/* Split from script.js */
Object.assign(PDFConverterPro.prototype, {
    loadStylesheet(url, id) {
        return new Promise((resolve, reject) => {
            // If an element with this id or href already exists, resolve
            if (id && document.getElementById(id)) return resolve();
            const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(l => l.href && l.href.includes(url));
            if (existing) return resolve();
            const link = document.createElement('link');
            if (id) link.id = id;
            link.rel = 'stylesheet';
            link.href = url;
            link.onload = () => resolve();
            link.onerror = () => reject(new Error('Failed to load stylesheet: ' + url));
            document.head.appendChild(link);
        });
    },
    // Helper: load first available script from a list of URLs

    async loadFirstAvailableScript(urls) {
        for (const url of urls) {
            try {
                await this.loadScript(url);
                return true;
            } catch (_) { /* try next */ }
        }
        return false;
    },
    // Helper: load first available stylesheet from a list of URLs

    async loadFirstAvailableStylesheet(urls, id) {
        for (const url of urls) {
            try {
                await this.loadStylesheet(url, id);
                return true;
            } catch (_) { /* try next */ }
        }
        return false;
    },
    // Ensure extra libs for Markdown rendering fidelity (KaTeX, highlight.js, Twemoji, GitHub Markdown CSS)

    async ensureMarkdownEnhancementLibs() {
        // Styles with fallbacks
        await this.loadFirstAvailableStylesheet([
            'https://cdn.jsdelivr.net/npm/github-markdown-css@5.2.0/github-markdown.min.css',
            'https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown.min.css'
        ], 'github-markdown-css');

        await this.loadFirstAvailableStylesheet([
            'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css',
            'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css'
        ], 'hljs-github-css');

        await this.loadFirstAvailableStylesheet([
            'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
            'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css'
        ], 'katex-css');

        // KaTeX core and auto-render (prefer jsDelivr)
        if (!window.katex) {
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js'
            ]);
        }
        if (!window.renderMathInElement) {
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js'
            ]);
        }

        // highlight.js (prefer jsDelivr; non-fatal if blocked)
        if (!window.hljs) {
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js',
                'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/highlight.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
            ]);
        }

        // Twemoji (prefer jsDelivr, fallback to unpkg; non-fatal)
        if (!window.twemoji) {
            const ok = await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js',
                'https://unpkg.com/twemoji@14.0.2/dist/twemoji.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/twemoji.min.js'
            ]);
            if (!ok) {
                // Do not throw; emoji rendering will fall back to native glyphs
                console.warn('Twemoji failed to load from all CDNs; continuing without it.');
            }
        }
    },
    // Post-process the container: Twemoji, KaTeX auto-render, highlight.js

    postProcessMarkdownContainer(container) {
        try {
            if (window.twemoji) {
                window.twemoji.parse(container, {
                    folder: 'svg',
                    ext: '.svg',
                    attributes: () => ({ crossorigin: 'anonymous' })
                });
            }
        } catch (_) { /* ignore emoji errors */ }

        try {
            if (window.renderMathInElement) {
                window.renderMathInElement(container, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false },
                        { left: '\\(', right: '\\)', display: false },
                        { left: '\\[', right: '\\]', display: true }
                    ],
                    throwOnError: false
                });
            }
        } catch (_) { /* ignore katex errors */ }

        try {
            if (window.hljs) {
                container.querySelectorAll('pre code').forEach((block) => {
                    try { window.hljs.highlightElement(block); } catch (_) {}
                });
            }
        } catch (_) { /* ignore highlight errors */ }
    },
    // Ensure Markdown library is available

    async ensureMarkdownLib() {
        if (!window.marked) {
            // marked v4+ exposes window.marked
            await this.loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
        }
        if (!window.marked) {
            throw new Error('Markdown parser failed to load');
        }
    },
    // Markdown to PDF Conversion (High Fidelity rendering via DOM -> html2canvas -> jsPDF)

    async convertMarkdownToPdf() {
        const results = [];

        // Ensure libraries are available
        await this.ensureMarkdownLib();
        await this.ensureHtmlRenderingLibs();
        await this.ensureMarkdownEnhancementLibs();
        const { jsPDF } = window.jspdf;

        for (const file of this.uploadedFiles) {
            try {
                // Read Markdown content with fallback decoding
                let md;
                try {
                    md = await file.text();
                } catch (readError) {
                    const arrayBuffer = await file.arrayBuffer();
                    const decoder = new TextDecoder('utf-8', { fatal: false });
                    md = decoder.decode(arrayBuffer);
                }

                md = (md || '')
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n')
                    .trim();

                if (!md) {
                    throw new Error('File appears to be empty or contains no readable Markdown');
                }

                // Parse Markdown to HTML using marked
                const html = (typeof window.marked.parse === 'function')
                    ? window.marked.parse(md)
                    : window.marked(md);

                // Prepare offscreen container styled as GitHub Markdown
                const container = document.createElement('div');
                const containerWidth = 794; // ~A4 width at 96 DPI
                container.className = 'markdown-body';
                container.style.cssText = `position: fixed; left: -10000px; top: 0; width: ${containerWidth}px; padding: 0; background: #ffffff; color: #000; box-sizing: border-box; max-width: none;`;
                container.innerHTML = html;
                // Inject rendering tweaks (lists, emoji size, lighter code, overflow safety)
                const style = document.createElement('style');
                style.textContent = `
                    .markdown-body { line-height: 1.6; }
                    /* Paragraph spacing and first-line indent */
                    .markdown-body p { margin: 0 0 10pt; text-indent: 1.5em; }
                    /* Don't indent the first paragraph after headings/lists/blockquote */
                    .markdown-body h1 + p,
                    .markdown-body h2 + p,
                    .markdown-body h3 + p,
                    .markdown-body h4 + p,
                    .markdown-body h5 + p,
                    .markdown-body h6 + p,
                    .markdown-body li p,
                    .markdown-body blockquote p { text-indent: 0; }
                    .markdown-body ol { list-style: decimal; list-style-position: outside; padding-left: 2em; margin: 0.25em 0 0.7em; }
                    .markdown-body ul { list-style: disc; list-style-position: outside; padding-left: 2em; margin: 0.25em 0 0.7em; }
                    .markdown-body ol ol { list-style-type: lower-alpha; }
                    .markdown-body ol ol ol { list-style-type: lower-roman; }
                    .markdown-body li { margin: 0.35em 0; }
                    .markdown-body li > p { margin: 0.2em 0; }
                    .markdown-body img.emoji, .markdown-body img.twemoji { height: 1.15em; width: 1.15em; max-height: 1.15em; margin: 0 .05em 0 .1em; vertical-align: -0.18em; }
                    .markdown-body pre { background: #f6f8fa; border-radius: 6px; padding: 12px; overflow: auto; }
                    .markdown-body pre code, .markdown-body code { color: #5b6b7a; }
                    /* Lighten highlight.js theme colors */
                    .markdown-body pre code.hljs, .markdown-body code.hljs { color: #6b7c8a !important; }
                    .markdown-body .hljs-keyword, .markdown-body .hljs-title, .markdown-body .hljs-name, .markdown-body .hljs-selector-tag { color: #6a7ea0 !important; }
                    .markdown-body .hljs-string, .markdown-body .hljs-attr, .markdown-body .hljs-attribute, .markdown-body .hljs-number { color: #758ea6 !important; }
                    .markdown-body .hljs-comment, .markdown-body .hljs-quote { color: #8da0b3 !important; font-style: italic; }
                    .markdown-body table { border-collapse: collapse; }
                    .markdown-body th, .markdown-body td { border: 1px solid #e5e7eb; padding: 6px 10px; }
                    .markdown-body blockquote { border-left: 4px solid #e5e7eb; padding-left: 12px; color: #555; }
                    .markdown-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
                    .markdown-body * { box-sizing: border-box; }
                    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { break-inside: avoid; }
                    .markdown-body p, .markdown-body li, .markdown-body pre, .markdown-body table, .markdown-body blockquote, .markdown-body hr, .markdown-body img, .markdown-body figure { break-inside: avoid; }
                `;
                container.appendChild(style);
                document.body.appendChild(container);

                // Apply Twemoji, KaTeX, and syntax highlighting
                this.postProcessMarkdownContainer(container);

                // Render container to canvas
                const scale = 3; // higher scale for better quality
                const canvas = await html2canvas(container, {
                    backgroundColor: '#ffffff',
                    scale,
                    useCORS: true,
                    allowTaint: false,
                    imageTimeout: 10000,
                    logging: false,
                    removeContainer: true
                });
                // Note: Do not call toDataURL on the full canvas here to avoid cross-origin taint issues.

                // Setup PDF
                const doc = new jsPDF({ unit: 'pt', format: 'a4' });
                const pdfWidth = doc.internal.pageSize.getWidth();
                const pdfHeight = doc.internal.pageSize.getHeight();

                // Add 1-inch margins and map content to inner content box
                const marginPt = 72; // 1 inch
                const innerWidthPt = pdfWidth - 2 * marginPt;
                const innerHeightPt = pdfHeight - 2 * marginPt;
                const pageHeightPx = Math.floor(canvas.width * (innerHeightPt / innerWidthPt));

                // Slice canvas into pages with small overlap to reduce mid-line cuts
                let yOffset = 0;
                let pageIndex = 0;
                const overlapPx = Math.floor(8 * scale);
                while (yOffset < canvas.height) {
                    const sliceHeight = Math.min(pageHeightPx, canvas.height - yOffset);
                    const pageCanvas = document.createElement('canvas');
                    pageCanvas.width = canvas.width;
                    pageCanvas.height = sliceHeight;
                    const ctx = pageCanvas.getContext('2d');
                    ctx.drawImage(
                        canvas,
                        0, yOffset, canvas.width, sliceHeight,
                        0, 0, pageCanvas.width, sliceHeight
                    );

                    const imgHeightPt = innerWidthPt * (sliceHeight / canvas.width);
                    if (pageIndex > 0) doc.addPage();
                    try {
                        doc.addImage(pageCanvas, 'PNG', marginPt, marginPt, innerWidthPt, imgHeightPt, undefined, 'FAST');
                    } catch (e) {
                        try {
                            doc.addImage(pageCanvas, 'JPEG', marginPt, marginPt, innerWidthPt, imgHeightPt, undefined, 'FAST');
                        } catch (_) {}
                    }

                    const willHaveMore = (yOffset + sliceHeight) < canvas.height;
                    yOffset += willHaveMore ? (sliceHeight - overlapPx) : sliceHeight;
                    pageIndex += 1;
                }

                // Cleanup container
                container.remove();

                // Output
                const pdfBlob = doc.output('blob');
                const url = URL.createObjectURL(pdfBlob);
                let outName = file.name.replace(/\.(md|markdown)$/i, '.pdf');
                if (!/\.pdf$/i.test(outName)) outName = file.name + '.pdf';

                results.push({
                    name: outName,
                    type: 'application/pdf',
                    size: pdfBlob.size,
                    url
                });

                this.showNotification(`Successfully converted ${file.name} to PDF`, 'success');
            } catch (error) {
                console.error('Error converting Markdown to PDF:', error);
                this.showNotification(`Failed to convert ${file.name}: ${error.message}`, 'error');
                continue;
            }
        }

        if (results.length === 0) throw new Error('Failed to convert any Markdown files to PDF');
        return results;
    },
    // HTML to PDF Conversion (High Fidelity with clickable links)

    async convertHtmlToPdf() {
        const results = [];

        // Ensure rendering libraries are available
        await this.ensureHtmlRenderingLibs();
        const { jsPDF } = window.jspdf;
        const renderSession = this.createEpubRenderSession();

        try {
            for (const file of this.uploadedFiles) {
                try {
                    let html;
                    try {
                        html = await file.text();
                    } catch (readError) {
                        const arrayBuffer = await file.arrayBuffer();
                        const decoder = new TextDecoder('utf-8', { fatal: false });
                        html = decoder.decode(arrayBuffer);
                    }

                    html = String(html || '').trim();
                    if (!html) {
                        throw new Error('File appears to be empty or contains no readable HTML');
                    }

                    const renderableHtml = this.prepareHtmlDocumentForPdf(html);
                    const { canvas, linkRects } = await this.renderHtmlDocumentToCanvas(renderableHtml, {
                        renderScale: 2.2,
                        loadTimeoutMs: 25000,
                        assetWaitMs: 15000,
                        fontWaitMs: 5000,
                        preferForeignObjectRendering: true
                    }, renderSession);

                    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
                    const pdfWidth = doc.internal.pageSize.getWidth();
                    const pdfHeight = doc.internal.pageSize.getHeight();
                    const fullCanvasWidth = canvas.width;
                    const fullCanvasHeight = canvas.height;
                    const pageHeightPx = Math.max(1, Math.floor(fullCanvasWidth * (pdfHeight / pdfWidth)));
                    const ratioCanvasToPdf = pdfWidth / fullCanvasWidth;

                    let yOffset = 0;
                    let pageIndex = 0;

                    while (yOffset < fullCanvasHeight) {
                        const sliceHeight = Math.min(pageHeightPx, fullCanvasHeight - yOffset);
                        const pageCanvas = document.createElement('canvas');
                        pageCanvas.width = fullCanvasWidth;
                        pageCanvas.height = sliceHeight;
                        const ctx = pageCanvas.getContext('2d');
                        ctx.drawImage(
                            canvas,
                            0,
                            yOffset,
                            fullCanvasWidth,
                            sliceHeight,
                            0,
                            0,
                            fullCanvasWidth,
                            sliceHeight
                        );

                        const imgData = pageCanvas.toDataURL('image/png');
                        if (pageIndex > 0) doc.addPage();
                        const imgHeightPt = pdfWidth * (sliceHeight / fullCanvasWidth);
                        doc.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeightPt, undefined, 'FAST');

                        linkRects.forEach((linkRect) => {
                            const linkBottom = linkRect.top + linkRect.height;
                            const pageBottom = yOffset + sliceHeight;
                            const intersects = !(linkBottom <= yOffset || linkRect.top >= pageBottom);
                            if (!intersects) return;

                            const visibleTop = Math.max(linkRect.top, yOffset);
                            const visibleHeight = Math.min(linkBottom, pageBottom) - visibleTop;
                            if (visibleHeight <= 1) return;

                            try {
                                doc.link(
                                    linkRect.left * ratioCanvasToPdf,
                                    (visibleTop - yOffset) * ratioCanvasToPdf,
                                    linkRect.width * ratioCanvasToPdf,
                                    visibleHeight * ratioCanvasToPdf,
                                    { url: linkRect.href }
                                );
                            } catch (_) { /* ignore link annotation errors */ }
                        });

                        yOffset += sliceHeight;
                        pageIndex += 1;
                    }

                    const pdfBytes = doc.output('arraybuffer');
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    let outputName = file.name;
                    if (/\.(html?|xhtml)$/i.test(outputName)) {
                        outputName = outputName.replace(/\.(html?|xhtml)$/i, '.pdf');
                    } else {
                        outputName = `${outputName}.pdf`;
                    }

                    results.push({
                        name: outputName,
                        type: 'application/pdf',
                        size: blob.size,
                        url: URL.createObjectURL(blob)
                    });

                    this.showNotification(`Successfully converted ${file.name} to PDF`, 'success');
                } catch (error) {
                    console.error('Error converting HTML to PDF:', error);
                    this.showNotification(`Failed to convert ${file.name}: ${error.message}`, 'error');
                    continue;
                }
            }
        } finally {
            this.destroyEpubRenderSession(renderSession);
        }

        if (results.length === 0) {
            throw new Error('Failed to convert any HTML files to PDF');
        }

        return results;
    },

    prepareHtmlDocumentForPdf(htmlText) {
        const rawHtml = String(htmlText || '');
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawHtml, 'text/html');
        const root = doc.documentElement;
        const head = doc.head || doc.createElement('head');
        const body = doc.body || doc.createElement('body');

        Array.from(doc.querySelectorAll('script')).forEach((node) => node.remove());

        if (!head.querySelector('base')) {
            const base = doc.createElement('base');
            base.href = document.baseURI;
            head.insertBefore(base, head.firstChild);
        }

        if (!head.querySelector('meta[charset]')) {
            const charset = doc.createElement('meta');
            charset.setAttribute('charset', 'UTF-8');
            head.insertBefore(charset, head.firstChild);
        }

        if (!head.querySelector('meta[name="viewport"]')) {
            const viewport = doc.createElement('meta');
            viewport.setAttribute('name', 'viewport');
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
            head.appendChild(viewport);
        }

        const originalHasDocumentShell = /<html[\s>]|<head[\s>]|<body[\s>]|<!doctype/i.test(rawHtml);
        const bodyMarkup = originalHasDocumentShell ? body.innerHTML : rawHtml;
        const lang = (root && root.getAttribute('lang')) || document.documentElement.getAttribute('lang') || 'en';

        return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${head.innerHTML}
</head>
<body>
${bodyMarkup}
</body>
</html>`;
    },

    async renderHtmlDocumentToCanvas(htmlString, options = {}, renderSession = null) {
        const renderScale = Math.max(1, Number(options.renderScale) || 2.2);
        const loadTimeoutMs = Math.max(3000, Number(options.loadTimeoutMs) || 25000);
        const assetWaitMs = Math.max(1000, Number(options.assetWaitMs) || 15000);
        const fontWaitMs = Math.max(500, Number(options.fontWaitMs) || 5000);
        const preferForeignObjectRendering = options.preferForeignObjectRendering !== false;
        const session = renderSession || this.createEpubRenderSession();
        const ownsSession = !renderSession;

        try {
            if (session.iframe) {
                session.iframe.setAttribute('sandbox', 'allow-same-origin');
            }

            await this.loadHtmlIntoRenderSession(session, htmlString, loadTimeoutMs);
            await this.waitForIframeAssets(session.iframe, { timeoutMs: assetWaitMs, fontTimeoutMs: fontWaitMs });

            const iframe = session.iframe;
            const iframeDoc = iframe.contentDocument;
            const iframeWindow = iframe.contentWindow;
            if (!iframeDoc || !iframeWindow) {
                throw new Error('Unable to access HTML render frame');
            }

            const root = iframeDoc.documentElement;
            const body = iframeDoc.body || root;
            const captureTarget = body;
            const width = Math.max(
                1,
                Math.ceil(
                    Math.max(
                        body.scrollWidth || 0,
                        root.scrollWidth || 0,
                        body.offsetWidth || 0,
                        root.clientWidth || 0
                    )
                )
            );
            const height = Math.max(
                1,
                Math.ceil(
                    Math.max(
                        body.scrollHeight || 0,
                        root.scrollHeight || 0,
                        body.offsetHeight || 0,
                        root.clientHeight || 0
                    )
                )
            );

            iframe.style.width = `${width}px`;
            iframe.style.height = `${height}px`;
            await new Promise((resolveFrame) => iframeWindow.requestAnimationFrame(() => iframeWindow.requestAnimationFrame(resolveFrame)));

            const anchorBaseRect = captureTarget.getBoundingClientRect();
            const linkRects = Array.from(iframeDoc.querySelectorAll('a[href]'))
                .map((anchor) => {
                    const rawHref = (anchor.getAttribute('href') || '').trim();
                    if (!rawHref) return null;

                    let resolvedHref = rawHref;
                    try {
                        resolvedHref = new URL(rawHref, iframeDoc.baseURI || document.baseURI).href;
                    } catch (_) {
                        resolvedHref = rawHref;
                    }

                    if (!/^(https?:|mailto:|tel:)/i.test(resolvedHref)) {
                        return null;
                    }

                    const rect = anchor.getBoundingClientRect();
                    if (!rect.width || !rect.height) return null;

                    return {
                        href: resolvedHref,
                        left: (rect.left - anchorBaseRect.left) * renderScale,
                        top: (rect.top - anchorBaseRect.top) * renderScale,
                        width: rect.width * renderScale,
                        height: rect.height * renderScale
                    };
                })
                .filter(Boolean);

            const baseOptions = {
                backgroundColor: '#ffffff',
                scale: renderScale,
                useCORS: true,
                allowTaint: false,
                imageTimeout: assetWaitMs,
                logging: false,
                width,
                height,
                windowWidth: width,
                windowHeight: height,
                scrollX: 0,
                scrollY: 0
            };

            let canvas;
            try {
                canvas = await window.html2canvas(captureTarget, {
                    ...baseOptions,
                    foreignObjectRendering: preferForeignObjectRendering
                });
            } catch (primaryError) {
                if (!preferForeignObjectRendering) throw primaryError;
                canvas = await window.html2canvas(captureTarget, {
                    ...baseOptions,
                    foreignObjectRendering: false
                });
            }

            if (!canvas || !canvas.width || !canvas.height) {
                throw new Error('Rendered HTML did not produce a usable page image');
            }

            return { canvas, linkRects };
        } finally {
            if (ownsSession) {
                this.destroyEpubRenderSession(session);
            }
        }
    },

    async ensureEpubProcessingLibs() {
        await this.ensureHtmlRenderingLibs();
        if (!window.JSZip) {
            const loaded = await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
            ]);
            if (!loaded || !window.JSZip) {
                throw new Error('EPUB processing library failed to load');
            }
        }
    },

    normalizeArchivePath(path) {
        const cleaned = String(path || '').replace(/\\/g, '/').replace(/^\//, '');
        const segments = cleaned.split('/');
        const normalized = [];

        segments.forEach((segment) => {
            if (!segment || segment === '.') return;
            if (segment === '..') {
                normalized.pop();
                return;
            }
            normalized.push(segment);
        });

        return normalized.join('/');
    },

    dirnameArchivePath(path) {
        const normalized = this.normalizeArchivePath(path);
        const separatorIndex = normalized.lastIndexOf('/');
        return separatorIndex >= 0 ? normalized.slice(0, separatorIndex + 1) : '';
    },

    isExternalArchiveReference(reference) {
        return /^(?:[a-z]+:|\/\/|data:|blob:|mailto:|tel:|javascript:|#)/i.test(String(reference || '').trim());
    },

    splitArchiveReference(reference) {
        const raw = String(reference || '').trim();
        const hashIndex = raw.indexOf('#');
        const queryIndex = raw.indexOf('?');
        const cutIndex = [hashIndex, queryIndex].filter(index => index >= 0).sort((a, b) => a - b)[0];
        if (typeof cutIndex === 'number') {
            return {
                path: raw.slice(0, cutIndex),
                suffix: raw.slice(cutIndex)
            };
        }
        return { path: raw, suffix: '' };
    },

    resolveArchivePath(basePath, reference) {
        if (this.isExternalArchiveReference(reference)) {
            return String(reference || '').trim();
        }

        const { path, suffix } = this.splitArchiveReference(reference);
        const combined = `${this.dirnameArchivePath(basePath)}${path}`;
        const normalized = this.normalizeArchivePath(combined);
        return normalized ? `${normalized}${suffix}` : suffix;
    },

    getZipEntry(zip, path) {
        if (!zip || !path) return null;
        const normalized = this.normalizeArchivePath(path);
        return zip.file(normalized) || zip.file(path) || null;
    },

    getMimeTypeFromArchivePath(path, manifestByPath = new Map()) {
        const normalized = this.normalizeArchivePath(path);
        const manifestEntry = manifestByPath.get(normalized);
        if (manifestEntry && manifestEntry.mediaType) return manifestEntry.mediaType;

        const extension = (normalized.split('.').pop() || '').toLowerCase();
        const mimeTypes = {
            css: 'text/css',
            xhtml: 'application/xhtml+xml',
            html: 'text/html',
            htm: 'text/html',
            svg: 'image/svg+xml',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            avif: 'image/avif',
            bmp: 'image/bmp',
            ico: 'image/x-icon',
            ttf: 'font/ttf',
            otf: 'font/otf',
            woff: 'font/woff',
            woff2: 'font/woff2',
            eot: 'application/vnd.ms-fontobject',
            mp3: 'audio/mpeg',
            m4a: 'audio/mp4',
            mp4: 'video/mp4'
        };

        return mimeTypes[extension] || 'application/octet-stream';
    },

    async blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read EPUB asset'));
            reader.readAsDataURL(blob);
        });
    },

    async getArchiveAssetDataUrl(zip, manifestByPath, assetCache, assetPath) {
        const normalizedPath = this.normalizeArchivePath(assetPath);
        if (!normalizedPath) return null;
        if (assetCache.has(normalizedPath)) {
            return assetCache.get(normalizedPath);
        }

        const pending = (async () => {
            const zipEntry = this.getZipEntry(zip, normalizedPath);
            if (!zipEntry) return null;

            const blob = await zipEntry.async('blob');
            const typedBlob = blob.type
                ? blob
                : new Blob([await blob.arrayBuffer()], { type: this.getMimeTypeFromArchivePath(normalizedPath, manifestByPath) });
            return this.blobToDataUrl(typedBlob);
        })();

        assetCache.set(normalizedPath, pending);
        return pending;
    },

    async inlineEpubCss(cssText, cssPath, zip, manifestByPath, assetCache, importDepth = 0) {
        if (!cssText) return '';

        let nextCss = String(cssText);
        if (importDepth < 6) {
            const importPattern = /@import\s+(?:url\()?["']?([^"')]+)["']?\)?\s*;/gi;
            const importMatches = Array.from(nextCss.matchAll(importPattern));
            for (const match of importMatches) {
                const originalImport = match[0];
                const importReference = match[1];
                if (!importReference || this.isExternalArchiveReference(importReference)) {
                    nextCss = nextCss.replace(originalImport, '');
                    continue;
                }

                const importPath = this.resolveArchivePath(cssPath, importReference);
                const zipEntry = this.getZipEntry(zip, importPath);
                if (!zipEntry) {
                    nextCss = nextCss.replace(originalImport, '');
                    continue;
                }

                const importedCss = await zipEntry.async('string');
                const inlinedImport = await this.inlineEpubCss(importedCss, importPath, zip, manifestByPath, assetCache, importDepth + 1);
                nextCss = nextCss.replace(originalImport, inlinedImport);
            }
        } else {
            nextCss = nextCss.replace(/@import\s+(?:url\()?["']?([^"')]+)["']?\)?\s*;/gi, '');
        }

        const urlPattern = /url\(([^)]+)\)/gi;
        const urlMatches = Array.from(nextCss.matchAll(urlPattern));
        for (const match of urlMatches) {
            const originalValue = match[0];
            const rawReference = match[1].trim().replace(/^['"]|['"]$/g, '');
            if (!rawReference || this.isExternalArchiveReference(rawReference)) {
                if (/^(?:https?:|\/\/|javascript:)/i.test(rawReference)) {
                    nextCss = nextCss.replace(originalValue, 'url("")');
                }
                continue;
            }

            const assetPath = this.resolveArchivePath(cssPath, rawReference);
            const dataUrl = await this.getArchiveAssetDataUrl(zip, manifestByPath, assetCache, assetPath);
            if (dataUrl) {
                nextCss = nextCss.replace(originalValue, `url("${dataUrl}")`);
            } else {
                nextCss = nextCss.replace(originalValue, 'url("")');
            }
        }

        return nextCss;
    },

    async inlineEpubResourceAttributes(doc, docPath, zip, manifestByPath, assetCache) {
        const resourceSelectors = [
            { selector: 'img[src]', attributes: ['src'] },
            { selector: 'source[src]', attributes: ['src'] },
            { selector: 'audio[src]', attributes: ['src'] },
            { selector: 'video[src]', attributes: ['src'] },
            { selector: 'video[poster]', attributes: ['poster'] },
            { selector: 'object[data]', attributes: ['data'] },
            { selector: '[href][type^="image/"]', attributes: ['href'] },
            { selector: '[xlink\\:href]', attributes: ['xlink:href'] }
        ];

        for (const config of resourceSelectors) {
            const nodes = Array.from(doc.querySelectorAll(config.selector));
            for (const node of nodes) {
                const attributeNames = config.attributes.length ? config.attributes : [];
                for (const attributeName of attributeNames) {
                    const rawReference = node.getAttribute(attributeName);
                    if (!rawReference) continue;

                    if (this.isExternalArchiveReference(rawReference)) {
                        if (/^(?:https?:|\/\/|javascript:)/i.test(rawReference)) {
                            node.removeAttribute(attributeName);
                        }
                        continue;
                    }

                    const assetPath = this.resolveArchivePath(docPath, rawReference);
                    const dataUrl = await this.getArchiveAssetDataUrl(zip, manifestByPath, assetCache, assetPath);
                    if (dataUrl) {
                        node.setAttribute(attributeName, dataUrl);
                    } else {
                        node.removeAttribute(attributeName);
                    }
                }

                const rawSrcset = node.getAttribute('srcset');
                if (!rawSrcset) continue;

                const rebuiltSrcset = [];
                for (const candidate of rawSrcset.split(',')) {
                    const trimmedCandidate = candidate.trim();
                    if (!trimmedCandidate) continue;
                    const parts = trimmedCandidate.split(/\s+/);
                    const reference = parts.shift();
                    const descriptor = parts.join(' ');

                    if (!reference || this.isExternalArchiveReference(reference)) {
                        continue;
                    }

                    const assetPath = this.resolveArchivePath(docPath, reference);
                    const dataUrl = await this.getArchiveAssetDataUrl(zip, manifestByPath, assetCache, assetPath);
                    if (dataUrl) {
                        rebuiltSrcset.push(descriptor ? `${dataUrl} ${descriptor}` : dataUrl);
                    }
                }

                if (rebuiltSrcset.length) {
                    node.setAttribute('srcset', rebuiltSrcset.join(', '));
                } else {
                    node.removeAttribute('srcset');
                }
            }
        }
    },

    async buildRenderableEpubChapter(htmlText, docPath, zip, manifestByPath, assetCache) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        Array.from(doc.querySelectorAll('script, iframe, embed, object, link:not([rel~="stylesheet"])')).forEach(node => node.remove());

        const linkedStyles = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'));
        await Promise.all(linkedStyles.map(async (linkNode) => {
            const href = linkNode.getAttribute('href');
            if (!href || this.isExternalArchiveReference(href)) {
                linkNode.remove();
                return;
            }

            const stylesheetPath = this.resolveArchivePath(docPath, href);
            const zipEntry = this.getZipEntry(zip, stylesheetPath);
            if (!zipEntry) {
                linkNode.remove();
                return;
            }

            const stylesheetText = await zipEntry.async('string');
            const styleNode = doc.createElement('style');
            styleNode.textContent = await this.inlineEpubCss(stylesheetText, stylesheetPath, zip, manifestByPath, assetCache);
            linkNode.replaceWith(styleNode);
        }));

        const inlineStyles = Array.from(doc.querySelectorAll('style'));
        await Promise.all(inlineStyles.map(async (styleNode) => {
            styleNode.textContent = await this.inlineEpubCss(styleNode.textContent || '', docPath, zip, manifestByPath, assetCache);
        }));

        const inlineStyleTargets = Array.from(doc.querySelectorAll('[style]'));
        await Promise.all(inlineStyleTargets.map(async (node) => {
            const styleValue = node.getAttribute('style');
            if (!styleValue) return;
            node.setAttribute('style', await this.inlineEpubCss(styleValue, docPath, zip, manifestByPath, assetCache));
        }));

        await this.inlineEpubResourceAttributes(doc, docPath, zip, manifestByPath, assetCache);

        const headMarkup = doc.head ? doc.head.innerHTML : '';
        const bodyMarkup = doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${headMarkup}
    <style>
        html, body {
            margin: 0;
            padding: 0;
            background: #ffffff !important;
        }
        body {
            width: 794px;
            padding: 56px 64px;
            box-sizing: border-box;
            color: #111111;
            overflow-wrap: break-word;
            word-break: normal;
        }
        img, svg, video, canvas {
            max-width: 100%;
            height: auto;
        }
        table {
            max-width: 100%;
            border-collapse: collapse;
        }
        pre, code {
            white-space: pre-wrap;
            word-break: break-word;
        }
    </style>
</head>
<body>
${bodyMarkup}
</body>
</html>`;
    },

    async waitForIframeAssets(iframe, options = {}) {
        const iframeDoc = iframe.contentDocument;
        const iframeWindow = iframe.contentWindow;
        if (!iframeDoc || !iframeWindow) return;
        const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 25000);
        const fontTimeoutMs = Math.max(500, Number(options.fontTimeoutMs) || 5000);

        const fontWait = (iframeDoc.fonts && iframeDoc.fonts.ready)
            ? Promise.race([
                iframeDoc.fonts.ready.catch(() => {}),
                new Promise(resolve => setTimeout(resolve, fontTimeoutMs))
            ])
            : Promise.resolve();

        const imageWait = new Promise(resolve => {
            const images = Array.from(iframeDoc.images || []);
            if (!images.length) return resolve();

            let pending = images.length;
            const finish = () => {
                pending -= 1;
                if (pending <= 0) resolve();
            };

            images.forEach((image) => {
                if (image.complete) {
                    finish();
                    return;
                }
                image.addEventListener('load', finish, { once: true });
                image.addEventListener('error', finish, { once: true });
            });

            setTimeout(resolve, timeoutMs);
        });

        await Promise.all([fontWait, imageWait]);
        await new Promise(resolve => iframeWindow.requestAnimationFrame(() => iframeWindow.requestAnimationFrame(resolve)));
    },

    getEpubRenderProfile(fileSize = 0, chapterCount = 0) {
        const isVeryLargeBook = fileSize >= 40 * 1024 * 1024 || chapterCount >= 120;
        const isLargeBook = isVeryLargeBook || fileSize >= 18 * 1024 * 1024 || chapterCount >= 60;

        return {
            renderScale: isVeryLargeBook ? 1.18 : (isLargeBook ? 1.32 : 1.55),
            jpegQuality: isVeryLargeBook ? 0.68 : (isLargeBook ? 0.7 : 0.72),
            chapterGapPx: Math.round(18 * (isVeryLargeBook ? 1.18 : (isLargeBook ? 1.32 : 1.55))),
            assetWaitMs: isVeryLargeBook ? 4500 : (isLargeBook ? 6000 : 9000),
            fontWaitMs: isVeryLargeBook ? 1200 : (isLargeBook ? 1800 : 3000),
            preferForeignObjectRendering: true
        };
    },

    createEpubRenderSession() {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position: fixed; left: -10000px; top: 0; width: 794px; height: 10px; opacity: 0; pointer-events: none; border: 0; background: #ffffff;';
        document.body.appendChild(iframe);
        return { iframe };
    },

    destroyEpubRenderSession(session) {
        if (!session || !session.iframe) return;
        if (session.iframe.parentNode) {
            session.iframe.parentNode.removeChild(session.iframe);
        }
    },

    async loadHtmlIntoRenderSession(session, htmlString, timeoutMs = 20000) {
        if (!session || !session.iframe) {
            throw new Error('Missing EPUB render session');
        }

        return new Promise((resolve, reject) => {
            const { iframe } = session;
            let settled = false;
            const cleanup = () => {
                iframe.onload = null;
                clearTimeout(timeoutId);
            };
            const finish = (callback) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback();
            };
            const timeoutId = setTimeout(() => {
                finish(() => reject(new Error('Timed out while loading EPUB chapter')));
            }, timeoutMs);

            iframe.onload = () => finish(resolve);
            iframe.srcdoc = htmlString;
        });
    },

    async renderHtmlStringToCanvas(htmlString, options = {}, renderSession = null) {
        const renderScale = Math.max(1, Number(options.renderScale) || 2.5);
        const loadTimeoutMs = Math.max(3000, Number(options.loadTimeoutMs) || 20000);
        const assetWaitMs = Math.max(1000, Number(options.assetWaitMs) || 9000);
        const fontWaitMs = Math.max(500, Number(options.fontWaitMs) || 3000);
        const preferForeignObjectRendering = options.preferForeignObjectRendering !== false;
        const session = renderSession || this.createEpubRenderSession();
        const iframe = session.iframe;
        const ownsSession = !renderSession;

        try {
            await this.loadHtmlIntoRenderSession(session, htmlString, loadTimeoutMs);
            await this.waitForIframeAssets(iframe, { timeoutMs: assetWaitMs, fontTimeoutMs: fontWaitMs });

            const iframeDoc = iframe.contentDocument;
            const iframeWindow = iframe.contentWindow;
            if (!iframeDoc || !iframeWindow) {
                throw new Error('Unable to access EPUB render frame');
            }

            const root = iframeDoc.documentElement;
            const body = iframeDoc.body || root;
            const width = Math.max(794, Math.ceil(body.scrollWidth || root.scrollWidth || 794));
            const height = Math.max(1, Math.ceil(body.scrollHeight || root.scrollHeight || 1));

            iframe.style.width = `${width}px`;
            iframe.style.height = `${height}px`;
            await new Promise(resolveFrame => iframeWindow.requestAnimationFrame(() => iframeWindow.requestAnimationFrame(resolveFrame)));

            const baseOptions = {
                backgroundColor: '#ffffff',
                scale: renderScale,
                useCORS: true,
                allowTaint: false,
                imageTimeout: assetWaitMs,
                logging: false,
                width,
                height,
                windowWidth: width,
                windowHeight: height,
                scrollX: 0,
                scrollY: 0
            };

            try {
                return await window.html2canvas(body, {
                    ...baseOptions,
                    foreignObjectRendering: preferForeignObjectRendering
                });
            } catch (primaryError) {
                if (!preferForeignObjectRendering) throw primaryError;
                return window.html2canvas(body, {
                    ...baseOptions,
                    foreignObjectRendering: false
                });
            }
        } finally {
            if (ownsSession) {
                this.destroyEpubRenderSession(session);
            }
        }
    },

    createWhiteCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        return canvas;
    },

    clearCanvasToWhite(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    },

    normalizeCanvasWidth(canvas, targetWidth) {
        if (!canvas || !targetWidth || canvas.width === targetWidth) return canvas;

        const scaledHeight = Math.max(1, Math.round(canvas.height * (targetWidth / canvas.width)));
        const resized = document.createElement('canvas');
        resized.width = targetWidth;
        resized.height = scaledHeight;
        const ctx = resized.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetWidth, scaledHeight);
        ctx.drawImage(canvas, 0, 0, targetWidth, scaledHeight);
        return resized;
    },

    flushSequentialPdfPage(pdf, state) {
        if (!state || state.cursorY <= 0) return;

        if (!state.isFirstPage) {
            pdf.addPage();
        }

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        pdf.addImage(
            state.pageCanvas.toDataURL('image/jpeg', state.jpegQuality || 0.82),
            'JPEG',
            0,
            0,
            pdfWidth,
            pdfHeight,
            undefined,
            'MEDIUM'
        );
        state.isFirstPage = false;
        state.cursorY = 0;
        this.clearCanvasToWhite(state.pageCanvas);
    },

    advanceSequentialPdfCursor(pdf, state, blankHeightPx) {
        let remainingBlank = Math.max(0, Math.round(blankHeightPx || 0));
        while (remainingBlank > 0) {
            const spaceLeft = state.pageCanvas.height - state.cursorY;
            if (spaceLeft <= 0) {
                this.flushSequentialPdfPage(pdf, state);
                continue;
            }

            const step = Math.min(spaceLeft, remainingBlank);
            state.cursorY += step;
            remainingBlank -= step;
            if (state.cursorY >= state.pageCanvas.height) {
                this.flushSequentialPdfPage(pdf, state);
            }
        }
    },

    appendCanvasToSequentialPdf(pdf, canvas, state) {
        const normalizedCanvas = this.normalizeCanvasWidth(canvas, state.pageCanvas.width);
        let sourceOffsetY = 0;

        while (sourceOffsetY < normalizedCanvas.height) {
            const remainingPageHeight = state.pageCanvas.height - state.cursorY;
            if (remainingPageHeight <= 0) {
                this.flushSequentialPdfPage(pdf, state);
                continue;
            }

            const sliceHeight = Math.min(remainingPageHeight, normalizedCanvas.height - sourceOffsetY);
            state.pageCtx.drawImage(
                normalizedCanvas,
                0,
                sourceOffsetY,
                normalizedCanvas.width,
                sliceHeight,
                0,
                state.cursorY,
                state.pageCanvas.width,
                sliceHeight
            );

            state.cursorY += sliceHeight;
            sourceOffsetY += sliceHeight;

            if (state.cursorY >= state.pageCanvas.height) {
                this.flushSequentialPdfPage(pdf, state);
            }
        }
    },

    async parseEpubPackage(file) {
        const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
        const containerEntry = this.getZipEntry(zip, 'META-INF/container.xml');
        if (!containerEntry) {
            throw new Error('This EPUB is missing META-INF/container.xml');
        }

        const containerXml = await containerEntry.async('string');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'application/xml');
        const rootfileNode = containerDoc.getElementsByTagNameNS('*', 'rootfile')[0];
        const packagePath = rootfileNode && rootfileNode.getAttribute('full-path');
        if (!packagePath) {
            throw new Error('Unable to locate the EPUB package document');
        }

        const packageEntry = this.getZipEntry(zip, packagePath);
        if (!packageEntry) {
            throw new Error('The EPUB package document could not be read');
        }

        const packageXml = await packageEntry.async('string');
        const packageDoc = parser.parseFromString(packageXml, 'application/xml');

        const manifestById = new Map();
        const manifestByPath = new Map();
        Array.from(packageDoc.getElementsByTagNameNS('*', 'item')).forEach((itemNode) => {
            const id = itemNode.getAttribute('id');
            const href = itemNode.getAttribute('href');
            if (!id || !href) return;

            const fullPath = this.resolveArchivePath(packagePath, href);
            const entry = {
                id,
                href,
                path: this.normalizeArchivePath(fullPath),
                mediaType: itemNode.getAttribute('media-type') || '',
                properties: itemNode.getAttribute('properties') || ''
            };

            manifestById.set(id, entry);
            manifestByPath.set(entry.path, entry);
        });

        const spineItems = Array.from(packageDoc.getElementsByTagNameNS('*', 'itemref'))
            .map((itemRefNode) => manifestById.get(itemRefNode.getAttribute('idref')))
            .filter(Boolean)
            .filter((entry) => /(xhtml|html)/i.test(entry.mediaType || '') || /\.(xhtml?|html?)$/i.test(entry.path));

        if (!spineItems.length) {
            throw new Error('No readable chapters were found inside this EPUB');
        }

        const titleNode = packageDoc.getElementsByTagNameNS('*', 'title')[0];
        return {
            zip,
            manifestByPath,
            spineItems,
            title: titleNode && titleNode.textContent ? titleNode.textContent.trim() : ''
        };
    },

    async convertEpubToPdf() {
        const results = [];
        await this.ensureEpubProcessingLibs();
        const { jsPDF } = window.jspdf;

        for (const file of this.uploadedFiles) {
            try {
                const { zip, manifestByPath, spineItems } = await this.parseEpubPackage(file);
                const assetCache = new Map();
                const epubRenderProfile = this.getEpubRenderProfile(file.size || 0, spineItems.length);
                const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true });
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = pdf.internal.pageSize.getHeight();
                const targetCanvasWidth = Math.round(794 * epubRenderProfile.renderScale);
                const pageCanvasHeight = Math.max(1, Math.floor(targetCanvasWidth * (pdfHeight / pdfWidth)));
                const pageCanvas = this.createWhiteCanvas(targetCanvasWidth, pageCanvasHeight);
                const pageCtx = pageCanvas.getContext('2d');
                const state = {
                    isFirstPage: true,
                    cursorY: 0,
                    pageCanvas,
                    pageCtx,
                    jpegQuality: epubRenderProfile.jpegQuality
                };
                const chapterGapPx = epubRenderProfile.chapterGapPx;
                const renderSession = this.createEpubRenderSession();

                try {
                    for (let chapterIndex = 0; chapterIndex < spineItems.length; chapterIndex += 1) {
                        const spineItem = spineItems[chapterIndex];
                        const progressText = document.getElementById('progress-text');
                        if (progressText) {
                            progressText.textContent = `Rendering ${file.name} chapter ${chapterIndex + 1} of ${spineItems.length}...`;
                        }

                        const chapterEntry = this.getZipEntry(zip, spineItem.path);
                        if (!chapterEntry) continue;

                        const chapterHtml = await chapterEntry.async('string');
                        const renderableHtml = await this.buildRenderableEpubChapter(
                            chapterHtml,
                            spineItem.path,
                            zip,
                            manifestByPath,
                            assetCache
                        );
                        const chapterCanvas = await this.renderHtmlStringToCanvas(renderableHtml, {
                            renderScale: epubRenderProfile.renderScale,
                            assetWaitMs: epubRenderProfile.assetWaitMs,
                            fontWaitMs: epubRenderProfile.fontWaitMs,
                            preferForeignObjectRendering: epubRenderProfile.preferForeignObjectRendering
                        }, renderSession);
                        if (!chapterCanvas || chapterCanvas.height <= 1) continue;

                        this.appendCanvasToSequentialPdf(pdf, chapterCanvas, state);
                        if (chapterIndex < spineItems.length - 1) {
                            this.advanceSequentialPdfCursor(pdf, state, chapterGapPx);
                        }
                    }
                } finally {
                    this.destroyEpubRenderSession(renderSession);
                }

                this.flushSequentialPdfPage(pdf, state);
                const pdfBlob = pdf.output('blob');
                const outputName = file.name.replace(/\.epub$/i, '.pdf');
                results.push({
                    name: /\.pdf$/i.test(outputName) ? outputName : `${file.name}.pdf`,
                    type: 'application/pdf',
                    size: pdfBlob.size,
                    url: URL.createObjectURL(pdfBlob)
                });

                this.showNotification(`Successfully converted ${file.name} to PDF`, 'success');
            } catch (error) {
                console.error('Error converting EPUB to PDF:', error);
                this.showNotification(`Failed to convert ${file.name}: ${error.message}`, 'error');
                continue;
            }
        }

        if (results.length === 0) {
            throw new Error('Failed to convert any EPUB files to PDF');
        }

        return results;
    },

    // Word (DOCX) to PDF Conversion (docx-preview -> html2canvas -> jsPDF with Mammoth fallback)
});
