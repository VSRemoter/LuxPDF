/* Split from script.js */
Object.assign(PDFConverterPro.prototype, {
    init() {
        this.bindEvents();
        this.setupDragAndDrop();
        this.loadLastUsedTool();
    },
    // Method to setup tool-specific pages

    setupToolSpecificPage() {
        // Fallback: infer tool name from URL on tool pages
        if (!this.currentTool) {
            const pageName = (window.location.pathname.split('/').pop() || '').toLowerCase();
            if (pageName.endsWith('.html')) {
                this.currentTool = pageName.replace('.html', '');
            }
        }
        if (!this.currentTool) return;

        // Compute tool config once
        const toolConfig = this.getToolConfig(this.currentTool);

        // Set file input accept attribute based on tool
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.accept = toolConfig.accept;
        }

        // Hide big hero header on tool pages and inject a compact title above the upload area
        try {
            const hero = document.querySelector('section.hero');
            if (hero) hero.style.display = 'none';

            // Ensure an inline title exists and is placed correctly
            let inlineTitle = document.querySelector('.tool-inline-title');
            if (!inlineTitle) {
                inlineTitle = document.createElement('div');
                inlineTitle.className = 'tool-inline-title';
            }
            inlineTitle.textContent = toolConfig.title || 'Tool';

            const uploadArea = document.getElementById('upload-area');
            const toolInterface = document.querySelector('.tool-interface');
            const toolsContainer = document.querySelector('.tools-section .container') || document.querySelector('.tools-section');

            if (uploadArea && uploadArea.parentNode && inlineTitle.parentNode !== uploadArea.parentNode) {
                uploadArea.parentNode.insertBefore(inlineTitle, uploadArea);
            } else if (toolInterface && inlineTitle.parentNode !== toolInterface) {
                toolInterface.insertBefore(inlineTitle, toolInterface.firstChild);
            } else if (toolsContainer && inlineTitle.parentNode !== toolsContainer) {
                toolsContainer.insertBefore(inlineTitle, toolsContainer.firstChild);
            } else if (!inlineTitle.parentNode) {
                // Fallback: append to main
                const main = document.querySelector('main, .main') || document.body;
                main.prepend(inlineTitle);
            }
        } catch (_) { /* noop */ }

        // Setup drag and drop for the tool page
        this.setupDragAndDrop();

        // Setup tool options for the current tool
        this.setupToolOptions(this.currentTool);

        // Update process button before binding events
        this.updateProcessButton();

        // Bind events for the tool page as the last step
        this.bindToolPageEvents();

        // Clear any existing files and reset state
        this.uploadedFiles = [];
        this.watermarkImageAsset = null;
        this.clearFileList();
        this.clearResults();
        this.hideProgress();
    },

    bindToolPageEvents() {
        // Ensure file input events are properly bound
        this.bindFileInputEvents();

        // Process button
        const processBtn = document.getElementById('process-btn');
        if (processBtn) {
            processBtn.addEventListener('click', () => {
                // Diagnostic logging
                console.log('Sending Plausible event for tool:', this.currentTool);

                // Track button click in Plausible
                if (window.plausible) {
                    setTimeout(() => {
                        window.plausible('ProcessButtonClick', { props: { tool: this.currentTool } });
                        this.processFiles(); // Start processing after sending the event
                    }, 0);
                } else {
                    // Fallback for when Plausible is not available (e.g., blocked)
                    this.processFiles();
                }
            });
        }

        // Tool-specific event listeners
        if (this.currentTool === 'split-pdf') {
            const splitMethod = document.getElementById('split-method');
            if (splitMethod) {
                splitMethod.addEventListener('change', (e) => {
                    const rangeGroup = document.getElementById('page-range-group');
                    if (rangeGroup) {
                        rangeGroup.style.display = e.target.value === 'range' ? 'block' : 'none';
                    }
                });
            }
        }

        if (this.currentTool === 'sort-pages') {
            // Reverse button listener is set up in setupToolOptions
            this.setupReverseButtonListener();
        }
    },
    // Helper: parse SVG dims from width/height or viewBox

    getSvgDimensions(svgText) {
        const w = svgText.match(/\bwidth\s*=\s*"([^"]+)"/i)?.[1];
        const h = svgText.match(/\bheight\s*=\s*"([^"]+)"/i)?.[1];
        const vb = svgText.match(/\bviewBox\s*=\s*"([^"]+)"/i)?.[1];
        const toPx = (v) => {
            if (!v) return null;
            const s = String(v).trim();
            const n = parseFloat(s);
            if (Number.isNaN(n)) return null;
            if (s.endsWith('px')) return n;
            if (s.endsWith('pt')) return n * (96/72);
            if (s.endsWith('in')) return n * 96;
            if (s.endsWith('cm')) return n * (96/2.54);
            if (s.endsWith('mm')) return n * (96/25.4);
            return n;
        };
        let width = toPx(w); let height = toPx(h);
        if ((!width || !height) && vb) {
            const p = vb.split(/\s+/).map(Number);
            if (p.length === 4) { width = width || p[2]; height = height || p[3]; }
        }
        width = Math.max(1, Math.floor(width || 1024));
        height = Math.max(1, Math.floor(height || 1024));
        const MAX = 4096; if (width>MAX || height>MAX){ const s=Math.min(MAX/width, MAX/height); width=Math.floor(width*s); height=Math.floor(height*s);} 
        return { width, height };
    },
    // SVG -> PNG

    async convertSvgToPng() {
        try {
            const results = []; const images=[];
            for (const file of this.uploadedFiles) {
                let svg = await file.text();
                if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg(\s|>)/i, (m)=>`<svg xmlns="http://www.w3.org/2000/svg"${m==='>'?'':' '}`);
                const { width, height } = this.getSvgDimensions(svg);
                const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                try {
                    const img = await new Promise((res, rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('Failed to load SVG')); i.src=url; });
                    const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height; const ctx=canvas.getContext('2d');
                    ctx.drawImage(img,0,0,width,height);
                    const outBlob = await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('toBlob failed')),'image/png'));
                    const outUrl = URL.createObjectURL(outBlob); const name = file.name.replace(/\.svg$/i,'.png');
                    images.push({ name, blob: outBlob }); results.push({ name, type:'image/png', size: outBlob.size, url: outUrl, blob: outBlob });
                } finally { URL.revokeObjectURL(url); }
            }
            if (images.length>1){ const zipBlob=await this.createActualZip(images,'svg_to_png'); results.unshift({ name:'svg_to_png_images.zip', type:'application/zip', size:zipBlob.size, url:URL.createObjectURL(zipBlob), isZipFile:true }); }
            return results;
        } catch (e) { console.error('Error converting SVG to PNG:', e); throw new Error('Failed to convert SVG to PNG'); }
    },
    // SVG -> JPEG (white background)

    async convertSvgToJpeg() {
        try {
            const results = []; const images=[];
            for (const file of this.uploadedFiles) {
                let svg = await file.text();
                if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg(\s|>)/i, (m)=>`<svg xmlns="http://www.w3.org/2000/svg"${m==='>'?'':' '}`);
                const { width, height } = this.getSvgDimensions(svg);
                const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                try {
                    const img = await new Promise((res, rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('Failed to load SVG')); i.src=url; });
                    const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height; const ctx=canvas.getContext('2d');
                    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,width,height); ctx.drawImage(img,0,0,width,height);
                    const outBlob = await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('toBlob failed')),'image/jpeg',0.92));
                    const outUrl = URL.createObjectURL(outBlob); const name = file.name.replace(/\.svg$/i,'.jpeg');
                    images.push({ name, blob: outBlob }); results.push({ name, type:'image/jpeg', size: outBlob.size, url: outUrl, blob: outBlob });
                } finally { URL.revokeObjectURL(url); }
            }
            if (images.length>1){ const zipBlob=await this.createActualZip(images,'svg_to_jpeg'); results.unshift({ name:'svg_to_jpeg_images.zip', type:'application/zip', size:zipBlob.size, url:URL.createObjectURL(zipBlob), isZipFile:true }); }
            return results;
        } catch (e) { console.error('Error converting SVG to JPEG:', e); throw new Error('Failed to convert SVG to JPEG'); }
    },
    // Helper: rasterize an SVG file to PNG bytes

    async svgFileToPngBytes(file) {
        let svg = await file.text();
        if (!/xmlns=/.test(svg)) {
            svg = svg.replace(/<svg(\s|>)/i, (m) => `<svg xmlns="http://www.w3.org/2000/svg"${m==='>'?'':' '}`);
        }
        const { width, height } = this.getSvgDimensions(svg);
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('Failed to load SVG'));
                i.src = url;
            });

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, img.naturalWidth || width);
            canvas.height = Math.max(1, img.naturalHeight || height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const outBlob = await new Promise((resolve, reject) =>
                canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/png')
            );
            const arrayBuffer = await outBlob.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        } finally {
            URL.revokeObjectURL(url);
        }
    },
    // SVG to PDF Conversion

    async convertSvgToPdf() {
        try {
            const results = [];
            const conversionMode = document.getElementById('conversion-mode')?.value || 'combined';

            if (conversionMode === 'combined') {
                const combinedPdfDoc = await PDFLib.PDFDocument.create();

                for (const file of this.uploadedFiles) {
                    const pngBytes = await this.svgFileToPngBytes(file);
                    const image = await combinedPdfDoc.embedPng(pngBytes);
                    const page = combinedPdfDoc.addPage([image.width, image.height]);
                    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
                }

                const combinedPdfBytes = await combinedPdfDoc.save();
                const combinedBlob = new Blob([combinedPdfBytes], { type: 'application/pdf' });
                const combinedUrl = URL.createObjectURL(combinedBlob);
                results.push({ name: 'merged_images.pdf', type: 'application/pdf', size: combinedBlob.size, url: combinedUrl });
            } else {
                const individualPdfs = [];
                for (const file of this.uploadedFiles) {
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const pngBytes = await this.svgFileToPngBytes(file);
                    const image = await pdfDoc.embedPng(pngBytes);
                    const page = pdfDoc.addPage([image.width, image.height]);
                    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
                    const pdfBytes = await pdfDoc.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const pdfResult = { name: file.name.replace(/\.svg$/i, '.pdf'), type: 'application/pdf', size: blob.size, url, blob };
                    individualPdfs.push(pdfResult);
                    results.push(pdfResult);
                }
                if (individualPdfs.length > 1) {
                    const zipBlob = await this.createPdfZip(individualPdfs);
                    results.unshift({ name: 'individual_pdfs.zip', type: 'application/zip', size: zipBlob.size, url: URL.createObjectURL(zipBlob), isZipFile: true });
                }
            }

            return results;
        } catch (e) {
            console.error('Error converting SVG to PDF:', e);
            throw new Error('Failed to convert SVG images to PDF');
        }
    },

    bindEvents() {
        // Search bar functionality (only for main page)
        const searchBar = document.getElementById('tool-search-bar');
        if (searchBar) {
            searchBar.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase().trim();
                const tableLinks = document.querySelectorAll('.tools-table .tool-link');
                if (tableLinks.length) {
                    // New compact table-based tools list
                    tableLinks.forEach(link => {
                        const text = link.textContent.toLowerCase();
                        const tool = (link.getAttribute('data-tool') || '').toLowerCase();
                        const match = !searchTerm || text.includes(searchTerm) || tool.includes(searchTerm);
                        const li = link.closest('li');
                        if (li) li.style.display = match ? '' : 'none';
                    });
                } else {
                    // Legacy card-based layout
                    document.querySelectorAll('.tool-card').forEach(card => {
                        const titleEl = card.querySelector('h3');
                        const descEl = card.querySelector('p');
                        const title = titleEl ? titleEl.textContent.toLowerCase() : '';
                        const description = descEl ? descEl.textContent.toLowerCase() : '';
                        const isVisible = !searchTerm || title.includes(searchTerm) || description.includes(searchTerm);
                        card.style.display = isVisible ? 'block' : 'none';
                    });
                }
            });
        }

        // FAQ functionality is handled by standalone initialization at bottom of file
    },

    setupDragAndDrop() {
        const uploadArea = document.getElementById('upload-area');
        if (!uploadArea) return; // Exit if upload area doesn't exist

        // Remove existing event listeners to prevent duplicates
        uploadArea.removeEventListener('dragenter', this.preventDefaults);
        uploadArea.removeEventListener('dragover', this.preventDefaults);
        uploadArea.removeEventListener('dragleave', this.preventDefaults);
        uploadArea.removeEventListener('drop', this.preventDefaults);

        // Clear any existing drag and drop handlers
        const newUploadArea = uploadArea.cloneNode(true);
        uploadArea.parentNode.replaceChild(newUploadArea, uploadArea);

        // Re-add click handler for the new element
        newUploadArea.addEventListener('click', () => {
            const fileInput = document.getElementById('file-input');
            if (fileInput) fileInput.click();
        });

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            newUploadArea.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            newUploadArea.addEventListener(eventName, () => {
                newUploadArea.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            newUploadArea.addEventListener(eventName, () => {
                newUploadArea.classList.remove('dragover');
            }, false);
        });

        newUploadArea.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            this.handleFileSelect(files);
        }, false);

        // Ensure file input change handler is properly bound after cloning
        this.bindFileInputEvents();
    },

    bindFileInputEvents() {
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            // Remove any existing change listeners to prevent duplicates
            fileInput.removeEventListener('change', this.handleFileInputChange);
            
            // Bind the change event with a reference we can remove later
            this.handleFileInputChange = (e) => {
                this.handleFileSelect(e.target.files);
            };
            
            fileInput.addEventListener('change', this.handleFileInputChange);
        }
    },

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    },

    openTool(toolName) {
        this.currentTool = toolName;
        this.uploadedFiles = [];

        const modal = document.getElementById('tool-modal');
        const modalTitle = document.getElementById('modal-title');
        const fileInput = document.getElementById('file-input');

        // Set modal title and file input accept
        const toolConfig = this.getToolConfig(toolName);
        modalTitle.textContent = toolConfig.title;
        fileInput.accept = toolConfig.accept;

        // Clear previous state
        this.clearFileList();
        this.clearResults();
        this.hideProgress();
        this.setupToolOptions(toolName);

        // Save as last used tool
        this.saveLastUsedTool();

        // Show tool description as notification
        this.showNotification(toolConfig.description, 'info');

        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    },

    closeModal() {
        const modal = document.getElementById('tool-modal');
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        this.uploadedFiles = [];
        this.currentTool = null;
    },

    getToolConfig(toolName) {
        const configs = {
            'pdf-to-png': {
                title: 'PDF to PNG Converter',
                accept: '.pdf',
                description: 'Convert PDF pages to PNG images'
            },
            'pdf-to-jpeg': {
                title: 'PDF to JPEG Converter',
                accept: '.pdf',
                description: 'Convert PDF pages to JPEG images'
            },
            'png-to-pdf': {
                title: 'PNG to PDF Converter',
                accept: '.png',
                description: 'Convert PNG images to PDF'
            },
            'jpeg-to-pdf': {
                title: 'JPEG to PDF Converter',
                accept: '.jpg,.jpeg',
                description: 'Convert JPEG images to PDF'
            },
            'pdf-to-txt': {
                title: 'PDF to Text Converter',
                accept: '.pdf',
                description: 'Extract text from PDF files'
            },
            'txt-to-pdf': {
                title: 'Text to PDF Converter',
                accept: '.txt',
                description: 'Convert text files to PDF'
            },
            'html-to-pdf': {
                title: 'HTML to PDF Converter',
                accept: '.html,.htm',
                description: 'Convert HTML files to PDF documents'
            },
            'markdown-to-pdf': {
                title: 'Markdown to PDF Converter',
                accept: '.md,.markdown',
                description: 'Convert Markdown files to PDF documents'
            },
            'epub-to-pdf': {
                title: 'EPUB to PDF Converter',
                accept: '.epub',
                description: 'Convert EPUB ebooks to PDF while preserving embedded styles, fonts, and images entirely in your browser'
            },
            'word-to-pdf': {
                title: 'Word (DOCX) to PDF Converter',
                accept: '.docx',
                description: 'Convert Word (.docx) documents to PDF entirely in your browser'
            },
            'rtf-to-pdf': {
                title: 'RTF to PDF Converter',
                accept: '.rtf',
                description: 'Convert Rich Text Format (.rtf) documents to PDF entirely in your browser'
            },
            'excel-to-pdf': {
                title: 'Excel (XLS/XLSX) to PDF Converter',
                accept: '.xls,.xlsx',
                description: 'Convert Excel spreadsheets to PDF entirely in your browser'
            },
            'ppt-to-pdf': {
                title: 'PowerPoint (PPTX) to PDF Converter',
                accept: '.ppt,.pptx',
                description: 'Convert PowerPoint presentations to PDF entirely in your browser'
            },
            'merge-pdf': {
                title: 'Merge PDF Files',
                accept: '.pdf',
                description: 'Combine multiple PDF files'
            },
            'split-pdf': {
                title: 'Split PDF File',
                accept: '.pdf',
                description: 'Split PDF into separate files'
            },
            'compress-pdf': {
                title: 'Compress PDF File',
                accept: '.pdf',
                description: 'Reduce PDF file size'
            },
            'compress-image': {
                title: 'Compress Image',
                accept: '.jpg,.jpeg,.png',
                description: 'Reduce JPEG/PNG file size'
            },
            'image-resizer': {
                title: 'Image Resizer',
                accept: '.jpg,.jpeg,.png,.webp',
                description: 'Resize JPEG, PNG, and WEBP images'
            },
            'rotate-pdf': {
                title: 'Rotate PDF Pages',
                accept: '.pdf',
                description: 'Rotate PDF pages'
            },
            'remove-metadata': {
                title: 'Remove PDF Metadata',
                accept: '.pdf',
                description: 'Strip all metadata from PDF files'
            },

            'edit-metadata': {
                title: 'Edit PDF Metadata',
                accept: '.pdf',
                description: 'View and edit document properties (Title, Author, Subject, Keywords, etc.) entirely in your browser'
            },

            'remove-password': {
                title: 'Remove Password from PDF',
                accept: '.pdf',
                description: 'Remove the password of a PDF file<'
            },
            'add-password': {
                title: 'Encrypt PDF',
                accept: '.pdf',
                description: 'Encrypt PDF with a password (client-side, no uploads)'
            },
            'extract-pages': {
                title: 'Extract Pages from PDF',
                accept: '.pdf',
                description: 'Select specific pages to extract from PDF. Works similarly to Split PDF.'
            },
            'remove-pages': {
                title: 'Remove Pages from PDF',
                accept: '.pdf',
                description: 'Delete specific pages from PDF files'
            },
            'sort-pages': {
                title: 'Sort PDF Pages',
                accept: '.pdf',
                description: 'Swap & sort PDF pages in anyway you want'
            },
            'add-watermark': {
                title: 'Add Watermark',
                accept: '.pdf',
                description: 'Add text or image watermark to a PDF file'
            },
            'flatten-pdf': {
                title: 'Flatten PDF',
                accept: '.pdf',
                description: 'Permanently embed form fields and annotations into page content'
            },
            'compare-pdfs': {
                title: 'Compare PDFs',
                accept: '.pdf',
                description: 'Compare two PDFs side-by-side with visual diffs'
            },
            'webp-to-pdf': {
                title: 'WEBP to PDF Converter',
                accept: '.webp',
                description: 'Convert WEBP images to PDF documents'
            },
            'webp-to-png': {
                title: 'WEBP to PNG Converter',
                accept: '.webp',
                description: 'Convert WEBP images to PNG entirely in your browser'
            },
            'webp-to-jpeg': {
                title: 'WEBP to JPEG Converter',
                accept: '.webp',
                description: 'Convert WEBP images to JPEG entirely in your browser'
            },
            'heif-to-pdf': {
                title: 'HEIC/HEIF to PDF Converter',
                accept: '.heif,.heic,.jpg,.jpeg',
                description: 'Convert HEIC/HEIF images to PDF documents'
            },
            'svg-to-png': {
                title: 'SVG to PNG Converter',
                accept: '.svg',
                description: 'Convert SVG images to PNG entirely in your browser'
            },
            'svg-to-jpeg': {
                title: 'SVG to JPEG Converter',
                accept: '.svg',
                description: 'Convert SVG images to JPEG entirely in your browser'
            },
            'svg-to-pdf': {
                title: 'SVG to PDF Converter',
                accept: '.svg',
                description: 'Convert SVG images to PDF entirely in your browser'
            }
        };
        return configs[toolName] || { title: 'PDF Tool', accept: '*', description: '' };
    },

    async handleFileSelect(files) {
        const incomingFiles = Array.from(files || []);
        console.log('handleFileSelect called with files:', incomingFiles.map(f => ({
            name: f.name,
            type: f.type,
            size: f.size
        })));

        if (!incomingFiles.length) {
            this.resetFileInput();
            return;
        }

        if (this.currentTool === 'add-watermark') {
            let selectedFile = null;
            for (const file of incomingFiles) {
                if (await this.validateFile(file)) {
                    selectedFile = file;
                    break;
                }
            }

            if (!selectedFile) {
                this.resetFileInput();
                return;
            }

            if (incomingFiles.length > 1) {
                this.showNotification('Only one PDF can be used for Add Watermark. Using the first valid file.', 'info');
            }

            this.uploadedFiles = [selectedFile];
            const watermarkOverlay = document.getElementById('watermark-overlay');
            if (watermarkOverlay) {
                delete watermarkOverlay.dataset.positioned;
            }
            this.updateFileList();
            this.updateProcessButton();
            this.renderWatermarkPreviewPage().catch((e) => {
                console.warn('Failed to render watermark preview page:', e);
            });
            this.resetFileInput();
            return;
        }

        let filesAdded = 0;
        for (const file of incomingFiles) {
            if (await this.validateFile(file)) {
                // Check if file already exists to prevent duplicates
                const existingFile = this.uploadedFiles.find(f =>
                    f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
                );

                if (!existingFile) {
                    this.uploadedFiles.push(file);
                    filesAdded++;
                }
            }
        }

        // Rebuild the whole list once so all items get consistent controls/sizing.
        if (filesAdded > 0) {
            this.updateFileList();
        }
        this.updateProcessButton();
        this.resetFileInput();

        // Show reordering tip for multiple files
        if (this.uploadedFiles.length > 1) {
            const toolName = this.currentTool;
            if (toolName === 'merge-pdf') {
                this.showNotification('💡 Tip: Drag files (or use arrows) to set merge order', 'info');
            } else if (this.uploadedFiles.length === 2) {
                this.showNotification('💡 Tip: You can drag files to reorder them', 'info');
            }
        }

        // For Edit Metadata tool, try to prefill fields from the first PDF selected
        if (this.currentTool === 'edit-metadata' && this.uploadedFiles.length > 0) {
            // Defer to allow DOM to update
            setTimeout(() => {
                this.populateMetadataFromFirstPdf().catch(() => {});
            }, 0);
        }

        if (this.currentTool === 'image-resizer') {
            setTimeout(() => {
                this.updateImageResizerReferenceDimensions().catch(() => {});
            }, 0);
        }

    },

    async validateFile(file) {
        if (!file || typeof file.name !== 'string') {
            this.showError('Invalid file selected.');
            return false;
        }

        if (file.size === 0) {
            this.showError(`Empty or broken files can't be uploaded: ${file.name}`);
            return false;
        }

        try {
            await file.slice(0, Math.min(file.size, 32)).arrayBuffer();
        } catch (_) {
            this.showError(`Unreadable or broken file can't be uploaded: ${file.name}`);
            return false;
        }

        const toolConfig = this.getToolConfig(this.currentTool);
        const acceptedTypes = toolConfig.accept.split(',').map(type => type.trim());

        if (acceptedTypes.includes('*')) return true;

        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        const fileName = file.name.toLowerCase();
        const mimeType = (file.type || '').toLowerCase();

        // Strict image type validation for Image Resizer
        if (this.currentTool === 'image-resizer') {
            const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
            const allowedMimeTypes = new Set([
                'image/png',
                'image/jpeg',
                'image/jpg',
                'image/pjpeg',
                'image/webp'
            ]);
            const isValidExtension = allowedExtensions.has(fileExtension);
            const isValidMime = mimeType === '' || allowedMimeTypes.has(mimeType);
            const isValidImageResizerFile = isValidExtension && isValidMime;

            if (!isValidImageResizerFile) {
                this.showError(`Image Resizer only supports PNG, JPEG, and WEBP files: ${file.name}`);
                return false;
            }
            return true;
        }

        // Enhanced validation for HEIF/HEIC files (especially for mobile devices)
        const isValid = acceptedTypes.some(type => {
            const cleanType = type.replace('.', '').toLowerCase();
            
            // Check file extension
            if (type === fileExtension) return true;
            
            // Check MIME type
            if (file.type.includes(cleanType)) return true;
            
            // Special handling for HEIF/HEIC files on mobile devices
            if (this.currentTool === 'heif-to-pdf') {
                // Accept actual HEIF/HEIC files
                if ((cleanType === 'heif' || cleanType === 'heic')) {
                    // Check for various HEIF/HEIC MIME types
                    if (mimeType.includes('heif') || mimeType.includes('heic') || 
                        mimeType.includes('image/heif') || mimeType.includes('image/heic') ||
                        mimeType.includes('image/heif-sequence') || mimeType.includes('image/heic-sequence')) {
                        return true;
                    }
                    
                    // Check file extension variations
                    if (fileName.endsWith('.heif') || fileName.endsWith('.heic') || 
                        fileName.endsWith('.hif') || fileName.endsWith('.avci')) {
                        return true;
                    }
                }
                
                // Accept JPEG files that might be iOS-converted HEIF files
                if ((cleanType === 'jpg' || cleanType === 'jpeg')) {
                    if (mimeType.includes('jpeg') || mimeType.includes('jpg') ||
                        fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
                        console.log('Accepting JPEG file for HEIF tool (may be iOS-converted HEIF):', fileName);
                        return true;
                    }
                }
                
                // For iOS, sometimes files from Photos app don't have proper extensions
                // but have specific MIME types or are known to be HEIF/HEIC
                if (mimeType === '' && fileName.includes('image')) {
                    console.log('Allowing file with empty MIME type that might be HEIF/HEIC from iOS Photos');
                    return true;
                }
            }
            
            return false;
        });

        if (!isValid) {
            console.log('File validation failed:', {
                fileName: file.name,
                mimeType: file.type,
                fileExtension: fileExtension,
                acceptedTypes: acceptedTypes,
                currentTool: this.currentTool
            });
            this.showError(`File type not supported for this tool: ${file.name} (${file.type || 'unknown type'})`);
            return false;
        }

        return true;
    },

    getFileId(file) {
        return `${file.name}::${file.size}::${file.lastModified}`;
    },

    findFileById(fileId) {
        return this.uploadedFiles.find(file => this.getFileId(file) === fileId) || null;
    },

    resetFileInput() {
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.value = '';
        }
    },

    truncateFileName(fileName, maxLength = 52) {
        if (typeof fileName !== 'string' || fileName.length <= maxLength) {
            return fileName;
        }

        const extensionIndex = fileName.lastIndexOf('.');
        const hasExtension = extensionIndex > 0 && extensionIndex < fileName.length - 1;
        if (!hasExtension) {
            return `${fileName.slice(0, maxLength - 1)}…`;
        }

        const extension = fileName.slice(extensionIndex);
        const availableNameLength = maxLength - extension.length - 1;
        if (availableNameLength <= 8) {
            return `${fileName.slice(0, maxLength - 1)}…`;
        }

        return `${fileName.slice(0, availableNameLength)}…${extension}`;
    },

    clearFileDropIndicators() {
        document.querySelectorAll('.file-item.drop-before, .file-item.drop-after').forEach(item => {
            item.classList.remove('drop-before', 'drop-after');
        });
    },

    animateReorderedFile(fileId, direction = null) {
        if (!fileId) return;

        const fileList = document.getElementById('file-list');
        if (!fileList) return;

        const movedItem = Array.from(fileList.children).find(item => item.dataset.fileId === fileId);
        if (!movedItem) return;

        movedItem.classList.remove('reordered-up', 'reordered-down');
        // Restart animation if the same file is moved repeatedly.
        void movedItem.offsetWidth;
        movedItem.classList.add(direction === 'up' ? 'reordered-up' : 'reordered-down');
    },

    addFileToList(file, options = {}) {
        const { animate = true } = options;
        const fileList = document.getElementById('file-list');
        if (!fileList) return; // Exit if file list doesn't exist

        const fileItem = document.createElement('div');
        fileItem.className = animate ? 'file-item fade-in' : 'file-item';
        fileItem.dataset.fileName = file.name;

        const fileSize = this.formatFileSize(file.size);
        const fileIcon = this.getFileIcon(file.type);
        const fileId = this.getFileId(file);
        const displayFileName = this.truncateFileName(file.name);

        // Show reorder controls only when there are multiple files.
        const showReorderControls = this.uploadedFiles.length > 1;
        const currentIndex = this.uploadedFiles.findIndex(f =>
            f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        );
        fileItem.draggable = showReorderControls;
        fileItem.dataset.fileId = fileId;
        fileItem.dataset.fileIndex = String(currentIndex);

        const isFirst = currentIndex === 0;
        const isLast = currentIndex === this.uploadedFiles.length - 1;

        if (showReorderControls) {
            const reorderControls = document.createElement('div');
            reorderControls.className = 'reorder-controls';

            const moveUpButton = document.createElement('button');
            moveUpButton.className = 'reorder-btn';
            moveUpButton.type = 'button';
            moveUpButton.title = 'Move up';
            moveUpButton.disabled = isFirst;
            moveUpButton.innerHTML = '<i class="fas fa-chevron-up" aria-hidden="true"></i>';
            moveUpButton.addEventListener('click', () => this.moveFileUpById(fileId));

            const moveDownButton = document.createElement('button');
            moveDownButton.className = 'reorder-btn';
            moveDownButton.type = 'button';
            moveDownButton.title = 'Move down';
            moveDownButton.disabled = isLast;
            moveDownButton.innerHTML = '<i class="fas fa-chevron-down" aria-hidden="true"></i>';
            moveDownButton.addEventListener('click', () => this.moveFileDownById(fileId));

            const dragHandle = document.createElement('div');
            dragHandle.className = 'drag-handle';
            dragHandle.title = 'Drag to reorder';
            dragHandle.innerHTML = '<i class="fas fa-grip-vertical" aria-hidden="true"></i>';

            reorderControls.appendChild(moveUpButton);
            reorderControls.appendChild(moveDownButton);
            reorderControls.appendChild(dragHandle);
            fileItem.appendChild(reorderControls);
        }

        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';

        const icon = document.createElement('i');
        icon.className = `fas ${fileIcon} file-icon`;
        icon.setAttribute('aria-hidden', 'true');

        const fileDetails = document.createElement('div');
        fileDetails.className = 'file-details';

        const fileNameHeading = document.createElement('h5');
        fileNameHeading.textContent = displayFileName;
        fileNameHeading.title = file.name;

        const fileSizeText = document.createElement('p');
        fileSizeText.textContent = fileSize;

        fileDetails.appendChild(fileNameHeading);
        fileDetails.appendChild(fileSizeText);
        fileInfo.appendChild(icon);
        fileInfo.appendChild(fileDetails);
        fileItem.appendChild(fileInfo);

        const fileActions = document.createElement('div');
        fileActions.className = 'file-actions';

        const previewButton = document.createElement('button');
        previewButton.className = 'preview-file';
        previewButton.type = 'button';
        previewButton.title = `Preview ${file.name}`;
        previewButton.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i>';
        previewButton.addEventListener('click', () => this.previewFileById(fileId));

        const removeButton = document.createElement('button');
        removeButton.className = 'remove-file';
        removeButton.type = 'button';
        removeButton.title = `Remove ${file.name}`;
        removeButton.setAttribute('aria-label', `Remove ${file.name}`);
        removeButton.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
        removeButton.addEventListener('click', () => this.removeFileById(fileId));

        fileActions.appendChild(previewButton);
        fileActions.appendChild(removeButton);
        fileItem.appendChild(fileActions);

        fileItem.querySelectorAll('button, i').forEach(el => el.setAttribute('draggable', 'false'));

        fileList.appendChild(fileItem);

        // Add drag and drop event listeners only if there are multiple files
        if (showReorderControls) {
            this.setupFileReorderEvents(fileItem);
        }

        // Generate page thumbnails for sort pages tool
        if (file.type.includes('pdf') && this.currentTool === 'sort-pages') {
            this.generatePageThumbnails(file);
        }
    },

    removeFile(fileName, fileSize, lastModified) {
        this.removeFileById(`${fileName}::${fileSize}::${lastModified}`);
    },

    removeFileById(fileId) {
        // Use unique identifiers to remove only the specific file
        this.uploadedFiles = this.uploadedFiles.filter(file => this.getFileId(file) !== fileId);
        this.updateFileList();
        this.updateProcessButton();
        this.resetFileInput();

        if (this.currentTool === 'image-resizer') {
            this.updateImageResizerReferenceDimensions().catch(() => {});
        }

        // Clear thumbnails if this was for sort pages tool
        if (this.currentTool === 'sort-pages' && this.uploadedFiles.length === 0) {
            const thumbnailContainer = document.getElementById('page-thumbnails');
            if (thumbnailContainer) {
                thumbnailContainer.innerHTML = '';
                thumbnailContainer.style.display = 'none';
            }
        }

        if (this.currentTool === 'add-watermark') {
            this.renderWatermarkPreviewPage().catch(() => {});
        }
    },

    updateFileList(options = {}) {
        const { animate = true, movedFileId = null, reorderDirection = null } = options;
        const fileList = document.getElementById('file-list');
        if (!fileList) return; // Exit if file list doesn't exist

        fileList.innerHTML = '';
        this.uploadedFiles.forEach(file => this.addFileToList(file, { animate }));

        if (movedFileId) {
            this.animateReorderedFile(movedFileId, reorderDirection);
        }

        if (this.currentTool === 'image-resizer') {
            this.updateImageResizerReferenceDimensions().catch(() => {});
        }
    },
    // File reordering methods

    moveFileUp(fileName, fileSize, lastModified) {
        this.moveFileUpById(`${fileName}::${fileSize}::${lastModified}`);
    },

    moveFileUpById(fileId) {
        const index = this.uploadedFiles.findIndex(file => this.getFileId(file) === fileId);
        if (index > 0) {
            const movedFile = this.uploadedFiles[index];
            // Swap with previous file
            [this.uploadedFiles[index - 1], this.uploadedFiles[index]] =
                [this.uploadedFiles[index], this.uploadedFiles[index - 1]];
            this.updateFileList({
                animate: false,
                movedFileId: this.getFileId(movedFile),
                reorderDirection: 'up'
            });
        }
    },

    moveFileDown(fileName, fileSize, lastModified) {
        this.moveFileDownById(`${fileName}::${fileSize}::${lastModified}`);
    },

    moveFileDownById(fileId) {
        const index = this.uploadedFiles.findIndex(file => this.getFileId(file) === fileId);
        if (index < this.uploadedFiles.length - 1) {
            const movedFile = this.uploadedFiles[index];
            // Swap with next file
            [this.uploadedFiles[index], this.uploadedFiles[index + 1]] =
                [this.uploadedFiles[index + 1], this.uploadedFiles[index]];
            this.updateFileList({
                animate: false,
                movedFileId: this.getFileId(movedFile),
                reorderDirection: 'down'
            });
        }
    },

    setupFileReorderEvents(fileItem) {
        fileItem.addEventListener('dragstart', (e) => {
            const draggedIndex = Number.parseInt(fileItem.dataset.fileIndex, 10);
            if (Number.isNaN(draggedIndex)) {
                e.preventDefault();
                return;
            }

            fileItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(draggedIndex));
        });

        fileItem.addEventListener('dragend', () => {
            fileItem.classList.remove('dragging');
            this.clearFileDropIndicators();
        });

        fileItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const draggingItem = document.querySelector('.file-item.dragging');
            if (draggingItem && draggingItem !== fileItem) {
                const rect = fileItem.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const insertAfter = e.clientY >= midY;

                this.clearFileDropIndicators();

                // Show stable drop indicator without changing element height.
                fileItem.classList.add(insertAfter ? 'drop-after' : 'drop-before');
            }
        });

        fileItem.addEventListener('dragleave', (e) => {
            if (!fileItem.contains(e.relatedTarget)) {
                fileItem.classList.remove('drop-before', 'drop-after');
            }
        });

        fileItem.addEventListener('drop', (e) => {
            e.preventDefault();
            this.clearFileDropIndicators();

            const draggedIndex = Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
            const targetIndex = Number.parseInt(fileItem.dataset.fileIndex, 10);

            if (Number.isNaN(draggedIndex) || Number.isNaN(targetIndex) || draggedIndex === targetIndex) {
                return;
            }

            const rect = fileItem.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const insertAfter = e.clientY >= midY;

            let insertIndex = targetIndex + (insertAfter ? 1 : 0);
            if (draggedIndex < insertIndex) {
                insertIndex--;
            }

            if (insertIndex === draggedIndex) {
                return;
            }

            const [draggedFile] = this.uploadedFiles.splice(draggedIndex, 1);
            this.uploadedFiles.splice(insertIndex, 0, draggedFile);
            this.updateFileList({
                animate: false,
                movedFileId: this.getFileId(draggedFile),
                reorderDirection: insertIndex < draggedIndex ? 'up' : 'down'
            });
        });
    },

    // Preprocess PPTX: ensure required doc parts exist (e.g., docProps/app.xml) to prevent plugin crashes
});
