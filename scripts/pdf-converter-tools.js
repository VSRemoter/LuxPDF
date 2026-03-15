/* Split from script.js */
Object.assign(PDFConverterPro.prototype, {
    async ensureDocxPreviewLib() {
        // docx-preview relies on JSZip
        if (!window.JSZip) {
            await this.loadFirstAvailableScript([
                'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
                'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
            ]);
        }
        if (!window.docx || typeof window.docx.renderAsync !== 'function') {
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/docx-preview@0.3.6/dist/docx-preview.min.js',
                'https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js',
                'https://unpkg.com/docx-preview@0.3.6/dist/docx-preview.min.js',
                'https://unpkg.com/docx-preview/dist/docx-preview.min.js'
            ]);
        }
        if (!window.docx || typeof window.docx.renderAsync !== 'function') {
            throw new Error('DOCX renderer failed to load');
        }
    },

    async ensureMammothLib() {
        if (!window.mammoth) {
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
                'https://cdn.jsdelivr.net/npm/mammoth/mammoth.browser.min.js',
                'https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js',
                'https://unpkg.com/mammoth/mammoth.browser.min.js'
            ]);
        }
        if (!window.mammoth) {
            throw new Error('Mammoth.js failed to load');
        }
    },

    getRenderableNodeSize(node) {
        const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { width: 0, height: 0 };
        const width = Math.max(1, Math.ceil(Math.max(rect.width || 0, node.scrollWidth || 0, node.offsetWidth || 0)));
        const height = Math.max(1, Math.ceil(Math.max(rect.height || 0, node.scrollHeight || 0, node.offsetHeight || 0)));
        return { width, height };
    },

    async waitForRenderedContentAssets(container, timeoutMs = 30000) {
        const fontWait = (document.fonts && document.fonts.ready)
            ? Promise.race([
                document.fonts.ready.catch(() => {}),
                new Promise(resolve => setTimeout(resolve, 5000))
            ])
            : Promise.resolve();

        const imageWait = new Promise(resolve => {
            const images = Array.from(container.querySelectorAll('img'));
            if (!images.length) return resolve();
            let pending = images.length;
            const done = () => {
                pending -= 1;
                if (pending <= 0) resolve();
            };
            images.forEach(img => {
                if (img.complete) return done();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
            });
            setTimeout(() => resolve(), timeoutMs);
        });

        await Promise.all([fontWait, imageWait]);
        // Give layout a couple of frames to settle
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },

    appendCanvasToPdf(pdf, canvas, orientation, isFirstPage) {
        const addPageIfNeeded = () => {
            if (isFirstPage) {
                isFirstPage = false;
            } else {
                pdf.addPage('a4', orientation);
            }
        };

        const pageWidth = () => pdf.internal.pageSize.getWidth();
        const pageHeight = () => pdf.internal.pageSize.getHeight();

        // If the rendered node is taller than one PDF page ratio, slice it.
        const singlePageHeightPx = Math.floor(canvas.width * (pageHeight() / pageWidth()));
        if (canvas.height > singlePageHeightPx * 1.03) {
            let yOffset = 0;
            while (yOffset < canvas.height) {
                addPageIfNeeded();
                const pdfW = pageWidth();
                const pdfH = pageHeight();
                const pageHeightPx = Math.floor(canvas.width * (pdfH / pdfW));
                const sliceHeight = Math.min(pageHeightPx, canvas.height - yOffset);

                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = canvas.width;
                pageCanvas.height = sliceHeight;
                const ctx = pageCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

                const imgHeightPt = pdfW * (sliceHeight / canvas.width);
                pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, imgHeightPt, undefined, 'FAST');
                yOffset += sliceHeight;
            }
            return isFirstPage;
        }

        addPageIfNeeded();
        const pdfW = pageWidth();
        const pdfH = pageHeight();
        const ratio = Math.min(pdfW / canvas.width, pdfH / canvas.height);
        const drawW = canvas.width * ratio;
        const drawH = canvas.height * ratio;
        const x = (pdfW - drawW) / 2;
        const y = (pdfH - drawH) / 2;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, drawW, drawH, undefined, 'FAST');
        return isFirstPage;
    },

    async convertWordToPdfWithDocxPreview(file, arrayBuffer, jsPDF) {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;max-width:none;padding:0;margin:0;';

        const pageCss = document.createElement('style');
        pageCss.textContent = `
            .lux-docx-host .docx-wrapper {
                background: #ffffff !important;
                padding: 0 !important;
            }
            .lux-docx-host .docx-wrapper > section,
            .lux-docx-host .docx-wrapper > .docx {
                margin: 0 auto 16px auto !important;
                box-shadow: none !important;
            }
            .lux-docx-host .docx {
                box-shadow: none !important;
            }
        `;
        host.className = 'lux-docx-host';
        host.appendChild(pageCss);

        const styleContainer = document.createElement('div');
        const bodyContainer = document.createElement('div');
        host.appendChild(styleContainer);
        host.appendChild(bodyContainer);
        document.body.appendChild(host);

        try {
            await window.docx.renderAsync(arrayBuffer, bodyContainer, styleContainer, {
                className: 'docx',
                inWrapper: true,
                ignoreWidth: false,
                ignoreHeight: false,
                ignoreFonts: false,
                breakPages: true,
                // Critical for Word-authored docs that rely on lastRenderedPageBreak markers.
                ignoreLastRenderedPageBreak: false,
                renderHeaders: true,
                renderFooters: true,
                renderFootnotes: true,
                renderEndnotes: true,
                renderComments: true,
                renderAltChunks: true,
                useBase64URL: true,
                trimXmlDeclaration: true,
                experimental: true
            });

            await this.waitForRenderedContentAssets(bodyContainer, 35000);

            const wrapper = bodyContainer.querySelector('.docx-wrapper') || bodyContainer;
            let pageNodes = Array.from(wrapper.children).filter(el => el && el.nodeType === 1);
            pageNodes = pageNodes.filter(el => !['STYLE', 'SCRIPT', 'LINK'].includes(el.tagName));
            if (!pageNodes.length) pageNodes = [wrapper];

            const firstSize = this.getRenderableNodeSize(pageNodes[0]);
            const firstOrientation = firstSize.width >= firstSize.height ? 'l' : 'p';
            const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: firstOrientation, compress: true });

            let isFirstPage = true;
            for (const pageNode of pageNodes) {
                const size = this.getRenderableNodeSize(pageNode);
                const orientation = size.width >= size.height ? 'l' : 'p';
                const canvas = await window.html2canvas(pageNode, {
                    scale: 3,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    imageTimeout: 30000,
                    logging: false,
                    width: size.width,
                    height: size.height,
                    windowWidth: size.width,
                    windowHeight: size.height,
                    scrollX: 0,
                    scrollY: 0
                });
                isFirstPage = this.appendCanvasToPdf(pdf, canvas, orientation, isFirstPage);
            }

            const pdfBytes = pdf.output('arraybuffer');
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            return {
                name: file.name.replace(/\.docx$/i, '.pdf'),
                type: 'application/pdf',
                size: blob.size,
                url: URL.createObjectURL(blob)
            };
        } finally {
            if (host && host.parentNode) host.parentNode.removeChild(host);
        }
    },

    async convertWordToPdfWithMammoth(file, arrayBuffer, jsPDF) {
        await this.ensureMammothLib();

        const mammothOptions = {
            convertImage: window.mammoth.images.inline(async function (element) {
                try {
                    const imageBuffer = await element.read('base64');
                    return { src: `data:${element.contentType};base64,${imageBuffer}` };
                } catch (e) {
                    return null;
                }
            }),
            styleMap: [
                "p[style-name='Title'] => h1:fresh",
                "p[style-name='Subtitle'] => h2:fresh",
                "r[style-name='Subtle Emphasis'] => em",
                "r[style-name='Intense Emphasis'] => strong"
            ]
        };

        const result = await window.mammoth.convertToHtml({ arrayBuffer }, mammothOptions);
        const html = (result && result.value) ? result.value : '';
        if (!html || !html.trim()) {
            throw new Error('No readable content found in the DOCX file');
        }

        const container = document.createElement('div');
        const containerWidth = 794; // ~A4 width at 96 DPI
        container.style.cssText = `position: fixed; left: -10000px; top: 0; width: ${containerWidth}px; padding: 0; background: #ffffff; color: #000; font-family: 'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; box-sizing: border-box; max-width: none;`;
        const baseStyles = `
            <style>
              * { box-sizing: border-box; }
              .docx-root {
                font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                font-size: 11pt;
                line-height: 1.15;
                color: #000;
                width: 100%;
              }
              .docx-root p { margin: 0 0 8pt; }
              .docx-root h1 { font-size: 20pt; margin: 0 0 10pt; }
              .docx-root h2 { font-size: 16pt; margin: 0 0 9pt; }
              .docx-root h3 { font-size: 14pt; margin: 0 0 8pt; }
              .docx-root img { max-width: 100%; height: auto; }
              .docx-root table { width: 100%; border-collapse: collapse; }
              .docx-root ul, .docx-root ol { margin: 0 0 8pt 24pt; }
              .docx-root a { color: #0645AD; text-decoration: underline; }
            </style>
        `;
        container.innerHTML = `${baseStyles}<div class="docx-root">${html}</div>`;
        document.body.appendChild(container);

        try {
            const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
            const pdfWidth = doc.internal.pageSize.getWidth();
            const pdfHeight = doc.internal.pageSize.getHeight();

            const scale = 2.5;
            const canvas = await window.html2canvas(container, {
                scale,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                imageTimeout: 20000,
            });

            const fullCanvasWidth = canvas.width;
            const fullCanvasHeight = canvas.height;
            const pageHeightPx = Math.floor(fullCanvasWidth * (pdfHeight / pdfWidth));

            let yOffset = 0;
            let pageIndex = 0;
            while (yOffset < fullCanvasHeight) {
                const sliceHeight = Math.min(pageHeightPx, fullCanvasHeight - yOffset);
                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = fullCanvasWidth;
                pageCanvas.height = sliceHeight;
                const ctx = pageCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, yOffset, fullCanvasWidth, sliceHeight, 0, 0, fullCanvasWidth, sliceHeight);

                const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
                if (pageIndex > 0) doc.addPage();
                const imgHeightPt = pdfWidth * (sliceHeight / fullCanvasWidth);
                doc.addImage(imgData, 'JPEG', 0, 0, pdfWidth, imgHeightPt);

                yOffset += sliceHeight;
                pageIndex += 1;
            }

            const pdfBytes = doc.output('arraybuffer');
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            return {
                name: file.name.replace(/\.docx$/i, '.pdf'),
                type: 'application/pdf',
                size: blob.size,
                url: URL.createObjectURL(blob)
            };
        } finally {
            container.remove();
        }
    },

    async convertWordToPdf() {
        const results = [];
        await this.ensureHtmlRenderingLibs();
        const { jsPDF } = window.jspdf;

        let hasDocxPreview = false;
        try {
            await this.ensureDocxPreviewLib();
            hasDocxPreview = !!(window.docx && typeof window.docx.renderAsync === 'function');
        } catch (_) {
            hasDocxPreview = false;
        }

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();

                let converted = null;
                let primaryError = null;

                if (hasDocxPreview) {
                    try {
                        converted = await this.convertWordToPdfWithDocxPreview(file, arrayBuffer, jsPDF);
                    } catch (err) {
                        primaryError = err;
                        console.warn('High-fidelity DOCX renderer failed; falling back to Mammoth:', err);
                    }
                }

                if (!converted) {
                    converted = await this.convertWordToPdfWithMammoth(file, arrayBuffer, jsPDF);
                    if (primaryError) {
                        this.showNotification(`Converted ${file.name} using compatibility mode`, 'info');
                    }
                }

                results.push(converted);
                this.showNotification(`Successfully converted ${file.name} to PDF`, 'success');
            } catch (error) {
                console.error('Error converting Word to PDF:', error);
                this.showNotification(`Failed to convert ${file.name}: ${error.message}`, 'error');
                continue;
            }
        }

        if (results.length === 0) throw new Error('Failed to convert any Word files to PDF');
        return results;
    },
    // RTF (Rich Text Format) to PDF Conversion (rtf.js -> HTML -> html2canvas -> jsPDF)

    async ensureRtfLibs() {
        // Load WMF/EMF renderers first (optional but improves fidelity)
        if (typeof window.WMFJS === 'undefined') {
            await this.loadFirstAvailableScript([
                '/vendor/rtfjs/WMFJS.bundle.js',
                '/vendor/rtfjs/WMFJS.bundle.min.js',
                'https://rawcdn.githack.com/tbluemel/rtf.js/master/dist/WMFJS.bundle.js',
                'https://rawcdn.githack.com/tbluemel/rtf.js/master/dist/WMFJS.bundle.min.js',
                'https://cdn.statically.io/gh/tbluemel/rtf.js/master/dist/WMFJS.bundle.js',
                'https://cdn.statically.io/gh/tbluemel/rtf.js/master/dist/WMFJS.bundle.min.js',
                'https://gitcdn.link/cdn/tbluemel/rtf.js/master/dist/WMFJS.bundle.js',
                'https://gitcdn.link/cdn/tbluemel/rtf.js/master/dist/WMFJS.bundle.min.js',
                'https://cdn.jsdelivr.net/gh/tbluemel/rtf.js/dist/WMFJS.bundle.js',
                'https://cdn.jsdelivr.net/gh/tbluemel/rtf.js/dist/WMFJS.bundle.min.js',
            ]).catch(() => {/* optional */});
        }
        if (typeof window.EMFJS === 'undefined') {
            await this.loadFirstAvailableScript([
                '/vendor/rtfjs/EMFJS.bundle.js',
                '/vendor/rtfjs/EMFJS.bundle.min.js',
                'https://rawcdn.githack.com/tbluemel/rtf.js/master/dist/EMFJS.bundle.js',
                'https://rawcdn.githack.com/tbluemel/rtf.js/master/dist/EMFJS.bundle.min.js',
                'https://cdn.statically.io/gh/tbluemel/rtf.js/master/dist/EMFJS.bundle.js',
                'https://cdn.statically.io/gh/tbluemel/rtf.js/master/dist/EMFJS.bundle.min.js',
                'https://gitcdn.link/cdn/tbluemel/rtf.js/master/dist/EMFJS.bundle.js',
                'https://gitcdn.link/cdn/tbluemel/rtf.js/master/dist/EMFJS.bundle.min.js',
                'https://cdn.jsdelivr.net/gh/tbluemel/rtf.js/dist/EMFJS.bundle.js',
                'https://cdn.jsdelivr.net/gh/tbluemel/rtf.js/dist/EMFJS.bundle.min.js',
            ]).catch(() => {/* optional */});
        }
        if (typeof window.RTFJS === 'undefined' || !window.RTFJS.Document) {
            const ok = await this.loadFirstAvailableScript([
                '/vendor/rtfjs/RTFJS.bundle.js',
                '/vendor/rtfjs/RTFJS.bundle.min.js',
                'https://rawcdn.githack.com/tbluemel/rtf.js/master/dist/RTFJS.bundle.js',
                'https://rawcdn.githack.com/tbluemel/rtf.js/master/dist/RTFJS.bundle.min.js',
                'https://cdn.statically.io/gh/tbluemel/rtf.js/master/dist/RTFJS.bundle.js',
                'https://cdn.statically.io/gh/tbluemel/rtf.js/master/dist/RTFJS.bundle.min.js',
                'https://gitcdn.link/cdn/tbluemel/rtf.js/master/dist/RTFJS.bundle.js',
                'https://gitcdn.link/cdn/tbluemel/rtf.js/master/dist/RTFJS.bundle.min.js',
                'https://cdn.jsdelivr.net/gh/tbluemel/rtf.js/dist/RTFJS.bundle.js',
                'https://cdn.jsdelivr.net/gh/tbluemel/rtf.js/dist/RTFJS.bundle.min.js',
            ]);
            if (!ok || typeof window.RTFJS === 'undefined' || !window.RTFJS.Document) {
                throw new Error('rtf.js failed to load');
            }
        }
        // Turn off verbose logging if available
        try { window.RTFJS && window.RTFJS.loggingEnabled && window.RTFJS.loggingEnabled(false); } catch (_) {}
        try { window.WMFJS && window.WMFJS.loggingEnabled && window.WMFJS.loggingEnabled(false); } catch (_) {}
        try { window.EMFJS && window.EMFJS.loggingEnabled && window.EMFJS.loggingEnabled(false); } catch (_) {}
    },

    async convertRtfToPdf() {
        const results = [];

        // Ensure libraries are available
        await this.ensureRtfLibs();
        await this.ensureHtmlRenderingLibs();
        const { jsPDF } = window.jspdf;

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();

                // Render RTF -> HTML elements using rtf.js
                const rtfDoc = new window.RTFJS.Document(arrayBuffer);
                const meta = typeof rtfDoc.metadata === 'function' ? rtfDoc.metadata() : null;
                if (meta && meta.title) { /* could use meta later for filenames */ }
                const htmlElements = await rtfDoc.render();

                // Prepare an offscreen container
                const container = document.createElement('div');
                const containerWidth = 794; // ~A4 width at 96 DPI
                container.style.cssText = `position: fixed; left: -10000px; top: 0; width: ${containerWidth}px; padding: 0; background: #ffffff; color: #000; box-sizing: border-box; max-width: none;`;
                const baseStyles = `
                    <style>
                      * { box-sizing: border-box; }
                      .rtf-root {
                        font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                        font-size: 11pt; line-height: 1.25; color: #000; width: 100%;
                      }
                      .rtf-root img { max-width: 100%; height: auto; }
                      .rtf-root table { border-collapse: collapse; max-width: 100%; }
                      .rtf-root p { margin: 0 0 8pt; }
                    </style>
                `;
                const wrapper = document.createElement('div');
                wrapper.className = 'rtf-root';

                if (Array.isArray(htmlElements)) {
                    htmlElements.forEach(el => { if (el) wrapper.appendChild(el); });
                } else if (htmlElements instanceof Node) {
                    wrapper.appendChild(htmlElements);
                } else if (htmlElements && htmlElements.element) { // some versions return {element}
                    wrapper.appendChild(htmlElements.element);
                }

                container.innerHTML = baseStyles;
                container.appendChild(wrapper);
                document.body.appendChild(container);

                // Create PDF
                const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
                const pdfWidth = doc.internal.pageSize.getWidth();
                const pdfHeight = doc.internal.pageSize.getHeight();
                const marginPt = 72; // 1 inch margins on all sides
                const innerWidthPt = pdfWidth - 2 * marginPt;
                const innerHeightPt = pdfHeight - 2 * marginPt;

                // Render at high scale for quality
                const scale = 3;
                const canvas = await window.html2canvas(container, {
                    scale,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    imageTimeout: 20000,
                });

                const fullCanvasWidth = canvas.width;
                const fullCanvasHeight = canvas.height;
                const pageHeightPx = Math.floor(fullCanvasWidth * (innerHeightPt / innerWidthPt));
                const ratioCanvasToPdf = innerWidthPt / fullCanvasWidth;

                // Slice canvas into PDF pages
                let yOffset = 0;
                let pageIndex = 0;
                const overlapPx = Math.floor(8 * scale); // small overlap to reduce line splitting
                while (yOffset < fullCanvasHeight) {
                    const sliceHeight = Math.min(pageHeightPx, fullCanvasHeight - yOffset);

                    const pageCanvas = document.createElement('canvas');
                    pageCanvas.width = fullCanvasWidth;
                    pageCanvas.height = sliceHeight;
                    const ctx = pageCanvas.getContext('2d');
                    ctx.drawImage(
                        canvas,
                        0, yOffset, fullCanvasWidth, sliceHeight,
                        0, 0, fullCanvasWidth, sliceHeight
                    );

                    const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
                    if (pageIndex > 0) doc.addPage();
                    const imgHeightPt = innerWidthPt * (sliceHeight / fullCanvasWidth);
                    doc.addImage(imgData, 'JPEG', marginPt, marginPt, innerWidthPt, imgHeightPt);

                    // Advance with overlap except on the final page
                    const willHaveMore = (yOffset + sliceHeight) < fullCanvasHeight;
                    yOffset += willHaveMore ? (sliceHeight - overlapPx) : sliceHeight;
                    pageIndex += 1;
                }

                // Cleanup
                container.remove();

                // Output blob
                const pdfBytes = doc.output('arraybuffer');
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);

                // Output name
                let outputName = file.name.replace(/\.rtf$/i, '.pdf');
                if (!/\.pdf$/i.test(outputName)) outputName = file.name + '.pdf';

                results.push({
                    name: outputName,
                    type: 'application/pdf',
                    size: blob.size,
                    url
                });

                this.showNotification(`Successfully converted ${file.name} to PDF`, 'success');
            } catch (error) {
                console.error('Error converting RTF to PDF:', error);
                this.showNotification(`Failed to convert ${file.name}: ${error.message}`, 'error');
                continue;
            }
        }

        if (results.length === 0) throw new Error('Failed to convert any RTF files to PDF');
        return results;
    },
    // Merge PDFs

    async mergePdfs() {
        try {
            const mergedPdf = await PDFLib.PDFDocument.create();

            for (const file of this.uploadedFiles) {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
                const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());

                pages.forEach(page => {
                    mergedPdf.addPage(page);
                });
            }

            const pdfBytes = await mergedPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            return [{
                name: 'merged_document.pdf',
                type: 'application/pdf',
                size: blob.size,
                url: url
            }];
        } catch (error) {
            console.error('Error merging PDFs:', error);
            throw new Error('Failed to merge PDF files');
        }
    },
    // Split PDF

    async splitPdf() {
        if (this.uploadedFiles.length !== 1) {
            throw new Error('Please select exactly one PDF file to split');
        }

        const file = this.uploadedFiles[0];
        const results = [];
        const individualPdfs = [];

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
            const pageCount = pdfDoc.getPageCount();

            const splitMethod = document.getElementById('split-method').value;
            let pageRanges = [];

            if (splitMethod === 'pages') {
                // Split each page into a separate PDF
                pageRanges = Array.from({ length: pageCount }, (_, i) => [i]);
            } else {
                // Split by range
                const rangeInput = document.getElementById('page-range').value;
                if (!rangeInput.trim()) {
                    throw new Error('Please enter a valid page range');
                }

                // Parse range input (e.g., "1-3, 5, 7-9")
                const ranges = rangeInput.split(',').map(r => r.trim());

                for (const range of ranges) {
                    if (range.includes('-')) {
                        const [start, end] = range.split('-').map(n => parseInt(n) - 1);
                        if (isNaN(start) || isNaN(end) || start < 0 || end >= pageCount || start > end) {
                            throw new Error(`Invalid page range: ${range}`);
                        }
                        pageRanges.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
                    } else {
                        const pageNum = parseInt(range) - 1;
                        if (isNaN(pageNum) || pageNum < 0 || pageNum >= pageCount) {
                            throw new Error(`Invalid page number: ${range}`);
                        }
                        pageRanges.push([pageNum]);
                    }
                }
            }

            // Create a separate PDF for each range
            for (let i = 0; i < pageRanges.length; i++) {
                const range = pageRanges[i];
                const newPdf = await PDFLib.PDFDocument.create();
                const pages = await newPdf.copyPages(pdfDoc, range);

                pages.forEach(page => {
                    newPdf.addPage(page);
                });

                const pdfBytes = await newPdf.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);

                const rangeText = range.length === 1
                    ? `page${range[0] + 1}`
                    : `pages${range[0] + 1}-${range[range.length - 1] + 1}`;

                const outName = `${file.name.replace(/\.pdf$/i, '')}_${rangeText}.pdf`;
                results.push({
                    name: outName,
                    type: 'application/pdf',
                    size: blob.size,
                    url: url
                });
                individualPdfs.push({ name: outName, blob });
            }

            // If multiple PDFs were created, also provide a ZIP download at the top
            if (individualPdfs.length > 1) {
                const zipBlob = await this.createPdfZip(individualPdfs);
                const base = file.name.replace(/\.pdf$/i, '');
                results.unshift({
                    name: `${base}_split_pdfs.zip`,
                    type: 'application/zip',
                    size: zipBlob.size,
                    url: URL.createObjectURL(zipBlob),
                    isZipFile: true
                });
            }

            return results;
        } catch (error) {
            console.error('Error splitting PDF:', error);
            throw new Error(`Failed to split ${file.name}: ${error.message}`);
        }
    },
    // Compress PDF

    async compressPdf() {
        const results = [];
        const { PDFDocument, PDFName, PDFDict, PDFStream, PDFNumber } = PDFLib;

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const originalSize = file.size;

                // Load PDF
                const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

                // Compress images in the PDF
                const pages = pdfDoc.getPages();
                let imagesCompressed = 0;

                for (const page of pages) {
                    const resources = page.node.Resources();
                    if (!resources) continue;

                    const xobjects = resources.lookup(PDFName.of('XObject'));
                    if (!(xobjects instanceof PDFDict)) continue;

                    for (const [key, value] of xobjects.entries()) {
                        const stream = pdfDoc.context.lookup(value);
                        if (!(stream instanceof PDFStream)) continue;

                        const subtype = stream.dict.get(PDFName.of('Subtype'));
                        if (subtype !== PDFName.of('Image')) continue;

                        try {
                            const imageBytes = stream.getContents();
                            const originalImageSize = imageBytes.length;

                            // Skip very small images
                            if (originalImageSize < 5000) continue;

                            // Try to compress the image using canvas
                            const width = stream.dict.get(PDFName.of('Width'))?.asNumber() || 0;
                            const height = stream.dict.get(PDFName.of('Height'))?.asNumber() || 0;

                            if (width > 0 && height > 0) {
                                // Create canvas and compress image
                                const canvas = document.createElement('canvas');
                                const ctx = canvas.getContext('2d');
                                canvas.width = width;
                                canvas.height = height;

                                // Create image from bytes
                                const blob = new Blob([imageBytes]);
                                const img = new Image();
                                const imageUrl = URL.createObjectURL(blob);

                                await new Promise((resolve, reject) => {
                                    img.onload = resolve;
                                    img.onerror = reject;
                                    img.src = imageUrl;
                                });

                                ctx.drawImage(img, 0, 0, width, height);

                                // Compress with good quality (0.8 = 80% quality)
                                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
                                const compressedBytes = this.dataUrlToBytes(compressedDataUrl);

                                // Only use compressed version if it's significantly smaller
                                if (compressedBytes.length < originalImageSize * 0.85) {
                                    stream.contents = compressedBytes;
                                    stream.dict.set(PDFName.of('Length'), PDFNumber.of(compressedBytes.length));
                                    stream.dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
                                    imagesCompressed++;
                                }

                                URL.revokeObjectURL(imageUrl);
                            }
                        } catch (error) {
                            console.warn('Failed to compress image:', error);
                        }
                    }
                }

                // Save with compression options
                const pdfBytes = await pdfDoc.save({
                    useObjectStreams: true,
                    addDefaultPage: false,
                    objectStreamsThreshold: 40,
                    updateFieldAppearances: false
                });

                const compressedBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                const compressionRatio = ((originalSize - compressedBlob.size) / originalSize * 100);

                // Only return compressed version if we achieved meaningful compression
                if (compressedBlob.size < originalSize && compressionRatio >= 5) {
                    this.showNotification(`Compressed ${file.name} by ${compressionRatio.toFixed(1)}% (${this.formatFileSize(originalSize - compressedBlob.size)} saved)`, 'success');

                    results.push({
                        name: `compressed_${file.name}`,
                        type: 'application/pdf',
                        size: compressedBlob.size,
                        url: URL.createObjectURL(compressedBlob)
                    });
                } else {
                    this.showNotification(`${file.name} is already optimized (${compressionRatio.toFixed(1)}% reduction)`, 'info');
                    results.push({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        url: URL.createObjectURL(file)
                    });
                }

            } catch (error) {
                console.error('Error compressing PDF:', error);
                this.showNotification(`Failed to compress ${file.name}: ${error.message}`, 'error');

                // Return original file as fallback
                results.push({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    url: URL.createObjectURL(file)
                });
            }
        }
        return results;
    },
    // Compress JPEG/PNG images

    async compressImage() {
        const results = [];
        // Read options
        const qEl = document.getElementById('image-quality');
        const quality = qEl ? Math.min(0.95, Math.max(0.1, parseFloat(qEl.value))) : 0.8;
        const maxEl = document.getElementById('max-dimension');
        let maxDim = maxEl ? parseInt(maxEl.value, 10) : 2000;
        if (!Number.isFinite(maxDim) || maxDim <= 0) maxDim = 2000;
        maxDim = Math.min(8000, Math.max(500, maxDim));

        for (const file of this.uploadedFiles) {
            try {
                const originalSize = file.size;
                const imageUrl = URL.createObjectURL(file);
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error('Failed to load image'));
                    img.src = imageUrl;
                });

                // Compute target dimensions
                const ow = img.naturalWidth || img.width;
                const oh = img.naturalHeight || img.height;
                const scale = Math.min(1, maxDim / Math.max(ow, oh));
                const tw = Math.max(1, Math.round(ow * scale));
                const th = Math.max(1, Math.round(oh * scale));

                const canvas = document.createElement('canvas');
                canvas.width = tw;
                canvas.height = th;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, tw, th);

                // Determine output mime based on input
                const isJpeg = /jpe?g$/i.test(file.name) || file.type.includes('jpeg') || file.type.includes('jpg');
                const isPng = /png$/i.test(file.name) || file.type.includes('png');
                const outMime = isJpeg ? 'image/jpeg' : 'image/png';

                const blob = await new Promise((resolve) => {
                    if (outMime === 'image/jpeg') {
                        canvas.toBlob((b) => resolve(b), outMime, quality);
                    } else {
                        canvas.toBlob((b) => resolve(b), outMime);
                    }
                });

                URL.revokeObjectURL(imageUrl);

                if (!blob) {
                    // Fallback: return original
                    results.push({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        url: URL.createObjectURL(file)
                    });
                    continue;
                }

                const reduction = ((originalSize - blob.size) / originalSize) * 100;
                if (blob.size < originalSize && reduction >= 5) {
                    this.showNotification(`Compressed ${file.name} by ${reduction.toFixed(1)}% (${this.formatFileSize(originalSize - blob.size)} saved)`, 'success');
                    const base = file.name.replace(/\.[^.]+$/, '');
                    const ext = outMime === 'image/jpeg' ? '.jpg' : '.png';
                    results.push({
                        name: `compressed_${base}${ext}`,
                        type: outMime,
                        size: blob.size,
                        url: URL.createObjectURL(blob)
                    });
                } else {
                    this.showNotification(`${file.name} is already optimized (${reduction.toFixed(1)}% reduction)`, 'info');
                    results.push({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        url: URL.createObjectURL(file)
                    });
                }
            } catch (err) {
                console.error('Error compressing image:', err);
                this.showNotification(`Failed to compress ${file.name}: ${err.message}`, 'error');
                results.push({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    url: URL.createObjectURL(file)
                });
            }
        }

        return results;
    },
    // Resize JPEG/PNG/WEBP images

    async resizeImage() {
        const results = [];

        const mode = document.getElementById('resize-mode')?.value || 'percentage';
        const percentageInput = document.getElementById('resize-percentage');
        const widthInput = document.getElementById('resize-width');
        const heightInput = document.getElementById('resize-height');

        const percentage = percentageInput ? parseFloat(percentageInput.value) : 100;
        const targetWidth = widthInput ? parseInt(widthInput.value, 10) : NaN;
        const targetHeight = heightInput ? parseInt(heightInput.value, 10) : NaN;

        if (mode === 'percentage') {
            if (!Number.isFinite(percentage) || percentage <= 0) {
                throw new Error('Please enter a valid resize percentage greater than 0');
            }
        } else {
            if (!Number.isFinite(targetWidth) || targetWidth <= 0 || !Number.isFinite(targetHeight) || targetHeight <= 0) {
                throw new Error('Please enter valid width and height values');
            }
        }

        for (const file of this.uploadedFiles) {
            const imageUrl = URL.createObjectURL(file);
            try {
                const img = await new Promise((resolve, reject) => {
                    const image = new Image();
                    image.onload = () => resolve(image);
                    image.onerror = () => reject(new Error('Failed to load image'));
                    image.src = imageUrl;
                });

                const originalWidth = img.naturalWidth || img.width;
                const originalHeight = img.naturalHeight || img.height;

                let resizedWidth = originalWidth;
                let resizedHeight = originalHeight;

                if (mode === 'percentage') {
                    const scale = percentage / 100;
                    resizedWidth = Math.max(1, Math.round(originalWidth * scale));
                    resizedHeight = Math.max(1, Math.round(originalHeight * scale));
                } else if (mode === 'resolution-lock') {
                    const scale = targetWidth / originalWidth;
                    resizedWidth = Math.max(1, Math.round(originalWidth * scale));
                    resizedHeight = Math.max(1, Math.round(originalHeight * scale));
                } else {
                    resizedWidth = Math.max(1, targetWidth);
                    resizedHeight = Math.max(1, targetHeight);
                }

                resizedWidth = Math.min(12000, resizedWidth);
                resizedHeight = Math.min(12000, resizedHeight);

                const canvas = document.createElement('canvas');
                canvas.width = resizedWidth;
                canvas.height = resizedHeight;
                const ctx = canvas.getContext('2d');

                const lowerName = file.name.toLowerCase();
                const isJpeg = file.type.includes('jpeg') || file.type.includes('jpg') || /\.(jpe?g)$/i.test(lowerName);
                const isWebp = file.type.includes('webp') || /\.webp$/i.test(lowerName);

                let outputMime = isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png';
                let outputExt = isJpeg ? 'jpg' : isWebp ? 'webp' : 'png';

                if (outputMime === 'image/jpeg') {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, resizedWidth, resizedHeight);
                }
                ctx.drawImage(img, 0, 0, resizedWidth, resizedHeight);

                let blob = await new Promise((resolve) => {
                    if (outputMime === 'image/jpeg' || outputMime === 'image/webp') {
                        canvas.toBlob((b) => resolve(b), outputMime, 0.92);
                    } else {
                        canvas.toBlob((b) => resolve(b), outputMime);
                    }
                });

                if (!blob && outputMime === 'image/webp') {
                    outputMime = 'image/png';
                    outputExt = 'png';
                    blob = await new Promise((resolve) => {
                        canvas.toBlob((b) => resolve(b), outputMime);
                    });
                }

                if (!blob) {
                    throw new Error('Failed to generate resized image');
                }

                const sizeDifference = blob.size - file.size;
                const sizeDeltaText = sizeDifference <= 0
                    ? `${this.formatFileSize(Math.abs(sizeDifference))} smaller`
                    : `${this.formatFileSize(sizeDifference)} larger`;

                results.push({
                    name: `${file.name.replace(/\.[^.]+$/, '')}_resized.${outputExt}`,
                    type: outputMime,
                    size: blob.size,
                    url: URL.createObjectURL(blob),
                    details: `Size: ${this.formatFileSize(file.size)} -> ${this.formatFileSize(blob.size)} (${sizeDeltaText}) | Resolution: ${originalWidth}x${originalHeight} -> ${resizedWidth}x${resizedHeight}`
                });
            } catch (error) {
                console.error('Error resizing image:', error);
                this.showNotification(`Failed to resize ${file.name}: ${error.message}`, 'error');
                results.push({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    url: URL.createObjectURL(file),
                    details: `Original size: ${this.formatFileSize(file.size)}`
                });
            } finally {
                URL.revokeObjectURL(imageUrl);
            }
        }

        return results;
    },
    // Convert data URL to byte array

    dataUrlToBytes(dataUrl) {
        const base64 = dataUrl.split(',')[1];
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    },
    // Remove Metadata from PDF

    async removeMetadata() {
        const results = [];

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const originalSize = file.size;

                // Load the original PDF
                const originalPdf = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

                // Create a completely new, empty PDF document
                const cleanPdf = await PDFLib.PDFDocument.create();

                // Copy all pages from original to clean PDF (without metadata)
                const pageIndices = Array.from({ length: originalPdf.getPageCount() }, (_, i) => i);
                const copiedPages = await cleanPdf.copyPages(originalPdf, pageIndices);

                // Add all copied pages to the clean PDF
                copiedPages.forEach(page => cleanPdf.addPage(page));

                // Save the clean PDF (no metadata will be included)
                const cleanPdfBytes = await cleanPdf.save({
                    useObjectStreams: false,
                    addDefaultPage: false,
                    objectStreamsThreshold: 40,
                    updateFieldAppearances: false
                });

                const cleanBlob = new Blob([cleanPdfBytes], { type: 'application/pdf' });
                const cleanSize = cleanBlob.size;

                // Calculate size difference
                const sizeDifference = originalSize - cleanSize;
                const sizeChangeText = sizeDifference > 0 ?
                    `(${this.formatFileSize(sizeDifference)} smaller)` :
                    sizeDifference < 0 ?
                        `(${this.formatFileSize(Math.abs(sizeDifference))} larger)` :
                        '(same size)';

                this.showNotification(`Metadata removed from ${file.name} ${sizeChangeText}`, 'success');

                results.push({
                    name: `clean_${file.name}`,
                    type: 'application/pdf',
                    size: cleanSize,
                    url: URL.createObjectURL(cleanBlob)
                });

            } catch (error) {
                console.error('Error removing metadata:', error);
                this.showNotification(`Failed to remove metadata from ${file.name}: ${error.message}`, 'error');

                // Return original file as fallback
                results.push({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    url: URL.createObjectURL(file)
                });
            }
        }

        return results;
    },
    // Rotate PDF

    async rotatePdf() {
        const results = [];
        const rotationAngle = parseInt(document.getElementById('rotation-angle').value);

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
                const pageCount = pdfDoc.getPageCount();

                // Always rotate all pages
                const pagesToRotate = Array.from({ length: pageCount }, (_, i) => i);

                // Apply rotation - fix for 180° and 270° rotations
                pagesToRotate.forEach(pageIndex => {
                    const page = pdfDoc.getPage(pageIndex);

                    // Get current rotation if any
                    const currentRotation = page.getRotation().angle;

                    // Calculate new rotation angle (add to current rotation)
                    const newRotation = (currentRotation + rotationAngle) % 360;

                    // Set the new rotation
                    page.setRotation(PDFLib.degrees(newRotation));
                });

                const pdfBytes = await pdfDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);

                results.push({
                    name: `rotated_${file.name}`,
                    type: 'application/pdf',
                    size: blob.size,
                    url: url
                });
            } catch (error) {
                console.error('Error rotating PDF:', error);
                throw new Error(`Failed to rotate ${file.name}`);
            }
        }

        return results;
    }


,
    // Remove Password from PDF (Decrypt)

    async removePassword() {
        const results = [];
        const currentPassword = document.getElementById('current-password')?.value;

        // Validate password input
        if (!currentPassword) {
            this.showNotification('Please enter the current PDF password', 'error');
            return results;
        }

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();

                // Use pdf.js to handle encrypted PDFs (better encryption support than pdf-lib)
                if (typeof pdfjsLib === 'undefined') {
                    this.showNotification('PDF.js library not available. Cannot decrypt PDFs.', 'error');
                    continue;
                }

                // Try to load the PDF with pdf.js and the provided password
                let pdfDocument;
                try {
                    const loadingTask = pdfjsLib.getDocument({
                        data: arrayBuffer,
                        password: currentPassword,
                        verbosity: 0
                    });
                    pdfDocument = await loadingTask.promise;
                } catch (pdfJsError) {
                    console.error('PDF.js error:', pdfJsError);

                    // Check for password-related errors
                    if (pdfJsError.name === 'PasswordException' ||
                        pdfJsError.message.includes('password') ||
                        pdfJsError.message.includes('Invalid PDF') ||
                        pdfJsError.code === 1) {
                        this.showNotification(`Incorrect password for ${file.name}`, 'error');
                    } else {
                        this.showNotification(`Failed to open ${file.name}: ${pdfJsError.message}`, 'error');
                    }

                    // Return original file as fallback
                    results.push({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        url: URL.createObjectURL(file)
                    });
                    continue;
                }

                // If we get here, the password was correct
                // Now recreate the PDF without encryption using pdf-lib
                this.showNotification(`Correct password for ${file.name}. Removing encryption...`, 'info');

                const newPdf = await PDFLib.PDFDocument.create();
                const numPages = pdfDocument.numPages;

                // Render each page and add to new PDF
                for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                    try {
                        const page = await pdfDocument.getPage(pageNum);
                        const viewport = page.getViewport({ scale: 2.0 }); // High resolution

                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        // Render the page to canvas
                        const renderContext = {
                            canvasContext: context,
                            viewport: viewport
                        };

                        await page.render(renderContext).promise;

                        // Convert canvas to image and embed in new PDF
                        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
                        const imageBytes = this.dataUrlToBytes(imageDataUrl);
                        const image = await newPdf.embedJpg(imageBytes);

                        const pdfPage = newPdf.addPage([viewport.width, viewport.height]);
                        pdfPage.drawImage(image, {
                            x: 0,
                            y: 0,
                            width: viewport.width,
                            height: viewport.height
                        });
                    } catch (pageError) {
                        console.error(`Error processing page ${pageNum}:`, pageError);
                        this.showNotification(`Warning: Error processing page ${pageNum} of ${file.name}`, 'info');
                    }
                }

                // Save the new PDF without encryption
                const decryptedBytes = await newPdf.save({
                    useObjectStreams: false,
                    addDefaultPage: false
                });

                const decryptedBlob = new Blob([decryptedBytes], { type: 'application/pdf' });

                // Verify the new PDF can be opened without password
                try {
                    await PDFLib.PDFDocument.load(decryptedBytes, { ignoreEncryption: false });
                    this.showNotification(`✅ Successfully removed password protection from ${file.name}`, 'success');
                } catch (verifyError) {
                    this.showNotification(`⚠️ Created unprotected version of ${file.name}, but please verify the result`, 'info');
                }

                results.push({
                    name: `unlocked_${file.name}`,
                    type: 'application/pdf',
                    size: decryptedBlob.size,
                    url: URL.createObjectURL(decryptedBlob)
                });

                // Clean up pdf.js document
                pdfDocument.destroy();

            } catch (error) {
                console.error('Unexpected error in password removal:', error);
                this.showNotification(`Failed to process ${file.name}: ${error.message}`, 'error');

                // Return original file as fallback
                results.push({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    url: URL.createObjectURL(file)
                });
            }
        }

        return results;
    },
    // Extract Pages functionality

    async extractPages() {
        const results = [];
        const pagesInput = document.getElementById('pages-to-extract');
        const pagesToExtract = pagesInput ? pagesInput.value.trim() : '';

        if (!pagesToExtract) {
            throw new Error('Please specify which pages to extract');
        }

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
                const totalPages = pdfDoc.getPageCount();

                // Parse page numbers (preserve user order for Extract Pages)
                const pageNumbers = this.parsePageNumbers(pagesToExtract, totalPages, true);

                if (pageNumbers.length === 0) {
                    throw new Error('No valid pages specified');
                }

                // Create new PDF with extracted pages
                const newPdfDoc = await PDFLib.PDFDocument.create();

                for (const pageNum of pageNumbers) {
                    const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [pageNum - 1]);
                    newPdfDoc.addPage(copiedPage);
                }

                const pdfBytes = await newPdfDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });

                const baseName = file.name.replace(/\.pdf$/i, '');
                const fileName = `${baseName}_extracted_pages.pdf`;

                results.push({
                    name: fileName,
                    type: 'application/pdf',
                    size: blob.size,
                    url: URL.createObjectURL(blob)
                });

                this.showNotification(`Successfully extracted ${pageNumbers.length} pages from ${file.name}`, 'success');

            } catch (error) {
                console.error('Error extracting pages:', error);
                throw new Error(`Failed to extract pages from ${file.name}: ${error.message}`);
            }
        }

        return results;
    },
    // Remove Pages functionality

    async removePages() {
        const results = [];
        const pagesInput = document.getElementById('pages-to-remove');
        const pagesToRemove = pagesInput ? pagesInput.value.trim() : '';

        if (!pagesToRemove) {
            throw new Error('Please specify which pages to remove');
        }

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
                const totalPages = pdfDoc.getPageCount();

                // Parse page numbers to remove
                const pageNumbers = this.parsePageNumbers(pagesToRemove, totalPages);

                if (pageNumbers.length === 0) {
                    throw new Error('No valid pages specified');
                }

                if (pageNumbers.length >= totalPages) {
                    throw new Error('Cannot remove all pages from PDF');
                }

                // Create new PDF with remaining pages
                const newPdfDoc = await PDFLib.PDFDocument.create();

                for (let i = 1; i <= totalPages; i++) {
                    if (!pageNumbers.includes(i)) {
                        const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i - 1]);
                        newPdfDoc.addPage(copiedPage);
                    }
                }

                const pdfBytes = await newPdfDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });

                const baseName = file.name.replace(/\.pdf$/i, '');
                const fileName = `${baseName}_pages_removed.pdf`;

                results.push({
                    name: fileName,
                    type: 'application/pdf',
                    size: blob.size,
                    url: URL.createObjectURL(blob)
                });

                this.showNotification(`Successfully removed ${pageNumbers.length} pages from ${file.name}`, 'success');

            } catch (error) {
                console.error('Error removing pages:', error);
                throw new Error(`Failed to remove pages from ${file.name}: ${error.message}`);
            }
        }

        return results;
    },
    // Add Watermark functionality

    async addWatermark() {
        if (this.uploadedFiles.length !== 1) {
            throw new Error('Please upload exactly one PDF file');
        }

        const file = this.uploadedFiles[0];
        const mode = document.querySelector('input[name="watermark-mode"]:checked')?.value || 'text';
        const excludedPagesInput = document.getElementById('watermark-excluded-pages')?.value?.trim() || '';
        const placement = this.getWatermarkOverlayPlacement();
        const results = [];

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
            const pageCount = pdfDoc.getPageCount();
            const excludedPages = excludedPagesInput
                ? new Set(this.parsePageNumbers(excludedPagesInput, pageCount))
                : new Set();

            if (mode === 'text') {
                const text = (document.getElementById('watermark-text-input')?.value || '').trim();
                if (!text) throw new Error('Please enter watermark text');

                const fontFamily = document.getElementById('watermark-text-font-family')?.value || 'helvetica';
                const fontStyle = document.getElementById('watermark-text-font-style')?.value || 'regular';
                const textColor = document.getElementById('watermark-text-color')?.value || '#ba453c';
                const textOpacity = (parseInt(document.getElementById('watermark-text-opacity')?.value, 10) || 35) / 100;
                const textRotationUi = parseInt(document.getElementById('watermark-text-rotation')?.value, 10) || 0;
                // CSS preview rotates in screen coordinates (clockwise-positive), PDF uses cartesian (counterclockwise-positive).
                const textRotation = -textRotationUi;
                const previewFontSize = parseInt(document.getElementById('watermark-text-font-size')?.value, 10) || 48;
                const previewCanvasWidth = Math.max(1, document.getElementById('watermark-preview-canvas')?.width || 1);
                const fontSizeRatio = previewFontSize / previewCanvasWidth;

                const fontName = this.getWatermarkPdfFontName(fontFamily, fontStyle);
                const font = await pdfDoc.embedFont(fontName);
                const color = this.hexToPdfRgb(textColor);

                for (let i = 0; i < pageCount; i++) {
                    const pageNumber = i + 1;
                    if (excludedPages.has(pageNumber)) continue;

                    const page = pdfDoc.getPage(i);
                    const { width, height } = page.getSize();
                    const boxWidth = placement.widthRatio * width;
                    const boxHeight = placement.heightRatio * height;
                    const boxX = placement.xRatio * width;
                    const boxY = height - (placement.yRatio * height) - boxHeight;
                    const drawFontSize = Math.max(6, fontSizeRatio * width);
                    const textWidth = font.widthOfTextAtSize(text, drawFontSize);
                    const localAnchorX = Math.max(0, (boxWidth - textWidth) / 2);
                    const localAnchorY = Math.max(0, (boxHeight - drawFontSize) * 0.45);
                    const anchorPoint = this.getRotatedAnchorPoint(
                        boxX,
                        boxY,
                        boxWidth,
                        boxHeight,
                        localAnchorX,
                        localAnchorY,
                        textRotation
                    );

                    page.drawText(text, {
                        x: anchorPoint.x,
                        y: anchorPoint.y,
                        font,
                        size: drawFontSize,
                        color,
                        opacity: Math.max(0.05, Math.min(1, textOpacity)),
                        rotate: PDFLib.degrees(textRotation)
                    });
                }
            } else {
                if (!this.watermarkImageAsset || !this.watermarkImageAsset.embedBytes) {
                    throw new Error('Please upload a watermark image');
                }
                const sizeValidation = this.getWatermarkImageDimensionValidation(true);
                if (!sizeValidation.valid) {
                    throw new Error(sizeValidation.message || 'Please fix watermark image width/height values');
                }

                const imageOpacity = (parseInt(document.getElementById('watermark-image-opacity')?.value, 10) || 35) / 100;
                const imageRotationUi = parseInt(document.getElementById('watermark-image-rotation')?.value, 10) || 0;
                const imageRotation = -imageRotationUi;
                const centered = !!document.getElementById('watermark-image-centered')?.checked;
                const imageBytes = this.watermarkImageAsset.embedBytes;
                const image = this.watermarkImageAsset.embedType === 'image/png'
                    ? await pdfDoc.embedPng(imageBytes)
                    : await pdfDoc.embedJpg(imageBytes);

                for (let i = 0; i < pageCount; i++) {
                    const pageNumber = i + 1;
                    if (excludedPages.has(pageNumber)) continue;

                    const page = pdfDoc.getPage(i);
                    const { width, height } = page.getSize();
                    const drawWidth = placement.widthRatio * width;
                    const drawHeight = placement.heightRatio * height;
                    const boxX = centered ? (width - drawWidth) / 2 : placement.xRatio * width;
                    const boxY = centered
                        ? (height - drawHeight) / 2
                        : height - (placement.yRatio * height) - drawHeight;
                    const anchorPoint = this.getRotatedAnchorPoint(
                        boxX,
                        boxY,
                        drawWidth,
                        drawHeight,
                        0,
                        0,
                        imageRotation
                    );

                    page.drawImage(image, {
                        x: anchorPoint.x,
                        y: anchorPoint.y,
                        width: drawWidth,
                        height: drawHeight,
                        opacity: Math.max(0.05, Math.min(1, imageOpacity)),
                        rotate: PDFLib.degrees(imageRotation)
                    });
                }
            }

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const outputName = `${file.name.replace(/\.pdf$/i, '')}_watermarked.pdf`;

            results.push({
                name: outputName,
                type: 'application/pdf',
                size: blob.size,
                url: URL.createObjectURL(blob)
            });

            const excludedCount = excludedPages.size;
            if (excludedCount > 0) {
                this.showNotification(`Watermark applied. Skipped ${excludedCount} excluded ${excludedCount === 1 ? 'page' : 'pages'}.`, 'success');
            } else {
                this.showNotification('Watermark applied to all pages successfully.', 'success');
            }
        } catch (error) {
            console.error('Error adding watermark:', error);
            throw new Error(`Failed to add watermark: ${error.message}`);
        }

        return results;
    },
    // Sort Pages functionality

    async sortPages() {
        const results = [];

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
                const totalPages = pdfDoc.getPageCount();

                // Get the current page order from the UI
                const pageOrder = this.getPageOrderFromUI();
                console.log('Total pages in PDF:', totalPages);
                console.log('Page order from UI:', pageOrder);

                // Create new PDF with sorted pages
                const newPdfDoc = await PDFLib.PDFDocument.create();

                if (pageOrder && pageOrder.length === totalPages) {
                    // Use custom order from UI - pageOrder contains the original page indices in the new order
                    console.log('Applying custom page order:', pageOrder);
                    for (const originalPageIndex of pageOrder) {
                        console.log(`Copying page at original index: ${originalPageIndex}`);
                        const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [originalPageIndex]);
                        newPdfDoc.addPage(copiedPage);
                    }
                    this.showNotification(`Successfully reordered ${totalPages} pages in ${file.name}. Order: [${pageOrder.join(', ')}]`, 'success');
                } else {
                    // Use original order if no custom order is set
                    console.log(`Using original order. PageOrder: ${pageOrder}, Length: ${pageOrder ? pageOrder.length : 'null'}, TotalPages: ${totalPages}`);
                    for (let i = 0; i < totalPages; i++) {
                        const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
                        newPdfDoc.addPage(copiedPage);
                    }
                    this.showNotification(`No reordering applied to ${file.name} - using original order`, 'info');
                }

                const pdfBytes = await newPdfDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });

                const baseName = file.name.replace(/\.pdf$/i, '');
                const fileName = `${baseName}_sorted.pdf`;

                results.push({
                    name: fileName,
                    type: 'application/pdf',
                    size: blob.size,
                    url: URL.createObjectURL(blob)
                });

            } catch (error) {
                console.error('Error sorting pages:', error);
                throw new Error(`Failed to sort pages in ${file.name}: ${error.message}`);
            }
        }

        return results;
    },
    // Helper function to parse page numbers from string input (preserves order for Extract Pages)

    parsePageNumbers(input, totalPages, preserveOrder = false) {
        if (preserveOrder) {
            return this.parsePageNumbersPreserveOrder(input, totalPages);
        }

        const pageNumbers = new Set();
        const parts = input.split(',');

        for (let part of parts) {
            part = part.trim();

            if (part.includes('-')) {
                // Handle range (e.g., "5-8")
                const [start, end] = part.split('-').map(n => parseInt(n.trim()));
                if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
                    throw new Error(`Invalid page range: ${part}`);
                }
                for (let i = start; i <= end; i++) {
                    pageNumbers.add(i);
                }
            } else {
                // Handle single page
                const pageNum = parseInt(part);
                if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
                    throw new Error(`Invalid page number: ${part}`);
                }
                pageNumbers.add(pageNum);
            }
        }

        return Array.from(pageNumbers).sort((a, b) => a - b);
    },
    // Helper function to parse page numbers preserving user order (for Extract Pages)

    parsePageNumbersPreserveOrder(input, totalPages) {
        const pageNumbers = [];
        const parts = input.split(',');

        for (let part of parts) {
            part = part.trim();

            if (part.includes('-')) {
                // Handle range (e.g., "5-8")
                const [start, end] = part.split('-').map(n => parseInt(n.trim()));
                if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
                    throw new Error(`Invalid page range: ${part}`);
                }
                for (let i = start; i <= end; i++) {
                    pageNumbers.push(i);
                }
            } else {
                // Handle single page
                const pageNum = parseInt(part);
                if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
                    throw new Error(`Invalid page number: ${part}`);
                }
                pageNumbers.push(pageNum);
            }
        }

        return pageNumbers; // Return without sorting to preserve user order
    },
    // Helper function to get page order from UI (for sort pages feature)

    getPageOrderFromUI() {
        const thumbnailContainer = document.getElementById('page-thumbnails');
        if (!thumbnailContainer) {
            console.log('No thumbnail container found');
            return null;
        }

        const thumbnails = thumbnailContainer.querySelectorAll('.page-thumbnail');
        if (thumbnails.length === 0) {
            console.log('No thumbnails found');
            return null;
        }

        // Get the current order based on DOM position, using data-original-page-index attribute
        // This represents the order of original page indices as they appear in the UI
        const pageOrder = Array.from(thumbnails).map(thumb => {
            const originalIndex = parseInt(thumb.getAttribute('data-original-page-index'));
            console.log(`Thumbnail with originalPageIndex: ${originalIndex}`);
            return originalIndex;
        });

        console.log('Final page order:', pageOrder);
        return pageOrder;
    },
// Helper function to parse page numbers from string input (preserves order for Extract Pages)
parsePageNumbers(input, totalPages, preserveOrder = false) {
    if (preserveOrder) {
        return this.parsePageNumbersPreserveOrder(input, totalPages);
    }

    const pageNumbers = new Set();
    const parts = input.split(',');

    for (let part of parts) {
        part = part.trim();

        if (part.includes('-')) {
            // Handle range (e.g., "5-8")
            const [start, end] = part.split('-').map(n => parseInt(n.trim()));
            if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
                throw new Error(`Invalid page range: ${part}`);
            }
            for (let i = start; i <= end; i++) {
                pageNumbers.add(i);
            }
        } else {
            // Handle single page
            const pageNum = parseInt(part);
            if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
                throw new Error(`Invalid page number: ${part}`);
            }
            pageNumbers.add(pageNum);
        }
    }

    return Array.from(pageNumbers).sort((a, b) => a - b);
}
,
// Helper function to parse page numbers preserving user order (for Extract Pages)
parsePageNumbersPreserveOrder(input, totalPages) {
    const pageNumbers = [];
    const parts = input.split(',');

    for (let part of parts) {
        part = part.trim();

        if (part.includes('-')) {
            // Handle range (e.g., "5-8")
            const [start, end] = part.split('-').map(n => parseInt(n.trim()));
            if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
                throw new Error(`Invalid page range: ${part}`);
            }
            for (let i = start; i <= end; i++) {
                pageNumbers.push(i);
            }
        } else {
            // Handle single page
            const pageNum = parseInt(part);
            if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
                throw new Error(`Invalid page number: ${part}`);
            }
            pageNumbers.push(pageNum);
        }
    }

    return pageNumbers; // Return without sorting to preserve user order
}

 
,
// Reverse page order function
reversePageOrder() {
    const thumbnailContainer = document.getElementById('page-thumbnails');
    const reverseBtn = document.getElementById('reverse-pages-btn');
    if (!thumbnailContainer || !reverseBtn) return;

    const thumbnails = Array.from(thumbnailContainer.querySelectorAll('.page-thumbnail'));
    if (thumbnails.length === 0) return;

    // Clear container
    thumbnailContainer.innerHTML = '';

    // Add thumbnails in reverse order and re-establish drag and drop
    thumbnails.reverse().forEach(thumbnail => {
        thumbnailContainer.appendChild(thumbnail);
        if (typeof Sortable === 'undefined') {
            this.setupThumbnailDragAndDrop(thumbnail);
        }
    });

    // Toggle the reversed state
    this.isReversed = !this.isReversed;
        setTimeout(() => {
            const reverseBtn = document.getElementById('reverse-pages-btn');
            if (reverseBtn) {
                // Remove any existing event listeners by cloning the button
                const newReverseBtn = reverseBtn.cloneNode(true);
                reverseBtn.parentNode.replaceChild(newReverseBtn, reverseBtn);
                
                // Add the event listener to the new button
                newReverseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Reverse button clicked!'); // Debug log
                    this.reversePageOrder();
                });
                
                console.log('Reverse button listener set up successfully'); // Debug log
            } else {
                console.log('Reverse button not found'); // Debug log
            }
        }, 50);
    },
    // Setup reset button (restore original DOM order by original page index)

    setupResetButtonListener() {
        setTimeout(() => {
            const btn = document.getElementById('reset-pages-btn');
            if (!btn) return;
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.resetToOriginalOrder();
            });
        }, 50);
    },
    // Reset thumbnails to original order based on data-original-page-index

    resetToOriginalOrder() {
        const container = document.getElementById('page-thumbnails');
        if (!container) return;
        const thumbs = Array.from(container.querySelectorAll('.page-thumbnail'));
        thumbs.sort((a, b) => (
            parseInt(a.getAttribute('data-original-page-index')) - parseInt(b.getAttribute('data-original-page-index'))
        ));
        container.innerHTML = '';
        thumbs.forEach(t => container.appendChild(t));
        // Re-enable Sortable after DOM reset
        if (typeof Sortable !== 'undefined') {
            this.enableThumbnailSorting();
        }
        this.isReversed = false;
        const reverseBtn = document.getElementById('reverse-pages-btn');
        if (reverseBtn) {
            reverseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> Reverse Order (Back to Front)';
        }
        this.showNotification('Order reset to original.', 'success');
    },
    // Thumbnail size controls

    setupThumbnailSizeControls() {
        setTimeout(() => {
            const select = document.getElementById('thumb-size-select');
            if (!select) return;
            const newSelect = select.cloneNode(true);
            select.parentNode.replaceChild(newSelect, select);
            newSelect.addEventListener('change', () => {
                this.applyThumbnailSize(newSelect.value);
            });
        }, 50);
    },
    // Reverse button control

    setupReverseButtonListener() {
        setTimeout(() => {
            const btn = document.getElementById('reverse-pages-btn');
            if (!btn) return;
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.reversePageOrder();
            });
        }, 50);
    },

    applyThumbnailSize(size) {
        const widths = { sm: '120px', md: '160px', lg: '220px' };
        const w = widths[size] || widths.md;
        const container = document.getElementById('page-thumbnails');
        if (!container) return;
        container.querySelectorAll('.page-thumbnail').forEach(el => {
            try { el.style.width = w; } catch (_) {}
        });
    },
    // Goto page control

    setupGotoPageListener() {
        setTimeout(() => {
            const input = document.getElementById('goto-page-input');
            const btn = document.getElementById('goto-page-btn');
            if (!input || !btn) return;
            const onGo = () => {
                const val = parseInt(input.value, 10);
                if (!isNaN(val) && val > 0) {
                    this.scrollToPageNumber(val);
                } else {
                    this.showNotification('Enter a valid page number', 'error');
                }
            };
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', (e) => { e.preventDefault(); onGo(); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); onGo(); }
            });
        }, 50);
    },

    scrollToPageNumber(pageNumber) {
        const container = document.getElementById('page-thumbnails');
        if (!container) return;
        const idx = pageNumber - 1;
        const target = Array.from(container.querySelectorAll('.page-thumbnail')).find(el =>
            parseInt(el.getAttribute('data-original-page-index')) === idx
        );
        if (!target) {
            this.showNotification('Page not found', 'error');
            return;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        const prev = target.style.boxShadow;
        target.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.8)';
        setTimeout(() => { target.style.boxShadow = prev; }, 900);
    },
    // Helper function to download results

    downloadResult(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Show success notification
        this.showNotification(`Downloaded: ${filename}`, 'success');
    },
    // Helper function to download all images (for ZIP fallback)

    downloadAllImages(images) {
        if (!images || images.length === 0) return;

        // Download each image with a small delay to prevent browser blocking
        images.forEach((image, index) => {
            setTimeout(() => {
                this.downloadResult(image.url, image.name);
            }, index * 200); // 200ms delay between downloads
        });

        this.showNotification(`Downloading ${images.length} files...`, 'success');
    },
    // Helper function to save last used tool

    saveLastUsedTool() {
        try {
            localStorage.setItem('luxpdf-last-tool', this.currentTool);
        } catch (error) {
            // Ignore localStorage errors
        }
    },
    // Helper function to load last used tool

    loadLastUsedTool() {
        try {
            const lastTool = localStorage.getItem('luxpdf-last-tool');
            if (lastTool) {
                // Could implement auto-opening last tool if desired
            }
        } catch (error) {
            // Ignore localStorage errors
        }
    },
    // Generate page thumbnails for sort pages feature

    async generatePageThumbnails(file) {
        if (this.currentTool !== 'sort-pages') return;

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            const thumbnailContainer = document.getElementById('page-thumbnails');
            const sortControls = document.querySelector('.sort-controls');

            if (!thumbnailContainer) return;

            thumbnailContainer.innerHTML = '';
            thumbnailContainer.style.display = 'grid';

            // Reset reverse state when generating new thumbnails
            this.isReversed = false;
            const reverseBtn = document.getElementById('reverse-pages-btn');
            if (reverseBtn) {
                reverseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> Reverse Order (Back to Front)';
            }

            // Show sort controls
            if (sortControls) {
                sortControls.style.display = 'block';
            }

            // Setup reverse button listener when controls become visible
            this.setupReverseButtonListener();

            this.showNotification('Generating page thumbnails...', 'info');

            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 0.5 });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                // Render the page to canvas
                const renderContext = {
                    canvasContext: context,
                    viewport: viewport
                };

                await page.render(renderContext).promise;

                const thumbnailDiv = document.createElement('div');
                thumbnailDiv.className = 'page-thumbnail';
                thumbnailDiv.draggable = typeof Sortable === 'undefined';
                // Store the original page index (0-based)
                thumbnailDiv.setAttribute('data-original-page-index', pageNum - 1);

                // Create a data URL from the canvas
                const dataURL = canvas.toDataURL('image/png');

                thumbnailDiv.innerHTML = `
                    <div class="thumbnail-header" style="display:flex; align-items:center; justify-content:space-between; gap:.5rem;">
                        <div class="page-label">Page ${pageNum}</div>
                        <button class="thumb-grip" title="Drag to reorder" aria-label="Drag to reorder" style="cursor: grab; background: transparent; color: inherit; border: none; padding: .25rem; display:flex; align-items:center;">
                            <i class="fas fa-grip-vertical"></i>
                        </button>
                    </div>
                    <div class="thumbnail-canvas-container">
                        <img src="${dataURL}" alt="Page ${pageNum}" style="width: 100%; height: auto; display: block;">
                    </div>
                `;
                // Default medium width; can be adjusted by size control
                try { thumbnailDiv.style.width = '160px'; } catch(_) {}

                // Attach native drag listeners only when SortableJS is not available (desktop fallback)
                if (typeof Sortable === 'undefined') {
                    this.setupThumbnailDragAndDrop(thumbnailDiv);
                }

                thumbnailContainer.appendChild(thumbnailDiv);
            }

            

            // After all thumbnails rendered, enable SortableJS if available
            if (typeof Sortable !== 'undefined') {
                this.enableThumbnailSorting();
            }

            // Apply current size selection if present
            const sizeSelect = document.getElementById('thumb-size-select');
            if (sizeSelect) {
                this.applyThumbnailSize(sizeSelect.value || 'md');
            }

            this.showNotification(`Generated ${pdf.numPages} page thumbnails. Drag to reorder!`, 'success');

        } catch (error) {
            console.error('Error generating thumbnails:', error);
            this.showNotification('Failed to generate page thumbnails', 'error');
        }
    },
    // Setup drag and drop for page thumbnails

    setupThumbnailDragAndDrop(thumbnail) {
        thumbnail.addEventListener('dragstart', (e) => {
            thumbnail.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', thumbnail.getAttribute('data-original-page-index'));
        });

        thumbnail.addEventListener('dragend', () => {
            thumbnail.classList.remove('dragging');
            document.querySelectorAll('.page-thumbnail').forEach(thumb => {
                thumb.style.borderTop = '';
                thumb.style.borderBottom = '';
            });
        });

        thumbnail.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const draggingThumb = document.querySelector('.page-thumbnail.dragging');
            if (draggingThumb && draggingThumb !== thumbnail) {
                const rect = thumbnail.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                thumbnail.style.borderTop = '';
                thumbnail.style.borderBottom = '';

                if (e.clientY < midY) {
                    thumbnail.style.borderTop = '3px solid var(--accent-color)';
                } else {
                    thumbnail.style.borderBottom = '3px solid var(--accent-color)';
                }
            }
        });

        thumbnail.addEventListener('dragleave', (e) => {
            const rect = thumbnail.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom) {
                thumbnail.style.borderTop = '';
                thumbnail.style.borderBottom = '';
            }
        });

        thumbnail.addEventListener('drop', (e) => {
            e.preventDefault();
            thumbnail.style.borderTop = '';
            thumbnail.style.borderBottom = '';

            const draggedPageIndex = e.dataTransfer.getData('text/plain');
            const targetPageIndex = thumbnail.getAttribute('data-original-page-index');

            if (draggedPageIndex && draggedPageIndex !== targetPageIndex) {
                const container = thumbnail.parentNode;
                const draggedThumb = container.querySelector(`[data-original-page-index="${draggedPageIndex}"]`);

                if (draggedThumb) {
                    const rect = thumbnail.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const insertAfter = e.clientY >= midY;

                    if (insertAfter) {
                        container.insertBefore(draggedThumb, thumbnail.nextSibling);
                    } else {
                        container.insertBefore(draggedThumb, thumbnail);
                    }

                    // Show notification that pages have been reordered
                    this.showNotification('Pages reordered! Click Process to generate the sorted PDF.', 'success');
                }
            }
        });
    }

 
,
    // Reverse page order function

    reversePageOrder() {
        const thumbnailContainer = document.getElementById('page-thumbnails');
        const reverseBtn = document.getElementById('reverse-pages-btn');
        if (!thumbnailContainer || !reverseBtn) return;

        const thumbnails = Array.from(thumbnailContainer.querySelectorAll('.page-thumbnail'));
        if (thumbnails.length === 0) return;

        // Clear container
        thumbnailContainer.innerHTML = '';

        // Add thumbnails in reverse order and re-establish drag and drop
        thumbnails.reverse().forEach(thumbnail => {
            thumbnailContainer.appendChild(thumbnail);
            // Re-establish drag and drop functionality for each thumbnail
            this.setupThumbnailDragAndDrop(thumbnail);
        });

        // Toggle the reversed state
        this.isReversed = !this.isReversed;

        // Update button text and icon based on current state
        if (this.isReversed) {
            reverseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> Reverse Order (Front to Back)';
            this.showNotification('Pages reversed to Back to Front! Click again to restore Front to Back order.', 'success');
        } else {
            reverseBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> Reverse Order (Back to Front)';
            this.showNotification('Pages restored to Front to Back order! Click again to reverse to Back to Front.', 'success');
        }
    },
    // Setup drag and drop for page thumbnails

    setupThumbnailDragAndDrop(thumbnail) {
        thumbnail.addEventListener('dragstart', (e) => {
            thumbnail.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', thumbnail.getAttribute('data-original-page-index'));
        });

        thumbnail.addEventListener('dragend', () => {
            thumbnail.classList.remove('dragging');
            document.querySelectorAll('.page-thumbnail').forEach(thumb => {
                thumb.style.borderTop = '';
                thumb.style.borderBottom = '';
            });
        });

        thumbnail.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const draggingThumb = document.querySelector('.page-thumbnail.dragging');
            if (draggingThumb && draggingThumb !== thumbnail) {
                const rect = thumbnail.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                thumbnail.style.borderTop = '';
                thumbnail.style.borderBottom = '';

                if (e.clientY < midY) {
                    thumbnail.style.borderTop = '3px solid var(--accent-color)';
                } else {
                    thumbnail.style.borderBottom = '3px solid var(--accent-color)';
                }
            }
        });

        thumbnail.addEventListener('dragleave', (e) => {
            const rect = thumbnail.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom) {
                thumbnail.style.borderTop = '';
                thumbnail.style.borderBottom = '';
            }
        });

        thumbnail.addEventListener('drop', (e) => {
            e.preventDefault();
            thumbnail.style.borderTop = '';
            thumbnail.style.borderBottom = '';

            const draggedPageIndex = e.dataTransfer.getData('text/plain');
            const targetPageIndex = thumbnail.getAttribute('data-original-page-index');

            if (draggedPageIndex && draggedPageIndex !== targetPageIndex) {
                const container = thumbnail.parentNode;
                const draggedThumb = container.querySelector(`[data-original-page-index="${draggedPageIndex}"]`);

                if (draggedThumb) {
                    const rect = thumbnail.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const insertAfter = e.clientY >= midY;

                    if (insertAfter) {
                        container.insertBefore(draggedThumb, thumbnail.nextSibling);
                    } else {
                        container.insertBefore(draggedThumb, thumbnail);
                    }

                    // Show notification that pages have been reordered
                    this.showNotification('Pages reordered! Click Process to generate the sorted PDF.', 'success');
                }
            }
        });
    }






,
    // HEIC/HEIF to PDF functionality

    async heifToPdf() {
        const results = [];
        const conversionMode = document.getElementById('conversion-mode')?.value || 'individual';

        if (conversionMode === 'combined') {
            // Combine all HEIC/HEIF files into a single PDF
            const pdfDoc = await PDFLib.PDFDocument.create();

            for (const file of this.uploadedFiles) {
                try {
                    let jpegArrayBuffer;
                    
                    // Check if file is already JPEG (iOS-converted) or needs HEIF conversion
                    if (file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {
                        console.log('Processing JPEG file (may be iOS-converted HEIF):', file.name);
                        // File is already JPEG, use it directly
                        jpegArrayBuffer = await file.arrayBuffer();
                    } else {
                        console.log('Converting HEIF file to JPEG:', file.name);
                        // Convert HEIF to JPEG using heic2any (it handles both HEIC and HEIF)
                        const jpegBlob = await heic2any({
                            blob: file,
                            toType: 'image/jpeg',
                            quality: 0.9
                        });
                        jpegArrayBuffer = await jpegBlob.arrayBuffer();
                    }
                    const jpegImage = await pdfDoc.embedJpg(jpegArrayBuffer);

                    // Calculate dimensions to fit the page
                    const page = pdfDoc.addPage();
                    const { width: pageWidth, height: pageHeight } = page.getSize();
                    const { width: imgWidth, height: imgHeight } = jpegImage;

                    const scale = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
                    const scaledWidth = imgWidth * scale;
                    const scaledHeight = imgHeight * scale;

                    const x = (pageWidth - scaledWidth) / 2;
                    const y = (pageHeight - scaledHeight) / 2;

                    page.drawImage(jpegImage, {
                        x,
                        y,
                        width: scaledWidth,
                        height: scaledHeight
                    });
                } catch (error) {
                    console.error('Error processing HEIF file:', error);
                    throw new Error(`Failed to process ${file.name}: ${error.message}`);
                }
            }

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });

            results.push({
                name: 'combined_heic_heif.pdf',
                type: 'application/pdf',
                size: blob.size,
                url: URL.createObjectURL(blob)
            });
        } else {
            // Convert each HEIC/HEIF file to individual PDF
            for (const file of this.uploadedFiles) {
                try {
                    let jpegArrayBuffer;
                    
                    // Check if file is already JPEG (iOS-converted) or needs HEIF conversion
                    if (file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {
                        console.log('Processing JPEG file (may be iOS-converted HEIF):', file.name);
                        // File is already JPEG, use it directly
                        jpegArrayBuffer = await file.arrayBuffer();
                    } else {
                        console.log('Converting HEIF file to JPEG:', file.name);
                        // Convert HEIF to JPEG using heic2any (it handles both HEIC and HEIF)
                        const jpegBlob = await heic2any({
                            blob: file,
                            toType: 'image/jpeg',
                            quality: 0.9
                        });
                        jpegArrayBuffer = await jpegBlob.arrayBuffer();
                    }
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const jpegImage = await pdfDoc.embedJpg(jpegArrayBuffer);

                    // Calculate dimensions to fit the page
                    const page = pdfDoc.addPage();
                    const { width: pageWidth, height: pageHeight } = page.getSize();
                    const { width: imgWidth, height: imgHeight } = jpegImage;

                    const scale = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
                    const scaledWidth = imgWidth * scale;
                    const scaledHeight = imgHeight * scale;

                    const x = (pageWidth - scaledWidth) / 2;
                    const y = (pageHeight - scaledHeight) / 2;

                    page.drawImage(jpegImage, {
                        x,
                        y,
                        width: scaledWidth,
                        height: scaledHeight
                    });

                    const pdfBytes = await pdfDoc.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });

                    const baseName = file.name.replace(/\.(heif|heic|jpg|jpeg)$/i, '');
                    const fileName = `${baseName}.pdf`;

                    results.push({
                        name: fileName,
                        type: 'application/pdf',
                        size: blob.size,
                        url: URL.createObjectURL(blob)
                    });
                } catch (error) {
                    console.error('Error converting HEIF:', error);
                    throw new Error(`Failed to convert ${file.name}: ${error.message}`);
                }
            }
        }

        return results;
    },
    // Helper method to add HTML content to PDF

    async addHtmlContentToPdf(pdfDoc, htmlContent) {
        // Simple HTML to PDF conversion
        // This is a basic implementation - for more complex HTML rendering,
        // you might want to use a more sophisticated library
        
        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        
        // Strip HTML tags and convert to plain text for basic rendering
        const textContent = htmlContent
            .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n')
            .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();

        // Add text to PDF
        const fontSize = 12;
        const margin = 50;
        const lineHeight = fontSize * 1.2;
        const maxWidth = width - (margin * 2);
        
        const lines = textContent.split('\n');
        let y = height - margin;
        
        let currentPage = page;
        
        for (const line of lines) {
            if (y < margin) {
                // Add new page if needed
                currentPage = pdfDoc.addPage();
                y = currentPage.getSize().height - margin;
            }
            
            if (line.trim()) {
                currentPage.drawText(line, {
                    x: margin,
                    y: y,
                    size: fontSize,
                    maxWidth: maxWidth
                });
            }
            
            y -= lineHeight;
        }
    },
    // Advanced HTML to PDF conversion method

    async addAdvancedHtmlContentToPdf(pdfDoc, htmlContent) {
        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        
        // Enhanced HTML to text conversion with better formatting
        const textContent = this.convertHtmlToFormattedText(htmlContent);
        
        // Add text to PDF with improved formatting
        const fontSize = 12;
        const margin = 50;
        const lineHeight = fontSize * 1.4;
        const maxWidth = width - (margin * 2);
        
        const lines = textContent.split('\n');
        let y = height - margin;
        let currentPage = page;
        
        for (const line of lines) {
            if (y < margin + lineHeight) {
                // Add new page if needed
                currentPage = pdfDoc.addPage();
                y = currentPage.getSize().height - margin;
            }
            
            if (line.trim()) {
                // Determine font size based on content type
                let currentFontSize = fontSize;
                let cleanLine = line;
                
                // Handle headers
                if (line.startsWith('# ')) {
                    currentFontSize = fontSize * 1.8;
                    cleanLine = line.substring(2);
                    y -= lineHeight * 0.5; // Extra spacing before headers
                } else if (line.startsWith('## ')) {
                    currentFontSize = fontSize * 1.5;
                    cleanLine = line.substring(3);
                    y -= lineHeight * 0.3;
                } else if (line.startsWith('### ')) {
                    currentFontSize = fontSize * 1.3;
                    cleanLine = line.substring(4);
                    y -= lineHeight * 0.2;
                } else if (line.startsWith('#### ')) {
                    currentFontSize = fontSize * 1.1;
                    cleanLine = line.substring(5);
                }
                
                // Handle bold and italic (basic detection)
                if (cleanLine.includes('**') || cleanLine.includes('__')) {
                    cleanLine = cleanLine.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
                }
                
                if (cleanLine.includes('*') || cleanLine.includes('_')) {
                    cleanLine = cleanLine.replace(/\*(.*?)\*/g, '$1').replace(/_(.*?)_/g, '$1');
                }
                
                // Handle code blocks (monospace simulation)
                if (cleanLine.includes('`')) {
                    cleanLine = cleanLine.replace(/`(.*?)`/g, '$1');
                }
                
                // Draw the text
                try {
                    currentPage.drawText(cleanLine, {
                        x: margin,
                        y: y,
                        size: currentFontSize,
                        maxWidth: maxWidth,
                        lineHeight: lineHeight
                    });
                } catch (error) {
                    // Fallback for problematic characters
                    const safeText = cleanLine.replace(/[^\x00-\x7F]/g, '?');
                    currentPage.drawText(safeText, {
                        x: margin,
                        y: y,
                        size: currentFontSize,
                        maxWidth: maxWidth,
                        lineHeight: lineHeight
                    });
                }
            }
            
            y -= lineHeight;
        }
    },
    // Convert HTML to formatted text with better structure preservation

    convertHtmlToFormattedText(htmlContent) {
        return htmlContent
            // Headers
            .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n\n# $1\n')
            .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n\n## $1\n')
            .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n### $1\n')
            .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n\n#### $1\n')
            .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n\n##### $1\n')
            .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n\n###### $1\n')
            // Paragraphs
            .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
            // Line breaks
            .replace(/<br\s*\/?>/gi, '\n')
            // Lists
            .replace(/<ul[^>]*>/gi, '\n')
            .replace(/<\/ul>/gi, '\n')
            .replace(/<ol[^>]*>/gi, '\n')
            .replace(/<\/ol>/gi, '\n')
            .replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
            // Blockquotes
            .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '\n> $1\n')
            // Code blocks
            .replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
            .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
            // Tables (basic)
            .replace(/<table[^>]*>/gi, '\n')
            .replace(/<\/table>/gi, '\n')
            .replace(/<tr[^>]*>/gi, '')
            .replace(/<\/tr>/gi, '\n')
            .replace(/<th[^>]*>(.*?)<\/th>/gi, '| $1 ')
            .replace(/<td[^>]*>(.*?)<\/td>/gi, '| $1 ')
            // Horizontal rules
            .replace(/<hr[^>]*>/gi, '\n---\n')
            // Strong and emphasis
            .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
            .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
            .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
            .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
            // Links
            .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
            // Remove remaining HTML tags
            .replace(/<[^>]*>/g, '')
            // Clean up HTML entities
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            // Clean up extra whitespace
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .trim();
    }
});
