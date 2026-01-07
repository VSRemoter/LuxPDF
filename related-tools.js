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

// Related Tools Configuration
const RELATED_TOOLS_CONFIG = {
    'merge-pdf': [
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        },
        {
            name: 'Compress PDF',
            url: '/compress-pdf.html',
            description: 'Reduce PDF file size while maintaining quality',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-compress-arrows-alt"></i>'
        },
        {
            name: 'Sort Pages',
            url: '/sort-pages.html',
            description: 'Swap & sort PDF pages in anyway you want',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-sort"></i>'
        },
        {
            name: 'Extract Pages',
            url: '/extract-pages.html',
            description: 'Select specific pages to extract from PDF',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-hand-paper"></i>'
        }
    ],
    'split-pdf': [
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Extract Pages',
            url: '/extract-pages.html',
            description: 'Select specific pages to extract from PDF',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-hand-paper"></i>'
        },
        {
            name: 'Remove Pages',
            url: '/remove-pages.html',
            description: 'Delete specific pages from PDF files',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-trash-alt"></i>'
        },
        {
            name: 'Sort Pages',
            url: '/sort-pages.html',
            description: 'Swap & sort PDF pages in anyway you want',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-sort"></i>'
        }
    ],
    'compress-pdf': [
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Remove Metadata',
            url: '/remove-metadata.html',
            description: 'Strip all metadata from PDF files for privacy',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-eraser"></i>'
        },
        {
            name: 'Remove Pages',
            url: '/remove-pages.html',
            description: 'Delete specific pages from PDF files',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-trash-alt"></i>'
        },
        {
            name: 'Sort Pages',
            url: '/sort-pages.html',
            description: 'Swap & sort PDF pages in anyway you want',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-sort"></i>'
        }
    ],
    'extract-pages': [
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        },
        {
            name: 'Remove Pages',
            url: '/remove-pages.html',
            description: 'Delete specific pages from PDF files',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-trash-alt"></i>'
        },
        {
            name: 'Sort Pages',
            url: '/sort-pages.html',
            description: 'Swap & sort PDF pages in anyway you want',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-sort"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'remove-pages': [
        {
            name: 'Extract Pages',
            url: '/extract-pages.html',
            description: 'Select specific pages to extract from PDF',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-hand-paper"></i>'
        },
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        },
        {
            name: 'Sort Pages',
            url: '/sort-pages.html',
            description: 'Swap & sort PDF pages in anyway you want',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-sort"></i>'
        },
        {
            name: 'Compress PDF',
            url: '/compress-pdf.html',
            description: 'Reduce PDF file size while maintaining quality',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-compress-arrows-alt"></i>'
        }
    ],
    'sort-pages': [
        {
            name: 'Extract Pages',
            url: '/extract-pages.html',
            description: 'Select specific pages to extract from PDF',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-hand-paper"></i>'
        },
        {
            name: 'Remove Pages',
            url: '/remove-pages.html',
            description: 'Delete specific pages from PDF files',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-trash-alt"></i>'
        },
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'rotate-pdf': [
        {
            name: 'Sort Pages',
            url: '/sort-pages.html',
            description: 'Swap & sort PDF pages in anyway you want',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-sort"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        },
        {
            name: 'Compress PDF',
            url: '/compress-pdf.html',
            description: 'Reduce PDF file size while maintaining quality',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-compress-arrows-alt"></i>'
        }
    ],
    'remove-metadata': [
        {
            name: 'Compress PDF',
            url: '/compress-pdf.html',
            description: 'Reduce PDF file size while maintaining quality',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-compress-arrows-alt"></i>'
        },
        {
            name: 'Remove Password',
            url: '/remove-password.html',
            description: 'Remove the password of a PDF file',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-unlock"></i>'
        },
        {
            name: 'Remove Pages',
            url: '/remove-pages.html',
            description: 'Delete specific pages from PDF files',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-trash-alt"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'remove-password': [
        {
            name: 'Remove Metadata',
            url: '/remove-metadata.html',
            description: 'Strip all metadata from PDF files for privacy',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-eraser"></i>'
        },
        {
            name: 'Compress PDF',
            url: '/compress-pdf.html',
            description: 'Reduce PDF file size while maintaining quality',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-compress-arrows-alt"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        }
    ],
    'add-password': [
        {
            name: 'Remove Password',
            url: '/remove-password.html',
            description: 'Unlock a PDF with its current password',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-unlock"></i>'
        },
        {
            name: 'Remove Metadata',
            url: '/remove-metadata.html',
            description: 'Strip all metadata from PDF files for privacy',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-eraser"></i>'
        },
        {
            name: 'Compress PDF',
            url: '/compress-pdf.html',
            description: 'Reduce PDF file size while maintaining quality',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-compress-arrows-alt"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'pdf-to-png': [
        {
            name: 'PNG to PDF',
            url: '/png-to-pdf.html',
            description: 'Convert PNG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'PDF to JPEG',
            url: '/pdf-to-jpeg.html',
            description: 'Convert PDF pages to JPEG images',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-image"></i>'
        },
        {
            name: 'JPEG to PDF',
            url: '/jpeg-to-pdf.html',
            description: 'Convert JPEG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        }
    ],
    'pdf-to-jpeg': [
        {
            name: 'JPEG to PDF',
            url: '/jpeg-to-pdf.html',
            description: 'Convert JPEG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'PDF to PNG',
            url: '/pdf-to-png.html',
            description: 'Convert PDF pages to high-quality PNG images',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-image"></i>'
        },
        {
            name: 'PNG to PDF',
            url: '/png-to-pdf.html',
            description: 'Convert PNG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        }
    ],
    'png-to-pdf': [
        {
            name: 'PDF to PNG',
            url: '/pdf-to-png.html',
            description: 'Convert PDF pages to high-quality PNG images',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-image"></i>'
        },
        {
            name: 'JPEG to PDF',
            url: '/jpeg-to-pdf.html',
            description: 'Convert JPEG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'PDF to JPEG',
            url: '/pdf-to-jpeg.html',
            description: 'Convert PDF pages to JPEG images',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-image"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'jpeg-to-pdf': [
        {
            name: 'PDF to JPEG',
            url: '/pdf-to-jpeg.html',
            description: 'Convert PDF pages to JPEG images',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-image"></i>'
        },
        {
            name: 'PNG to PDF',
            url: '/png-to-pdf.html',
            description: 'Convert PNG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'PDF to PNG',
            url: '/pdf-to-png.html',
            description: 'Convert PDF pages to high-quality PNG images',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-image"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'pdf-to-txt': [
        {
            name: 'TXT to PDF',
            url: '/txt-to-pdf.html',
            description: 'Convert text files to PDF documents',
            icon: '<i class="fas fa-file-alt"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'PDF to PNG',
            url: '/pdf-to-png.html',
            description: 'Convert PDF pages to high-quality PNG images',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-image"></i>'
        },
        {
            name: 'PDF to JPEG',
            url: '/pdf-to-jpeg.html',
            description: 'Convert PDF pages to JPEG images',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-image"></i>'
        },
        {
            name: 'Split PDF',
            url: '/split-pdf.html',
            description: 'Split PDF into separate pages or ranges',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-scissors"></i>'
        }
    ],
    'txt-to-pdf': [
        {
            name: 'PDF to TXT',
            url: '/pdf-to-txt.html',
            description: 'Extract text content from PDF files',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-alt"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Compress PDF',
            url: '/compress-pdf.html',
            description: 'Reduce PDF file size while maintaining quality',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-compress-arrows-alt"></i>'
        },
        {
            name: 'PNG to PDF',
            url: '/png-to-pdf.html',
            description: 'Convert PNG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'heif-to-pdf': [
        {
            name: 'JPEG to PDF',
            url: '/jpeg-to-pdf.html',
            description: 'Convert JPEG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'PNG to PDF',
            url: '/png-to-pdf.html',
            description: 'Convert PNG images to PDF documents',
            icon: '<i class="fas fa-file-image"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'html-to-pdf': [
        {
            name: 'PDF to TXT',
            url: '/pdf-to-txt.html',
            description: 'Extract text content from PDF files',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-alt"></i>'
        },
        {
            name: 'TXT to PDF',
            url: '/txt-to-pdf.html',
            description: 'Convert text files to PDF documents',
            icon: '<i class="fas fa-file-alt"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Compress PDF',
            url: '/compress-pdf.html',
            description: 'Reduce PDF file size while maintaining quality',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-compress-arrows-alt"></i>'
        }
    ],
    'markdown-to-pdf': [
        {
            name: 'MD-Text to PDF',
            url: '/markdown-text-to-pdf.html',
            description: 'Live Markdown editor with real-time PDF preview',
            icon: '<i class="fas fa-edit"></i>'
        },
        {
            name: 'TXT to PDF',
            url: '/txt-to-pdf.html',
            description: 'Convert text files to PDF documents',
            icon: '<i class="fas fa-file-alt"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ],
    'markdown-text-to-pdf': [
        {
            name: 'Markdown to PDF',
            url: '/markdown-to-pdf.html',
            description: 'Convert Markdown files to PDF documents',
            icon: '<i class="fab fa-markdown"></i>'
        },
        {
            name: 'TXT to PDF',
            url: '/txt-to-pdf.html',
            description: 'Convert text files to PDF documents',
            icon: '<i class="fas fa-file-alt"></i><i class="fas fa-arrow-right"></i><i class="fas fa-file-pdf"></i>'
        },
        {
            name: 'Merge PDF',
            url: '/merge-pdf.html',
            description: 'Combine multiple PDF files into one',
            icon: '<i class="fas fa-file-pdf"></i><i class="fas fa-plus"></i><i class="fas fa-file-pdf"></i>'
        }
    ]
};

// Function to generate related tools HTML
function generateRelatedToolsHTML(currentTool) {
    const relatedTools = RELATED_TOOLS_CONFIG[currentTool];
    if (!relatedTools) return '';

    return `
        <section class="related-tools-section">
            <div class="container">
                <h3 class="section-title">See Our Related Tools</h3>
                <div class="related-tools-grid">
                    ${relatedTools.map(tool => `
                        <a href="${tool.url}" class="related-tool-card">
                            <div class="related-tool-icon">
                                ${tool.icon}
                            </div>
                            <h4>${tool.name}</h4>
                            <p>${tool.description}</p>
                        </a>
                    `).join('')}
                </div>
            </div>
        </section>
    `;
}