/* Split from script.js */
Object.assign(PDFConverterPro.prototype, {
    showNotification(message, type = 'info') {
        // Remove any existing notifications
        this.removeNotifications();

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type} fade-in`;

        // Set icon based on type
        let icon = 'fa-info-circle';
        if (type === 'success') icon = 'fa-check-circle';
        if (type === 'error') icon = 'fa-exclamation-circle';

        notification.innerHTML = `
            <i class="fas ${icon}"></i>
            <span>${message}</span>
        `;

        // Add to document
        document.body.appendChild(notification);

        // Remove after delay
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-in forwards';
            setTimeout(() => {
                this.removeNotifications();
            }, 300);
        }, 3000);
    },

    removeNotifications() {
        const notifications = document.querySelectorAll('.notification');
        notifications.forEach(notification => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });
    },

    showError(message) {
        console.error(message);
        this.showNotification(message, 'error');
    },
    // File preview functionality

    previewFile(fileName, fileSize, lastModified) {
        this.previewFileById(`${fileName}::${fileSize}::${lastModified}`);
    },

    previewFileById(fileId) {
        const file = this.findFileById(fileId);
        if (!file) return;

        if (file.type.includes('image')) {
            this.previewImage(file);
        } else if (file.type.includes('pdf')) {
            this.previewPdf(file);
        } else if (file.type.includes('text')) {
            this.previewText(file);
        } else {
            this.showNotification('Preview not available for this file type', 'info');
        }
    },

    async previewImage(file) {
        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.showPreviewModal(file.name, `
                    <div class="file-preview file-preview-image">
                        <div class="preview-image-stage">
                            <img src="${e.target.result}" alt="${file.name}">
                        </div>
                    </div>
                `);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            this.showError('Failed to preview image');
        }
    },

    async previewPdf(file) {
        try {
            const url = URL.createObjectURL(file);
            this.showPreviewModal(file.name, `
                <div class="file-preview">
                    <iframe src="${url}" width="100%" height="500px" style="border: none;"></iframe>
                </div>
            `);
        } catch (error) {
            this.showError('Failed to preview PDF');
        }
    },

    async previewText(file) {
        try {
            const text = await file.text();
            this.showPreviewModal(file.name, `
                <div class="file-preview">
                    <pre style="white-space: pre-wrap; background: #1f1f1f; color: #d1cfc0; padding: 15px; border-radius: 8px; max-height: 500px; overflow-y: auto;">${text}</pre>
                </div>
            `);
        } catch (error) {
            this.showError('Failed to preview text file');
        }
    },

    showPreviewModal(fileName, content) {
        // Create modal if it doesn't exist
        let previewModal = document.getElementById('preview-modal');
        if (!previewModal) {
            previewModal = document.createElement('div');
            previewModal.id = 'preview-modal';
            previewModal.className = 'modal';

            previewModal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="preview-title">File Preview</h3>
                        <button class="close-btn" id="close-preview">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body" id="preview-content">
                    </div>
                </div>
            `;

            document.body.appendChild(previewModal);

            // Close button event
            document.getElementById('close-preview').addEventListener('click', () => {
                previewModal.style.display = 'none';
                document.body.style.overflow = 'auto';
            });

            // Click outside to close
            previewModal.addEventListener('click', (e) => {
                if (e.target.id === 'preview-modal') {
                    previewModal.style.display = 'none';
                    document.body.style.overflow = 'auto';
                }
            });
        }

        // Update content
        document.getElementById('preview-title').textContent = `Preview: ${fileName}`;
        document.getElementById('preview-content').innerHTML = content;

        // Show modal
        previewModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    },

    downloadResult(url, fileName) {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },
    // Save and load last used tool - Last used highlighting removed

    saveLastUsedTool() {
        if (this.currentTool) {
            localStorage.setItem('pdfConverterLastTool', this.currentTool);
        }
    },

    loadLastUsedTool() {
        // Last used tool highlighting functionality removed
    },
    // PDF to PNG Conversion

    async convertPdfToImage(format = 'png') {
        const results = [];
        const downloadOption = document.getElementById('download-option')?.value || 'zip';
        const isJpeg = format === 'jpeg';

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                const pageCount = pdf.numPages;

                const images = [];

                // Convert all pages to images
                for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better quality

                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport
                    };
                    await page.render(renderContext).promise;

                    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
                    const quality = isJpeg ? 0.9 : undefined;
                    const dataUrl = canvas.toDataURL(mimeType, quality);

                    const blob = await (await fetch(dataUrl)).blob();
                    const fileName = `${file.name.replace('.pdf', '')}_page${pageNum}.${format}`;

                    images.push({
                        name: fileName,
                        type: mimeType,
                        size: blob.size,
                        blob: blob,
                        url: URL.createObjectURL(blob)
                    });
                }

                if (downloadOption === 'zip') {
                    // Create actual ZIP file using JSZip
                    const zipBlob = await this.createActualZip(images, file.name.replace('.pdf', ''));
                    const zipFileName = `${file.name.replace('.pdf', '')}_all_pages.zip`;

                    results.push({
                        name: zipFileName,
                        type: 'application/zip',
                        size: zipBlob.size,
                        url: URL.createObjectURL(zipBlob)
                    });
                } else {
                    // Return individual images
                    results.push(...images);
                }

            } catch (error) {
                console.error(`Error converting PDF to ${format.toUpperCase()}:`, error);
                throw new Error(`Failed to convert ${file.name} to ${format.toUpperCase()}`);
            }
        }
        return results;
    },
    // Edit Metadata: Apply user-provided metadata to PDFs

    async editMetadata() {
        const results = [];

        // Parse datetime-local values deterministically in local time.
        const parseDatetimeLocalInput = (value) => {
            if (!value || typeof value !== 'string') return null;
            const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (!m) return null;
            const yyyy = Number(m[1]);
            const MM = Number(m[2]) - 1;
            const dd = Number(m[3]);
            const hh = Number(m[4]);
            const mm = Number(m[5]);
            const ss = Number(m[6] || 0);
            const d = new Date(yyyy, MM, dd, hh, mm, ss, 0);
            return isNaN(d.getTime()) ? null : d;
        };

        // Read input values once
        const titleEl = document.getElementById('meta-title');
        const authorEl = document.getElementById('meta-author');
        const subjectEl = document.getElementById('meta-subject');
        const keywordsEl = document.getElementById('meta-keywords');
        const producerEl = document.getElementById('meta-producer');
        const creatorEl = document.getElementById('meta-creator');
        const languageEl = document.getElementById('meta-language');
        const creationDateEl = document.getElementById('meta-creation-date');
        const modificationDateEl = document.getElementById('meta-modification-date');

        const title = titleEl ? titleEl.value.trim() : '';
        const author = authorEl ? authorEl.value.trim() : '';
        const subject = subjectEl ? subjectEl.value.trim() : '';
        const keywordsRaw = keywordsEl ? keywordsEl.value.trim() : '';
        const producer = producerEl ? producerEl.value.trim() : '';
        const creator = creatorEl ? creatorEl.value.trim() : '';
        const language = languageEl ? languageEl.value.trim() : '';
        const creationDateStr = creationDateEl ? creationDateEl.value : '';
        const modificationDateStr = modificationDateEl ? modificationDateEl.value : '';

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

                // Only set fields that are non-empty to keep others unchanged
                if (title && typeof pdfDoc.setTitle === 'function') pdfDoc.setTitle(title);
                if (author && typeof pdfDoc.setAuthor === 'function') pdfDoc.setAuthor(author);
                if (subject && typeof pdfDoc.setSubject === 'function') pdfDoc.setSubject(subject);
                if (keywordsRaw && typeof pdfDoc.setKeywords === 'function') {
                    const kw = keywordsRaw.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
                    if (kw.length) pdfDoc.setKeywords(kw);
                }
                if (producer && typeof pdfDoc.setProducer === 'function') pdfDoc.setProducer(producer);
                if (creator && typeof pdfDoc.setCreator === 'function') pdfDoc.setCreator(creator);
                if (language && typeof pdfDoc.setLanguage === 'function') pdfDoc.setLanguage(language);
                if (creationDateStr && typeof pdfDoc.setCreationDate === 'function') {
                    const d = parseDatetimeLocalInput(creationDateStr);
                    if (d) pdfDoc.setCreationDate(d);
                }
                if (modificationDateStr && typeof pdfDoc.setModificationDate === 'function') {
                    const d = parseDatetimeLocalInput(modificationDateStr);
                    if (d) pdfDoc.setModificationDate(d);
                }

                const bytes = await pdfDoc.save({
                    useObjectStreams: false,
                    addDefaultPage: false,
                    objectStreamsThreshold: 40,
                    updateFieldAppearances: false
                });

                const blob = new Blob([bytes], { type: 'application/pdf' });
                results.push({
                    name: `meta_${file.name}`,
                    type: 'application/pdf',
                    size: blob.size,
                    url: URL.createObjectURL(blob)
                });

                this.showNotification(`Updated metadata for ${file.name}`, 'success');
            } catch (error) {
                console.error('Error editing metadata:', error);
                this.showNotification(`Failed to edit metadata for ${file.name}: ${error.message}`, 'error');
                // Fallback to original file for download to avoid empty results
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
    // Populate metadata form from the first uploaded PDF (for convenience)

    async populateMetadataFromFirstPdf() {
        try {
            if (this.currentTool !== 'edit-metadata') return;
            if (!this.uploadedFiles || this.uploadedFiles.length === 0) return;

            const file = this.uploadedFiles[0];
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

            const byId = (id) => document.getElementById(id);
            const setVal = (id, val) => { const el = byId(id); if (el) el.value = val ?? ''; };
            const setIfEmpty = (id, val) => {
                const el = byId(id);
                if (!el) return;
                const normalized = (val ?? '').toString().trim();
                if (!el.value && normalized) el.value = normalized;
            };

            // Clear all fields first to avoid stale values
            setVal('meta-title', '');
            setVal('meta-author', '');
            setVal('meta-subject', '');
            setVal('meta-keywords', '');
            setVal('meta-producer', '');
            setVal('meta-creator', '');
            setVal('meta-language', '');
            setVal('meta-creation-date', '');
            setVal('meta-modification-date', '');

            // Helper to parse PDF date strings like D:YYYYMMDDHHmmSS+HH'mm
            const parsePdfDate = (s) => {
                if (!s || typeof s !== 'string') return null;
                const str = (s.startsWith('D:') ? s.slice(2) : s).trim();
                const core = str.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
                if (!core) return null;

                const yyyy = core[1];
                const mm = core[2] || '01';
                const dd = core[3] || '01';
                const HH = core[4] || '00';
                const MM = core[5] || '00';
                const SS = core[6] || '00';

                // PDF timezone variants:
                // Z, +HH'mm', -HH'mm', +HHmm, -HHmm, +HH, -HH
                let tz = '';
                const tzTail = str.slice(core[0].length).trim();
                if (/^[Zz]$/.test(tzTail)) {
                    tz = 'Z';
                } else {
                    const off = tzTail.match(/^([+\-])(\d{2})(?:'?(\d{2})'?)?/);
                    if (off) {
                        const sign = off[1];
                        const th = off[2];
                        const tm = off[3] || '00';
                        tz = `${sign}${th}:${tm}`;
                    }
                }

                // If timezone is absent, interpret as local time (per common PDF writer behavior).
                const iso = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${tz}`;
                const d = new Date(iso);
                return isNaN(d.getTime()) ? null : d;
            };

            // Prefer pdf.js metadata (Info dictionary) which many tools update reliably
            if (typeof pdfjsLib !== 'undefined' && pdfjsLib.getDocument) {
                try {
                    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    const meta = await pdf.getMetadata();
                    const info = (meta && meta.info) || {};
                    if (info.Title) setVal('meta-title', info.Title);
                    if (info.Author) setVal('meta-author', info.Author);
                    if (info.Subject) setVal('meta-subject', info.Subject);
                    if (info.Keywords) setVal('meta-keywords', info.Keywords);
                    if (info.Producer) setVal('meta-producer', info.Producer);
                    if (info.Creator) setVal('meta-creator', info.Creator);
                    if (info.Language || info.Lang) setVal('meta-language', info.Language || info.Lang);
                    if (info.CreationDate) {
                        const d = parsePdfDate(info.CreationDate);
                        if (d) setVal('meta-creation-date', this.formatDateForDatetimeLocal(d));
                    }
                    if (info.ModDate) {
                        const d = parsePdfDate(info.ModDate);
                        if (d) setVal('meta-modification-date', this.formatDateForDatetimeLocal(d));
                    }
                    await pdf.destroy();
                } catch (e) {
                    console.warn('pdf.js metadata read failed; falling back to pdf-lib getters', e);
                }
            }

            // Strings
            if (typeof pdfDoc.getTitle === 'function') setIfEmpty('meta-title', pdfDoc.getTitle() || '');
            if (typeof pdfDoc.getAuthor === 'function') setIfEmpty('meta-author', pdfDoc.getAuthor() || '');
            if (typeof pdfDoc.getSubject === 'function') setIfEmpty('meta-subject', pdfDoc.getSubject() || '');
            if (typeof pdfDoc.getProducer === 'function') setIfEmpty('meta-producer', pdfDoc.getProducer() || '');
            if (typeof pdfDoc.getCreator === 'function') setIfEmpty('meta-creator', pdfDoc.getCreator() || '');
            {
                const langEl = byId('meta-language');
                if (typeof pdfDoc.getLanguage === 'function' && langEl && !langEl.value) {
                    setIfEmpty('meta-language', pdfDoc.getLanguage() || '');
                }
            }

            // Keywords (array)
            if (typeof pdfDoc.getKeywords === 'function') {
                const kws = pdfDoc.getKeywords();
                if (Array.isArray(kws)) setIfEmpty('meta-keywords', kws.join(', '));
                else if (typeof kws === 'string') setIfEmpty('meta-keywords', kws);
            }

            // Dates
            const creationDateEl = byId('meta-creation-date');
            if (typeof pdfDoc.getCreationDate === 'function' && creationDateEl && !creationDateEl.value) {
                const cd = pdfDoc.getCreationDate();
                if (cd instanceof Date && !isNaN(cd.getTime())) {
                    setVal('meta-creation-date', this.formatDateForDatetimeLocal(cd));
                }
            }
            const modificationDateEl = byId('meta-modification-date');
            if (typeof pdfDoc.getModificationDate === 'function' && modificationDateEl && !modificationDateEl.value) {
                const md = pdfDoc.getModificationDate();
                if (md instanceof Date && !isNaN(md.getTime())) {
                    setVal('meta-modification-date', this.formatDateForDatetimeLocal(md));
                }
            }
        } catch (err) {
            console.warn('Could not populate metadata from PDF:', err);
        }
    },
    // Helper: format Date to yyyy-MM-ddTHH:mm for datetime-local inputs

    formatDateForDatetimeLocal(date) {
        const pad = (n) => String(n).padStart(2, '0');
        const yyyy = date.getFullYear();
        const MM = pad(date.getMonth() + 1);
        const dd = pad(date.getDate());
        const hh = pad(date.getHours());
        const mm = pad(date.getMinutes());
        return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
    },
    // Build styled HTML for an ExcelJS worksheet preserving key formatting

    buildExcelWorksheetHTML(worksheet, sheetName) {
        const wrap = document.createElement('div');
        const caption = document.createElement('caption');
        caption.textContent = sheetName || worksheet.name || 'Sheet';

        const table = document.createElement('table');
        table.appendChild(caption);
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
        table.style.tableLayout = 'fixed';
        table.style.fontFamily = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        table.style.fontSize = '12px';

        const colgroup = document.createElement('colgroup');
        const colCount = worksheet.actualColumnCount || (worksheet.columns ? worksheet.columns.length : 0) || 0;
        for (let c = 1; c <= colCount; c++) {
            const col = worksheet.getColumn(c);
            const colEl = document.createElement('col');
            const px = this.excelColWidthToPx(col && col.width ? col.width : 10);
            colEl.style.width = px + 'px';
            colgroup.appendChild(colEl);
        }
        table.appendChild(colgroup);

        const merges = this.getWorksheetMerges(worksheet);
        const maxRow = worksheet.actualRowCount || (worksheet._rows ? worksheet._rows.length : 0) || 0;
        for (let r = 1; r <= maxRow; r++) {
            const row = worksheet.getRow(r);
            const tr = document.createElement('tr');
            if (row && row.height) tr.style.height = this.pointsToPx(row.height) + 'px';

            for (let c = 1; c <= colCount; c++) {
                const cell = row.getCell(c);
                if (cell && cell.isMerged && cell.address !== cell.master.address) {
                    // skip cells covered by a merge (only render master)
                    continue;
                }
                const td = document.createElement('td');

                // Apply merge spans if master
                if (cell && cell.isMerged) {
                    const span = merges[cell.address] || merges[cell.master.address];
                    if (span) {
                        if (span.colSpan > 1) td.colSpan = span.colSpan;
                        if (span.rowSpan > 1) td.rowSpan = span.rowSpan;
                    }
                }

                // Content
                const text = (cell && (cell.text || cell.value)) != null ? String(cell.text != null ? cell.text : cell.value) : '';
                td.textContent = text;

                // Alignment & wrap
                if (cell && cell.alignment) {
                    const a = cell.alignment;
                    if (a.horizontal) td.style.textAlign = a.horizontal;
                    if (a.vertical) td.style.verticalAlign = a.vertical;
                    if (a.wrapText) td.style.whiteSpace = 'pre-wrap';
                }

                // Font
                if (cell && cell.font) {
                    const f = cell.font;
                    if (f.bold) td.style.fontWeight = '700';
                    if (f.italic) td.style.fontStyle = 'italic';
                    if (f.underline) td.style.textDecoration = 'underline';
                    if (f.size) td.style.fontSize = `${f.size}px`;
                    if (f.color && f.color.argb) td.style.color = this.argbToCss(f.color.argb);
                }

                // Fill (background)
                if (cell && cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor && cell.fill.fgColor.argb) {
                    td.style.backgroundColor = this.argbToCss(cell.fill.fgColor.argb);
                }

                // Borders
                if (cell && cell.border) {
                    const b = cell.border;
                    const edge = (e) => {
                        if (!b[e]) return null;
                        const col = b[e].color && b[e].color.argb ? this.argbToCss(b[e].color.argb) : '#000';
                        const style = b[e].style || 'thin';
                        const w = (style === 'hair' ? 0.5 : style === 'thin' ? 1 : style === 'medium' ? 2 : 1);
                        return `${w}px solid ${col}`;
                    };
                    const top = edge('top');
                    const left = edge('left');
                    const right = edge('right');
                    const bottom = edge('bottom');
                    if (top) td.style.borderTop = top;
                    if (left) td.style.borderLeft = left;
                    if (right) td.style.borderRight = right;
                    if (bottom) td.style.borderBottom = bottom;
                }

                td.style.padding = '6px 8px';
                td.style.boxSizing = 'border-box';
                td.style.overflow = 'hidden';

                tr.appendChild(td);

                // If merged, skip the covered cells
                if (cell && cell.isMerged) {
                    const span = merges[cell.address] || merges[cell.master.address];
                    if (span && span.colSpan && span.colSpan > 1) {
                        c += (span.colSpan - 1);
                    }
                }
            }
            table.appendChild(tr);
        }

        wrap.appendChild(table);
        return wrap;
    },
    // Helper: collect merges and compute spans { [masterAddress]: {rowSpan, colSpan} }

    getWorksheetMerges(worksheet) {
        const merges = {};
        let mergeList = [];
        if (worksheet && worksheet.model && Array.isArray(worksheet.model.merges)) {
            mergeList = worksheet.model.merges;
        } else if (worksheet && worksheet._merges) {
            try {
                mergeList = Array.from(worksheet._merges.keys ? worksheet._merges.keys() : worksheet._merges);
            } catch (_) { /* noop */ }
        }
        const toRC = (addr) => {
            const m = addr.match(/([A-Z]+)(\d+)/);
            if (!m) return { r: 1, c: 1 };
            return { r: parseInt(m[2], 10), c: this.colLettersToNumber(m[1]) };
        };
        const partsFromRange = (rng) => {
            const [a, b] = rng.split(':');
            const A = toRC(a);
            const B = toRC(b);
            const r1 = Math.min(A.r, B.r), r2 = Math.max(A.r, B.r);
            const c1 = Math.min(A.c, B.c), c2 = Math.max(A.c, B.c);
            return { r1, c1, r2, c2 };
        };
        (mergeList || []).forEach(rng => {
            if (typeof rng !== 'string') return;
            const { r1, c1, r2, c2 } = partsFromRange(rng);
            const master = worksheet.getCell(r1, c1);
            if (!master) return;
            merges[master.address] = { rowSpan: (r2 - r1 + 1), colSpan: (c2 - c1 + 1) };
        });
        return merges;
    },

    colLettersToNumber(letters) {
        let num = 0;
        for (let i = 0; i < letters.length; i++) {
            num = num * 26 + (letters.charCodeAt(i) - 64);
        }
        return num;
    },

    pointsToPx(points) {
        return Math.round(points * (96 / 72));
    },

    excelColWidthToPx(widthChars) {
        // Approximate conversion from Excel column width (characters) to pixels
        // Common heuristic: pixels ≈ (characters + 0.71) * 8
        return Math.round((Number(widthChars || 10) + 0.71) * 8);
    },

    argbToCss(argb) {
        // argb like 'FFRRGGBB'
        if (!argb || typeof argb !== 'string' || argb.length < 6) return '#000000';
        const a = parseInt(argb.slice(0, 2), 16) / 255;
        const r = parseInt(argb.slice(2, 4), 16);
        const g = parseInt(argb.slice(4, 6), 16);
        const b = parseInt(argb.slice(6, 8), 16);
        if (a >= 0.999) {
            // Opaque
            return `#${argb.slice(2, 8)}`;
        }
        return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
    },
    // Collect text overlays from a rendered sheet node for selectable text layer

    collectTextOverlays(rootNode, canvasScale) {
        try {
            const overlays = [];
            const origin = rootNode.getBoundingClientRect();
            const cells = rootNode.querySelectorAll('td, th');
            cells.forEach((el) => {
                const text = (el.innerText || '').trim();
                if (!text) return;
                const rect = el.getBoundingClientRect();
                const left = rect.left - origin.left + (rootNode.scrollLeft || 0);
                const top = rect.top - origin.top + (rootNode.scrollTop || 0);
                const width = rect.width;
                const style = window.getComputedStyle(el);
                const fsPx = parseFloat(style.fontSize || '12') || 12;
                overlays.push({
                    text,
                    leftCanvas: left * canvasScale,
                    topCanvas: top * canvasScale,
                    widthCanvas: width * canvasScale,
                    fontSizeCanvas: fsPx * canvasScale,
                });
            });
            return overlays;
        } catch (e) {
            console.warn('collectTextOverlays failed:', e);
            return [];
        }
    },
    // Add Password to PDF (Encrypt using qpdf-wasm)

    async addPassword() {
        const results = [];
        const newPassword = document.getElementById('new-password')?.value || '';
        const confirmPassword = document.getElementById('confirm-password')?.value || '';

        if (!newPassword) {
            this.showNotification('Please enter a new password', 'error');
            return results;
        }
        if (newPassword !== confirmPassword) {
            this.showNotification('Passwords do not match', 'error');
            return results;
        }

        // Lazy-load and cache qpdf-wasm module
        if (!this._qpdfModule) {
            try {
                const mod = await import('https://cdn.jsdelivr.net/npm/@jspawn/qpdf-wasm@0.0.2/qpdf.mjs');
                const createModule = mod && (mod.default || mod);
                this._qpdfModule = await createModule({
                    locateFile: (p) => p.endsWith('.wasm')
                        ? 'https://cdn.jsdelivr.net/npm/@jspawn/qpdf-wasm@0.0.2/qpdf.wasm'
                        : p,
                    noInitialRun: true
                });
            } catch (e) {
                console.error('Failed to load qpdf-wasm:', e);
                this.showNotification('Failed to load encryption engine. Check your internet connection and try again.', 'error');
                return results;
            }
        }

        const qpdf = this._qpdfModule;

        for (let i = 0; i < this.uploadedFiles.length; i++) {
            const file = this.uploadedFiles[i];
            try {
                const arrayBuffer = await file.arrayBuffer();
                const inName = `in_${Date.now()}_${i}.pdf`;
                const outName = `out_${Date.now()}_${i}.pdf`;

                // Write input file to WASM FS
                qpdf.FS.writeFile(inName, new Uint8Array(arrayBuffer));

                // Use same value for user and owner password by default
                const userPass = newPassword;
                const ownerPass = newPassword;

                // Build args: qpdf --encrypt user owner bits -- in.pdf out.pdf
                const args = ['--encrypt', userPass, ownerPass, '256', '--', inName, outName];

                // Run qpdf CLI
                try {
                    qpdf.callMain(args);
                } catch (runErr) {
                    // Emscripten may throw for non-zero exit; rethrow with context
                    console.error('qpdf error:', runErr);
                    throw new Error('Encryption failed');
                }

                // Read output file from WASM FS
                const outBytes = qpdf.FS.readFile(outName);
                const blob = new Blob([outBytes], { type: 'application/pdf' });

                results.push({
                    name: `protected_${file.name}`,
                    type: 'application/pdf',
                    size: blob.size,
                    url: URL.createObjectURL(blob)
                });

                // Cleanup FS
                try { qpdf.FS.unlink(inName); } catch (_) {}
                try { qpdf.FS.unlink(outName); } catch (_) {}

                this.showNotification(`✅ Added password to ${file.name}`, 'success');
            } catch (error) {
                console.error('Error encrypting PDF:', error);
                this.showNotification(`Failed to Encrypt PDF to ${file.name}: ${error.message}`, 'error');

                // Fallback: return original file untouched
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
    // Flatten PDF (annotations and form fields) using qpdf-wasm

    async flattenPdf() {
        const results = [];

        // Lazy-load and cache qpdf-wasm module
        if (!this._qpdfModule) {
            try {
                const mod = await import('https://cdn.jsdelivr.net/npm/@jspawn/qpdf-wasm@0.0.2/qpdf.mjs');
                const createModule = mod && (mod.default || mod);
                this._qpdfModule = await createModule({
                    locateFile: (p) => p.endsWith('.wasm')
                        ? 'https://cdn.jsdelivr.net/npm/@jspawn/qpdf-wasm@0.0.2/qpdf.wasm'
                        : p,
                    noInitialRun: true
                });
            } catch (e) {
                console.error('Failed to load qpdf-wasm:', e);
                this.showNotification('Failed to load flattening engine. Check your internet connection and try again.', 'error');
                return results;
            }
        }

        const qpdf = this._qpdfModule;

        // Default options: always generate appearances and flatten all annotations/form fields
        const scope = 'all';
        const wantAppearances = true;

        for (let i = 0; i < this.uploadedFiles.length; i++) {
            const file = this.uploadedFiles[i];
            try {
                const arrayBuffer = await file.arrayBuffer();
                const inName = `in_${Date.now()}_${i}.pdf`;
                const outName = `out_${Date.now()}_${i}.pdf`;

                // Write input file to WASM FS
                qpdf.FS.writeFile(inName, new Uint8Array(arrayBuffer));

                // Build args: qpdf [options] -- in.pdf out.pdf
                const args = [];
                if (wantAppearances) {
                    args.push('--generate-appearances');
                }
                args.push(`--flatten-annotations=${scope}`);
                args.push('--', inName, outName);

                try {
                    qpdf.callMain(args);
                } catch (runErr) {
                    console.error('qpdf flatten error:', runErr);
                    throw new Error('Flattening failed');
                }

                // Read output file from WASM FS
                const outBytes = qpdf.FS.readFile(outName);
                const blob = new Blob([outBytes], { type: 'application/pdf' });

                results.push({
                    name: `flattened_${file.name}`,
                    type: 'application/pdf',
                    size: blob.size,
                    url: URL.createObjectURL(blob)
                });

                // Cleanup FS
                try { qpdf.FS.unlink(inName); } catch (_) {}
                try { qpdf.FS.unlink(outName); } catch (_) {}

                this.showNotification(`✅ Flattened ${file.name}`, 'success');
            } catch (error) {
                console.error('Error flattening PDF:', error);
                this.showNotification(`Failed to flatten ${file.name}: ${error.message}`, 'error');

                // Fallback: return original file untouched
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
    // Helper function to create actual ZIP file

    async createActualZip(images, baseName) {
        const zip = new JSZip();

        for (const image of images) {
            zip.file(image.name, image.blob);
        }

        return await zip.generateAsync({ type: 'blob' });
    },
    // Helper function to create ZIP file from PDF files

    async createPdfZip(pdfFiles) {
        const zip = new JSZip();

        for (const pdf of pdfFiles) {
            zip.file(pdf.name, pdf.blob);
        }

        return await zip.generateAsync({ type: 'blob' });
    },

    getRasterPdfPageSize(widthPx, heightPx) {
        const pxToPt = 72 / 96;
        const rawWidthPt = Math.max(1, widthPx * pxToPt);
        const rawHeightPt = Math.max(1, heightPx * pxToPt);
        const maxSidePt = 1440;
        const scale = Math.min(1, maxSidePt / Math.max(rawWidthPt, rawHeightPt));

        return {
            widthPt: Math.max(1, Math.round(rawWidthPt * scale)),
            heightPt: Math.max(1, Math.round(rawHeightPt * scale))
        };
    },

    getRasterPdfJpegQuality(widthPx, heightPx, fileSizeBytes = 0) {
        const megaPixels = ((widthPx || 0) * (heightPx || 0)) / 1000000;
        if (fileSizeBytes >= 14 * 1024 * 1024 || megaPixels >= 14) return 0.76;
        if (fileSizeBytes >= 8 * 1024 * 1024 || megaPixels >= 9) return 0.8;
        if (fileSizeBytes >= 4 * 1024 * 1024 || megaPixels >= 5) return 0.84;
        return 0.88;
    },

    async decodeImageForPdf(file) {
        if (typeof createImageBitmap === 'function') {
            try {
                const bitmap = await createImageBitmap(file);
                return {
                    source: bitmap,
                    width: Math.max(1, bitmap.width || 1),
                    height: Math.max(1, bitmap.height || 1),
                    cleanup: () => {
                        if (typeof bitmap.close === 'function') bitmap.close();
                    }
                };
            } catch (_) {
                // Fall back to HTMLImageElement decoding.
            }
        }

        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Failed to decode image file'));
                image.src = url;
            });

            return {
                source: img,
                width: Math.max(1, img.naturalWidth || img.width || 1),
                height: Math.max(1, img.naturalHeight || img.height || 1),
                cleanup: () => URL.revokeObjectURL(url)
            };
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error;
        }
    },

    renderDecodedImageToCanvas(decodedImage, options = {}) {
        const maxSidePx = Math.max(1, Number(options.maxSidePx) || Math.max(decodedImage.width, decodedImage.height));
        const backgroundColor = options.backgroundColor || null;
        const longestSide = Math.max(decodedImage.width, decodedImage.height);
        const scale = Math.min(1, maxSidePx / Math.max(1, longestSide));
        const targetWidth = Math.max(1, Math.round(decodedImage.width * scale));
        const targetHeight = Math.max(1, Math.round(decodedImage.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Canvas rendering is not available in this browser');
        }

        if (backgroundColor) {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, targetWidth, targetHeight);
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(decodedImage.source, 0, 0, targetWidth, targetHeight);
        return canvas;
    },

    async canvasToBytes(canvas, mimeType, quality) {
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(
                (result) => (result ? resolve(result) : reject(new Error('Canvas toBlob failed'))),
                mimeType,
                quality
            );
        });
        const arrayBuffer = await blob.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    },

    async prepareImageFileForPdf(file) {
        const normalizedType = (file.type || '').toLowerCase();
        const fileName = (file.name || '').toLowerCase();
        const isPng = normalizedType.includes('png') || fileName.endsWith('.png');
        const isJpeg = normalizedType.includes('jpeg') || normalizedType.includes('jpg') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg');

        if (isJpeg && file.size <= 5 * 1024 * 1024) {
            return {
                embedType: 'jpg',
                bytes: new Uint8Array(await file.arrayBuffer())
            };
        }

        if (isPng && file.size <= 2.5 * 1024 * 1024) {
            return {
                embedType: 'png',
                bytes: new Uint8Array(await file.arrayBuffer())
            };
        }

        const decodedImage = await this.decodeImageForPdf(file);
        try {
            const longestSide = Math.max(decodedImage.width, decodedImage.height);
            const megaPixels = (decodedImage.width * decodedImage.height) / 1000000;

            if (isJpeg) {
                if (file.size <= 8 * 1024 * 1024 && longestSide <= 3200 && megaPixels <= 9) {
                    return {
                        embedType: 'jpg',
                        bytes: new Uint8Array(await file.arrayBuffer())
                    };
                }

                const maxSidePx = (file.size > 14 * 1024 * 1024 || megaPixels > 14 || longestSide > 4200) ? 2600 : 3000;
                const canvas = this.renderDecodedImageToCanvas(decodedImage, {
                    maxSidePx,
                    backgroundColor: '#ffffff'
                });
                return {
                    embedType: 'jpg',
                    bytes: await this.canvasToBytes(
                        canvas,
                        'image/jpeg',
                        this.getRasterPdfJpegQuality(canvas.width, canvas.height, file.size)
                    )
                };
            }

            if (isPng) {
                const maxSidePx = (file.size > 10 * 1024 * 1024 || megaPixels > 14 || longestSide > 4200) ? 2400 : 2800;
                const canvas = this.renderDecodedImageToCanvas(decodedImage, { maxSidePx });
                const hasTransparency = this.canvasHasTransparencySampled(canvas);

                if (!hasTransparency && (file.size > 3.5 * 1024 * 1024 || megaPixels > 6 || longestSide > 2800)) {
                    return {
                        embedType: 'jpg',
                        bytes: await this.canvasToBytes(
                            canvas,
                            'image/jpeg',
                            this.getRasterPdfJpegQuality(canvas.width, canvas.height, file.size)
                        )
                    };
                }

                if (canvas.width !== decodedImage.width || canvas.height !== decodedImage.height) {
                    return {
                        embedType: 'png',
                        bytes: await this.canvasToBytes(canvas, 'image/png')
                    };
                }

                return {
                    embedType: 'png',
                    bytes: new Uint8Array(await file.arrayBuffer())
                };
            }

            throw new Error(`Unsupported image format: ${file.type || file.name}`);
        } finally {
            decodedImage.cleanup();
        }
    },

    async addPreparedImagePageToPdf(pdfDoc, preparedImage) {
        const image = preparedImage.embedType === 'png'
            ? await pdfDoc.embedPng(preparedImage.bytes)
            : await pdfDoc.embedJpg(preparedImage.bytes);

        const { widthPt, heightPt } = this.getRasterPdfPageSize(image.width, image.height);
        const page = pdfDoc.addPage([widthPt, heightPt]);
        page.drawImage(image, {
            x: 0,
            y: 0,
            width: widthPt,
            height: heightPt
        });
    },

    async convertPdfToPng() {
        return this.convertPdfToImage('png');
    },
    // PDF to JPEG Conversion

    async convertPdfToJpeg() {
        return this.convertPdfToImage('jpeg');
    },
    // PNG to PDF Conversion

    async convertPngToPdf() {
        try {
            const results = [];
            const conversionMode = document.getElementById('conversion-mode')?.value || 'combined';

            if (conversionMode === 'combined') {
                // Create a single merged PDF with all images
                const combinedPdfDoc = await PDFLib.PDFDocument.create();

                for (const file of this.uploadedFiles) {
                    const preparedImage = await this.prepareImageFileForPdf(file);
                    await this.addPreparedImagePageToPdf(combinedPdfDoc, preparedImage);
                }

                const combinedPdfBytes = await combinedPdfDoc.save({ useObjectStreams: true });
                const combinedBlob = new Blob([combinedPdfBytes], { type: 'application/pdf' });
                const combinedUrl = URL.createObjectURL(combinedBlob);

                results.push({
                    name: 'merged_images.pdf',
                    type: 'application/pdf',
                    size: combinedBlob.size,
                    url: combinedUrl
                });

            } else if (conversionMode === 'individual') {
                // Create individual PDFs for each image
                const individualPdfs = [];

                for (const file of this.uploadedFiles) {
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const preparedImage = await this.prepareImageFileForPdf(file);
                    await this.addPreparedImagePageToPdf(pdfDoc, preparedImage);

                    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);

                    const pdfResult = {
                        name: file.name.replace(/\.(png|jpg|jpeg)$/i, '.pdf'),
                        type: 'application/pdf',
                        size: blob.size,
                        url: url,
                        blob: blob
                    };

                    individualPdfs.push(pdfResult);
                    results.push(pdfResult);
                }

                // Create ZIP file with all individual PDFs (show first)
                if (individualPdfs.length > 1) {
                    const zipBlob = await this.createPdfZip(individualPdfs);
                    const zipResult = {
                        name: 'individual_pdfs.zip',
                        type: 'application/zip',
                        size: zipBlob.size,
                        url: URL.createObjectURL(zipBlob),
                        isZipFile: true
                    };

                    // Insert ZIP at the beginning
                    results.unshift(zipResult);
                }
            }

            return results;
        } catch (error) {
            console.error('Error converting images to PDF:', error);
            throw new Error('Failed to convert images to PDF');
        }
    },
    // JPEG to PDF Conversion

    async convertJpegToPdf() {
        try {
            const results = [];
            const conversionMode = document.getElementById('conversion-mode')?.value || 'combined';

            if (conversionMode === 'combined') {
                // Create a single merged PDF with all images
                const combinedPdfDoc = await PDFLib.PDFDocument.create();

                for (const file of this.uploadedFiles) {
                    const preparedImage = await this.prepareImageFileForPdf(file);
                    await this.addPreparedImagePageToPdf(combinedPdfDoc, preparedImage);
                }

                const combinedPdfBytes = await combinedPdfDoc.save({ useObjectStreams: true });
                const combinedBlob = new Blob([combinedPdfBytes], { type: 'application/pdf' });
                const combinedUrl = URL.createObjectURL(combinedBlob);

                results.push({
                    name: 'merged_images.pdf',
                    type: 'application/pdf',
                    size: combinedBlob.size,
                    url: combinedUrl
                });

            } else if (conversionMode === 'individual') {
                // Create individual PDFs for each image
                const individualPdfs = [];

                for (const file of this.uploadedFiles) {
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const preparedImage = await this.prepareImageFileForPdf(file);
                    await this.addPreparedImagePageToPdf(pdfDoc, preparedImage);

                    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);

                    const pdfResult = {
                        name: file.name.replace(/\.(jpg|jpeg)$/i, '.pdf'),
                        type: 'application/pdf',
                        size: blob.size,
                        url: url,
                        blob: blob
                    };

                    individualPdfs.push(pdfResult);
                    results.push(pdfResult);
                }

                // Create ZIP file with all individual PDFs (show first)
                if (individualPdfs.length > 1) {
                    const zipBlob = await this.createPdfZip(individualPdfs);
                    const zipResult = {
                        name: 'individual_pdfs.zip',
                        type: 'application/zip',
                        size: zipBlob.size,
                        url: URL.createObjectURL(zipBlob),
                        isZipFile: true
                    };

                    // Insert ZIP at the beginning
                    results.unshift(zipResult);
                }
            }

            return results;
        } catch (error) {
            console.error('Error converting JPEG to PDF:', error);
            throw new Error('Failed to convert JPEG images to PDF');
        }
    },
    // Helper: Decode WEBP file to PNG bytes using canvas

    async webpFileToPngBytes(file) {
        return new Promise((resolve, reject) => {
            try {
                const url = URL.createObjectURL(file);
                const img = new Image();
                img.onload = async () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth || img.width;
                        canvas.height = img.naturalHeight || img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        canvas.toBlob(async (blob) => {
                            try {
                                if (!blob) throw new Error('Canvas toBlob returned null');
                                const arrayBuffer = await blob.arrayBuffer();
                                resolve(new Uint8Array(arrayBuffer));
                            } catch (e) {
                                reject(e);
                            } finally {
                                URL.revokeObjectURL(url);
                            }
                        }, 'image/png');
                    } catch (e) {
                        URL.revokeObjectURL(url);
                        reject(e);
                    }
                };
                img.onerror = (e) => {
                    URL.revokeObjectURL(url);
                    reject(new Error('Failed to decode WEBP image'));
                };
                img.src = url;
            } catch (e) {
                reject(e);
            }
        });
    },
    // WEBP to PDF Conversion

    async convertWebpToPdf() {
        try {
            const results = [];
            const conversionMode = document.getElementById('conversion-mode')?.value || 'combined';

            if (conversionMode === 'combined') {
                const combinedPdfDoc = await PDFLib.PDFDocument.create();

                for (const file of this.uploadedFiles) {
                    const pngBytes = await this.webpFileToPngBytes(file);
                    const image = await combinedPdfDoc.embedPng(pngBytes);

                    const page = combinedPdfDoc.addPage([image.width, image.height]);
                    page.drawImage(image, {
                        x: 0,
                        y: 0,
                        width: image.width,
                        height: image.height
                    });
                }

                const combinedPdfBytes = await combinedPdfDoc.save();
                const combinedBlob = new Blob([combinedPdfBytes], { type: 'application/pdf' });
                const combinedUrl = URL.createObjectURL(combinedBlob);

                results.push({
                    name: 'merged_images.pdf',
                    type: 'application/pdf',
                    size: combinedBlob.size,
                    url: combinedUrl
                });
            } else if (conversionMode === 'individual') {
                const individualPdfs = [];

                for (const file of this.uploadedFiles) {
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const pngBytes = await this.webpFileToPngBytes(file);
                    const image = await pdfDoc.embedPng(pngBytes);

                    const page = pdfDoc.addPage([image.width, image.height]);
                    page.drawImage(image, {
                        x: 0,
                        y: 0,
                        width: image.width,
                        height: image.height
                    });

                    const pdfBytes = await pdfDoc.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);

                    const pdfResult = {
                        name: file.name.replace(/\.webp$/i, '.pdf'),
                        type: 'application/pdf',
                        size: blob.size,
                        url: url,
                        blob: blob
                    };

                    individualPdfs.push(pdfResult);
                    results.push(pdfResult);
                }

                if (individualPdfs.length > 1) {
                    const zipBlob = await this.createPdfZip(individualPdfs);
                    const zipResult = {
                        name: 'individual_pdfs.zip',
                        type: 'application/zip',
                        size: zipBlob.size,
                        url: URL.createObjectURL(zipBlob),
                        isZipFile: true
                    };
                    results.unshift(zipResult);
                }
            }

            return results;
        } catch (error) {
            console.error('Error converting WEBP to PDF:', error);
            throw new Error('Failed to convert WEBP images to PDF');
        }
    },
    // WEBP -> PNG

    async convertWebpToPng() {
        try {
            const results = [];
            const images = [];

            for (const file of this.uploadedFiles) {
                const url = URL.createObjectURL(file);
                try {
                    const img = await new Promise((resolve, reject) => {
                        const i = new Image();
                        i.onload = () => resolve(i);
                        i.onerror = () => reject(new Error('Failed to load WEBP image'));
                        i.src = url;
                    });

                    const width = img.naturalWidth || img.width;
                    const height = img.naturalHeight || img.height;
                    const canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const outBlob = await new Promise((resolve, reject) =>
                        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/png')
                    );

                    const outUrl = URL.createObjectURL(outBlob);
                    const name = file.name.replace(/\.webp$/i, '.png');
                    images.push({ name, blob: outBlob });
                    results.push({ name, type: 'image/png', size: outBlob.size, url: outUrl, blob: outBlob });
                } finally {
                    URL.revokeObjectURL(url);
                }
            }

            if (images.length > 1) {
                const zipBlob = await this.createActualZip(images, 'webp_to_png');
                results.unshift({
                    name: 'webp_to_png_images.zip',
                    type: 'application/zip',
                    size: zipBlob.size,
                    url: URL.createObjectURL(zipBlob),
                    isZipFile: true
                });
            }

            return results;
        } catch (e) {
            console.error('Error converting WEBP to PNG:', e);
            throw new Error('Failed to convert WEBP to PNG');
        }
    },
    // WEBP -> JPEG (white background)

    async convertWebpToJpeg() {
        try {
            const results = [];
            const images = [];

            for (const file of this.uploadedFiles) {
                const url = URL.createObjectURL(file);
                try {
                    const img = await new Promise((resolve, reject) => {
                        const i = new Image();
                        i.onload = () => resolve(i);
                        i.onerror = () => reject(new Error('Failed to load WEBP image'));
                        i.src = url;
                    });

                    const width = img.naturalWidth || img.width;
                    const height = img.naturalHeight || img.height;
                    const canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');

                    // White background for JPEG
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);

                    const outBlob = await new Promise((resolve, reject) =>
                        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/jpeg', 0.92)
                    );

                    const outUrl = URL.createObjectURL(outBlob);
                    const name = file.name.replace(/\.webp$/i, '.jpeg');
                    images.push({ name, blob: outBlob });
                    results.push({ name, type: 'image/jpeg', size: outBlob.size, url: outUrl, blob: outBlob });
                } finally {
                    URL.revokeObjectURL(url);
                }
            }

            if (images.length > 1) {
                const zipBlob = await this.createActualZip(images, 'webp_to_jpeg');
                results.unshift({
                    name: 'webp_to_jpeg_images.zip',
                    type: 'application/zip',
                    size: zipBlob.size,
                    url: URL.createObjectURL(zipBlob),
                    isZipFile: true
                });
            }

            return results;
        } catch (e) {
            console.error('Error converting WEBP to JPEG:', e);
            throw new Error('Failed to convert WEBP to JPEG');
        }
    },
    // PDF to TXT Conversion

    async convertPdfToTxt() {
        const results = [];

        // Show a processing notification
        this.showNotification('Extracting text from PDF...', 'info');

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                let extractedText = '';

                try {
                    // Create a simple text representation
                    extractedText += `PDF TEXT EXTRACTION\n`;
                    extractedText += `===================\n\n`;
                    extractedText += `File: ${file.name}\n`;
                    extractedText += `Size: ${this.formatFileSize(file.size)}\n\n`;

                    // Use PDF.js for text extraction if available
                    if (typeof pdfjsLib !== 'undefined') {
                        // Load the PDF document
                        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                        const pdf = await loadingTask.promise;
                        const numPages = pdf.numPages;

                        extractedText += `Total Pages: ${numPages}\n\n`;

                        // Extract text from each page
                        for (let i = 1; i <= numPages; i++) {
                            extractedText += `--- PAGE ${i} ---\n`;

                            try {
                                const page = await pdf.getPage(i);
                                const textContent = await page.getTextContent();

                                if (textContent.items && textContent.items.length > 0) {
                                    // Group text by lines for better formatting
                                    const textItems = textContent.items;
                                    const lines = {};

                                    for (const item of textItems) {
                                        if (item.str && item.str.trim()) {
                                            // Round the y-coordinate to group text lines
                                            const y = Math.round(item.transform[5]);
                                            if (!lines[y]) {
                                                lines[y] = [];
                                            }
                                            lines[y].push({
                                                text: item.str,
                                                x: item.transform[4]
                                            });
                                        }
                                    }

                                    // Sort lines by y-coordinate (top to bottom)
                                    const sortedYs = Object.keys(lines).sort((a, b) => b - a);

                                    // For each line, sort text items by x-coordinate (left to right)
                                    for (const y of sortedYs) {
                                        lines[y].sort((a, b) => a.x - b.x);
                                        const lineText = lines[y].map(item => item.text).join(' ').trim();
                                        if (lineText) {
                                            extractedText += lineText + '\n';
                                        }
                                    }
                                } else {
                                    extractedText += '[No text content found on this page]\n';
                                }

                                extractedText += '\n';
                            } catch (pageError) {
                                extractedText += `[Error extracting text from page ${i}: ${pageError.message}]\n\n`;
                                console.error(`Error extracting text from page ${i}:`, pageError);
                            }
                        }
                    } else {
                        // Fallback to basic extraction using pdf-lib
                        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
                        const pageCount = pdfDoc.getPageCount();

                        extractedText += `Total Pages: ${pageCount}\n\n`;
                        extractedText += `[PDF.js library not available for full text extraction]\n\n`;

                        // Try to get metadata
                        try {
                            const title = pdfDoc.getTitle();
                            const author = pdfDoc.getAuthor();
                            const subject = pdfDoc.getSubject();
                            const keywords = pdfDoc.getKeywords();

                            extractedText += `Document Information:\n`;
                            extractedText += `--------------------\n`;
                            if (title) extractedText += `Title: ${title}\n`;
                            if (author) extractedText += `Author: ${author}\n`;
                            if (subject) extractedText += `Subject: ${subject}\n`;
                            if (keywords) extractedText += `Keywords: ${keywords}\n`;
                            extractedText += `--------------------\n\n`;
                        } catch (metadataError) {
                            extractedText += `[Could not extract document metadata]\n\n`;
                        }

                        extractedText += `This is a basic text extraction. For better results, ensure PDF.js library is properly loaded.\n`;
                    }

                } catch (extractionError) {
                    console.error('PDF text extraction error:', extractionError);
                    extractedText = `Failed to extract text from "${file.name}"\n\n`;
                    extractedText += `Error: ${extractionError.message}\n\n`;
                    extractedText += `This may be due to one of the following reasons:\n`;
                    extractedText += `- The PDF contains scanned images rather than actual text\n`;
                    extractedText += `- The PDF is encrypted or password-protected\n`;
                    extractedText += `- The PDF structure is not standard or is corrupted\n\n`;
                    extractedText += `For better results, consider using specialized PDF text extraction tools.`;
                }

                // Create a downloadable text file
                const blob = new Blob([extractedText], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);

                results.push({
                    name: file.name.replace('.pdf', '.txt'),
                    type: 'text/plain',
                    size: blob.size,
                    url: url
                });

                // Show success notification
                this.showNotification(`Text extracted successfully from ${file.name}`, 'success');

            } catch (error) {
                console.error('Error converting PDF to text:', error);
                this.showNotification(`Failed to extract text from ${file.name}`, 'error');
                throw new Error(`Failed to extract text from ${file.name}: ${error.message}`);
            }
        }
        return results;
    },
    // TXT to PDF Conversion

    async convertTxtToPdf() {
        const results = [];

        for (const file of this.uploadedFiles) {
            try {
                // Read text with better error handling
                let text;
                try {
                    text = await file.text();
                } catch (readError) {
                    // Try alternative reading method for problematic files
                    const arrayBuffer = await file.arrayBuffer();
                    const decoder = new TextDecoder('utf-8', { fatal: false });
                    text = decoder.decode(arrayBuffer);
                }

                // Sanitize text - remove or replace problematic characters
                text = text
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
                    .replace(/\r\n/g, '\n') // Normalize line endings
                    .replace(/\r/g, '\n')
                    .trim();

                if (!text) {
                    throw new Error('File appears to be empty or contains no readable text');
                }

                // Create PDF document
                const pdfDoc = await PDFLib.PDFDocument.create();

                // Set up font and page dimensions
                const fontSize = 11;
                const lineHeight = fontSize * 1.4;
                const margin = 50;
                const pageWidth = 595; // A4 width
                const pageHeight = 842; // A4 height
                const textWidth = pageWidth - (margin * 2);
                const textHeight = pageHeight - (margin * 2);

                // Split text into lines and handle word wrapping
                const lines = [];
                const textLines = text.split('\n');

                for (const line of textLines) {
                    if (line.length === 0) {
                        lines.push(''); // Preserve empty lines
                        continue;
                    }

                    // Simple word wrapping - split long lines
                    const words = line.split(' ');
                    let currentLine = '';

                    for (const word of words) {
                        const testLine = currentLine ? `${currentLine} ${word}` : word;

                        // Rough character width estimation (more accurate than before)
                        const estimatedWidth = testLine.length * (fontSize * 0.6);

                        if (estimatedWidth <= textWidth) {
                            currentLine = testLine;
                        } else {
                            if (currentLine) {
                                lines.push(currentLine);
                                currentLine = word;
                            } else {
                                // Word is too long, split it
                                const maxCharsPerLine = Math.floor(textWidth / (fontSize * 0.6));
                                for (let i = 0; i < word.length; i += maxCharsPerLine) {
                                    lines.push(word.substring(i, i + maxCharsPerLine));
                                }
                                currentLine = '';
                            }
                        }
                    }

                    if (currentLine) {
                        lines.push(currentLine);
                    }
                }

                // Calculate lines per page
                const linesPerPage = Math.floor(textHeight / lineHeight);
                let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
                let currentY = pageHeight - margin;
                let lineCount = 0;

                // Add text to PDF with proper pagination
                for (const line of lines) {
                    // Check if we need a new page
                    if (lineCount >= linesPerPage) {
                        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
                        currentY = pageHeight - margin;
                        lineCount = 0;
                    }

                    try {
                        // Draw text line by line for better control
                        currentPage.drawText(line || ' ', {
                            x: margin,
                            y: currentY,
                            size: fontSize,
                            maxWidth: textWidth,
                            lineHeight: lineHeight
                        });
                    } catch (drawError) {
                        // If drawing fails, try with sanitized text
                        const sanitizedLine = line.replace(/[^\x20-\x7E\n]/g, '?'); // Replace non-printable chars
                        currentPage.drawText(sanitizedLine || ' ', {
                            x: margin,
                            y: currentY,
                            size: fontSize,
                            maxWidth: textWidth,
                            lineHeight: lineHeight
                        });
                    }

                    currentY -= lineHeight;
                    lineCount++;
                }

                const pdfBytes = await pdfDoc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);

                results.push({
                    name: file.name.replace(/\.txt$/i, '.pdf'),
                    type: 'application/pdf',
                    size: blob.size,
                    url: url
                });

                this.showNotification(`Successfully converted ${file.name} to PDF`, 'success');

            } catch (error) {
                console.error('Error converting text to PDF:', error);
                this.showNotification(`Failed to convert ${file.name}: ${error.message}`, 'error');

                // Continue with other files instead of stopping completely
                continue;
            }
        }

        if (results.length === 0) {
            throw new Error('Failed to convert any text files to PDF');
        }

        return results;
    },
    // Dynamically load external scripts when needed

    loadScript(url) {
        return new Promise((resolve, reject) => {
            const existing = Array.from(document.getElementsByTagName('script')).find(s => s.src === url);
            if (existing) {
                if (existing.dataset.loaded === 'true') return resolve();
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', () => reject(new Error('Failed to load script: ' + url)));
                return;
            }
            const script = document.createElement('script');
            script.src = url;
            script.async = true;
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                resolve();
            });
            script.addEventListener('error', () => reject(new Error('Failed to load script: ' + url)));
            document.head.appendChild(script);
        });
    },

    async ensureHtmlRenderingLibs() {
        // Try multiple CDNs to avoid network/CSP blocks
        if (!window.jspdf) {
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
            ]);
        }
        if (!window.html2canvas) {
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
            ]);
        }
        if (!window.jspdf || !window.html2canvas) {
            throw new Error('Required rendering libraries failed to load');
        }
    },
    // New: Ensure SheetJS (XLSX) is available

    async ensureSheetJSLib() {
        if (!window.XLSX) {
            const loaded = await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
            ]);
            if (!loaded || !window.XLSX) {
                throw new Error('Failed to load Excel parsing library');
            }
        }
    },
    // New: Ensure ExcelJS (for styled XLSX rendering) is available

    async ensureExcelJSLib() {
        if (!window.ExcelJS) {
            const loaded = await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js',
            ]);
            if (!loaded || !window.ExcelJS) {
                throw new Error('Failed to load ExcelJS library');
            }
        }
    },
    // New: Convert Excel (XLS/XLSX) to PDF

    async convertExcelToPdf() {
        const results = [];
        await this.ensureHtmlRenderingLibs();
        const { jsPDF } = window.jspdf;

        // Defaults (no UI): convert all sheets, portrait, no selectable text
        const sheetMode = 'all';

        // Libraries are loaded per file based on extension

        for (const file of this.uploadedFiles) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const isXlsx = /\.xlsx$/i.test(file.name);
                if (isXlsx) {
                    await this.ensureExcelJSLib();
                } else {
                    await this.ensureSheetJSLib();
                }
                const h2cScale = isXlsx ? 3 : 2;
                const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
                const pageWidth = pdf.internal.pageSize.getWidth();
                const pageHeight = pdf.internal.pageSize.getHeight();

                // Offscreen container
                const container = document.createElement('div');
                container.style.position = 'fixed';
                container.style.left = '-10000px';
                container.style.top = '0';
                container.style.width = '794px';
                container.style.background = '#ffffff';
                container.style.color = '#000000';
                container.style.padding = '16px';
                container.style.boxSizing = 'border-box';

                // Base styles for both modes
                const style = document.createElement('style');
                style.textContent = `
                    .xls-sheet { page-break-after: always; }
                    .xls-sheet:last-child { page-break-after: auto; }
                    table { border-collapse: collapse; width: auto; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-size: 12px; table-layout: fixed; }
                    td, th { border: 1px solid #ccc; padding: 6px 8px; overflow: hidden; text-overflow: ellipsis; }
                    caption { text-align: left; font-weight: 600; margin: 8px 0; }
                `;
                container.appendChild(style);

                if (isXlsx) {
                    // Enhanced fidelity using ExcelJS
                    const wb = new window.ExcelJS.Workbook();
                    await wb.xlsx.load(arrayBuffer);
                    const allWorksheets = wb.worksheets || [];
                    if (allWorksheets.length === 0) throw new Error('No sheets found');
                    const chosen = sheetMode === 'all' ? allWorksheets : [allWorksheets[0]];
                    chosen.forEach(ws => {
                        const wrap = this.buildExcelWorksheetHTML(ws, ws.name);
                        wrap.classList.add('xls-sheet');
                        container.appendChild(wrap);
                    });
                } else {
                    // Standard mode via SheetJS HTML rendering
                    const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
                    const sheetNames = workbook.SheetNames || [];
                    if (sheetNames.length === 0) throw new Error('No sheets found');
                    const chosenSheets = sheetMode === 'all' ? sheetNames : [sheetNames[0]];
                    chosenSheets.forEach((name) => {
                        const sheet = workbook.Sheets[name];
                        const html = window.XLSX.utils.sheet_to_html(sheet, { header: `<caption>${name}</caption>` });
                        const wrap = document.createElement('div');
                        wrap.className = 'xls-sheet';
                        wrap.innerHTML = html;
                        container.appendChild(wrap);
                    });
                }

                document.body.appendChild(container);

                const nodes = Array.from(container.querySelectorAll('.xls-sheet'));
                let firstPage = true;
                for (const node of nodes) {
                    // Capture the full natural width of the sheet to avoid horizontal cut-off
                    const naturalWidth = Math.max(node.scrollWidth, node.offsetWidth);
                    // Cap canvas pixel width to keep memory in check while preserving width
                    const canvasTargetPx = Math.min(naturalWidth, pageWidth * h2cScale);
                    const scaleForCanvas = canvasTargetPx / naturalWidth; // results in canvas.width ~= canvasTargetPx
                    // Ensure node width reflects full content so html2canvas can capture it
                    node.style.width = naturalWidth + 'px';
                    const canvas = await window.html2canvas(node, {
                        backgroundColor: '#ffffff',
                        scale: scaleForCanvas,
                        useCORS: true,
                        logging: false,
                        width: naturalWidth
                    });
                    const imgWidth = pageWidth;
                    const ratio = imgWidth / canvas.width;
                    const pageHeightInPxAtScale = pageHeight / ratio;
                    let renderedHeight = 0;
                    while (renderedHeight < canvas.height) {
                        const sliceHeight = Math.min(pageHeightInPxAtScale, canvas.height - renderedHeight);
                        const pageCanvas = document.createElement('canvas');
                        pageCanvas.width = canvas.width;
                        pageCanvas.height = sliceHeight;
                        const ctx = pageCanvas.getContext('2d');
                        ctx.drawImage(canvas, 0, renderedHeight, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

                        const pdfImgHeight = sliceHeight * ratio;
                        if (!firstPage) {
                            pdf.addPage({ orientation: 'p', format: 'a4', unit: 'pt' });
                        }
                        // Draw the visual image first
                        pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, pdfImgHeight);
                        firstPage = false;
                        renderedHeight += sliceHeight;
                    }
                }

                document.body.removeChild(container);
                const blob = pdf.output('blob');
                const url = URL.createObjectURL(blob);
                const outputName = file.name.replace(/\.(xls|xlsx)$/i, '') + '.pdf';
                results.push({ name: outputName, type: 'application/pdf', size: blob.size, url });
                this.showNotification(`Successfully converted ${file.name} to PDF`, 'success');
            } catch (error) {
                console.error('Error converting Excel (XLS/XLSX) to PDF:', error);
                this.showNotification(`Failed to convert ${file.name}: ${error.message}`,'error');
                continue;
            }
        }

        if (results.length === 0) {
            throw new Error('Failed to convert any Excel (XLS/XLSX) files to PDF');
        }

        return results;
    },
    // Ensure PPTX.js and dependencies are available (force-compatible versions)

    async ensurePptxLibs() {
        // Remove any stale/invalid PPTXjs assets (e.g., unpkg npm placeholder causing MIME errors)
        try {
            const badCss = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(l => {
                const href = (l && l.href) || '';
                return href.includes('unpkg.com/pptxjs') || href.includes('/npm/pptxjs@') || l.id === 'pptxjs-css';
            });
            badCss.forEach(l => { try { l.parentNode && l.parentNode.removeChild(l); } catch (_) {} });
            const badJs = Array.from(document.querySelectorAll('script')).filter(s => {
                const src = (s && s.src) || '';
                return (
                    src.includes('unpkg.com/pptxjs') || src.includes('/npm/pptxjs@') ||
                    src.includes('unpkg.com/filereader.js') || src.includes('/npm/filereader.js@')
                );
            });
            badJs.forEach(s => { try { s.parentNode && s.parentNode.removeChild(s); } catch (_) {} });
        } catch (_) {}

        // Stylesheets first (with fallbacks)
        await this.loadFirstAvailableStylesheet([
            // Prefer local/vendor first to avoid CSP/CDN issues
            '/vendor/pptxjs/pptxjs.css',
            // Reliable GitHub mirrors that set correct content-type
            'https://rawcdn.githack.com/meshesha/PPTXjs/master/css/pptxjs.css?cb=' + Date.now(),
            'https://cdn.statically.io/gh/meshesha/PPTXjs/master/css/pptxjs.css?cb=' + Date.now(),
            'https://gitcdn.link/cdn/meshesha/PPTXjs/master/css/pptxjs.css?cb=' + Date.now(),
            // jsDelivr as a later fallback (can mis-serve MIME in some environments)
            'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/css/pptxjs.css?cb=' + Date.now(),
        ], 'pptxjs-css');

        await this.loadFirstAvailableStylesheet([
            'https://unpkg.com/nvd3/build/nv.d3.min.css',
            'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/css/nv.d3.min.css',
            'https://cdnjs.cloudflare.com/ajax/libs/nvd3/1.8.6/nv.d3.min.css',
            '/vendor/nvd3/nv.d3.min.css',
        ], 'pptxjs-nvd3-css');

        // Always provision a jQuery 1.11.3 instance for PPTXjs
        if (!window.__pptxJQ) {
            const prev$ = window.jQuery;
            const prevDollar = window.$;
            await this.loadFirstAvailableScript([
                'https://code.jquery.com/jquery-1.11.3.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/jquery/1.11.3/jquery.min.js',
            ]);
            if (!window.jQuery) throw new Error('Failed to load jQuery 1.11.3 for PPTXjs');
            // noConflict(true) returns the 1.11 instance and restores prior globals
            const j11 = window.jQuery.noConflict(true);
            window.__pptxJQ = j11;
            // restore previous globals (if any) were restored by noConflict(true)
            if (prev$) { window.jQuery = prev$; }
            if (prevDollar) { window.$ = prevDollar; }
        }

        // Ensure JSZip v2.x for PPTXjs
        if (!window.__pptxJSZip) {
            const prevZip = window.JSZip;
            await this.loadFirstAvailableScript([
                'https://cdn.jsdelivr.net/npm/jszip@2.6.1/dist/jszip.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/jszip/2.6.1/jszip.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/jszip/2.5.0/jszip.min.js',
                '/vendor/jszip/jszip.min.js',
            ]);
            if (!window.JSZip || (window.JSZip.version && !window.JSZip.version.startsWith('2'))) {
                throw new Error('Failed to provision JSZip v2.x for PPTXjs');
            }
            window.__pptxJSZip = window.JSZip;
            // do not keep v2 on the global permanently; other parts may rely on v3
            if (prevZip) window.JSZip = prevZip;
        }

        // Ensure jszip-utils (needed by some PPTXjs code paths for fetching URLs)
        if (typeof window.JSZipUtils === 'undefined') {
            await this.loadFirstAvailableScript([
                // Prefer local/vendor first
                '/vendor/jszip-utils/jszip-utils.min.js',
                // Reliable GitHub mirrors that set correct content-type
                'https://rawcdn.githack.com/Stuk/jszip-utils/master/dist/jszip-utils.min.js',
                'https://cdn.statically.io/gh/Stuk/jszip-utils/master/dist/jszip-utils.min.js',
                'https://gitcdn.link/cdn/Stuk/jszip-utils/master/dist/jszip-utils.min.js',
                // cdnjs as an alternative
                'https://cdnjs.cloudflare.com/ajax/libs/jszip-utils/0.0.2/jszip-utils.min.js',
                // jsDelivr as a later fallback
                'https://cdn.jsdelivr.net/gh/Stuk/jszip-utils/dist/jszip-utils.min.js',
            ]).catch(() => {/* continue without explicit utils if unavailable */});
        }

        // FileReader.js polyfill (non-fatal if not available in modern browsers)
        if (!window.FileReaderJS) {
            // Load with jQuery 1.11 as the global to maximize compatibility
            const saved$FR = window.jQuery; const savedDollarFR = window.$; const savedZipFR = window.JSZip;
            window.jQuery = window.$ = window.__pptxJQ || window.jQuery;
            window.JSZip = window.__pptxJSZip || window.JSZip;
            await this.loadFirstAvailableScript([
                // Prefer local/vendor first
                '/vendor/filereader/filereader.min.js',
                '/vendor/filereader/filereader.js',
                // Reliable GitHub mirrors that set correct content-type
                'https://rawcdn.githack.com/meshesha/PPTXjs/master/js/filereader.js',
                'https://cdn.statically.io/gh/meshesha/PPTXjs/master/js/filereader.js',
                'https://gitcdn.link/cdn/meshesha/PPTXjs/master/js/filereader.js',
                // jsDelivr as a later fallback
                'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/filereader.js',
            ]).catch(() => {/* continue without explicit polyfill */});
            // restore
            window.jQuery = saved$FR; window.$ = savedDollarFR; window.JSZip = savedZipFR;
        }

        // d3 and nvd3 (for charts rendering inside slides)
        if (!window.d3) {
            await this.loadFirstAvailableScript([
                'https://unpkg.com/d3@3.5.17/d3.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/d3/3.5.17/d3.min.js',
                '/vendor/d3/d3.min.js',
            ]);
        }
        if (!window.nv) {
            await this.loadFirstAvailableScript([
                'https://unpkg.com/nvd3@1.8.6/build/nv.d3.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/nvd3/1.8.6/nv.d3.min.js',
                '/vendor/nvd3/nv.d3.min.js',
            ]);
        }

        // Load PPTXjs and divs2slides under the jQuery 1.11 + JSZip v2 context
        {
            const saved$ = window.jQuery; const savedDollar = window.$; const savedZip = window.JSZip;
            // Clear any previous plugin/global state to avoid stale 'app'
            try { delete window.PPTXJS; } catch (_) { window.PPTXJS = undefined; }
            try { delete window.app; } catch (_) { window.app = undefined; }
            try { if (window.__pptxJQ && window.__pptxJQ.fn) delete window.__pptxJQ.fn.pptxToHtml; } catch (_) {}

            window.jQuery = window.$ = window.__pptxJQ; // ensure plugin binds to 1.11
            window.JSZip = window.__pptxJSZip;          // ensure v2 API during definition

            const cb = 'cb=' + Date.now();
            const ok1 = await this.loadFirstAvailableScript([
                // Prefer local/vendor first
                '/vendor/pptxjs/pptxjs.js',
                // Reliable GitHub mirrors that set correct content-type
                'https://rawcdn.githack.com/meshesha/PPTXjs/master/dist/pptxjs.min.js?' + cb,
                'https://rawcdn.githack.com/meshesha/PPTXjs/master/js/pptxjs.js?' + cb,
                'https://cdn.statically.io/gh/meshesha/PPTXjs/master/dist/pptxjs.min.js?' + cb,
                'https://cdn.statically.io/gh/meshesha/PPTXjs/master/js/pptxjs.js?' + cb,
                'https://gitcdn.link/cdn/meshesha/PPTXjs/master/dist/pptxjs.min.js?' + cb,
                'https://gitcdn.link/cdn/meshesha/PPTXjs/master/js/pptxjs.js?' + cb,
                // jsDelivr as a later fallback
                'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/dist/pptxjs.min.js?' + cb,
                'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/pptxjs.js?' + cb,
            ]);
            const ok2 = await this.loadFirstAvailableScript([
                // Prefer local/vendor first
                '/vendor/pptxjs/divs2slides.js',
                // Reliable GitHub mirrors that set correct content-type
                'https://rawcdn.githack.com/meshesha/PPTXjs/master/dist/divs2slides.min.js?' + cb,
                'https://rawcdn.githack.com/meshesha/PPTXjs/master/js/divs2slides.js?' + cb,
                'https://cdn.statically.io/gh/meshesha/PPTXjs/master/dist/divs2slides.min.js?' + cb,
                'https://cdn.statically.io/gh/meshesha/PPTXjs/master/js/divs2slides.js?' + cb,
                'https://gitcdn.link/cdn/meshesha/PPTXjs/master/dist/divs2slides.min.js?' + cb,
                'https://gitcdn.link/cdn/meshesha/PPTXjs/master/js/divs2slides.js?' + cb,
                // jsDelivr as a later fallback
                'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/dist/divs2slides.min.js?' + cb,
                'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/divs2slides.js?' + cb,
            ]);
            // restore globals immediately
            window.jQuery = saved$; window.$ = savedDollar; window.JSZip = savedZip;
            if (!ok1 || !ok2) throw new Error('Failed to load PPTXjs libraries');
        }

        if (!(window.__pptxJQ && window.__pptxJQ.fn && window.__pptxJQ.fn.pptxToHtml)) {
            throw new Error('PPTX rendering plugin failed to initialize');
        }
    },
    // Wait until PPTXjs has rendered slides into the container

    waitForPptxRender(container, timeoutMs = 45000) {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const check = () => {
                const slides = container.querySelectorAll('.slide, .pptxjs-slide, div[id^="slide-"], .pptx-slide, .ppt-slide');
                const loading = container.querySelectorAll('.pptx-loading, .loading, .pptxjs-loading');
                // Resolve when at least one slide-like element exists and no loading indicators remain
                if (slides.length > 0 && (loading.length === 0 || (Date.now() - start) > 10000)) {
                    resolve();
                    return;
                }
                // If plugin injected an explicit error message, fail early
                const errEl = container.querySelector('.pptxjs-error, .pptx-error, .error');
                if (errEl) {
                    reject(new Error(errEl.textContent && errEl.textContent.trim() ? errEl.textContent.trim() : 'PPTX rendering error'));
                    return;
                }
                if (Date.now() - start > timeoutMs) {
                    reject(new Error('Timed out while rendering PPTX'));
                    return;
                }
                setTimeout(check, 300);
            };
            check();
        });
    },
    // Ensure all images within rendered slides are fully loaded before rasterizing

    ensureAllSlideImagesLoaded(container, timeoutMs = 20000) {
        const start = Date.now();
        return new Promise((resolve) => {
            const images = Array.from(container.querySelectorAll('.slide img, .pptxjs-slide img, div[id^="slide-"] img, .pptx-slide img, .ppt-slide img'));
            if (images.length === 0) return resolve();

            const pending = new Set();
            const onDone = () => {
                if (pending.size === 0) return resolve();
                if (Date.now() - start > timeoutMs) return resolve();
            };
            images.forEach(img => {
                if (img.complete && img.naturalWidth > 0) return; // already loaded
                pending.add(img);
                const clear = () => { pending.delete(img); onDone(); };
                img.addEventListener('load', clear, { once: true });
                img.addEventListener('error', clear, { once: true });
            });
            if (pending.size === 0) return resolve();

            const tick = () => {
                // periodically check in case events were missed
                for (const img of Array.from(pending)) {
                    if ((img.complete && img.naturalWidth > 0) || (img.naturalWidth === 0 && img.complete)) {
                        pending.delete(img);
                    }
                }
                onDone();
                if (pending.size > 0 && (Date.now() - start) <= timeoutMs) {
                    setTimeout(tick, 250);
                }
            };
            setTimeout(tick, 250);
        });
    },

    getPptSlideSize(slide) {
        const rect = slide && slide.getBoundingClientRect ? slide.getBoundingClientRect() : null;
        const widthPx = Math.max(
            1,
            Math.round((rect && rect.width) || slide?.scrollWidth || slide?.clientWidth || 1200)
        );
        const heightPx = Math.max(
            1,
            Math.round((rect && rect.height) || slide?.scrollHeight || slide?.clientHeight || 675)
        );
        // CSS px are 1/96 inch; PDF points are 1/72 inch.
        const pxToPt = 72 / 96;
        return {
            widthPx,
            heightPx,
            widthPt: Math.max(1, widthPx * pxToPt),
            heightPt: Math.max(1, heightPx * pxToPt),
            orientation: widthPx >= heightPx ? 'l' : 'p'
        };
    },

    downscaleCanvasIfNeeded(canvas, maxSidePx = 2800) {
        const width = canvas?.width || 0;
        const height = canvas?.height || 0;
        const longestSide = Math.max(width, height);
        if (!longestSide || longestSide <= maxSidePx) return canvas;

        const ratio = maxSidePx / longestSide;
        const targetWidth = Math.max(1, Math.round(width * ratio));
        const targetHeight = Math.max(1, Math.round(height * ratio));
        const out = document.createElement('canvas');
        out.width = targetWidth;
        out.height = targetHeight;
        const ctx = out.getContext('2d');
        if (!ctx) return canvas;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
        return out;
    },

    canvasHasTransparencySampled(canvas) {
        const width = canvas?.width || 0;
        const height = canvas?.height || 0;
        if (!width || !height) return false;

        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return false;

            const sampleCols = 24;
            const sampleRows = 24;
            const stepX = Math.max(1, Math.floor(width / sampleCols));
            const stepY = Math.max(1, Math.floor(height / sampleRows));

            for (let y = 0; y < height; y += stepY) {
                for (let x = 0; x < width; x += stepX) {
                    const alpha = ctx.getImageData(x, y, 1, 1).data[3];
                    if (alpha < 255) return true;
                }
            }
        } catch (_) {
            // Ignore read failures and assume opaque.
        }
        return false;
    },

    getPptJpegQuality(canvas) {
        const pixels = (canvas?.width || 0) * (canvas?.height || 0);
        const megaPixels = pixels / 1000000;
        if (megaPixels <= 2.5) return 0.88;
        if (megaPixels <= 5.5) return 0.84;
        return 0.8;
    },
    // Convert PPTX to PDF using PPTXjs + html2canvas + jsPDF

    async convertPptxToPdf() {
        await this.ensureHtmlRenderingLibs();
        await this.ensurePptxLibs();
        const results = [];

        const { jsPDF } = window.jspdf;
        // Keep render resolution high enough for text while avoiding massive PDFs.
        const h2cScale = Math.min(2.2, Math.max(1.8, window.devicePixelRatio || 2));

        for (const file of this.uploadedFiles) {
            // Guard: PPTXjs supports .pptx; legacy .ppt is not supported reliably
            if (/\.ppt$/i.test(file.name) && !/\.pptx$/i.test(file.name)) {
                throw new Error('Legacy .ppt files are not supported by the in-browser renderer. Please convert to .pptx and try again.');
            }

            // Offscreen root for PPTX rendering (kept visible for correct measurements)
            const root = document.createElement('div');
            root.id = 'slide-resolte-contaniner'; // matches PPTXjs demo id (typo intentional in lib)
            root.style.position = 'fixed';
            root.style.left = '-10000px';
            root.style.top = '0';
            root.style.width = 'auto';
            root.style.background = 'transparent';
            root.style.padding = '0';
            root.style.margin = '0';
            // Do not hide with visibility/opacity to allow proper layout calculations

            // Isolate slide rendering from app styles to keep PPT styling faithful.
            const isolationStyle = document.createElement('style');
            isolationStyle.textContent = `
                #slide-resolte-contaniner, #slide-resolte-contaniner * {
                    box-sizing: content-box !important;
                }
                #slide-resolte-contaniner img {
                    max-width: none !important;
                    max-height: none !important;
                }
                #slide-resolte-contaniner .slide,
                #slide-resolte-contaniner .pptxjs-slide {
                    margin: 0 !important;
                    border: 0 !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                }
                #slide-resolte-contaniner #all_slides_warpper {
                    transform: none !important;
                    height: auto !important;
                }
            `;
            root.appendChild(isolationStyle);

            const renderDiv = document.createElement('div');
            root.appendChild(renderDiv);
            document.body.appendChild(root);

            let savedZip, saved$, savedDollar;
            try {
                const pptxJQ = window.__pptxJQ || window.jQuery;
                pptxJQ(renderDiv).empty();

                // Ensure JSZip v2 and jQuery 1.11 are the globals used by the plugin at runtime
                savedZip = window.JSZip;
                saved$ = window.jQuery;
                savedDollar = window.$;
                window.JSZip = window.__pptxJSZip || window.JSZip;
                window.jQuery = window.$ = window.__pptxJQ || window.jQuery;

                // Debug: log versions and chosen path
                try {
                    console.info('PPTXjs env:', {
                        jQuery: (window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery) || 'unknown',
                        JSZip: (window.JSZip && window.JSZip.version) || 'unknown',
                        JSZipUtils: typeof window.JSZipUtils !== 'undefined',
                    });
                } catch (_) {}

                // Use a preprocessed PPTX (adds missing app.xml and content types) if available
                const patchedBlob = await this.preprocessPptx(file);
                const patchedFile = patchedBlob
                    ? new File([patchedBlob], file.name, {
                        type: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        lastModified: file.lastModified || Date.now()
                      })
                    : file;

                // Preferred: FileReader path via hidden input (robust vs. XHR/MIME)
                let rendered = false;
                if (window.FileReaderJS) {
                    try {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.style.display = 'none';
                        input.id = `pptx-file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        root.appendChild(input);

                        (window.jQuery || pptxJQ)(renderDiv).empty();
                        (window.jQuery || pptxJQ)(renderDiv).pptxToHtml({
                            fileInputId: input.id,
                            slidesScale: '',
                            slideMode: false,
                            keyBoardShortCut: false,
                            mediaProcess: true,
                        });

                        let assigned = false;
                        try {
                            const dt = new DataTransfer();
                            dt.items.add(patchedFile);
                            input.files = dt.files;
                            assigned = input.files && input.files.length > 0;
                        } catch (_) { assigned = false; }

                        if (!assigned) {
                            await new Promise((resolve) => {
                                const onChange = () => { resolve(); };
                                input.addEventListener('change', onChange, { once: true });
                                try { input.click(); } catch (_) {}
                                setTimeout(resolve, 10000);
                            });
                            if (!input.files || input.files.length === 0) {
                                throw new Error('Please select the PPTX file in the prompt to continue');
                            }
                        } else {
                            (window.jQuery || pptxJQ)(input).trigger('change');
                        }

                        await this.waitForPptxRender(root, 90000);
                        await this.waitForRenderedContentAssets(root, 30000);
                        await this.ensureAllSlideImagesLoaded(root, 30000);
                        rendered = true;
                    } catch (eFI) {
                        // fall through to URL path
                    }
                }

                // Fallback: object URL via pptxFileUrl
                if (!rendered) {
                    let objectUrl = URL.createObjectURL(patchedFile);
                    try {
                        (window.jQuery || pptxJQ)(renderDiv).pptxToHtml({
                            pptxFileUrl: objectUrl,
                            slidesScale: '',
                            slideMode: false,
                            keyBoardShortCut: false,
                            mediaProcess: true,
                        });
                        await this.waitForPptxRender(root, 90000);
                        await this.waitForRenderedContentAssets(root, 30000);
                        await this.ensureAllSlideImagesLoaded(root, 30000);
                        rendered = true;
                    } finally {
                        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
                    }
                }

                const slides = root.querySelectorAll('.slide, .pptxjs-slide');
                if (!slides || slides.length === 0) {
                    throw new Error('No slides found after rendering (PPTX load may have failed)');
                }

                const firstSize = this.getPptSlideSize(slides[0]);
                // Match native slide dimensions instead of forcing A4, which avoids letterboxing and preserves layout.
                const pdf = new jsPDF({
                    orientation: firstSize.orientation,
                    unit: 'pt',
                    format: [firstSize.widthPt, firstSize.heightPt],
                    compress: true,
                    putOnlyUsedFonts: true
                });

                let pageIndex = 0;
                for (const slide of slides) {
                    const size = this.getPptSlideSize(slide);
                    if (pageIndex > 0) {
                        pdf.addPage([size.widthPt, size.heightPt], size.orientation);
                    }

                    // Render slide to canvas preserving its own background (including images/gradients)
                    const rawCanvas = await window.html2canvas(slide, {
                        backgroundColor: null, // do not force a solid color; keep actual background
                        scale: h2cScale,
                        useCORS: true,
                        logging: false,
                        width: size.widthPx,
                        height: size.heightPx,
                        windowWidth: size.widthPx,
                        windowHeight: size.heightPx,
                        scrollX: 0,
                        scrollY: 0,
                    });

                    const canvas = this.downscaleCanvasIfNeeded(rawCanvas, 2800);
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    const hasTransparency = this.canvasHasTransparencySampled(canvas);
                    const useJpeg = !hasTransparency;
                    const imgData = useJpeg
                        ? canvas.toDataURL('image/jpeg', this.getPptJpegQuality(canvas))
                        : canvas.toDataURL('image/png');

                    pdf.addImage(
                        imgData,
                        useJpeg ? 'JPEG' : 'PNG',
                        0,
                        0,
                        pageWidth,
                        pageHeight,
                        undefined,
                        useJpeg ? 'MEDIUM' : 'FAST'
                    );
                    pageIndex++;
                }

                const outBlob = pdf.output('blob');
                const outName = file.name.replace(/\.(pptx|ppt)$/i, '') + '.pdf';
                results.push({
                    name: outName,
                    type: 'application/pdf',
                    size: outBlob.size,
                    url: URL.createObjectURL(outBlob)
                });
            } catch (err) {
                console.error('PPTX->PDF error:', err);
                throw err;
            } finally {
                // Restore any globals we swapped and revoke URLs
                try { if (typeof savedZip !== 'undefined') window.JSZip = savedZip; } catch (_) {}
                try { if (typeof saved$ !== 'undefined') window.jQuery = saved$; } catch (_) {}
                try { if (typeof savedDollar !== 'undefined') window.$ = savedDollar; } catch (_) {}
                try {
                    const imgs = renderDiv ? renderDiv.querySelectorAll('img') : [];
                    imgs && imgs.forEach(img => { if (img.src && img.src.startsWith('blob:')) { try { URL.revokeObjectURL(img.src); } catch (_) {} } });
                } catch (_) {}
                if (root && root.parentNode) root.parentNode.removeChild(root);
            }
        }

        if (results.length === 0) {
            throw new Error('Failed to convert any PPTX files to PDF');
        }
        return results;
    },

    // Helper: load stylesheet once
});
