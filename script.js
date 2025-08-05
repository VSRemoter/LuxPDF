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
        this.init();
    }

    init() {
        this.bindEvents();
        this.setupDragAndDrop();
        this.loadLastUsedTool();
    }

    // Method to setup tool-specific pages
    setupToolSpecificPage() {
        if (!this.currentTool) return;

        // Set file input accept attribute based on tool
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            const toolConfig = this.getToolConfig(this.currentTool);
            fileInput.accept = toolConfig.accept;
        }

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

    bindEvents() {
        // Search bar functionality (only for main page)
        const searchBar = document.getElementById('tool-search-bar');
        if (searchBar) {
            searchBar.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase().trim();
                document.querySelectorAll('.tool-card').forEach(card => {
                    const title = card.querySelector('h3').textContent.toLowerCase();
                    const description = card.querySelector('p').textContent.toLowerCase();
                    const isVisible = title.includes(searchTerm) || description.includes(searchTerm);
                    card.style.display = isVisible ? 'block' : 'none';
                });
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

            'remove-password': {
                title: 'Remove Password from PDF',
                accept: '.pdf',
                description: 'Remove the password of a PDF file<'
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
            'heic-to-pdf': {
                title: 'HEIC to PDF Converter',
                accept: '.heic,.heif',
                description: 'Convert HEIC/HEIF images to PDF documents'
            }
        };
        return configs[toolName] || { title: 'PDF Tool', accept: '*', description: '' };
    }

    handleFileSelect(files) {
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
    }

    validateFile(file) {
        const toolConfig = this.getToolConfig(this.currentTool);
        const acceptedTypes = toolConfig.accept.split(',').map(type => type.trim());

        if (acceptedTypes.includes('*')) return true;

        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        const isValid = acceptedTypes.some(type =>
            type === fileExtension ||
            file.type.includes(type.replace('.', ''))
        );

        if (!isValid) {
            this.showError(`File type not supported for this tool: ${file.name}`);
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

        // Generate preview for image files automatically (except for PNG/JPEG to PDF tools)
        if (file.type.includes('image') && this.currentTool !== 'png-to-pdf' && this.currentTool !== 'jpeg-to-pdf') {
            this.generateImagePreview(file);
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
        const optionsContainer = document.getElementById('tool-options');
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
                        <div class="sort-controls" style="display: none; margin: 1rem 0;">
                            <button type="button" id="reverse-pages-btn" class="reverse-btn">
                                <i class="fas fa-exchange-alt"></i>
                                Reverse Order (Back to Front)
                            </button>
                        </div>
                        <div id="page-thumbnails" class="page-thumbnails-container" style="display: none;">
                            <!-- Page thumbnails will be generated here -->
                        </div>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Drag and drop the page thumbnails to rearrange them in your desired order.
                        </p>
                    </div>
                `;

                // Add event listener for reverse button immediately after DOM is updated
                this.setupReverseButtonListener();
                break;

            case 'heic-to-pdf':
                optionsContainer.innerHTML = `
                    <div class="option-group">
                        <label>Conversion Mode</label>
                        <select id="conversion-mode">
                            <option value="individual">Individual PDFs (one per HEIC file)</option>
                            <option value="combined">Merge all into single PDF</option>
                        </select>
                        <p style="font-size: 0.9rem; color: rgba(248, 250, 252, 0.6); margin-top: 0.5rem;">
                            Choose how you want your HEIC images converted to PDF format.
                        </p>
                    </div>
                `;
                break;
        }
    }

    updateProcessButton() {
        const processBtn = document.getElementById('process-btn');
        if (!processBtn) return; // Exit if process button doesn't exist

        const hasFiles = this.uploadedFiles.length > 0;

        processBtn.disabled = !hasFiles;

        if (hasFiles) {
            const fileCount = this.uploadedFiles.length;
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
                case 'png-to-pdf':
                    results = await this.convertPngToPdf();
                    break;
                case 'jpeg-to-pdf':
                    results = await this.convertJpegToPdf();
                    break;
                case 'pdf-to-txt':
                    results = await this.convertPdfToTxt();
                    break;
                case 'txt-to-pdf':
                    results = await this.convertTxtToPdf();
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
                case 'rotate-pdf':
                    results = await this.rotatePdf();
                    break;
                case 'remove-metadata':
                    results = await this.removeMetadata();
                    break;
                case 'remove-password':
                    results = await this.removePassword();
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
                case 'heic-to-pdf':
                    results = await this.heicToPdf();
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
        if (!results || results.length === 0) return;

        const resultsSection = document.getElementById('results-section');
        const resultsList = document.getElementById('results-list');

        if (!resultsSection || !resultsList) return; // Exit if elements don't exist

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

            resultItem.innerHTML = `
                <div class="file-info">
                    <i class="fas ${this.getFileIcon(result.type)} file-icon"></i>
                    <div class="file-details">
                        <h5>${result.name}</h5>
                        <p>${this.formatFileSize(result.size)}</p>
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
                    <div class="file-preview">
                        <img src="${e.target.result}" alt="${file.name}" style="max-height: 100px;">
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

    // Generate image preview for image files
    generateImagePreview(file) {
        if (!file.type.includes('image')) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const fileList = document.getElementById('file-list');
            const fileItem = fileList.querySelector(`.file-item:last-child`);

            if (fileItem) {
                const previewDiv = document.createElement('div');
                previewDiv.className = 'file-preview';
                previewDiv.innerHTML = `<img src="${e.target.result}" alt="${file.name}" style="max-height: 100px;">`;

                fileItem.appendChild(previewDiv);
            }
        };
        reader.readAsDataURL(file);
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

                results.push({
                    name: `${file.name.replace('.pdf', '')}_${rangeText}.pdf`,
                    type: 'application/pdf',
                    size: blob.size,
                    url: url
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

    // Setup reverse button event listener
    setupReverseButtonListener() {
        // Use a small delay to ensure DOM is updated
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
                // Store the original page index (0-based) - this represents which page from the original PDF this thumbnail shows
                thumbnailDiv.setAttribute('data-original-page-index', pageNum - 1);

                // Create a data URL from the canvas
                const dataURL = canvas.toDataURL('image/png');

                thumbnailDiv.innerHTML = `
                    <div class="thumbnail-header">Page ${pageNum}</div>
                    <div class="thumbnail-canvas-container">
                        <img src="${dataURL}" alt="Page ${pageNum}" style="width: 100%; height: auto; display: block;">
                    </div>
                `;

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





    // HEIC to PDF functionality
    async heicToPdf() {
        const results = [];
        const conversionMode = document.getElementById('conversion-mode')?.value || 'individual';

        if (conversionMode === 'combined') {
            // Combine all HEIC files into a single PDF
            const pdfDoc = await PDFLib.PDFDocument.create();

            for (const file of this.uploadedFiles) {
                try {
                    // Convert HEIC to JPEG
                    const jpegBlob = await heic2any({
                        blob: file,
                        toType: 'image/jpeg',
                        quality: 0.9
                    });

                    const jpegArrayBuffer = await jpegBlob.arrayBuffer();
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
                    console.error('Error processing HEIC file:', error);
                    throw new Error(`Failed to process ${file.name}: ${error.message}`);
                }
            }

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });

            results.push({
                name: 'combined_heic.pdf',
                type: 'application/pdf',
                size: blob.size,
                url: URL.createObjectURL(blob)
            });
        } else {
            // Convert each HEIC file to individual PDF
            for (const file of this.uploadedFiles) {
                try {
                    // Convert HEIC to JPEG
                    const jpegBlob = await heic2any({
                        blob: file,
                        toType: 'image/jpeg',
                        quality: 0.9
                    });

                    const jpegArrayBuffer = await jpegBlob.arrayBuffer();
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

                    const baseName = file.name.replace(/\.(heic|heif)$/i, '');
                    const fileName = `${baseName}.pdf`;

                    results.push({
                        name: fileName,
                        type: 'application/pdf',
                        size: blob.size,
                        url: URL.createObjectURL(blob)
                    });
                } catch (error) {
                    console.error('Error converting HEIC:', error);
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
            animation: 150,
            draggable: '.page-thumbnail',
            touchStartThreshold: 0,
            forceFallback: true, // always use fallback so ghost follows finger
            fallbackOnBody: true,
            fallbackTolerance: 3,
            draggable: '.page-thumbnail',
            touchStartThreshold: 0,
            
            ghostClass: 'dragging',
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
    
    // Check if we are on the main page (index.html) by looking for the tool grid
    const isMainPage = document.querySelector('.tools-grid');

    if (isMainPage) {
        // Main page specific initializations
        window.pdfConverter = new PDFConverterPro();
        console.log('PDF Converter Pro initialized for main page');

        // Make tool cards clickable
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