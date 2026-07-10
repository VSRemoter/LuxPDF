/* LuxPDF native-fidelity DOM capture engine.
 *
 * html2canvas re-implements browser text layout and routinely produces
 * mid-word line breaks, wrong justification and broken backgrounds. This
 * engine instead serializes the live DOM into an SVG <foreignObject> and lets
 * the browser itself rasterize it, which yields pixel-identical text layout.
 * html2canvas remains available as an automatic fallback.
 */
Object.assign(PDFConverterPro.prototype, {

    __captureXmlSerializer: null,

    getCaptureSerializer() {
        if (!this.__captureXmlSerializer) {
            this.__captureXmlSerializer = new XMLSerializer();
        }
        return this.__captureXmlSerializer;
    },

    // Replace live <canvas> elements in a clone with <img> snapshots so they
    // survive serialization, and mirror form field state.
    prepareCloneForCapture(sourceNode, cloneNode) {
        try {
            const sourceCanvases = sourceNode.querySelectorAll ? sourceNode.querySelectorAll('canvas') : [];
            const cloneCanvases = cloneNode.querySelectorAll ? cloneNode.querySelectorAll('canvas') : [];
            for (let i = 0; i < cloneCanvases.length; i += 1) {
                const src = sourceCanvases[i];
                const clone = cloneCanvases[i];
                if (!src || !clone || !clone.parentNode) continue;
                let replacement = null;
                try {
                    const img = (cloneNode.ownerDocument || document).createElement('img');
                    img.src = src.toDataURL('image/png');
                    if (clone.getAttribute('style')) img.setAttribute('style', clone.getAttribute('style'));
                    if (clone.getAttribute('class')) img.setAttribute('class', clone.getAttribute('class'));
                    img.setAttribute('width', String(src.width));
                    img.setAttribute('height', String(src.height));
                    replacement = img;
                } catch (_) { /* tainted canvas: drop it */ }
                if (replacement) {
                    clone.parentNode.replaceChild(replacement, clone);
                } else {
                    clone.parentNode.removeChild(clone);
                }
            }
        } catch (_) { /* non-fatal */ }

        try {
            Array.from(cloneNode.querySelectorAll ? cloneNode.querySelectorAll('script, iframe, embed, object, audio, video') : [])
                .forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });
        } catch (_) { /* non-fatal */ }

        // Some HTML generators (e.g. PPTXjs) emit malformed attributes like a
        // stray quote, which the HTML parser keeps as an attribute named "'".
        // XMLSerializer outputs them verbatim and the SVG then fails to parse.
        try {
            const validAttrName = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
            const walker = [cloneNode];
            while (walker.length) {
                const el = walker.pop();
                if (el && el.attributes) {
                    for (let i = el.attributes.length - 1; i >= 0; i -= 1) {
                        const attr = el.attributes[i];
                        if (validAttrName.test(attr.name)) continue;
                        try {
                            el.removeAttributeNode(attr);
                        } catch (_) {
                            try { el.removeAttribute(attr.name); } catch (_) { /* keep going */ }
                        }
                    }
                }
                if (el && el.children) {
                    for (let i = 0; i < el.children.length; i += 1) walker.push(el.children[i]);
                }
            }
        } catch (_) { /* non-fatal */ }
    },

    // SVG-as-image documents cannot reference any external or blob: URLs;
    // inline every <img> that isn't already a data URL.
    async inlineCloneBlobImages(cloneNode) {
        const images = Array.from(cloneNode.querySelectorAll ? cloneNode.querySelectorAll('img[src]') : [])
            .filter((img) => {
                const src = img.getAttribute('src') || '';
                return src && !src.startsWith('data:');
            });
        await Promise.all(images.map(async (img) => {
            try {
                const response = await fetch(img.src);
                const blob = await response.blob();
                img.src = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('blob read failed'));
                    reader.readAsDataURL(blob);
                });
            } catch (_) {
                img.removeAttribute('src');
            }
        }));

        // Inline blob: URLs that appear in inline style attributes (e.g.
        // slide background images), then blank any other external url().
        const styledNodes = Array.from(cloneNode.querySelectorAll ? cloneNode.querySelectorAll('[style*="url(" i]') : []);
        await Promise.all(styledNodes.map(async (el) => {
            let styleValue = el.getAttribute('style') || '';
            const blobUrls = Array.from(new Set((styleValue.match(/url\(\s*(["']?)(blob:[^)"']+)\1\s*\)/gi) || [])
                .map((m) => m.replace(/^url\(\s*(["']?)/i, '').replace(/(["']?)\s*\)$/, ''))));
            for (const blobUrl of blobUrls) {
                try {
                    const response = await fetch(blobUrl);
                    const blob = await response.blob();
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => reject(new Error('blob style read failed'));
                        reader.readAsDataURL(blob);
                    });
                    styleValue = styleValue.split(blobUrl).join(dataUrl);
                } catch (_) { /* blanked below */ }
            }
            el.setAttribute('style', this.sanitizeCssForSvgCapture(styleValue));
        }));
    },

    // PPTXjs emits every space as &nbsp;, which removes all word-wrap
    // opportunities and makes the browser break words at arbitrary letters.
    // Restore normal spaces and preserve runs of them with pre-wrap so text
    // wraps at word boundaries exactly like PowerPoint does.
    fixNbspTextWrapping(rootNode) {
        try {
            const doc = rootNode.ownerDocument || document;
            const walker = doc.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);
            textNodes.forEach((tn) => {
                if (tn.nodeValue && tn.nodeValue.indexOf('\u00A0') !== -1) {
                    tn.nodeValue = tn.nodeValue.replace(/\u00A0/g, ' ');
                }
            });
            Array.from(rootNode.querySelectorAll('.text-block')).forEach((el) => {
                el.style.whiteSpace = 'pre-wrap';
            });
        } catch (_) { /* non-fatal */ }
    },

    // SVG images cannot load external subresources: strip @import rules and
    // blank out any url() pointing at http(s)/blob targets. data: URLs pass.
    sanitizeCssForSvgCapture(css) {
        return String(css || '')
            .replace(/@import[^;]+;/gi, '')
            .replace(/url\(\s*(["']?)(?!data:)[^)"']*\1\s*\)/gi, 'url("")');
    },

    // <style> text inside the SVG's XHTML payload must be XML-safe.
    buildCaptureStyleMarkup(styleTexts) {
        return (styleTexts || [])
            .filter(Boolean)
            .map((css) => `<style>${this.sanitizeCssForSvgCapture(css)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')}</style>`)
            .join('');
    },

    // Serialize a DOM node (plus supporting CSS) into a standalone SVG string.
    buildCaptureSvg(node, options) {
        const width = options.width;
        const height = options.height;
        const scale = options.scale;
        const serializer = this.getCaptureSerializer();

        let inner;
        if (options.serializeWholeDocument && node.ownerDocument && node.ownerDocument.documentElement) {
            inner = serializer.serializeToString(node.ownerDocument.documentElement);
        } else {
            inner = serializer.serializeToString(node);
        }

        // XHTML requires a single namespaced root.
        const styleMarkup = this.buildCaptureStyleMarkup(options.styleTexts);

        const bg = options.backgroundColor === null || options.backgroundColor === 'transparent'
            ? ''
            : `background:${options.backgroundColor || '#ffffff'};`;

        const wrapperClass = options.wrapperClassName ? ` class="${options.wrapperClassName}"` : '';
        const body = options.serializeWholeDocument
            ? inner
            : `<div xmlns="http://www.w3.org/1999/xhtml"${wrapperClass} style="margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;${bg}position:relative;">${styleMarkup}${inner}</div>`;

        const viewX = options.viewX || 0;
        const viewY = options.viewY || 0;
        const foWidth = options.contentWidth || width;
        const foHeight = options.contentHeight || height;

        return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="${viewX} ${viewY} ${width} ${height}">` +
            (options.serializeWholeDocument ? `<foreignObject x="0" y="0" width="${foWidth}" height="${foHeight}">${styleMarkup ? `<div xmlns="http://www.w3.org/1999/xhtml">${styleMarkup}</div>` : ''}${body}</foreignObject>` :
                `<foreignObject x="0" y="0" width="${foWidth}" height="${foHeight}">${body}</foreignObject>`) +
            `</svg>`;
    },

    async rasterizeSvgString(svgMarkup, targetWidth, targetHeight, backgroundColor) {
        // NOTE: must be a data: URL. SVG images containing <foreignObject>
        // loaded from blob: URLs taint the destination canvas in Chromium.
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
        const image = new Image();
        const loaded = new Promise((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('SVG snapshot failed to load'));
        });
        image.src = url;
        await loaded;
        try { if (image.decode) await image.decode(); } catch (_) { /* decode is best-effort */ }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(targetWidth));
        canvas.height = Math.max(1, Math.round(targetHeight));
        const ctx = canvas.getContext('2d');
        if (backgroundColor && backgroundColor !== 'transparent') {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
    },

    // Heuristic: a capture that came back fully uniform almost certainly failed.
    canvasLooksUniform(canvas) {
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const w = canvas.width;
            const h = canvas.height;
            if (!w || !h) return true;
            const samples = 144;
            const cols = 12;
            const rows = 12;
            let first = null;
            for (let i = 0; i < samples; i += 1) {
                const x = Math.min(w - 1, Math.floor(((i % cols) + 0.5) * (w / cols)));
                const y = Math.min(h - 1, Math.floor((Math.floor(i / cols) + 0.5) * (h / rows)));
                const d = ctx.getImageData(x, y, 1, 1).data;
                const key = `${d[0]},${d[1]},${d[2]},${d[3]}`;
                if (first === null) first = key;
                else if (key !== first) return false;
            }
            return true;
        } catch (_) {
            return false;
        }
    },

    // Compare two renders at a fixed sampling grid. Browser SVG snapshots are
    // normally deterministic; a large difference indicates an intermittent
    // foreignObject paint failure (often visible as black rectangles).
    canvasSampleDistance(a, b) {
        try {
            if (!a || !b || a.width !== b.width || a.height !== b.height) return Infinity;
            const cols = 24;
            const rows = 14;
            const sample = (source) => {
                const probe = document.createElement('canvas');
                probe.width = cols;
                probe.height = rows;
                const probeCtx = probe.getContext('2d', { willReadFrequently: true });
                probeCtx.drawImage(source, 0, 0, cols, rows);
                return probeCtx.getImageData(0, 0, cols, rows).data;
            };
            const pixelsA = sample(a);
            const pixelsB = sample(b);
            let delta = 0;
            for (let i = 0; i < pixelsA.length; i += 1) {
                delta += Math.abs(pixelsA[i] - pixelsB[i]);
            }
            return pixelsA.length ? delta / pixelsA.length : Infinity;
        } catch (_) {
            return Infinity;
        }
    },

    // Chromium can occasionally replace a foreignObject subtree with a solid
    // black rectangle. Detect that specific failure without rendering every
    // slide two or three times.
    canvasHasSuspiciousBlackBlock(canvas) {
        try {
            const cols = 32;
            const rows = 18;
            const probe = document.createElement('canvas');
            probe.width = cols;
            probe.height = rows;
            const ctx = probe.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(canvas, 0, 0, cols, rows);
            const pixels = ctx.getImageData(0, 0, cols, rows).data;
            const black = new Uint8Array(cols * rows);
            let blackCount = 0;
            for (let i = 0; i < black.length; i += 1) {
                const p = i * 4;
                if (pixels[p] <= 3 && pixels[p + 1] <= 3 && pixels[p + 2] <= 3 && pixels[p + 3] >= 250) {
                    black[i] = 1;
                    blackCount += 1;
                }
            }
            const total = cols * rows;
            if (blackCount < total * 0.06 || blackCount > total * 0.85) return false;

            const seen = new Uint8Array(total);
            for (let start = 0; start < total; start += 1) {
                if (!black[start] || seen[start]) continue;
                const queue = [start];
                seen[start] = 1;
                let count = 0;
                let minX = cols, maxX = 0, minY = rows, maxY = 0;
                while (queue.length) {
                    const current = queue.pop();
                    const x = current % cols;
                    const y = Math.floor(current / cols);
                    count += 1;
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                    const neighbours = [current - 1, current + 1, current - cols, current + cols];
                    for (const next of neighbours) {
                        if (next < 0 || next >= total || seen[next] || !black[next]) continue;
                        const nx = next % cols;
                        const ny = Math.floor(next / cols);
                        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
                        seen[next] = 1;
                        queue.push(next);
                    }
                }
                const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
                if (count >= total * 0.06 && boxArea && count / boxArea >= 0.88) return true;
            }
            return false;
        } catch (_) {
            return false;
        }
    },

    /**
     * Capture a DOM node with native browser rendering.
     * options:
     *   width/height  - CSS px size to capture (defaults to bounding box)
     *   scale         - raster scale factor
     *   backgroundColor
     *   styleTexts    - array of CSS strings the subtree depends on
     *   wrapperClassName - class names to apply to the capture wrapper
     *   expectContent - if true, falls back when the result is uniform
     */
    async captureNodeToCanvasNative(node, options = {}) {
        const size = this.getRenderableNodeSize(node);
        const width = Math.max(1, Math.ceil(options.width || size.width));
        const height = Math.max(1, Math.ceil(options.height || size.height));
        const scale = Math.max(0.5, options.scale || 2);

        const clone = node.cloneNode(true);
        this.prepareCloneForCapture(node, clone);
        await this.inlineCloneBlobImages(clone);

        const svgMarkup = this.buildCaptureSvg(clone, {
            width,
            height,
            scale,
            styleTexts: options.styleTexts || [],
            backgroundColor: options.backgroundColor !== undefined ? options.backgroundColor : '#ffffff',
            wrapperClassName: options.wrapperClassName || ''
        });

        return this.rasterizeSvgString(
            svgMarkup,
            width * scale,
            height * scale,
            options.backgroundColor !== undefined ? options.backgroundColor : '#ffffff'
        );
    },

    /**
     * Prepare a node for repeated windowed captures (serialize once, then
     * rasterize arbitrary vertical windows via SVG viewBox cropping).
     */
    async createNodeCaptureSession(node, options = {}) {
        const size = this.getRenderableNodeSize(node);
        const width = Math.max(1, Math.ceil(options.width || size.width));
        const totalHeight = Math.max(1, Math.ceil(options.height || size.height));

        const clone = node.cloneNode(true);
        this.prepareCloneForCapture(node, clone);
        await this.inlineCloneBlobImages(clone);

        const serializer = this.getCaptureSerializer();
        const inner = serializer.serializeToString(clone);
        const styleMarkup = this.buildCaptureStyleMarkup(options.styleTexts);
        const bg = options.backgroundColor === null || options.backgroundColor === 'transparent'
            ? ''
            : `background:${options.backgroundColor || '#ffffff'};`;
        const wrapperClass = options.wrapperClassName ? ` class="${options.wrapperClassName}"` : '';
        const bodyMarkup = `<div xmlns="http://www.w3.org/1999/xhtml"${wrapperClass} style="margin:0;padding:0;width:${width}px;height:${totalHeight}px;overflow:hidden;${bg}position:relative;">${styleMarkup}${inner}</div>`;

        return {
            width,
            totalHeight,
            bodyMarkup,
            backgroundColor: options.backgroundColor !== undefined ? options.backgroundColor : '#ffffff'
        };
    },

    async captureSessionWindow(session, y, height, scale) {
        const cropY = Math.max(0, Math.floor(y));
        const cropHeight = Math.max(1, Math.ceil(Math.min(height, session.totalHeight - cropY)));
        const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(session.width * scale)}" height="${Math.round(cropHeight * scale)}" viewBox="0 ${cropY} ${session.width} ${cropHeight}">` +
            `<foreignObject x="0" y="0" width="${session.width}" height="${session.totalHeight}">${session.bodyMarkup}</foreignObject>` +
            `</svg>`;
        return this.rasterizeSvgString(
            svgMarkup,
            session.width * scale,
            cropHeight * scale,
            session.backgroundColor
        );
    },

    /**
     * Collect vertical intervals (relative to the top of rootNode) that are
     * occupied by indivisible content: text line boxes, images, table rows...
     * Page breaks placed outside these intervals never slice a line in half.
     */
    computeOccupiedIntervals(rootNode, options = {}) {
        const doc = rootNode.ownerDocument || document;
        const win = doc.defaultView || window;
        const rootRect = rootNode.getBoundingClientRect();
        const intervals = [];
        const push = (top, bottom) => {
            if (!(bottom > top)) return;
            intervals.push([top - rootRect.top, bottom - rootRect.top]);
        };

        try {
            const walker = doc.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null);
            const range = doc.createRange();
            let textNode;
            while ((textNode = walker.nextNode())) {
                if (!textNode.nodeValue || !textNode.nodeValue.trim()) continue;
                range.selectNodeContents(textNode);
                const rects = range.getClientRects();
                for (let i = 0; i < rects.length; i += 1) {
                    const r = rects[i];
                    if (r.width > 0 && r.height > 0) {
                        // Adjacent CSS line boxes often touch exactly. Keeping
                        // their full rectangles makes them merge into one tall
                        // occupied interval, leaving pagination no legal gap
                        // and forcing a hard cut through glyphs. A sub-pixel
                        // inset preserves each line as an independent interval
                        // while still protecting all visible text pixels.
                        const inset = Math.min(0.75, r.height * 0.08);
                        push(r.top + inset, r.bottom - inset);
                    }
                }
            }
        } catch (_) { /* fall back to element scanning below */ }

        try {
            rootNode.querySelectorAll('img, svg, canvas, video, hr, input, select, textarea, button')
                .forEach((el) => {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) push(r.top, r.bottom);
                });
            if (options.atomicTableRows !== false) {
                // Table rows are atomic by default. DOCX pagination disables
                // this because Word permits long rows to continue on the next
                // page; the text-line intervals still prevent sliced glyphs.
                rootNode.querySelectorAll('tr').forEach((el) => {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 2) push(r.top + 0.75, r.bottom - 0.75);
                });
            }
        } catch (_) { /* non-fatal */ }

        intervals.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const interval of intervals) {
            const last = merged[merged.length - 1];
            if (last && interval[0] <= last[1] + 0.5) {
                last[1] = Math.max(last[1], interval[1]);
            } else {
                merged.push([interval[0], interval[1]]);
            }
        }
        return merged;
    },

    /**
     * Compute page-break offsets within [0, totalHeight] for a given page
     * height, snapping breaks to gaps between occupied intervals so no text
     * line or image is sliced in half. Falls back to hard cuts when a page
     * has no usable gap (e.g. an image taller than the page).
     */
    computePageBreakOffsets(occupiedIntervals, pageContentHeight, totalHeight, minFillRatio = 0.3) {
        const breaks = [];
        let cursor = 0;
        const limit = 100000;
        let guard = 0;

        while (cursor + pageContentHeight < totalHeight && guard < limit) {
            guard += 1;
            const target = cursor + pageContentHeight;
            let safe = -1;

            for (const [top, bottom] of occupiedIntervals) {
                if (top >= target) break;
                let candidate;
                if (bottom <= target) {
                    candidate = Math.ceil(bottom) + 1; // cut just below a completed line
                } else {
                    candidate = Math.floor(top); // cut just above a spanning element
                }
                if (candidate > cursor && candidate <= target) {
                    safe = Math.max(safe, candidate);
                }
            }

            let breakY;
            if (safe > cursor + pageContentHeight * minFillRatio) {
                breakY = Math.min(target, safe);
            } else {
                breakY = target; // hard cut, no better option on this page
            }
            breaks.push(breakY);
            cursor = breakY;
        }

        breaks.push(totalHeight);
        return breaks;
    },

    async captureNodeSmart(node, options = {}) {
        let nativeError = null;
        try {
            const canvas = await this.captureNodeToCanvasNative(node, options);
            const expectContent = options.expectContent !== false;
            if (!expectContent || !this.canvasLooksUniform(canvas)) {
                const shouldVerify = options.verifyNative === true ||
                    (options.verifyNative === 'auto' && this.canvasHasSuspiciousBlackBlock(canvas));
                if (shouldVerify) {
                    const second = await this.captureNodeToCanvasNative(node, options);
                    const d01 = this.canvasSampleDistance(canvas, second);
                    if (d01 <= 2) {
                        second.width = 1; second.height = 1;
                        return canvas;
                    }

                    const third = await this.captureNodeToCanvasNative(node, options);
                    const d02 = this.canvasSampleDistance(canvas, third);
                    const d12 = this.canvasSampleDistance(second, third);
                    const scores = [d01 + d02, d01 + d12, d02 + d12];
                    const candidates = [canvas, second, third];
                    let best = 0;
                    if (scores[1] < scores[best]) best = 1;
                    if (scores[2] < scores[best]) best = 2;
                    candidates.forEach((candidate, index) => {
                        if (index !== best) { candidate.width = 1; candidate.height = 1; }
                    });
                    console.warn('Native DOM capture varied between attempts; selected the closest repeat.');
                    return candidates[best];
                }
                return canvas;
            }
            nativeError = new Error('Native capture produced an empty image');
        } catch (err) {
            nativeError = err;
        }

        if (nativeError) {
            console.warn('Native DOM capture failed; falling back to html2canvas:', nativeError);
        }
        if (!window.html2canvas) throw nativeError;

        const size = this.getRenderableNodeSize(node);
        const width = Math.max(1, Math.ceil(options.width || size.width));
        const height = Math.max(1, Math.ceil(options.height || size.height));
        try {
            return await window.html2canvas(node, {
                scale: Math.max(0.5, options.scale || 2),
                useCORS: true,
                allowTaint: true,
                backgroundColor: options.backgroundColor !== undefined ? options.backgroundColor : '#ffffff',
                imageTimeout: 30000,
                logging: false,
                width,
                height,
                windowWidth: width,
                windowHeight: height,
                scrollX: 0,
                scrollY: 0
            });
        } catch (fallbackError) {
            throw nativeError || fallbackError;
        }
    },

    // ------------------------------------------------------------------
    // Font support helpers
    // ------------------------------------------------------------------

    // Collect @font-face rules from style elements inside a container.
    collectFontFaceCss(container) {
        if (!container) return '';
        const chunks = [];
        try {
            container.querySelectorAll('style').forEach((styleEl) => {
                const text = styleEl.textContent || '';
                const matches = text.match(/@font-face\s*\{[^}]*\}/gi);
                if (matches) chunks.push(...matches);
            });
        } catch (_) { /* non-fatal */ }
        return chunks.join('\n');
    },

    parseFontFamiliesFromFontFaceCss(css) {
        const families = new Set();
        const rules = String(css || '').match(/@font-face\s*\{[^}]*\}/gi) || [];
        rules.forEach((rule) => {
            const m = rule.match(/font-family\s*:\s*(["']?)([^;"'}]+)\1/i);
            if (m && m[2]) families.add(m[2].trim());
        });
        return families;
    },

    // Find every font-family referenced by inline styles within a subtree.
    collectUsedFontFamilies(rootNode) {
        const used = new Set();
        const addFromValue = (value) => {
            String(value || '').split(',').forEach((part) => {
                const name = part.trim().replace(/^["']|["']$/g, '');
                if (name && !/^var\(/i.test(name) && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|inherit|initial|unset)$/i.test(name)) {
                    used.add(name);
                }
            });
        };
        try {
            if (rootNode.querySelectorAll) {
                rootNode.querySelectorAll('[style*="font-family" i]').forEach((el) => {
                    addFromValue(el.style && el.style.fontFamily);
                });
                rootNode.querySelectorAll('style').forEach((styleEl) => {
                    const matches = (styleEl.textContent || '').match(/font-family\s*:\s*([^;}{]+)[;}]/gi) || [];
                    matches.forEach((decl) => addFromValue(decl.replace(/font-family\s*:\s*/i, '').replace(/[;}]$/, '')));
                });
            }
        } catch (_) { /* non-fatal */ }
        return used;
    },

    isFontFamilyAvailable(family) {
        // document.fonts.check() returns true for unknown families, so detect
        // availability by comparing text metrics against generic fallbacks.
        try {
            if (!this.__fontProbeCtx) {
                const probe = document.createElement('canvas');
                probe.width = 64;
                probe.height = 64;
                this.__fontProbeCtx = probe.getContext('2d');
            }
            const ctx = this.__fontProbeCtx;
            const sample = 'mmmWWWlli10O@#abcDEF';
            const measure = (font) => {
                ctx.font = `72px ${font}`;
                return ctx.measureText(sample).width;
            };
            const quoted = `"${String(family).replace(/"/g, '')}"`;
            const monoBase = measure('monospace');
            const serifBase = measure('serif');
            return measure(`${quoted}, monospace`) !== monoBase ||
                measure(`${quoted}, serif`) !== serifBase;
        } catch (_) {
            return false;
        }
    },

    // Try to load a missing font family from Google Fonts; returns a CSS string
    // of @font-face rules with data: URLs (usable inside SVG captures), or ''.
    async fetchGoogleFontCss(family) {
        try {
            const fam = encodeURIComponent(String(family).trim()).replace(/%20/g, '+');
            const cssUrl = `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;
            const response = await fetch(cssUrl, { mode: 'cors', signal: controller ? controller.signal : undefined });
            if (timer) clearTimeout(timer);
            if (!response.ok) return '';
            let css = await response.text();

            const urls = Array.from(new Set((css.match(/url\((https:[^)]+)\)/g) || []).map(u => u.slice(4, -1))));
            for (const url of urls) {
                try {
                    const fontResponse = await fetch(url, { mode: 'cors' });
                    if (!fontResponse.ok) { css = ''; break; }
                    const buf = await fontResponse.arrayBuffer();
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => reject(new Error('font read failed'));
                        reader.readAsDataURL(new Blob([buf], { type: 'font/woff2' }));
                    });
                    css = css.split(url).join(dataUrl);
                } catch (_) {
                    css = '';
                    break;
                }
            }
            return css || '';
        } catch (_) {
            return '';
        }
    },

    // Register CSS @font-face rules in a live document so layout/measurement
    // uses them too. Returns the created <style> element.
    async registerFontCssInDocument(css, markerId, targetDoc = document) {
        if (!css) return null;
        if (markerId && targetDoc.getElementById(markerId)) return targetDoc.getElementById(markerId);
        const styleEl = targetDoc.createElement('style');
        if (markerId) styleEl.id = markerId;
        styleEl.textContent = css;
        (targetDoc.head || targetDoc.documentElement).appendChild(styleEl);
        try {
            if (targetDoc.fonts && targetDoc.fonts.ready) {
                await Promise.race([
                    targetDoc.fonts.ready.catch(() => {}),
                    new Promise((resolve) => setTimeout(resolve, 4000))
                ]);
            }
        } catch (_) { /* non-fatal */ }
        return styleEl;
    },

    /**
     * Build CSS that resolves missing font families:
     *  1. alias to an embedded face whose name is a prefix/superset match
     *  2. try Google Fonts
     * Returns combined CSS string (may be '').
     */
    async buildMissingFontCss(usedFamilies, embeddedFontFaceCss) {
        const embedded = this.parseFontFamiliesFromFontFaceCss(embeddedFontFaceCss);
        const cssParts = [];
        const googleFamilies = [];

        for (const family of usedFamilies) {
            if (embedded.has(family) || this.isFontFamilyAvailable(family)) continue;

            // Prefix alias: "Google Sans Text" -> embedded "Google Sans"
            let aliasSource = null;
            for (const candidate of embedded) {
                if (family.toLowerCase().startsWith(candidate.toLowerCase()) ||
                    candidate.toLowerCase().startsWith(family.toLowerCase())) {
                    if (!aliasSource || candidate.length > aliasSource.length) aliasSource = candidate;
                }
            }
            if (aliasSource) {
                const rules = (String(embeddedFontFaceCss).match(/@font-face\s*\{[^}]*\}/gi) || [])
                    .filter((rule) => {
                        const m = rule.match(/font-family\s*:\s*(["']?)([^;"'}]+)\1/i);
                        return m && m[2] && m[2].trim() === aliasSource;
                    })
                    .map((rule) => rule.replace(/font-family\s*:\s*(["']?)[^;"'}]+\1/i, `font-family: "${family}"`));
                if (rules.length) {
                    cssParts.push(rules.join('\n'));
                    continue;
                }
            }

            googleFamilies.push(family);
        }

        // Font lookups are best-effort. Run a bounded set concurrently so an
        // unavailable font service cannot make a deck appear to hang.
        const remoteCss = await Promise.all(googleFamilies.slice(0, 12).map((family) => this.fetchGoogleFontCss(family)));
        remoteCss.forEach((css) => { if (css) cssParts.push(css); });

        return cssParts.join('\n');
    },

    // SVG-as-image documents cannot reference blob: URLs; inline them.
    async inlineBlobUrlsInCss(css) {
        let nextCss = String(css || '');
        const blobUrls = Array.from(new Set((nextCss.match(/url\((["']?)(blob:[^)"']+)\1\)/gi) || [])
            .map((m) => m.replace(/^url\((["']?)/i, '').replace(/(["']?)\)$/, ''))));
        for (const blobUrl of blobUrls) {
            try {
                const response = await fetch(blobUrl);
                const blob = await response.blob();
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('blob css read failed'));
                    reader.readAsDataURL(blob);
                });
                nextCss = nextCss.split(blobUrl).join(dataUrl);
            } catch (_) { /* leave as-is; fallback renderer may still work */ }
        }
        return nextCss;
    },

    // Collect every CSS rule active in the document (style tags + same-origin
    // stylesheets), used to make SVG captures style-identical to the live DOM.
    async collectDocumentCssTexts(doc = document) {
        const cssTexts = [];
        const sheets = Array.from(doc.styleSheets || []);
        for (const sheet of sheets) {
            try {
                const rules = sheet.cssRules;
                if (rules) {
                    cssTexts.push(Array.from(rules).map((rule) => rule.cssText).join('\n'));
                    continue;
                }
            } catch (_) { /* cross-origin; try fetching below */ }
            const href = sheet.href;
            if (href) {
                try {
                    const response = await fetch(href, { mode: 'cors' });
                    if (response.ok) cssTexts.push(await response.text());
                } catch (_) { /* skip unreadable sheet */ }
            }
        }
        return cssTexts;
    },

    // Cooperative yield so long conversions don't freeze the UI thread.
    async yieldToUiThread() {
        await new Promise((resolve) => setTimeout(resolve, 0));
    },

    setConversionProgressText(text) {
        try {
            const progressText = document.getElementById('progress-text');
            if (progressText && text) progressText.textContent = text;
        } catch (_) { /* non-fatal */ }
    }
});
