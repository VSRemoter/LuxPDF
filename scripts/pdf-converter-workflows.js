/* Split from script.js */
Object.assign(PDFConverterPro.prototype, {
    async preprocessPptx(originalFile) {
        try {
            const inputBuf = await originalFile.arrayBuffer();
            // Prefer already-provisioned JSZip v2 (no extra network). Fallback to v3 only if necessary.
            const JSZipLib = window.__pptxJSZip || window.JSZip;
            if (JSZipLib) {
                // Detect API flavor by presence of loadAsync
                if (typeof JSZipLib.loadAsync === 'function') {
                    // v3 path
                    const zip = await JSZipLib.loadAsync(inputBuf);
                    const hasApp = !!zip.file('docProps/app.xml');
                    if (!hasApp) {
                        const appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                            + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
                            + 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n'
                            + '  <Application>Microsoft Office PowerPoint</Application>\n'
                            + '</Properties>';
                        zip.folder('docProps').file('app.xml', appXml);
                        // Ensure [Content_Types].xml override exists for app.xml
                        try {
                            const ctFile = zip.file('[Content_Types].xml');
                            if (ctFile) {
                                let ct = await ctFile.async('string');
                                if (!/PartName="\/docProps\/app\.xml"/i.test(ct)) {
                                    const override = '\n  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>';
                                    ct = ct.replace(/<\/Types>/, override + '\n</Types>');
                                    zip.file('[Content_Types].xml', ct);
                                }
                            }
                        } catch (_) { /* ignore */ }
                        const outBlob = await zip.generateAsync({ type: 'blob' });
                        return outBlob;
                    }
                    return null;
                } else {
                    // v2 path
                    /* global Uint8Array */
                    // JSZip v2 expects a binary string; convert ArrayBuffer accordingly
                    const ab = new Uint8Array(inputBuf);
                    let binary = '';
                    for (let i = 0; i < ab.length; i++) binary += String.fromCharCode(ab[i]);
                    const zip = new JSZipLib(binary);
                    const hasApp = !!zip.file('docProps/app.xml');
                    if (!hasApp) {
                        const appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                            + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
                            + 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n'
                            + '  <Application>Microsoft Office PowerPoint</Application>\n'
                            + '</Properties>';
                        zip.file('docProps/app.xml', appXml);
                        // Ensure [Content_Types].xml override exists for app.xml
                        try {
                            const ctEntry = zip.file('[Content_Types].xml');
                            if (ctEntry) {
                                const ct = ctEntry.asText ? ctEntry.asText() : '';
                                if (ct && !/PartName="\/docProps\/app\.xml"/i.test(ct)) {
                                    const override = '\n  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>';
                                    const patched = ct.replace(/<\/Types>/, override + '\n</Types>');
                                    zip.file('[Content_Types].xml', patched);
                                }
                            }
                        } catch (_) { /* ignore */ }
                        // JSZip v2 generate to blob if supported; fallback to base64 -> Blob
                        let outBlob;
                        if (zip.generate) {
                            try {
                                outBlob = zip.generate({ type: 'blob' });
                            } catch (_) {
                                const b64 = zip.generate({ type: 'base64' });
                                const byteChars = atob(b64);
                                const bytes = new Uint8Array(byteChars.length);
                                for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
                                outBlob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
                            }
                        }
                        return outBlob || null;
                    }
                    return null;
                }
            }
            // As a last resort, try to load JSZip v3 if not present (may be blocked by CSP/CDN)
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
            ]);
            if (window.JSZip && typeof window.JSZip.loadAsync === 'function') {
                const zip = await window.JSZip.loadAsync(inputBuf);
                const hasApp = !!zip.file('docProps/app.xml');
                if (!hasApp) {
                    const appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                        + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
                        + 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n'
                        + '  <Application>Microsoft Office PowerPoint</Application>\n'
                        + '</Properties>';
                    zip.folder('docProps').file('app.xml', appXml);
                    const outBlob = await zip.generateAsync({ type: 'blob' });
                    return outBlob;
                }
            }
            return null;
        } catch (e) {
            // On any failure, skip preprocessing
            console.warn('PPTX preprocess skipped:', e);
            return null;
        }
    },

    clearFileList() {
        const fileList = document.getElementById('file-list');
        if (fileList) {
            fileList.innerHTML = '';
        }
        this.resetFileInput();
    },

    getFileIcon(fileType) {
        if (fileType.includes('pdf')) return 'fa-file-pdf';
        if (fileType.includes('epub')) return 'fa-book-open';
        if (fileType.includes('image')) return 'fa-file-image';
        if (fileType.includes('text')) return 'fa-file-alt';
        return 'fa-file';
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    setupToolOptions(toolName) {
        const optionsContainer = document.getElementById('tool-options') || document.getElementById('options-container');
        if (!optionsContainer) return; // Exit if options container doesn't exist

        optionsContainer.innerHTML = '';

        switch (toolName) {
            case 'pdf-to-png':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Download Options</label>
                        <select id="download-option">
                            <option value="zip">Download all pages as ZIP file</option>
                            <option value="individual">Show individual pages to download</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Choose how you want to download the converted PNG images.
                        </p>
                    </div>
                `;
                break;

            case 'edit-metadata':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p>Edit standard PDF metadata fields. Leave a field blank to keep it unchanged. To remove all metadata, use the Remove Metadata tool.</p>
                    </div>
                    <div class="option-group">
                        <label for="meta-title">Title</label>
                        <input id="meta-title" type="text" placeholder="Document Title" />
                    </div>
                    <div class="option-group">
                        <label for="meta-author">Author</label>
                        <input id="meta-author" type="text" placeholder="Author name" />
                    </div>
                    <div class="option-group">
                        <label for="meta-subject">Subject</label>
                        <input id="meta-subject" type="text" placeholder="Subject" />
                    </div>
                    <div class="option-group">
                        <label for="meta-keywords">Keywords</label>
                        <input id="meta-keywords" type="text" placeholder="Comma-separated (e.g., project, report, Q1)" />
                    </div>
                    <div class="option-group">
                        <label for="meta-producer">Producer</label>
                        <input id="meta-producer" type="text" placeholder="PDF Producer" />
                    </div>
                    <div class="option-group">
                        <label for="meta-creator">Creator</label>
                        <input id="meta-creator" type="text" placeholder="Application or tool name" />
                    </div>
                    <div class="option-group">
                        <label for="meta-language">Language</label>
                        <input id="meta-language" type="text" placeholder="e.g., en, en-US, fr-FR" />
                    </div>
                    <div class="option-group">
                        <label for="meta-creation-date">Creation Date</label>
                        <input id="meta-creation-date" type="datetime-local" />
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.25rem;">If set, overrides the PDF's creation date</p>
                    </div>
                    <div class="option-group">
                        <label for="meta-modification-date">Modification Date</label>
                        <input id="meta-modification-date" type="datetime-local" />
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.25rem;">If set, overrides the PDF's modification date</p>
                    </div>
                `;
                // Try pre-filling fields from the first uploaded PDF (if any)
                if (this.uploadedFiles && this.uploadedFiles.length > 0) {
                    this.populateMetadataFromFirstPdf().catch(() => {});
                }
                break;

            case 'pdf-to-jpeg':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Download Options</label>
                        <select id="download-option">
                            <option value="zip">Download all pages as ZIP file</option>
                            <option value="individual">Show individual pages to download</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Choose how you want to download the converted JPEG images.
                        </p>
                    </div>
                `;
                break;

            case 'svg-to-png':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Options</label>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Each uploaded SVG will be converted to a PNG image locally in your browser.
                        </p>
                    </div>
                `;
                break;

            case 'svg-to-jpeg':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Options</label>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Each uploaded SVG will be converted to a JPEG image with a white background locally in your browser.
                        </p>
                    </div>
                `;
                break;

            case 'svg-to-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Conversion Mode</label>
                        <select id="conversion-mode">
                            <option value="combined">Merge all images into single PDF</option>
                            <option value="individual">Individual PDFs (ZIP + Individual files)</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Choose how you want your images converted to PDF format.
                        </p>
                    </div>
                `;
                break;

            case 'png-to-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Conversion Mode</label>
                        <select id="conversion-mode">
                            <option value="combined">Merge all images into single PDF</option>
                            <option value="individual">Individual PDFs (ZIP + Individual files)</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Choose how you want your images converted to PDF format.
                        </p>
                    </div>
                `;
                break;

            case 'jpeg-to-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Conversion Mode</label>
                        <select id="conversion-mode">
                            <option value="combined">Merge all images into single PDF</option>
                            <option value="individual">Individual PDFs (ZIP + Individual files)</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Choose how you want your images converted to PDF format.
                        </p>
                    </div>
                `;
                break;

            case 'webp-to-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Conversion Mode</label>
                        <select id="conversion-mode">
                            <option value="combined">Merge all images into single PDF</option>
                            <option value="individual">Individual PDFs (ZIP + Individual files)</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Choose how you want your images converted to PDF format.
                        </p>
                    </div>
                `;
                break;

            case 'webp-to-png':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Options</label>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Each uploaded WEBP will be converted to a PNG image locally in your browser.
                        </p>
                    </div>
                `;
                break;

            case 'webp-to-jpeg':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Options</label>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Each uploaded WEBP will be converted to a JPEG image with a white background locally in your browser.
                        </p>
                    </div>
                `;
                break;

            case 'excel-to-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p style="font-size: 0.95rem; color: rgba(248, 250, 252, 0.8); margin: 0;">
                            No settings needed. We will convert all sheets to a portrait PDF automatically.
                        </p>
                    </div>
                `;
                break;

            case 'ppt-to-pdf':
                optionsContainer.innerHTML = '';
                break;

            case 'split-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Split Method</label>
                        <select id="split-method">
                            <option value="pages">Split by pages</option>
                            <option value="range">Split by range</option>
                        </select>
                    </div>
                    <div class="option-group" id="page-range-group" style="display: none;">
                        <label>Page Range (e.g., 1-5, 7, 9-12)</label>
                        <input type="text" id="page-range" placeholder="1-5, 7, 9-12">
                    </div>
                `;

                document.getElementById('split-method').addEventListener('change', (e) => {
                    const rangeGroup = document.getElementById('page-range-group');
                    rangeGroup.style.display = e.target.value === 'range' ? 'block' : 'none';
                });
                break;

            case 'rotate-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Rotation Angle</label>
                        <select id="rotation-angle">
                            <option value="90">90° Clockwise</option>
                            <option value="180">180°</option>
                            <option value="270">270° Clockwise (90° Counter-clockwise)</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            All pages will be rotated by the selected angle.
                        </p>
                    </div>
                `;
                break;

            case 'compress-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p>Click "Process Files" to compress your PDF.</p>
                    </div>
                `;
                break;

            case 'compress-image':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p>Click "Process Files" to compress your images.</p>
                    </div>
                `;
                break;

            case 'image-resizer':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label for="resize-mode">Resize Mode</label>
                        <select id="resize-mode">
                            <option value="percentage">By Percentage</option>
                            <option value="resolution-lock">By Resolution (Keep Aspect Ratio)</option>
                            <option value="resolution-free">By Resolution (Free Width & Height)</option>
                        </select>
                    </div>
                    <div class="option-group" id="resize-percentage-group">
                        <label for="resize-percentage">Resize Percentage</label>
                        <div class="resize-inline-inputs">
                            <input type="number" id="resize-percentage" min="1" max="500" value="100">
                            <span>%</span>
                        </div>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Example: 50% makes each image half its original width and height.
                        </p>
                    </div>
                    <div class="option-group" id="resize-resolution-group" style="display: none;">
                        <label>Target Resolution</label>
                        <div class="resize-dimension-inputs">
                            <input type="number" id="resize-width" min="1" max="12000" value="1920">
                            <span>x</span>
                            <input type="number" id="resize-height" min="1" max="12000" value="1080">
                        </div>
                        <p id="resize-aspect-hint" style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Aspect ratio lock is off.
                        </p>
                        <p id="resize-original-hint" style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.35rem;"></p>
                    </div>
                `;
                this.setupImageResizerOptionListeners();
                break;

            case 'compare-pdfs':
                optionsContainer.innerHTML = '';
                break;

            case 'remove-metadata':
                optionsContainer.innerHTML = '';
                break;



            case 'remove-password':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Current Password</label>
                        <input type="password" id="current-password" placeholder="Enter current PDF password">
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Enter the password required to open this PDF file.
                        </p>
                    </div>
                `;
                break;

            case 'add-password':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>New Password</label>
                        <input type="password" id="new-password" placeholder="Enter new PDF password">
                    </div>
                    <div class="option-group">
                        <label>Confirm Password</label>
                        <input type="password" id="confirm-password" placeholder="Re-enter new PDF password">
                    </div>
                `;
                break;

            case 'extract-pages':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Pages to Extract (e.g., 1, 3, 5-8, 10)</label>
                        <input type="text" id="pages-to-extract" placeholder="1, 3, 5-8, 10">
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Specify which pages to extract. Use commas for individual pages and hyphens for ranges.
                        </p>
                    </div>
                `;
                break;

            case 'remove-pages':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Pages to Remove (e.g., 2, 4, 6-9, 15)</label>
                        <input type="text" id="pages-to-remove" placeholder="2, 4, 6-9, 15">
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Specify which pages to remove. Use commas for individual pages and hyphens for ranges.
                        </p>
                    </div>
                `;
                break;

            case 'sort-pages':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p>Upload a PDF file to see page thumbnails that you can drag and drop to reorder.</p>
                        <div class="sort-controls" style="display: none; margin: 1rem 0; display: flex; flex-wrap: wrap; gap: .5rem; align-items: center;">
                            <button type="button" id="reverse-pages-btn" class="reverse-btn">
                                <i class="fas fa-exchange-alt"></i>
                                Reverse Order (Back to Front)
                            </button>
                            <button type="button" id="reset-pages-btn" class="reverse-btn" style="background: var(--btn-secondary-bg, #273043);">
                                <i class="fas fa-undo"></i>
                                Reset to Original Order
                            </button>
                        </div>
                        <div id="page-thumbnails" class="page-thumbnails-container" style="display: none;">
                            <!-- Page thumbnails will be generated here -->
                        </div>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Drag anywhere on a page thumbnail to reorder. On mobile, press and hold for about a second, then drag.
                        </p>
                    </div>
                `;

                // Add event listeners for controls after DOM is updated
                this.setupReverseButtonListener();
                this.setupResetButtonListener();
                break;

            case 'add-watermark':
                optionsContainer.innerHTML = `
                    <div class="watermark-layout">
                        <div class="watermark-preview-column">
                            <div class="option-group">
                                <label>Preview (Page 1)</label>
                                <div class="watermark-preview-panel">
                                    <div class="watermark-preview-shell" id="watermark-preview-shell">
                                        <canvas id="watermark-preview-canvas"></canvas>
                                        <div id="watermark-overlay" class="watermark-overlay" style="display: none;"></div>
                                        <button type="button" id="watermark-resize-handle" class="watermark-resize-handle" aria-label="Resize watermark" style="display: none;">
                                            <i class="fas fa-arrows-alt"></i>
                                        </button>
                                        <div id="watermark-preview-empty" class="watermark-preview-empty">
                                            Upload one PDF file to preview watermark placement on page 1.
                                        </div>
                                    </div>
                                </div>
                                <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.55rem;">
                                    Drag the watermark in the preview to position it. In image mode, use the resize handle or width/height fields.
                                </p>
                            </div>
                        </div>

                        <div class="watermark-controls-column">
                            <div class="option-group">
                                <label for="watermark-excluded-pages">Exclude Pages (optional)</label>
                                <input type="text" id="watermark-excluded-pages" placeholder="Example: 6, 9, 12-14">
                                <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                                    These pages will be skipped and left unchanged.
                                </p>
                            </div>

                            <div class="option-group">
                                <label>Watermark Type</label>
                                <div class="watermark-mode-toggle">
                                    <label class="watermark-mode-option">
                                        <input type="radio" name="watermark-mode" id="watermark-mode-text" value="text" checked>
                                        Add Text
                                    </label>
                                    <label class="watermark-mode-option">
                                        <input type="radio" name="watermark-mode" id="watermark-mode-image" value="image">
                                        Add Image
                                    </label>
                                </div>
                            </div>

                            <div class="option-group" id="watermark-text-options">
                                <label for="watermark-text-input">Watermark Text</label>
                                <input type="text" id="watermark-text-input" value="CONFIDENTIAL" maxlength="120">

                                <div class="watermark-input-grid">
                                    <div>
                                        <label for="watermark-text-opacity">Opacity: <span id="watermark-text-opacity-value">35%</span></label>
                                        <input type="range" id="watermark-text-opacity" min="5" max="100" value="35">
                                    </div>
                                    <div>
                                        <label for="watermark-text-rotation">Rotation: <span id="watermark-text-rotation-value">-30°</span></label>
                                        <input type="range" id="watermark-text-rotation" min="-180" max="180" value="-30">
                                    </div>
                                </div>

                                <div class="watermark-input-grid">
                                    <div>
                                        <label for="watermark-text-color">Color</label>
                                        <input type="color" id="watermark-text-color" value="#ba453c">
                                    </div>
                                    <div>
                                        <label for="watermark-text-font-size">Font Size</label>
                                        <input type="number" id="watermark-text-font-size" min="8" max="220" value="48">
                                    </div>
                                </div>

                                <div class="watermark-input-grid">
                                    <div>
                                        <label for="watermark-text-font-family">Font Family</label>
                                        <select id="watermark-text-font-family">
                                            <option value="helvetica">Helvetica</option>
                                            <option value="times">Times Roman</option>
                                            <option value="courier">Courier</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label for="watermark-text-font-style">Font Style</label>
                                        <select id="watermark-text-font-style">
                                            <option value="regular">Regular</option>
                                            <option value="bold">Bold</option>
                                            <option value="italic">Italic</option>
                                            <option value="bold-italic">Bold Italic</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div class="option-group" id="watermark-image-options" style="display: none;">
                                <label for="watermark-image-file">Watermark Image</label>
                                <input type="file" id="watermark-image-file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp">
                                <p id="watermark-image-selected" style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.7); margin-top: 0.35rem;">No image selected</p>

                                <div class="checkbox-group" style="margin-top: 0.65rem;">
                                    <input type="checkbox" id="watermark-image-centered" checked>
                                    <label for="watermark-image-centered">Center image on page</label>
                                </div>

                                <div class="watermark-input-grid">
                                    <div>
                                        <label for="watermark-image-opacity">Opacity: <span id="watermark-image-opacity-value">35%</span></label>
                                        <input type="range" id="watermark-image-opacity" min="5" max="100" value="35">
                                    </div>
                                    <div>
                                        <label for="watermark-image-rotation">Rotation: <span id="watermark-image-rotation-value">0°</span></label>
                                        <input type="range" id="watermark-image-rotation" min="-180" max="180" value="0">
                                    </div>
                                </div>

                                <div class="watermark-input-grid">
                                    <div>
                                        <label for="watermark-image-width">Width</label>
                                        <input type="number" id="watermark-image-width" min="1" max="5000" value="220">
                                    </div>
                                    <div>
                                        <label for="watermark-image-height">Height</label>
                                        <input type="number" id="watermark-image-height" min="1" max="5000" value="130">
                                    </div>
                                </div>
                                <p id="watermark-image-dimension-error" class="watermark-dimension-error" style="display: none;"></p>
                            </div>
                        </div>
                    </div>
                `;
                this.setupWatermarkOptionListeners();
                break;

            case 'flatten-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p>Flatten interactive content into static page pixels. Processing is 100% client-side.</p>
                    </div>
                `;
                break;

            case 'heif-to-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Conversion Mode</label>
                        <select id="conversion-mode">
                            <option value="individual">Individual PDFs (one per HEIC/HEIF file)</option>
                            <option value="combined">Merge all into single PDF</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Choose how you want your HEIC/HEIF images converted to PDF format.
                        </p>
                    </div>
                `;
                break;
        }
    },

    setupWatermarkOptionListeners() {
        if (this.watermarkInteractionCleanup) {
            this.watermarkInteractionCleanup();
            this.watermarkInteractionCleanup = null;
        }

        const modeInputs = Array.from(document.querySelectorAll('input[name="watermark-mode"]'));
        const textOpacity = document.getElementById('watermark-text-opacity');
        const textRotation = document.getElementById('watermark-text-rotation');
        const imageOpacity = document.getElementById('watermark-image-opacity');
        const imageRotation = document.getElementById('watermark-image-rotation');
        const textInput = document.getElementById('watermark-text-input');
        const textColor = document.getElementById('watermark-text-color');
        const textSize = document.getElementById('watermark-text-font-size');
        const textFamily = document.getElementById('watermark-text-font-family');
        const textStyle = document.getElementById('watermark-text-font-style');
        const imageInput = document.getElementById('watermark-image-file');
        const imageCentered = document.getElementById('watermark-image-centered');
        const imageWidth = document.getElementById('watermark-image-width');
        const imageHeight = document.getElementById('watermark-image-height');

        const overlayRefresh = (forceRecenter = false) => {
            this.updateWatermarkValueLabels();
            this.updateWatermarkModeUI();
            this.updateWatermarkOverlayFromControls(forceRecenter);
            this.updateProcessButton();
        };

        modeInputs.forEach(input => {
            input.addEventListener('change', () => overlayRefresh(true));
        });

        [textInput, textColor, textSize, textFamily, textStyle, textOpacity, textRotation].forEach(el => {
            if (el) {
                el.addEventListener('input', () => overlayRefresh(false));
                el.addEventListener('change', () => overlayRefresh(false));
            }
        });

        [imageOpacity, imageRotation, imageWidth, imageHeight].forEach(el => {
            if (el) {
                el.addEventListener('input', () => overlayRefresh(false));
                el.addEventListener('change', () => overlayRefresh(false));
            }
        });

        if (imageCentered) {
            imageCentered.addEventListener('change', () => overlayRefresh(true));
        }

        if (imageInput) {
            imageInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    await this.loadWatermarkImageAsset(file);
                    const selectedEl = document.getElementById('watermark-image-selected');
                    if (selectedEl) {
                        selectedEl.textContent = `Selected image: ${file.name}`;
                    }
                    overlayRefresh(true);
                } catch (error) {
                    this.showError(error.message || 'Failed to load watermark image');
                }
            });
        }

        this.watermarkInteractionCleanup = this.setupWatermarkInteractionEvents();
        this.updateWatermarkValueLabels();
        this.updateWatermarkModeUI();
        this.renderWatermarkPreviewPage().catch((e) => {
            console.warn('Failed to render watermark preview page:', e);
        });
        this.updateProcessButton();
    },

    updateWatermarkValueLabels() {
        const textOpacity = document.getElementById('watermark-text-opacity');
        const textRotation = document.getElementById('watermark-text-rotation');
        const imageOpacity = document.getElementById('watermark-image-opacity');
        const imageRotation = document.getElementById('watermark-image-rotation');

        const textOpacityValue = document.getElementById('watermark-text-opacity-value');
        const textRotationValue = document.getElementById('watermark-text-rotation-value');
        const imageOpacityValue = document.getElementById('watermark-image-opacity-value');
        const imageRotationValue = document.getElementById('watermark-image-rotation-value');

        if (textOpacity && textOpacityValue) textOpacityValue.textContent = `${textOpacity.value}%`;
        if (textRotation && textRotationValue) textRotationValue.textContent = `${textRotation.value}°`;
        if (imageOpacity && imageOpacityValue) imageOpacityValue.textContent = `${imageOpacity.value}%`;
        if (imageRotation && imageRotationValue) imageRotationValue.textContent = `${imageRotation.value}°`;
    },

    updateWatermarkModeUI() {
        const mode = document.querySelector('input[name="watermark-mode"]:checked')?.value || 'text';
        const textOptions = document.getElementById('watermark-text-options');
        const imageOptions = document.getElementById('watermark-image-options');
        const resizeHandle = document.getElementById('watermark-resize-handle');
        const centered = document.getElementById('watermark-image-centered')?.checked;
        const imageError = document.getElementById('watermark-image-dimension-error');

        if (textOptions) textOptions.style.display = mode === 'text' ? 'block' : 'none';
        if (imageOptions) imageOptions.style.display = mode === 'image' ? 'block' : 'none';
        if (resizeHandle) resizeHandle.style.display = mode === 'image' && !centered ? 'block' : 'none';
        if (imageError && mode !== 'image') {
            imageError.style.display = 'none';
        }
    },

    getWatermarkImageDimensionValidation(showError = true) {
        const widthInput = document.getElementById('watermark-image-width');
        const heightInput = document.getElementById('watermark-image-height');
        const errorEl = document.getElementById('watermark-image-dimension-error');

        if (!widthInput || !heightInput) {
            return { valid: false, width: null, height: null, message: 'Width/height inputs are missing.' };
        }

        const widthRaw = String(widthInput.value || '').trim();
        const heightRaw = String(heightInput.value || '').trim();
        let message = '';

        if (!widthRaw || !heightRaw) {
            message = 'Width and height are required.';
        } else {
            const width = Number(widthRaw);
            const height = Number(heightRaw);
            if (!Number.isFinite(width) || !Number.isFinite(height)) {
                message = 'Width and height must be valid numbers.';
            } else if (width <= 0 || height <= 0) {
                message = 'Width and height must be greater than 0.';
            } else if (width < 1 || height < 1) {
                message = 'Width and height are too small.';
            } else if (width > 5000 || height > 5000) {
                message = 'Width and height are too large (max: 5000).';
            } else {
                widthInput.classList.remove('watermark-input-invalid');
                heightInput.classList.remove('watermark-input-invalid');
                if (errorEl) errorEl.style.display = 'none';
                return { valid: true, width, height, message: '' };
            }
        }

        if (showError) {
            widthInput.classList.add('watermark-input-invalid');
            heightInput.classList.add('watermark-input-invalid');
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.style.display = 'block';
            }
        }

        return { valid: false, width: null, height: null, message };
    },

    async renderWatermarkPreviewPage() {
        if (this.currentTool !== 'add-watermark') return;

        const canvas = document.getElementById('watermark-preview-canvas');
        const shell = document.getElementById('watermark-preview-shell');
        const overlay = document.getElementById('watermark-overlay');
        const emptyState = document.getElementById('watermark-preview-empty');
        if (!canvas || !shell || !overlay || !emptyState) return;

        const pdfFile = this.uploadedFiles[0];
        if (!pdfFile) {
            canvas.width = 0;
            canvas.height = 0;
            canvas.style.width = '100%';
            canvas.style.height = '0px';
            overlay.style.display = 'none';
            emptyState.textContent = 'Upload one PDF file to preview watermark placement on page 1.';
            emptyState.style.display = 'flex';
            this.updateProcessButton();
            return;
        }

        if (typeof pdfjsLib === 'undefined' || !pdfjsLib.getDocument) {
            overlay.style.display = 'none';
            emptyState.textContent = 'Preview is unavailable because pdf.js is not loaded.';
            emptyState.style.display = 'flex';
            return;
        }

        const renderToken = ++this.watermarkPreviewRenderToken;
        try {
            const arrayBuffer = await pdfFile.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const page = await pdf.getPage(1);
            const baseViewport = page.getViewport({ scale: 1 });
            const maxWidth = Math.min(1200, Math.max(320, (shell.clientWidth || 760) - 4));
            const scale = maxWidth / Math.max(1, baseViewport.width);
            const viewport = page.getViewport({ scale });

            if (renderToken !== this.watermarkPreviewRenderToken) return;

            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            canvas.style.width = `${Math.round(viewport.width)}px`;
            canvas.style.height = `${Math.round(viewport.height)}px`;

            const context = canvas.getContext('2d');
            await page.render({ canvasContext: context, viewport }).promise;

            if (renderToken !== this.watermarkPreviewRenderToken) return;

            emptyState.style.display = 'none';
            this.updateWatermarkOverlayFromControls(false);
            this.updateProcessButton();
        } catch (error) {
            console.error('Watermark preview render failed:', error);
            overlay.style.display = 'none';
            emptyState.textContent = 'Could not render preview for this PDF file.';
            emptyState.style.display = 'flex';
        }
    },

    getWatermarkCssFontFamily(family) {
        const map = {
            helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            times: "'Times New Roman', Times, serif",
            courier: "'Courier New', Courier, monospace"
        };
        return map[family] || map.helvetica;
    },

    getWatermarkFontStyle(style) {
        const map = {
            regular: { weight: '400', style: 'normal' },
            bold: { weight: '700', style: 'normal' },
            italic: { weight: '400', style: 'italic' },
            'bold-italic': { weight: '700', style: 'italic' }
        };
        return map[style] || map.regular;
    },

    positionWatermarkResizeHandle() {
        const overlay = document.getElementById('watermark-overlay');
        const resizeHandle = document.getElementById('watermark-resize-handle');
        if (!overlay || !resizeHandle || overlay.style.display === 'none') return;
        const left = overlay.offsetLeft + overlay.offsetWidth - 10;
        const top = overlay.offsetTop + overlay.offsetHeight - 10;
        resizeHandle.style.left = `${left}px`;
        resizeHandle.style.top = `${top}px`;
    },

    setWatermarkOverlayPosition(x, y) {
        const canvas = document.getElementById('watermark-preview-canvas');
        const overlay = document.getElementById('watermark-overlay');
        if (!canvas || !overlay) return;

        const maxX = Math.max(0, canvas.width - overlay.offsetWidth);
        const maxY = Math.max(0, canvas.height - overlay.offsetHeight);
        const clampedX = Math.max(0, Math.min(maxX, x));
        const clampedY = Math.max(0, Math.min(maxY, y));

        overlay.style.left = `${clampedX}px`;
        overlay.style.top = `${clampedY}px`;
        overlay.dataset.positioned = 'true';
        this.positionWatermarkResizeHandle();
    },

    updateWatermarkOverlayFromControls(forceRecenter = false) {
        const canvas = document.getElementById('watermark-preview-canvas');
        const overlay = document.getElementById('watermark-overlay');
        const resizeHandle = document.getElementById('watermark-resize-handle');
        const mode = document.querySelector('input[name="watermark-mode"]:checked')?.value || 'text';
        if (!canvas || !overlay || !resizeHandle || canvas.width === 0 || canvas.height === 0) return;

        overlay.classList.toggle('is-image', mode === 'image');
        overlay.classList.toggle('is-text', mode === 'text');

        if (mode === 'text') {
            const text = (document.getElementById('watermark-text-input')?.value || 'CONFIDENTIAL').trim() || 'CONFIDENTIAL';
            const fontSizeInput = parseInt(document.getElementById('watermark-text-font-size')?.value, 10);
            const fontSize = Math.max(8, Math.min(220, Number.isFinite(fontSizeInput) ? fontSizeInput : 48));
            const color = document.getElementById('watermark-text-color')?.value || '#ba453c';
            const opacity = (parseInt(document.getElementById('watermark-text-opacity')?.value, 10) || 35) / 100;
            const rotation = parseInt(document.getElementById('watermark-text-rotation')?.value, 10) || 0;
            const family = document.getElementById('watermark-text-font-family')?.value || 'helvetica';
            const style = document.getElementById('watermark-text-font-style')?.value || 'regular';
            const fontMeta = this.getWatermarkFontStyle(style);
            const cssFamily = this.getWatermarkCssFontFamily(family);

            const ctx = canvas.getContext('2d');
            ctx.font = `${fontMeta.style} ${fontMeta.weight} ${fontSize}px ${cssFamily}`;
            const measuredWidth = Math.ceil(ctx.measureText(text).width + 16);
            const boxWidth = Math.max(44, Math.min(canvas.width, measuredWidth));
            const boxHeight = Math.max(22, Math.ceil(fontSize * 1.35));

            overlay.innerHTML = '';
            overlay.textContent = text;
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.width = `${boxWidth}px`;
            overlay.style.height = `${boxHeight}px`;
            overlay.style.color = color;
            overlay.style.opacity = String(Math.max(0.05, Math.min(1, opacity)));
            overlay.style.fontSize = `${fontSize}px`;
            overlay.style.fontFamily = cssFamily;
            overlay.style.fontWeight = fontMeta.weight;
            overlay.style.fontStyle = fontMeta.style;
            overlay.style.transform = `rotate(${rotation}deg)`;

            const needsCentering = forceRecenter || overlay.dataset.positioned !== 'true';
            if (needsCentering) {
                this.setWatermarkOverlayPosition((canvas.width - boxWidth) / 2, (canvas.height - boxHeight) / 2);
            } else {
                this.setWatermarkOverlayPosition(overlay.offsetLeft, overlay.offsetTop);
            }

            resizeHandle.style.display = 'none';
            return;
        }

        if (!this.watermarkImageAsset || !this.watermarkImageAsset.dataUrl) {
            overlay.style.display = 'none';
            resizeHandle.style.display = 'none';
            return;
        }

        const widthInputEl = document.getElementById('watermark-image-width');
        const heightInputEl = document.getElementById('watermark-image-height');
        const centered = !!document.getElementById('watermark-image-centered')?.checked;
        const opacity = (parseInt(document.getElementById('watermark-image-opacity')?.value, 10) || 35) / 100;
        const rotation = parseInt(document.getElementById('watermark-image-rotation')?.value, 10) || 0;
        const validation = this.getWatermarkImageDimensionValidation(true);
        let width = validation.width;
        let height = validation.height;

        if (!validation.valid) {
            const fallbackWidth = Number.parseFloat(overlay.dataset.lastValidWidth || '220');
            const fallbackHeight = Number.parseFloat(overlay.dataset.lastValidHeight || '130');
            width = Number.isFinite(fallbackWidth) ? fallbackWidth : 220;
            height = Number.isFinite(fallbackHeight) ? fallbackHeight : 130;
        } else {
            overlay.dataset.lastValidWidth = String(width);
            overlay.dataset.lastValidHeight = String(height);
        }

        overlay.innerHTML = `<img src="${this.watermarkImageAsset.dataUrl}" alt="Watermark">`;
        overlay.style.display = 'block';
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
        overlay.style.opacity = String(Math.max(0.05, Math.min(1, opacity)));
        overlay.style.transform = `rotate(${rotation}deg)`;
        overlay.style.fontSize = '';
        overlay.style.color = '';
        overlay.style.fontFamily = '';
        overlay.style.fontWeight = '';
        overlay.style.fontStyle = '';

        if (centered || forceRecenter || overlay.dataset.positioned !== 'true') {
            this.setWatermarkOverlayPosition((canvas.width - width) / 2, (canvas.height - height) / 2);
        } else {
            this.setWatermarkOverlayPosition(overlay.offsetLeft, overlay.offsetTop);
        }

        resizeHandle.style.display = centered ? 'none' : 'block';
        this.positionWatermarkResizeHandle();
    },

    setupWatermarkInteractionEvents() {
        const overlay = document.getElementById('watermark-overlay');
        const canvas = document.getElementById('watermark-preview-canvas');
        const resizeHandle = document.getElementById('watermark-resize-handle');
        if (!overlay || !canvas || !resizeHandle) return null;

        const getPoint = (event) => {
            if (event.touches && event.touches[0]) {
                return { x: event.touches[0].clientX, y: event.touches[0].clientY };
            }
            return { x: event.clientX, y: event.clientY };
        };

        let dragState = null;
        let resizeState = null;

        const onOverlayDown = (event) => {
            if (overlay.style.display === 'none') return;
            if (event.target === resizeHandle || resizeHandle.contains(event.target)) return;
            const centered = !!document.getElementById('watermark-image-centered')?.checked;
            const mode = document.querySelector('input[name="watermark-mode"]:checked')?.value || 'text';
            if (mode === 'image' && centered) return;
            if (event.button !== undefined && event.button !== 0) return;

            event.preventDefault();
            const point = getPoint(event);
            dragState = {
                startX: point.x,
                startY: point.y,
                initialLeft: overlay.offsetLeft,
                initialTop: overlay.offsetTop
            };
        };

        const onResizeDown = (event) => {
            const mode = document.querySelector('input[name="watermark-mode"]:checked')?.value || 'text';
            const centered = !!document.getElementById('watermark-image-centered')?.checked;
            if (mode !== 'image' || centered) return;
            if (event.button !== undefined && event.button !== 0) return;

            event.preventDefault();
            event.stopPropagation();

            const point = getPoint(event);
            resizeState = {
                startX: point.x,
                startY: point.y,
                startWidth: overlay.offsetWidth,
                startHeight: overlay.offsetHeight,
                startLeft: overlay.offsetLeft,
                startTop: overlay.offsetTop
            };
        };

        const onMove = (event) => {
            if (!dragState && !resizeState) return;

            const point = getPoint(event);
            if (dragState) {
                event.preventDefault();
                const nextX = dragState.initialLeft + (point.x - dragState.startX);
                const nextY = dragState.initialTop + (point.y - dragState.startY);
                this.setWatermarkOverlayPosition(nextX, nextY);
            }

            if (resizeState) {
                event.preventDefault();
                const widthInput = document.getElementById('watermark-image-width');
                const heightInput = document.getElementById('watermark-image-height');
                const deltaX = point.x - resizeState.startX;
                const deltaY = point.y - resizeState.startY;
                const nextWidth = Math.max(1, Math.min(5000, resizeState.startWidth + deltaX));
                const nextHeight = Math.max(1, Math.min(5000, resizeState.startHeight + deltaY));
                overlay.style.width = `${nextWidth}px`;
                overlay.style.height = `${nextHeight}px`;
                if (widthInput) widthInput.value = String(Math.round(nextWidth));
                if (heightInput) heightInput.value = String(Math.round(nextHeight));
                this.setWatermarkOverlayPosition(resizeState.startLeft, resizeState.startTop);
                overlay.dataset.lastValidWidth = String(Math.round(nextWidth));
                overlay.dataset.lastValidHeight = String(Math.round(nextHeight));
                this.updateWatermarkValueLabels();
            }
        };

        const onUp = () => {
            dragState = null;
            resizeState = null;
        };

        overlay.addEventListener('mousedown', onOverlayDown);
        overlay.addEventListener('touchstart', onOverlayDown, { passive: false });
        resizeHandle.addEventListener('mousedown', onResizeDown);
        resizeHandle.addEventListener('touchstart', onResizeDown, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);

        return () => {
            overlay.removeEventListener('mousedown', onOverlayDown);
            overlay.removeEventListener('touchstart', onOverlayDown);
            resizeHandle.removeEventListener('mousedown', onResizeDown);
            resizeHandle.removeEventListener('touchstart', onResizeDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchend', onUp);
        };
    },

    async readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    },

    async convertImageFileToPngBytes(file) {
        const objectUrl = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Could not decode image file'));
                image.src = objectUrl;
            });

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, img.naturalWidth || img.width);
            canvas.height = Math.max(1, img.naturalHeight || img.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const pngBlob = await new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Failed to convert image to PNG'));
                }, 'image/png');
            });
            return new Uint8Array(await pngBlob.arrayBuffer());
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    },

    async loadWatermarkImageAsset(file) {
        if (!file || !file.type.startsWith('image/')) {
            throw new Error('Please select a valid image file');
        }

        const dataUrl = await this.readFileAsDataUrl(file);
        const mimeType = file.type.toLowerCase();
        let embedType = mimeType;
        let embedBytes;

        if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
            embedBytes = new Uint8Array(await file.arrayBuffer());
            embedType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
        } else {
            embedBytes = await this.convertImageFileToPngBytes(file);
            embedType = 'image/png';
        }

        const dimImage = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to measure image dimensions'));
            img.src = dataUrl;
        });

        const widthInput = document.getElementById('watermark-image-width');
        const heightInput = document.getElementById('watermark-image-height');
        if (widthInput && heightInput) {
            const targetWidth = 220;
            const ratio = (dimImage.naturalWidth || 1) / Math.max(1, dimImage.naturalHeight || 1);
            const targetHeight = Math.max(20, Math.round(targetWidth / ratio));
            widthInput.value = String(targetWidth);
            heightInput.value = String(targetHeight);
            widthInput.classList.remove('watermark-input-invalid');
            heightInput.classList.remove('watermark-input-invalid');
            const errorEl = document.getElementById('watermark-image-dimension-error');
            if (errorEl) errorEl.style.display = 'none';
        }

        this.watermarkImageAsset = {
            name: file.name,
            dataUrl,
            embedType,
            embedBytes
        };
    },

    getWatermarkOverlayPlacement() {
        const canvas = document.getElementById('watermark-preview-canvas');
        const overlay = document.getElementById('watermark-overlay');
        if (!canvas || !overlay || canvas.width === 0 || canvas.height === 0 || overlay.style.display === 'none') {
            throw new Error('Watermark preview is not ready. Please upload a PDF and adjust the preview first.');
        }

        return {
            xRatio: overlay.offsetLeft / canvas.width,
            yRatio: overlay.offsetTop / canvas.height,
            widthRatio: overlay.offsetWidth / canvas.width,
            heightRatio: overlay.offsetHeight / canvas.height
        };
    },

    getWatermarkPdfFontName(family, style) {
        const fontMap = {
            helvetica: {
                regular: PDFLib.StandardFonts.Helvetica,
                bold: PDFLib.StandardFonts.HelveticaBold,
                italic: PDFLib.StandardFonts.HelveticaOblique,
                'bold-italic': PDFLib.StandardFonts.HelveticaBoldOblique
            },
            times: {
                regular: PDFLib.StandardFonts.TimesRoman,
                bold: PDFLib.StandardFonts.TimesRomanBold,
                italic: PDFLib.StandardFonts.TimesRomanItalic,
                'bold-italic': PDFLib.StandardFonts.TimesRomanBoldItalic
            },
            courier: {
                regular: PDFLib.StandardFonts.Courier,
                bold: PDFLib.StandardFonts.CourierBold,
                italic: PDFLib.StandardFonts.CourierOblique,
                'bold-italic': PDFLib.StandardFonts.CourierBoldOblique
            }
        };

        return (fontMap[family] && fontMap[family][style]) || PDFLib.StandardFonts.Helvetica;
    },

    hexToPdfRgb(hex) {
        const clean = String(hex || '').trim();
        const normalized = /^#([0-9a-f]{6})$/i.test(clean) ? clean.slice(1) : 'ba453c';
        const r = parseInt(normalized.slice(0, 2), 16) / 255;
        const g = parseInt(normalized.slice(2, 4), 16) / 255;
        const b = parseInt(normalized.slice(4, 6), 16) / 255;
        return PDFLib.rgb(r, g, b);
    },

    getRotatedAnchorPoint(boxX, boxY, boxWidth, boxHeight, localAnchorX, localAnchorY, rotationDeg) {
        const centerX = boxX + boxWidth / 2;
        const centerY = boxY + boxHeight / 2;
        const offsetX = localAnchorX - boxWidth / 2;
        const offsetY = localAnchorY - boxHeight / 2;
        const theta = (rotationDeg * Math.PI) / 180;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        return {
            x: centerX + (offsetX * cos) - (offsetY * sin),
            y: centerY + (offsetX * sin) + (offsetY * cos)
        };
    },

    setupImageResizerOptionListeners() {
        const modeSelect = document.getElementById('resize-mode');
        const percentageInput = document.getElementById('resize-percentage');
        const widthInput = document.getElementById('resize-width');
        const heightInput = document.getElementById('resize-height');

        if (!modeSelect || !percentageInput || !widthInput || !heightInput) return;

        modeSelect.addEventListener('change', () => {
            this.updateImageResizerModeUI();
        });

        percentageInput.addEventListener('input', () => {
            const value = parseFloat(percentageInput.value);
            if (!Number.isFinite(value) || value <= 0) return;
            percentageInput.value = String(Math.min(500, Math.max(1, value)));
        });

        widthInput.addEventListener('input', () => {
            this.syncImageResizerDimensions('width');
        });

        heightInput.addEventListener('input', () => {
            this.syncImageResizerDimensions('height');
        });

        this.updateImageResizerModeUI();
        this.updateImageResizerReferenceDimensions().catch(() => {});
    },

    updateImageResizerModeUI() {
        const mode = document.getElementById('resize-mode')?.value || 'percentage';
        const percentageGroup = document.getElementById('resize-percentage-group');
        const resolutionGroup = document.getElementById('resize-resolution-group');
        const aspectHint = document.getElementById('resize-aspect-hint');

        if (percentageGroup) {
            percentageGroup.style.display = mode === 'percentage' ? 'block' : 'none';
        }
        if (resolutionGroup) {
            resolutionGroup.style.display = mode === 'percentage' ? 'none' : 'block';
        }
        if (aspectHint) {
            aspectHint.textContent = mode === 'resolution-lock'
                ? 'Aspect ratio lock is on. Editing width or height updates the other value automatically.'
                : 'Aspect ratio lock is off. Width and height are fully independent.';
        }

        if (mode === 'resolution-lock') {
            this.syncImageResizerDimensions('width');
        }
    },

    syncImageResizerDimensions(changedField) {
        if (this.currentTool !== 'image-resizer') return;
        const mode = document.getElementById('resize-mode')?.value;
        if (mode !== 'resolution-lock') return;

        const widthInput = document.getElementById('resize-width');
        const heightInput = document.getElementById('resize-height');
        const ref = this.imageResizerReference;
        if (!widthInput || !heightInput || !ref || !ref.width || !ref.height) return;

        if (changedField === 'width') {
            const width = parseInt(widthInput.value, 10);
            if (Number.isFinite(width) && width > 0) {
                heightInput.value = String(Math.max(1, Math.round((width / ref.width) * ref.height)));
            }
        } else {
            const height = parseInt(heightInput.value, 10);
            if (Number.isFinite(height) && height > 0) {
                widthInput.value = String(Math.max(1, Math.round((height / ref.height) * ref.width)));
            }
        }
    },

    async updateImageResizerReferenceDimensions() {
        if (this.currentTool !== 'image-resizer') return;

        const widthInput = document.getElementById('resize-width');
        const heightInput = document.getElementById('resize-height');
        const originalHint = document.getElementById('resize-original-hint');
        if (!widthInput || !heightInput || !originalHint) return;

        if (!this.uploadedFiles.length) {
            this.imageResizerReference = null;
            originalHint.textContent = 'Upload an image to auto-fill dimensions.';
            widthInput.dataset.initialized = '';
            heightInput.dataset.initialized = '';
            return;
        }

        const firstFile = this.uploadedFiles[0];
        const dims = await new Promise((resolve, reject) => {
            const url = URL.createObjectURL(firstFile);
            const img = new Image();
            img.onload = () => {
                const width = img.naturalWidth || img.width;
                const height = img.naturalHeight || img.height;
                URL.revokeObjectURL(url);
                resolve({ width, height });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to read image dimensions'));
            };
            img.src = url;
        });

        this.imageResizerReference = dims;
        originalHint.textContent = `Reference image: ${dims.width} x ${dims.height}px`;

        if (!widthInput.dataset.initialized || !heightInput.dataset.initialized) {
            widthInput.value = String(dims.width);
            heightInput.value = String(dims.height);
            widthInput.dataset.initialized = 'true';
            heightInput.dataset.initialized = 'true';
        }

        const mode = document.getElementById('resize-mode')?.value;
        if (mode === 'resolution-lock') {
            this.syncImageResizerDimensions('width');
        }
    },

    updateProcessButton() {
        const processBtn = document.getElementById('process-btn');
        if (!processBtn) return; // Exit if process button doesn't exist

        const fileCount = this.uploadedFiles.length;
        let enabled = fileCount > 0;

        if (this.currentTool === 'add-watermark') {
            const mode = document.querySelector('input[name="watermark-mode"]:checked')?.value || 'text';
            const hasImageAsset = mode !== 'image' || !!(this.watermarkImageAsset && this.watermarkImageAsset.embedBytes);
            const validImageSize = mode !== 'image' || this.getWatermarkImageDimensionValidation(false).valid;
            enabled = fileCount === 1 && hasImageAsset && validImageSize;

            if (fileCount === 0) {
                processBtn.innerHTML = `
                    <i class="fas fa-stamp"></i>
                    Upload 1 PDF
                `;
            } else if (fileCount !== 1) {
                processBtn.innerHTML = `
                    <i class="fas fa-stamp"></i>
                    Select exactly 1 PDF
                `;
            } else if (mode === 'image' && !hasImageAsset) {
                processBtn.innerHTML = `
                    <i class="fas fa-stamp"></i>
                    Select Watermark Image
                `;
            } else if (mode === 'image' && !validImageSize) {
                processBtn.innerHTML = `
                    <i class="fas fa-stamp"></i>
                    Fix Image Size
                `;
            } else {
                processBtn.innerHTML = `
                    <i class="fas fa-stamp"></i>
                    Apply Watermark
                `;
            }
        } else if (this.currentTool === 'compare-pdfs') {
            enabled = fileCount === 2;
            if (fileCount === 0) {
                processBtn.innerHTML = `
                    <i class="fas fa-cog"></i>
                    Select 2 PDFs
                `;
            } else if (fileCount !== 2) {
                processBtn.innerHTML = `
                    <i class="fas fa-cog"></i>
                    Select exactly 2 PDFs (currently ${fileCount})
                `;
            } else {
                processBtn.innerHTML = `
                    <i class="fas fa-cog"></i>
                    Process 2 files
                `;
            }
        } else if (this.currentTool === 'image-resizer') {
            if (enabled) {
                processBtn.innerHTML = `
                    <i class="fas fa-expand"></i>
                    Resize ${fileCount} ${fileCount === 1 ? 'Image' : 'Images'}
                `;
            } else {
                processBtn.innerHTML = `
                    <i class="fas fa-expand"></i>
                    Resize Image
                `;
            }
        } else if (enabled) {
            const fileText = fileCount === 1 ? 'file' : 'files';
            processBtn.innerHTML = `
                <i class="fas fa-cog"></i>
                Process ${fileCount} ${fileText}
            `;
        } else {
            processBtn.innerHTML = `
                <i class="fas fa-cog"></i>
                Process Files
            `;
        }

        processBtn.disabled = !enabled;
    },

    async processFiles() {
        if (this.uploadedFiles.length === 0) return;

        this.showProgress();
        this.clearResults();

        try {
            let results = [];

            switch (this.currentTool) {
                case 'pdf-to-png':
                    results = await this.convertPdfToPng();
                    break;
                case 'pdf-to-jpeg':
                    results = await this.convertPdfToJpeg();
                    break;
                case 'svg-to-png':
                    results = await this.convertSvgToPng();
                    break;
                case 'svg-to-jpeg':
                    results = await this.convertSvgToJpeg();
                    break;
                case 'svg-to-pdf':
                    results = await this.convertSvgToPdf();
                    break;
                case 'png-to-pdf':
                    results = await this.convertPngToPdf();
                    break;
                case 'jpeg-to-pdf':
                    results = await this.convertJpegToPdf();
                    break;
                case 'webp-to-pdf':
                    results = await this.convertWebpToPdf();
                    break;
                case 'webp-to-png':
                    results = await this.convertWebpToPng();
                    break;
                case 'webp-to-jpeg':
                    results = await this.convertWebpToJpeg();
                    break;
                case 'pdf-to-txt':
                    results = await this.convertPdfToTxt();
                    break;
                case 'txt-to-pdf':
                    results = await this.convertTxtToPdf();
                    break;
                case 'html-to-pdf':
                    results = await this.convertHtmlToPdf();
                    break;
                case 'markdown-to-pdf':
                    results = await this.convertMarkdownToPdf();
                    break;
                case 'epub-to-pdf':
                    results = await this.convertEpubToPdf();
                    break;
                case 'word-to-pdf':
                    results = await this.convertWordToPdf();
                    break;
                case 'rtf-to-pdf':
                    results = await this.convertRtfToPdf();
                    break;
                case 'excel-to-pdf':
                    results = await this.convertExcelToPdf();
                    break;
                case 'ppt-to-pdf':
                    results = await this.convertPptxToPdf();
                    break;
                case 'merge-pdf':
                    results = await this.mergePdfs();
                    break;
                case 'split-pdf':
                    results = await this.splitPdf();
                    break;
                case 'compress-pdf':
                    results = await this.compressPdf();
                    break;
                case 'compress-image':
                    results = await this.compressImage();
                    break;
                case 'image-resizer':
                    results = await this.resizeImage();
                    break;
                case 'rotate-pdf':
                    results = await this.rotatePdf();
                    break;
                case 'remove-metadata':
                    results = await this.removeMetadata();
                    break;
                case 'edit-metadata':
                    results = await this.editMetadata();
                    break;
                case 'remove-password':
                    results = await this.removePassword();
                    break;
                case 'add-password':
                    results = await this.addPassword();
                    break;
                case 'extract-pages':
                    results = await this.extractPages();
                    break;
                case 'remove-pages':
                    results = await this.removePages();
                    break;
                case 'sort-pages':
                    results = await this.sortPages();
                    break;
                case 'add-watermark':
                    results = await this.addWatermark();
                    break;
                case 'flatten-pdf':
                    results = await this.flattenPdf();
                    break;
                case 'heif-to-pdf':
                    results = await this.heifToPdf();
                    break;
                case 'compare-pdfs':
                    results = await this.comparePdfs();
                    break;
                default:
                    throw new Error('Unknown tool: ' + this.currentTool);
            }

            this.showResults(results);
        } catch (error) {
            console.error('Processing error:', error);
            this.showError('Processing failed: ' + error.message);
        } finally {
            this.hideProgress();
        }
    },
    // Helper functions for UI

    showProgress() {
        const progressContainer = document.getElementById('progress-container');
        const progressFill = document.getElementById('progress-fill');

        if (progressContainer) {
            progressContainer.style.display = 'block';
        }
        if (progressFill) {
            progressFill.style.width = '0%';
        }

        // Simulate progress
        this.progressInterval = setInterval(() => {
            if (progressFill) {
                const currentWidth = parseInt(progressFill.style.width) || 0;
                if (currentWidth < 90) {
                    progressFill.style.width = (currentWidth + 5) + '%';
                }
            }
        }, 300);
    },

    hideProgress() {
        const progressContainer = document.getElementById('progress-container');
        const progressFill = document.getElementById('progress-fill');

        // Complete the progress bar
        if (progressFill) {
            progressFill.style.width = '100%';
        }

        // Clear the interval
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }

        // Hide after a short delay
        setTimeout(() => {
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
        }, 500);
    },

    showResults(results) {
        if (!results) return;

        const resultsSection = document.getElementById('results-section');
        const resultsList = document.getElementById('results-list');

        if (!resultsSection || !resultsList) return; // Exit if elements don't exist

        // Allow tool methods to fully render custom UIs
        if (!Array.isArray(results)) {
            if (results.type === 'custom-rendered') {
                resultsSection.style.display = 'block';
                return;
            }
            if (results.type === 'custom' && results.html) {
                resultsList.innerHTML = results.html;
                resultsSection.style.display = 'block';
                return;
            }
        }

        if (!results || results.length === 0) return;

        resultsList.innerHTML = '';

        // Show the results section
        resultsSection.style.display = 'block';

        results.forEach(result => {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item fade-in';

            // Add special styling for ZIP files
            if (result.isZipFile || result.type === 'application/zip') {
                resultItem.classList.add('zip-file');
            }

            const detailsMarkup = result.details
                ? `<p class="result-meta">${result.details}</p>`
                : '';

            resultItem.innerHTML = `
                <div class="file-info">
                    <i class="fas ${this.getFileIcon(result.type)} file-icon"></i>
                    <div class="file-details">
                        <h5>${result.name}</h5>
                        <p>${this.formatFileSize(result.size)}</p>
                        ${detailsMarkup}
                    </div>
                </div>
                <button class="download-btn" onclick="window.pdfConverter.downloadResult('${result.url}', '${result.name}')">
                    <i class="fas fa-download"></i> Download
                </button>
            `;
            resultsList.appendChild(resultItem);
        });

        resultsSection.style.display = 'block';
    },

    clearResults() {
        const resultsSection = document.getElementById('results-section');
        const resultsList = document.getElementById('results-list');

        if (resultsList) {
            resultsList.innerHTML = '';
        }
        if (resultsSection) {
            resultsSection.style.display = 'none';
        }
    },
    // Compare two PDFs: render pages side-by-side with a simple pixel diff overlay (red)

    async comparePdfs() {
        if (this.uploadedFiles.length !== 2) {
            throw new Error('Please upload exactly two PDF files');
        }

        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js is not loaded');
        }

        const [fileA, fileB] = this.uploadedFiles;
        const [bufA, bufB] = await Promise.all([fileA.arrayBuffer(), fileB.arrayBuffer()]);
        const [pdfA, pdfB] = await Promise.all([
            pdfjsLib.getDocument({ data: bufA }).promise,
            pdfjsLib.getDocument({ data: bufB }).promise
        ]);

        const resultsSection = document.getElementById('results-section');
        const resultsList = document.getElementById('results-list');
        if (!resultsSection || !resultsList) return { type: 'custom-rendered' };

        resultsList.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'result-item';
        header.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
                <div style="font-weight:600;">Left: ${fileA.name} · Right: ${fileB.name}</div>
                <div style="font-size:0.9rem; opacity:0.8;">Red overlay indicates visual differences</div>
            </div>
        `;
        resultsList.appendChild(header);

        const pageCount = Math.max(pdfA.numPages, pdfB.numPages);
        const targetWidth = 700; // px render width per side

        const renderInto = async (pdf, pageNo, canvas) => {
            if (!pdf || pageNo < 1 || pageNo > pdf.numPages) return null;
            const page = await pdf.getPage(pageNo);
            const vp1 = page.getViewport({ scale: 1 });
            const scale = targetWidth / vp1.width;
            const viewport = page.getViewport({ scale });
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            return { w: canvas.width, h: canvas.height, ctx };
        };

        for (let i = 1; i <= pageCount; i++) {
            const row = document.createElement('div');
            row.className = 'result-item fade-in';
            row.style.padding = '12px';
            row.style.display = 'flex';
            row.style.flexDirection = 'column';
            row.style.gap = '10px';

            const label = document.createElement('div');
            label.style.fontWeight = '600';
            label.textContent = `Page ${i}`;
            row.appendChild(label);

            const panes = document.createElement('div');
            panes.style.display = 'flex';
            panes.style.gap = '16px';
            panes.style.alignItems = 'flex-start';

            const leftWrap = document.createElement('div');
            const rightWrap = document.createElement('div');
            leftWrap.style.position = 'relative';
            rightWrap.style.position = 'relative';

            const leftCanvas = document.createElement('canvas');
            const rightCanvas = document.createElement('canvas');
            const overlayCanvas = document.createElement('canvas');
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.left = '0';
            overlayCanvas.style.top = '0';
            overlayCanvas.style.pointerEvents = 'none';
            overlayCanvas.style.mixBlendMode = 'multiply';

            leftWrap.appendChild(leftCanvas);
            rightWrap.appendChild(rightCanvas);
            rightWrap.appendChild(overlayCanvas);

            panes.appendChild(leftWrap);
            panes.appendChild(rightWrap);
            row.appendChild(panes);
            resultsList.appendChild(row);

            const [aInfo, bInfo] = await Promise.all([
                renderInto(pdfA, i, leftCanvas),
                renderInto(pdfB, i, rightCanvas)
            ]);

            if (!aInfo && !bInfo) {
                label.textContent += ' (no corresponding pages)';
                continue;
            }

            if (aInfo && bInfo) {
                const dw = Math.min(aInfo.w, bInfo.w);
                const dh = Math.min(aInfo.h, bInfo.h);
                overlayCanvas.width = dw;
                overlayCanvas.height = dh;
                overlayCanvas.style.width = dw + 'px';
                overlayCanvas.style.height = dh + 'px';

                const aData = aInfo.ctx.getImageData(0, 0, dw, dh).data;
                const bData = bInfo.ctx.getImageData(0, 0, dw, dh).data;
                const octx = overlayCanvas.getContext('2d');
                const out = octx.createImageData(dw, dh);
                const oData = out.data;
                const thr = 25; // per-channel threshold
                const alpha = 160; // overlay alpha (0-255)
                for (let p = 0; p < oData.length; p += 4) {
                    const dr = Math.abs(aData[p] - bData[p]);
                    const dg = Math.abs(aData[p + 1] - bData[p + 1]);
                    const db = Math.abs(aData[p + 2] - bData[p + 2]);
                    const diff = dr > thr || dg > thr || db > thr;
                    if (diff) {
                        oData[p] = 255;     // R
                        oData[p + 1] = 0;   // G
                        oData[p + 2] = 0;   // B
                        oData[p + 3] = alpha; // A
                    } else {
                        oData[p + 3] = 0; // fully transparent
                    }
                }
                octx.putImageData(out, 0, 0);
            } else {
                // One side missing
                const note = document.createElement('div');
                note.style.fontSize = '0.9rem';
                note.style.opacity = '0.8';
                note.textContent = aInfo ? 'No matching page on right' : 'No matching page on left';
                row.appendChild(note);
            }
        }

        // Indicate that we've already rendered a custom view
        return { type: 'custom-rendered' };
    }
});
