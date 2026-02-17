# LuxPDF: Open-Source, Privacy-First PDF and Document Tools

LuxPDF is a free, open-source web app for PDF, document, and image workflows. It is built to run 100% client-side in the browser so user files are processed locally rather than uploaded to an app server. We take pride in making a PDF WebApp that is both elegant and useful.

Website: https://luxpdf.com

## Core Principles:

- Client-side processing by default for privacy
- No required account to use tools
- No limitations on usage, or file size
- Open-source codebase (AGPL-3.0)
- Funded by donations and sponsors

## Implemented Tools (36)

### PDF and Document Conversions

- JPEG to PDF (`jpeg-to-pdf.html`)
- PNG to PDF (`png-to-pdf.html`)
- TXT to PDF (`txt-to-pdf.html`)
- HTML to PDF (`html-to-pdf.html`)
- Markdown to PDF (`markdown-to-pdf.html`)
- Markdown Text to PDF (`markdown-text-to-pdf.html`)
- Word to PDF (`word-to-pdf.html`)
- RTF to PDF (`rtf-to-pdf.html`)
- PowerPoint to PDF (`ppt-to-pdf.html`)
- Excel to PDF (`excel-to-pdf.html`)
- HEIF/HEIC to PDF (`heif-to-pdf.html`)
- WEBP to PDF (`webp-to-pdf.html`)
- SVG to PDF (`svg-to-pdf.html`)
- PDF to JPEG (`pdf-to-jpeg.html`)
- PDF to PNG (`pdf-to-png.html`)
- PDF to TXT (`pdf-to-txt.html`)

### Image Format and Image Utilities

- WEBP to PNG (`webp-to-png.html`)
- WEBP to JPEG (`webp-to-jpeg.html`)
- SVG to PNG (`svg-to-png.html`)
- SVG to JPEG (`svg-to-jpeg.html`)
- Compress Image (`compress-image.html`)
- Image Resizer (`image-resizer.html`)

### PDF Editing and Organization

- Merge PDF (`merge-pdf.html`)
- Split PDF (`split-pdf.html`)
- Extract Pages (`extract-pages.html`)
- Remove Pages (`remove-pages.html`)
- Sort Pages (`sort-pages.html`)
- Rotate PDF (`rotate-pdf.html`)
- Compress PDF (`compress-pdf.html`)
- Flatten PDF (`flatten-pdf.html`)
- Add Watermark (`add-watermark.html`)
- Compare PDFs (`compare-pdfs.html`)

### PDF Security and Privacy

- Add Password / Encrypt PDF (`add-password.html`)
- Remove Password (`remove-password.html`)
- Remove Metadata (`remove-metadata.html`)
- Edit Metadata (`edit-metadata.html`)

## Site Pages

- Home (`index.html`)
- Blog (`blog.html`)
- Changelog (`changelog.html`)
- Support (`support.html`)
- Privacy Policy (`privacy.html`)
- Terms (`terms.html`)
- Intro Post (`introducing-luxpdf.html`)

## Tech Stack

- HTML, CSS, JavaScript (vanilla)
- `pdf-lib`
- Mozilla `pdf.js`
- `JSZip`
- `pica`
- Vendor helpers in `vendor/`

## Local Development

This project is static-site based. You can run it with any local static file server.

Example options:

- VS Code Live Server
- `python -m http.server`
- `npx serve`

Then open `index.html` from the local server URL.

## Quick Links

- Website: https://luxpdf.com
- Blog: https://luxpdf.com/blog.html
- Changelog: https://luxpdf.com/changelog.html
- Privacy Policy: https://luxpdf.com/privacy.html
- Terms of Service: https://luxpdf.com/terms.html
- Support: https://luxpdf.com/support.html
- GitHub: https://github.com/VSRemoter/LuxPDF

## License

Licensed under the GNU Affero General Public License v3.0. See `LICENSE`.
