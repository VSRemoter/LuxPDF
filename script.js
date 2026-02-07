/*
    LuxPDF: A free, open-source, and private PDF web application.
    Copyright (C) 2025 LuxPDF

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program. If not, see <https://www.gnu.org/licenses/>.
*/

// PDF Converter Pro - Main JavaScript File
class PDFConverterPro {
    constructor() {
        this.currentTool = null;
        this.uploadedFiles = [];
        this.isReversed = false; // Track reverse state for sort-pages tool
        this.handleFileInputChange = null; // Reference to file input change handler
        this.imageResizerReference = null; // Store reference dimensions for locked-aspect resize mode
        this.init();
    }

    init() {
        this.bindEvents();
        this.setupDragAndDrop();
        this.loadLastUsedTool();
    }

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
        this.clearFileList();
        this.clearResults();
        this.hideProgress();
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

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
    }

    closeModal() {
        const modal = document.getElementById('tool-modal');
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        this.uploadedFiles = [];
        this.currentTool = null;
    }

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
    }

    handleFileSelect(files) {
        console.log('handleFileSelect called with files:', Array.from(files).map(f => ({
            name: f.name,
            type: f.type,
            size: f.size
        })));
        
        Array.from(files).forEach(file => {
            if (this.validateFile(file)) {
                // Check if file already exists to prevent duplicates
                const existingFile = this.uploadedFiles.find(f =>
                    f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
                );

                if (!existingFile) {
                    this.uploadedFiles.push(file);
                    this.addFileToList(file);
                }
            }
        });
        this.updateProcessButton();

        // Show reordering tip for multiple files
        if (this.uploadedFiles.length > 1) {
            const toolName = this.currentTool;
            if (toolName === 'merge-pdf') {
                this.showNotification('💡 Tip: Use arrow buttons to reorder files before merging', 'info');
            } else if (this.uploadedFiles.length === 2) {
                this.showNotification('💡 Tip: You can reorder files using the arrow buttons', 'info');
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
    }

    validateFile(file) {
        const toolConfig = this.getToolConfig(this.currentTool);
        const acceptedTypes = toolConfig.accept.split(',').map(type => type.trim());

        if (acceptedTypes.includes('*')) return true;

        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        const fileName = file.name.toLowerCase();
        const mimeType = file.type.toLowerCase();

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
    }

    addFileToList(file) {
        const fileList = document.getElementById('file-list');
        if (!fileList) return; // Exit if file list doesn't exist

        const fileItem = document.createElement('div');
        fileItem.className = 'file-item fade-in';
        fileItem.draggable = this.uploadedFiles.length > 1; // Enable dragging when multiple files
        fileItem.dataset.fileName = file.name;
        // Add unique identifier to prevent issues with same-named files
        fileItem.dataset.fileId = `${file.name}_${file.size}_${file.lastModified}`;

        const fileSize = this.formatFileSize(file.size);
        const fileIcon = this.getFileIcon(file.type);

        // Show reorder controls when there are multiple files OR will be multiple files
        const showReorderControls = this.uploadedFiles.length > 1;
        const currentIndex = this.uploadedFiles.findIndex(f =>
            f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        );
        const isFirst = currentIndex === 0;
        const isLast = currentIndex === this.uploadedFiles.length - 1;

        const reorderControls = showReorderControls ? `
            <div class="reorder-controls">
                <button class="reorder-btn" onclick="window.pdfConverter.moveFileUp('${file.name}', ${file.size}, ${file.lastModified})" 
                        title="Move up" ${isFirst ? 'disabled' : ''}>
                    <i class="fas fa-chevron-up"></i>
                </button>
                <button class="reorder-btn" onclick="window.pdfConverter.moveFileDown('${file.name}', ${file.size}, ${file.lastModified})" 
                        title="Move down" ${isLast ? 'disabled' : ''}>
                    <i class="fas fa-chevron-down"></i>
                </button>
                <div class="drag-handle" title="Drag to reorder">
                    <i class="fas fa-grip-vertical"></i>
                </div>
            </div>
        ` : '';

        fileItem.innerHTML = `
            ${reorderControls}
            <div class="file-info">
                <i class="fas ${fileIcon} file-icon"></i>
                <div class="file-details">
                    <h5>${file.name}</h5>
                    <p>${fileSize}</p>
                </div>
            </div>
            <div class="file-actions">
                <button class="preview-file" onclick="window.pdfConverter.previewFile('${file.name}', ${file.size}, ${file.lastModified})">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="remove-file" onclick="window.pdfConverter.removeFile('${file.name}', ${file.size}, ${file.lastModified})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        fileList.appendChild(fileItem);

        // Add drag and drop event listeners only if there are multiple files
        if (showReorderControls) {
            this.setupFileReorderEvents(fileItem);
        }

        // Generate page thumbnails for sort pages tool
        if (file.type.includes('pdf') && this.currentTool === 'sort-pages') {
            this.generatePageThumbnails(file);
        }
    }

    removeFile(fileName, fileSize, lastModified) {
        // Use unique identifiers to remove only the specific file
        this.uploadedFiles = this.uploadedFiles.filter(file =>
            !(file.name === fileName && file.size === fileSize && file.lastModified === lastModified)
        );
        this.updateFileList();
        this.updateProcessButton();

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
    }

    updateFileList() {
        const fileList = document.getElementById('file-list');
        if (!fileList) return; // Exit if file list doesn't exist

        fileList.innerHTML = '';
        this.uploadedFiles.forEach(file => this.addFileToList(file));

        if (this.currentTool === 'image-resizer') {
            this.updateImageResizerReferenceDimensions().catch(() => {});
        }
    }

    // File reordering methods
    moveFileUp(fileName, fileSize, lastModified) {
        const index = this.uploadedFiles.findIndex(file =>
            file.name === fileName && file.size === fileSize && file.lastModified === lastModified
        );
        if (index > 0) {
            // Swap with previous file
            [this.uploadedFiles[index - 1], this.uploadedFiles[index]] =
                [this.uploadedFiles[index], this.uploadedFiles[index - 1]];
            this.updateFileList();
        }
    }

    moveFileDown(fileName, fileSize, lastModified) {
        const index = this.uploadedFiles.findIndex(file =>
            file.name === fileName && file.size === fileSize && file.lastModified === lastModified
        );
        if (index < this.uploadedFiles.length - 1) {
            // Swap with next file
            [this.uploadedFiles[index], this.uploadedFiles[index + 1]] =
                [this.uploadedFiles[index + 1], this.uploadedFiles[index]];
            this.updateFileList();
        }
    }

    setupFileReorderEvents(fileItem) {
        fileItem.addEventListener('dragstart', (e) => {
            fileItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', fileItem.dataset.fileId);
        });

        fileItem.addEventListener('dragend', (e) => {
            fileItem.classList.remove('dragging');
            // Remove all drop indicators
            document.querySelectorAll('.file-item').forEach(item => {
                item.style.borderTop = '';
                item.style.borderBottom = '';
            });
        });

        fileItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const draggingItem = document.querySelector('.file-item.dragging');
            if (draggingItem && draggingItem !== fileItem) {
                const rect = fileItem.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                // Clear previous indicators
                fileItem.style.borderTop = '';
                fileItem.style.borderBottom = '';

                // Show drop indicator
                if (e.clientY < midY) {
                    fileItem.style.borderTop = '3px solid var(--accent-color)';
                } else {
                    fileItem.style.borderBottom = '3px solid var(--accent-color)';
                }
            }
        });

        fileItem.addEventListener('dragleave', (e) => {
            // Only clear if we're actually leaving the element
            const rect = fileItem.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom) {
                fileItem.style.borderTop = '';
                fileItem.style.borderBottom = '';
            }
        });

        fileItem.addEventListener('drop', (e) => {
            e.preventDefault();
            fileItem.style.borderTop = '';
            fileItem.style.borderBottom = '';

            const draggedFileId = e.dataTransfer.getData('text/plain');
            const targetFileId = fileItem.dataset.fileId;

            if (draggedFileId && draggedFileId !== targetFileId) {
                // Parse file identifiers to find the actual files
                const [draggedName, draggedSize, draggedModified] = draggedFileId.split('_');
                const [targetName, targetSize, targetModified] = targetFileId.split('_');

                const draggedIndex = this.uploadedFiles.findIndex(file =>
                    file.name === draggedName &&
                    file.size === parseInt(draggedSize) &&
                    file.lastModified === parseInt(draggedModified)
                );
                const targetIndex = this.uploadedFiles.findIndex(file =>
                    file.name === targetName &&
                    file.size === parseInt(targetSize) &&
                    file.lastModified === parseInt(targetModified)
                );

                if (draggedIndex !== -1 && targetIndex !== -1) {
                    // Determine if we should insert before or after target
                    const rect = fileItem.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const insertAfter = e.clientY >= midY;

                    // Remove dragged file
                    const draggedFile = this.uploadedFiles.splice(draggedIndex, 1)[0];

                    // Calculate new insertion index
                    let newIndex = targetIndex;
                    if (draggedIndex < targetIndex) {
                        newIndex = targetIndex - 1;
                    }
                    if (insertAfter) {
                        newIndex++;
                    }

                    // Insert at new position
                    this.uploadedFiles.splice(newIndex, 0, draggedFile);
                    this.updateFileList();
                }
            }
        });
    }

    // Preprocess PPTX: ensure required doc parts exist (e.g., docProps/app.xml) to prevent plugin crashes
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
    }

    clearFileList() {
        const fileList = document.getElementById('file-list');
        if (fileList) {
            fileList.innerHTML = '';
        }
    }

    getFileIcon(fileType) {
        if (fileType.includes('pdf')) return 'fa-file-pdf';
        if (fileType.includes('image')) return 'fa-file-image';
        if (fileType.includes('text')) return 'fa-file-alt';
        return 'fa-file';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

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
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p style="font-size: 0.95rem; color: rgba(248, 250, 252, 0.8); margin: 0;">
                            Orientation and quality are auto-optimized for maximum fidelity. No settings required.
                        </p>
                    </div>
                `;
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
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p>Upload exactly two PDFs. Click "Process Files" to view a side-by-side comparison with highlighted differences.</p>
                    </div>
                `;
                break;

            case 'remove-metadata':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <p>Click "Process Files" to remove all metadata from your PDF.</p>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            This will strip all metadata including author, title, creation date, and other identifying information.
                        </p>
                    </div>
                `;
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
    }

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
    }

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
    }

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
    }

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
    }

    updateProcessButton() {
        const processBtn = document.getElementById('process-btn');
        if (!processBtn) return; // Exit if process button doesn't exist

        const fileCount = this.uploadedFiles.length;
        let enabled = fileCount > 0;

        if (this.currentTool === 'compare-pdfs') {
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
    }

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
    }
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
    }

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
    }

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
    }

    clearResults() {
        const resultsSection = document.getElementById('results-section');
        const resultsList = document.getElementById('results-list');

        if (resultsList) {
            resultsList.innerHTML = '';
        }
        if (resultsSection) {
            resultsSection.style.display = 'none';
        }
    }

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
    }

    removeNotifications() {
        const notifications = document.querySelectorAll('.notification');
        notifications.forEach(notification => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });
    }

    showError(message) {
        console.error(message);
        this.showNotification(message, 'error');
    }

    // File preview functionality
    previewFile(fileName, fileSize, lastModified) {
        const file = this.uploadedFiles.find(f =>
            f.name === fileName && f.size === fileSize && f.lastModified === lastModified
        );
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
    }

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
    }

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
    }

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
    }

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
    }

    downloadResult(url, fileName) {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Save and load last used tool - Last used highlighting removed
    saveLastUsedTool() {
        if (this.currentTool) {
            localStorage.setItem('pdfConverterLastTool', this.currentTool);
        }
    }

    loadLastUsedTool() {
        // Last used tool highlighting functionality removed
    }

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
    }

    // Edit Metadata: Apply user-provided metadata to PDFs
    async editMetadata() {
        const results = [];

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
                    const d = new Date(creationDateStr);
                    if (!isNaN(d.getTime())) pdfDoc.setCreationDate(d);
                }
                if (modificationDateStr && typeof pdfDoc.setModificationDate === 'function') {
                    const d = new Date(modificationDateStr);
                    if (!isNaN(d.getTime())) pdfDoc.setModificationDate(d);
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
    }

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
                let str = s.startsWith('D:') ? s.slice(2) : s;
                const yyyy = str.slice(0, 4);
                const mm = str.slice(4, 6) || '01';
                const dd = str.slice(6, 8) || '01';
                const HH = str.slice(8, 10) || '00';
                const MM = str.slice(10, 12) || '00';
                const SS = str.slice(12, 14) || '00';
                let tz = 'Z';
                const tzMatch = str.match(/([Zz]|[+\-]\d{2}'?\d{2}?)/);
                if (tzMatch) {
                    const t = tzMatch[1];
                    if (t.toUpperCase() === 'Z') tz = 'Z';
                    else {
                        const sign = t[0];
                        const th = t.slice(1, 3);
                        const tm = t.slice(-2);
                        tz = `${sign}${th}:${tm}`;
                    }
                }
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
            if (typeof pdfDoc.getTitle === 'function') setVal('meta-title', pdfDoc.getTitle() || '');
            if (typeof pdfDoc.getAuthor === 'function') setVal('meta-author', pdfDoc.getAuthor() || '');
            if (typeof pdfDoc.getSubject === 'function') setVal('meta-subject', pdfDoc.getSubject() || '');
            if (typeof pdfDoc.getProducer === 'function') setVal('meta-producer', pdfDoc.getProducer() || '');
            if (typeof pdfDoc.getCreator === 'function') setVal('meta-creator', pdfDoc.getCreator() || '');
            if (typeof pdfDoc.getLanguage === 'function' && !byId('meta-language').value) setVal('meta-language', pdfDoc.getLanguage() || '');

            // Keywords (array)
            if (typeof pdfDoc.getKeywords === 'function') {
                const kws = pdfDoc.getKeywords();
                if (Array.isArray(kws)) setVal('meta-keywords', kws.join(', '));
                else if (typeof kws === 'string') setVal('meta-keywords', kws);
            }

            // Dates
            if (typeof pdfDoc.getCreationDate === 'function' && !byId('meta-creation-date').value) {
                const cd = pdfDoc.getCreationDate();
                if (cd instanceof Date && !isNaN(cd.getTime())) {
                    setVal('meta-creation-date', this.formatDateForDatetimeLocal(cd));
                }
            }
            if (typeof pdfDoc.getModificationDate === 'function' && !byId('meta-modification-date').value) {
                const md = pdfDoc.getModificationDate();
                if (md instanceof Date && !isNaN(md.getTime())) {
                    setVal('meta-modification-date', this.formatDateForDatetimeLocal(md));
                }
            }
        } catch (err) {
            console.warn('Could not populate metadata from PDF:', err);
        }
    }

    // Helper: format Date to yyyy-MM-ddTHH:mm for datetime-local inputs
    formatDateForDatetimeLocal(date) {
        const pad = (n) => String(n).padStart(2, '0');
        const yyyy = date.getFullYear();
        const MM = pad(date.getMonth() + 1);
        const dd = pad(date.getDate());
        const hh = pad(date.getHours());
        const mm = pad(date.getMinutes());
        return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
    }

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
    }

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
    }

    colLettersToNumber(letters) {
        let num = 0;
        for (let i = 0; i < letters.length; i++) {
            num = num * 26 + (letters.charCodeAt(i) - 64);
        }
        return num;
    }

    pointsToPx(points) {
        return Math.round(points * (96 / 72));
    }

    excelColWidthToPx(widthChars) {
        // Approximate conversion from Excel column width (characters) to pixels
        // Common heuristic: pixels ≈ (characters + 0.71) * 8
        return Math.round((Number(widthChars || 10) + 0.71) * 8);
    }

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
    }

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
    }

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
    }

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
    }

    // Helper function to create actual ZIP file
    async createActualZip(images, baseName) {
        const zip = new JSZip();

        for (const image of images) {
            zip.file(image.name, image.blob);
        }

        return await zip.generateAsync({ type: 'blob' });
    }

    // Helper function to create ZIP file from PDF files
    async createPdfZip(pdfFiles) {
        const zip = new JSZip();

        for (const pdf of pdfFiles) {
            zip.file(pdf.name, pdf.blob);
        }

        return await zip.generateAsync({ type: 'blob' });
    }

    async convertPdfToPng() {
        return this.convertPdfToImage('png');
    }

    // PDF to JPEG Conversion
    async convertPdfToJpeg() {
        return this.convertPdfToImage('jpeg');
    }

    // PNG to PDF Conversion
    async convertPngToPdf() {
        try {
            const results = [];
            const conversionMode = document.getElementById('conversion-mode')?.value || 'combined';

            if (conversionMode === 'combined') {
                // Create a single merged PDF with all images
                const combinedPdfDoc = await PDFLib.PDFDocument.create();

                for (const file of this.uploadedFiles) {
                    const arrayBuffer = await file.arrayBuffer();
                    const imageBytes = new Uint8Array(arrayBuffer);

                    let image;
                    if (file.type.includes('png')) {
                        image = await combinedPdfDoc.embedPng(imageBytes);
                    } else if (file.type.includes('jpg') || file.type.includes('jpeg')) {
                        image = await combinedPdfDoc.embedJpg(imageBytes);
                    } else {
                        throw new Error(`Unsupported image format: ${file.type}`);
                    }

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
                // Create individual PDFs for each image
                const individualPdfs = [];

                for (const file of this.uploadedFiles) {
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const arrayBuffer = await file.arrayBuffer();
                    const imageBytes = new Uint8Array(arrayBuffer);

                    let image;
                    if (file.type.includes('png')) {
                        image = await pdfDoc.embedPng(imageBytes);
                    } else if (file.type.includes('jpg') || file.type.includes('jpeg')) {
                        image = await pdfDoc.embedJpg(imageBytes);
                    } else {
                        throw new Error(`Unsupported image format: ${file.type}`);
                    }

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
    }

    // JPEG to PDF Conversion
    async convertJpegToPdf() {
        try {
            const results = [];
            const conversionMode = document.getElementById('conversion-mode')?.value || 'combined';

            if (conversionMode === 'combined') {
                // Create a single merged PDF with all images
                const combinedPdfDoc = await PDFLib.PDFDocument.create();

                for (const file of this.uploadedFiles) {
                    const arrayBuffer = await file.arrayBuffer();
                    const imageBytes = new Uint8Array(arrayBuffer);

                    // Embed JPEG image
                    const image = await combinedPdfDoc.embedJpg(imageBytes);

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
                // Create individual PDFs for each image
                const individualPdfs = [];

                for (const file of this.uploadedFiles) {
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    const arrayBuffer = await file.arrayBuffer();
                    const imageBytes = new Uint8Array(arrayBuffer);

                    // Embed JPEG image
                    const image = await pdfDoc.embedJpg(imageBytes);

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    // Convert PPTX to PDF using PPTXjs + html2canvas + jsPDF
    async convertPptxToPdf() {
        await this.ensureHtmlRenderingLibs();
        await this.ensurePptxLibs();
        const results = [];

        const { jsPDF } = window.jspdf;
        // Always high quality for maximum fidelity
        const h2cScale = 3;

        // Helpers: parse CSS color and determine effective slide background color
        const parseCssColorToRgb = (colorStr) => {
            if (!colorStr || typeof colorStr !== 'string') return null;
            colorStr = colorStr.trim();
            // Hex formats
            if (colorStr[0] === '#') {
                let r, g, b;
                if (colorStr.length === 4) { // #rgb
                    r = parseInt(colorStr[1] + colorStr[1], 16);
                    g = parseInt(colorStr[2] + colorStr[2], 16);
                    b = parseInt(colorStr[3] + colorStr[3], 16);
                    return { r, g, b };
                } else if (colorStr.length === 7) { // #rrggbb
                    r = parseInt(colorStr.slice(1, 3), 16);
                    g = parseInt(colorStr.slice(3, 5), 16);
                    b = parseInt(colorStr.slice(5, 7), 16);
                    return { r, g, b };
                }
                return null;
            }
            // rgb/rgba
            const m = colorStr.match(/rgba?\(([^)]+)\)/i);
            if (m) {
                const parts = m[1].split(',').map(s => s.trim());
                if (parts.length >= 3) {
                    const r = Math.max(0, Math.min(255, parseInt(parts[0], 10)));
                    const g = Math.max(0, Math.min(255, parseInt(parts[1], 10)));
                    const b = Math.max(0, Math.min(255, parseInt(parts[2], 10)));
                    return { r, g, b };
                }
            }
            return null;
        };

        const getEffectiveSlideBgColor = (el) => {
            let node = el;
            try {
                while (node && node !== document.body) {
                    const cs = window.getComputedStyle(node);
                    if (cs) {
                        const bgImg = cs.backgroundImage;
                        // If a background image/gradient is present, don't enforce a color; let html2canvas render it.
                        if (bgImg && bgImg !== 'none') return null;
                        const bg = cs.backgroundColor;
                        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
                    }
                    node = node.parentElement;
                }
            } catch (_) { /* ignore */ }
            // Fallback to white when nothing specified
            return '#ffffff';
        };

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
            root.style.width = '1200px';
            root.style.background = '#ffffff';
            // Do not hide with visibility/opacity to allow proper layout calculations
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
                            slidesScale: '130%',
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
                            slidesScale: '130%',
                            slideMode: false,
                            keyBoardShortCut: false,
                            mediaProcess: true,
                        });
                        await this.waitForPptxRender(root, 90000);
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

                // Determine first page orientation from first slide aspect ratio
                const firstSlide = slides[0];
                const firstRect = (firstSlide && firstSlide.getBoundingClientRect) ? firstSlide.getBoundingClientRect() : null;
                const firstW = firstRect ? Math.max(1, firstRect.width) : (firstSlide.scrollWidth || firstSlide.clientWidth || 1200);
                const firstH = firstRect ? Math.max(1, firstRect.height) : (firstSlide.scrollHeight || firstSlide.clientHeight || 675);
                const firstOrientation = firstW >= firstH ? 'l' : 'p';

                // Prepare PDF with first slide orientation
                const pdf = new jsPDF({ orientation: firstOrientation, unit: 'pt', format: 'a4' });
                let pageIndex = 0;
                for (const slide of slides) {
                    // Compute slide aspect and choose orientation per slide
                    let rect = slide.getBoundingClientRect ? slide.getBoundingClientRect() : null;
                    let sw = rect ? Math.max(1, rect.width) : (slide.scrollWidth || slide.clientWidth || 1200);
                    let sh = rect ? Math.max(1, rect.height) : (slide.scrollHeight || slide.clientHeight || 675);
                    const pageOrientation = sw >= sh ? 'l' : 'p';
                    if (pageIndex > 0) {
                        pdf.addPage('a4', pageOrientation);
                    }
                    // Current page size
                    let pageWidth = pdf.internal.pageSize.getWidth();
                    let pageHeight = pdf.internal.pageSize.getHeight();

                    // Determine effective solid background color (for letterboxing) without overriding slide-rendered backgrounds
                    const bgForPage = getEffectiveSlideBgColor(slide); // null if background image/gradient

                    // Render slide to canvas preserving its own background (including images/gradients)
                    const canvas = await window.html2canvas(slide, {
                        backgroundColor: null, // do not force a solid color; keep actual background
                        scale: h2cScale,
                        useCORS: true,
                        logging: false,
                        windowWidth: slide.scrollWidth || slide.clientWidth,
                        windowHeight: slide.scrollHeight || slide.clientHeight,
                    });

                    // Paint page background color first (covers any margins/letterboxing)
                    if (bgForPage) {
                        const rgb = parseCssColorToRgb(bgForPage);
                        if (rgb) {
                            try {
                                pdf.setFillColor(rgb.r, rgb.g, rgb.b);
                                pdf.rect(0, 0, pageWidth, pageHeight, 'F');
                            } catch (_) { /* ignore color errors */ }
                        }
                    }

                    const imgData = canvas.toDataURL('image/png');
                    const imgWidth = canvas.width;
                    const imgHeight = canvas.height;
                    const ratio = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
                    const drawWidth = imgWidth * ratio;
                    const drawHeight = imgHeight * ratio;
                    const dx = (pageWidth - drawWidth) / 2;
                    const dy = (pageHeight - drawHeight) / 2;

                    pdf.addImage(imgData, 'PNG', dx, dy, drawWidth, drawHeight, undefined, 'FAST');
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
    }

    // Helper: load stylesheet once
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
    }

    // Helper: load first available script from a list of URLs
    async loadFirstAvailableScript(urls) {
        for (const url of urls) {
            try {
                await this.loadScript(url);
                return true;
            } catch (_) { /* try next */ }
        }
        return false;
    }

    // Helper: load first available stylesheet from a list of URLs
    async loadFirstAvailableStylesheet(urls, id) {
        for (const url of urls) {
            try {
                await this.loadStylesheet(url, id);
                return true;
            } catch (_) { /* try next */ }
        }
        return false;
    }

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
    }

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
    }

    // Ensure Markdown library is available
    async ensureMarkdownLib() {
        if (!window.marked) {
            // marked v4+ exposes window.marked
            await this.loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
        }
        if (!window.marked) {
            throw new Error('Markdown parser failed to load');
        }
    }

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
    }

    // HTML to PDF Conversion (High Fidelity with clickable links)
    async convertHtmlToPdf() {
        const results = [];

        // Ensure rendering libraries are available
        await this.ensureHtmlRenderingLibs();
        const { jsPDF } = window.jspdf;

        for (const file of this.uploadedFiles) {
            try {
                // Read HTML content with fallback decoding
                let html;
                try {
                    html = await file.text();
                } catch (readError) {
                    const arrayBuffer = await file.arrayBuffer();
                    const decoder = new TextDecoder('utf-8', { fatal: false });
                    html = decoder.decode(arrayBuffer);
                }

                if (!html || !html.trim()) {
                    throw new Error('File appears to be empty or contains no readable HTML');
                }

                // Prepare offscreen container to render HTML
                const container = document.createElement('div');
                const containerWidth = 794; // ~A4 width at 96 DPI
                container.style.cssText = `position: fixed; left: -10000px; top: 0; width: ${containerWidth}px; padding: 24px; background: #ffffff; color: #000;`;
                container.innerHTML = html;
                document.body.appendChild(container);

                // Collect anchor elements for link overlay
                const anchors = Array.from(container.querySelectorAll('a[href]')).map(a => ({
                    el: a,
                    href: a.getAttribute('href')
                }));

                // Create jsPDF document
                const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
                const pdfWidth = doc.internal.pageSize.getWidth();
                const pdfHeight = doc.internal.pageSize.getHeight();

                // Render to canvas at high scale
                const scale = 2.5; // higher scale = higher quality
                const canvas = await window.html2canvas(container, {
                    scale,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    imageTimeout: 15000
                });

                const fullCanvasWidth = canvas.width;
                const fullCanvasHeight = canvas.height;
                const pageHeightPx = Math.floor(fullCanvasWidth * (pdfHeight / pdfWidth));
                const ratioCanvasToPdf = pdfWidth / fullCanvasWidth;

                // Precompute anchor rects in canvas pixel space
                const anchorRects = anchors
                    .filter(a => !!a.href && /^https?:|^mailto:|^#|^\//i.test(a.href))
                    .map(a => {
                        const rect = a.el.getBoundingClientRect();
                        const parentRect = container.getBoundingClientRect();
                        const left = (rect.left - parentRect.left) * scale;
                        const top = (rect.top - parentRect.top) * scale;
                        const width = rect.width * scale;
                        const height = rect.height * scale;
                        return { href: a.href, left, top, width, height };
                    });

                let yOffset = 0;
                let pageIndex = 0;
                while (yOffset < fullCanvasHeight) {
                    const sliceHeight = Math.min(pageHeightPx, fullCanvasHeight - yOffset);

                    // Create page slice
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
                    const imgHeightPt = pdfWidth * (sliceHeight / fullCanvasWidth);
                    doc.addImage(imgData, 'JPEG', 0, 0, pdfWidth, imgHeightPt);

                    // Add clickable link annotations overlapping the image
                    anchorRects.forEach(ar => {
                        const arBottom = ar.top + ar.height;
                        const pageBottom = yOffset + sliceHeight;
                        const intersects = !(arBottom <= yOffset || ar.top >= pageBottom);
                        if (!intersects) return;
                        const visibleTop = Math.max(ar.top, yOffset);
                        const visibleHeight = Math.min(arBottom, pageBottom) - visibleTop;
                        if (visibleHeight <= 1) return;
                        const xPt = ar.left * ratioCanvasToPdf;
                        const yPt = (visibleTop - yOffset) * ratioCanvasToPdf;
                        const wPt = ar.width * ratioCanvasToPdf;
                        const hPt = visibleHeight * ratioCanvasToPdf;
                        try {
                            doc.link(xPt, yPt, wPt, hPt, { url: ar.href });
                        } catch (_) { /* ignore link errors */ }
                    });

                    yOffset += sliceHeight;
                    pageIndex += 1;
                }

                // Cleanup
                container.remove();

                // Output blob
                const pdfBytes = doc.output('arraybuffer');
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);

                // Generate output name
                let outputName = file.name;
                if (/\.(html?|xhtml)$/i.test(outputName)) {
                    outputName = outputName.replace(/\.(html?|xhtml)$/i, '.pdf');
                } else {
                    outputName = outputName + '.pdf';
                }

                results.push({
                    name: outputName,
                    type: 'application/pdf',
                    size: blob.size,
                    url: url
                });

                this.showNotification(`Successfully converted ${file.name} to PDF`, 'success');

            } catch (error) {
                console.error('Error converting HTML to PDF:', error);
                this.showNotification(`Failed to convert ${file.name}: ${error.message}`, 'error');
                continue;
            }
        }

        if (results.length === 0) {
            throw new Error('Failed to convert any HTML files to PDF');
        }

        return results;
    }

    // Word (DOCX) to PDF Conversion (docx-preview -> html2canvas -> jsPDF with Mammoth fallback)
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
    }

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
    }

    getRenderableNodeSize(node) {
        const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { width: 0, height: 0 };
        const width = Math.max(1, Math.ceil(Math.max(rect.width || 0, node.scrollWidth || 0, node.offsetWidth || 0)));
        const height = Math.max(1, Math.ceil(Math.max(rect.height || 0, node.scrollHeight || 0, node.offsetHeight || 0)));
        return { width, height };
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    // Convert data URL to byte array
    dataUrlToBytes(dataUrl) {
        const base64 = dataUrl.split(',')[1];
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    applyThumbnailSize(size) {
        const widths = { sm: '120px', md: '160px', lg: '220px' };
        const w = widths[size] || widths.md;
        const container = document.getElementById('page-thumbnails');
        if (!container) return;
        container.querySelectorAll('.page-thumbnail').forEach(el => {
            try { el.style.width = w; } catch (_) {}
        });
    }

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
    }

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
    }

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
    }

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
    }

    // Helper function to save last used tool
    saveLastUsedTool() {
        try {
            localStorage.setItem('luxpdf-last-tool', this.currentTool);
        } catch (error) {
            // Ignore localStorage errors
        }
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
}

// Initialize FAQ Accordion
function initializeFAQAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        if (question) {
            // Prevent multiple listeners by checking for a marker
            if (!question.dataset.faqInitialized) {
                question.dataset.faqInitialized = 'true';
                question.addEventListener('click', () => {
                    item.classList.toggle('active');
                });
            }
        }
    });
}

// Initialize Mobile Navigation (universal)
function initializeMobileNav() {
    const headerContainer = document.querySelector('.header .container');
    if (!headerContainer) return; // Safety guard

    // Ensure hamburger markup exists (tool pages may not have it)
    let hamburgerMenu = document.querySelector('.hamburger-menu');
    if (!hamburgerMenu) {
        hamburgerMenu = document.createElement('div');
        hamburgerMenu.className = 'hamburger-menu';
        hamburgerMenu.innerHTML = `
            <div class="hamburger-icon">
                <span></span><span></span><span></span>
            </div>
        `;
        headerContainer.appendChild(hamburgerMenu);
    }

    const hamburgerIcon = hamburgerMenu.querySelector('.hamburger-icon');

    // Build/off-canvas mobile navigation
    const mobileNav = document.createElement('div');
    mobileNav.className = 'mobile-nav';

    // Clone desktop navigation but REMOVE the 'nav' class so it isn't hidden by media-query
    const desktopNav = document.querySelector('.nav');
    if (!desktopNav) return; // no nav, abort
    const navClone = desktopNav.cloneNode(true);
    navClone.classList.add('mobile-nav-links');
    navClone.classList.remove('nav');
    mobileNav.appendChild(navClone);

    // Dark overlay behind menu
    const overlay = document.createElement('div');
    overlay.className = 'mobile-overlay';

    document.body.appendChild(mobileNav);
    document.body.appendChild(overlay);

    // Helper to open / close
    const toggleMobileMenu = () => {
        mobileNav.classList.toggle('active');
        overlay.classList.toggle('active');
        hamburgerIcon.classList.toggle('active');
        document.body.style.overflow = mobileNav.classList.contains('active') ? 'hidden' : '';
    };
    const closeMobileMenu = () => {
        mobileNav.classList.remove('active');
        overlay.classList.remove('active');
        hamburgerIcon.classList.remove('active');
        document.body.style.overflow = '';
    };

    // Wire events
    hamburgerMenu.addEventListener('click', toggleMobileMenu);
    overlay.addEventListener('click', closeMobileMenu);
    // Close when any link (including in cloned menu) is tapped
    mobileNav.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', closeMobileMenu);
    });
}

// Enable touch-friendly sorting for page thumbnails using SortableJS
if (typeof PDFConverterPro !== 'undefined' && typeof Sortable !== 'undefined') {
    PDFConverterPro.prototype.enableThumbnailSorting = function () {
        const container = document.getElementById('page-thumbnails');
        if (!container) return;

        // Destroy previous instance to avoid duplicates
        if (this.thumbnailSortable && typeof this.thumbnailSortable.destroy === 'function') {
            this.thumbnailSortable.destroy();
        }

        this.thumbnailSortable = Sortable.create(container, {
            animation: 220,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            draggable: '.page-thumbnail',
            // allow drag from any part of the thumbnail
            delay: 700,              // ~1 second long-press on touch devices
            delayOnTouchOnly: true,
            touchStartThreshold: 3,
            forceFallback: true,     // consistent drag preview
            fallbackOnBody: true,
            fallbackTolerance: 3,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: () => {
                this.showNotification('Pages reordered! Click Process to generate the sorted PDF.', 'success');
            }
        });
    };
}

// Initialize the main application logic
document.addEventListener('DOMContentLoaded', function () {
    // Initialize FAQ on all pages
    initializeFAQAccordion();
    
    // Initialize mobile navigation
    initializeMobileNav();
    
    // Check if we are on the main page (index.html) by looking for the tools layout
    const isMainPage = document.querySelector('.tools-grid, .tools-table');

    if (isMainPage) {
        // Main page specific initializations
        window.pdfConverter = new PDFConverterPro();
        console.log('PDF Converter Pro initialized for main page');

        // Legacy support: make tool cards clickable if present
        document.querySelectorAll('.tool-card').forEach(card => {
            card.addEventListener('click', () => {
                const tool = card.dataset.tool;
                if (tool) {
                    window.location.href = `${tool}.html`;
                }
            });
        });

        // Handle newsletter form submission
        const newsletterForm = document.getElementById('newsletter-form');
        if (newsletterForm) {
            newsletterForm.addEventListener('submit', function (e) {
                e.preventDefault();
                const email = document.getElementById('newsletter-email').value;
                if (email) {
                    window.pdfConverter.showNotification('Thank you for subscribing!', 'success');
                    this.reset();
                } else {
                    window.pdfConverter.showNotification('Please enter a valid email address.', 'error');
                }
            });
        }

        // Smooth scroll for anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const targetId = this.getAttribute('href');
                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });
    }
    // Note: Tool-specific pages have their own initialization script in their respective HTML files,
    // which creates an instance of PDFConverterPro and calls setupToolSpecificPage().
});
