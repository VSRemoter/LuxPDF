import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import JSZip from 'jszip';

// Image conversion functions
export const convertPdfToImage = async (pdfFile, format = 'image/jpeg') => {
  try {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await getDocument(arrayBuffer).promise;
    const page = await pdf.getPage(1);
    
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve({
          success: true,
          data: blob,
          fileName: `${pdfFile.name.replace('.pdf', '')}.${format.split('/')[1]}`
        });
      }, format);
    });
  } catch (error) {
    console.error('PDF to image conversion error:', error);
    return {
      success: false,
      error: error.message || 'Error converting PDF to image'
    };
  }
};

export const convertImageToPdf = async (imageFile) => {
  try {
    const pdfDoc = await PDFDocument.create();
    const imageBytes = await imageFile.arrayBuffer();
    
    let image;
    if (imageFile.type === 'image/jpeg') {
      image = await pdfDoc.embedJpg(imageBytes);
    } else if (imageFile.type === 'image/png') {
      image = await pdfDoc.embedPng(imageBytes);
    } else if (imageFile.type === 'image/webp') {
      // Convert WebP to PNG first using canvas
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = URL.createObjectURL(imageFile);
      });
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const pngBuffer = await pngBlob.arrayBuffer();
      image = await pdfDoc.embedPng(pngBuffer);
      
      URL.revokeObjectURL(img.src);
    } else {
      throw new Error('Unsupported image format');
    }
    
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
    
    const pdfBytes = await pdfDoc.save();
    return {
      success: true,
      data: new Blob([pdfBytes], { type: 'application/pdf' }),
      fileName: `${imageFile.name.split('.')[0]}.pdf`
    };
  } catch (error) {
    console.error('Image to PDF conversion error:', error);
    return {
      success: false,
      error: error.message || 'Error converting image to PDF'
    };
  }
};

export const convertMultipleImagesToPdf = async (imageFiles) => {
  try {
    const pdfDoc = await PDFDocument.create();
    
    for (const imageFile of imageFiles) {
      const imageBytes = await imageFile.arrayBuffer();
      
      let image;
      if (imageFile.type === 'image/jpeg') {
        image = await pdfDoc.embedJpg(imageBytes);
      } else if (imageFile.type === 'image/png') {
        image = await pdfDoc.embedPng(imageBytes);
      } else if (imageFile.type === 'image/webp') {
        // Convert WebP to PNG first
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = URL.createObjectURL(imageFile);
        });
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const pngBuffer = await pngBlob.arrayBuffer();
        image = await pdfDoc.embedPng(pngBuffer);
        
        URL.revokeObjectURL(img.src);
      } else {
        console.warn(`Skipping unsupported format: ${imageFile.type}`);
        continue;
      }
      
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }
    
    const pdfBytes = await pdfDoc.save();
    return {
      success: true,
      data: new Blob([pdfBytes], { type: 'application/pdf' }),
      fileName: 'combined_images.pdf'
    };
  } catch (error) {
    console.error('Multiple images to PDF conversion error:', error);
    return {
      success: false,
      error: error.message || 'Error converting images to PDF'
    };
  }
};

export const mergePDFs = async (files) => {
  try {
    const mergedPdf = await PDFDocument.create();
    
    for (const file of files) {
      const fileArrayBuffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(fileArrayBuffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
    
    const mergedPdfFile = await mergedPdf.save();
    return {
      success: true,
      data: new Blob([mergedPdfFile], { type: 'application/pdf' }),
      fileName: 'merged.pdf'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

export const splitPDF = async (file, startPage, endPage) => {
  try {
    const fileArrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(fileArrayBuffer);
    const newPdf = await PDFDocument.create();
    
    const pageIndices = [];
    for (let i = startPage - 1; i < endPage; i++) {
      pageIndices.push(i);
    }
    
    const pages = await newPdf.copyPages(pdf, pageIndices);
    pages.forEach(page => newPdf.addPage(page));
    
    const splitPdfFile = await newPdf.save();
    return {
      success: true,
      data: new Blob([splitPdfFile], { type: 'application/pdf' }),
      fileName: `split_${startPage}-${endPage}.pdf`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

export const compressPDF = async (file) => {
  try {
    const fileArrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(fileArrayBuffer);
    const compressedPdfFile = await pdf.save({
      useObjectStreams: true,
      objectsPerStream: 50
    });
    
    return {
      success: true,
      data: new Blob([compressedPdfFile], { type: 'application/pdf' }),
      fileName: 'compressed.pdf'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

export const rotatePDF = async (file, angle) => {
  try {
    const fileArrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(fileArrayBuffer);
    
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const page = pdf.getPage(i);
      page.setRotation(angle);
    }
    
    const rotatedPdfFile = await pdf.save();
    return {
      success: true,
      data: new Blob([rotatedPdfFile], { type: 'application/pdf' }),
      fileName: 'rotated.pdf'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

export const convertPdfToText = async (pdfFile) => {
  try {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await getDocument(arrayBuffer).promise;
    
    let fullText = '';
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');
      
      fullText += pageText + '\n\n';
    }
    
    // Clean up the text
    const cleanedText = fullText.trim();
    const blob = new Blob([cleanedText], { type: 'text/plain' });
    
    return {
      success: true,
      data: blob,
      fileName: `${pdfFile.name.replace('.pdf', '')}.txt`
    };
  } catch (error) {
    console.error('PDF to text conversion error:', error);
    return {
      success: false,
      error: 'Error converting PDF to text'
    };
  }
};

export const convertTextToPdf = async (textFiles) => {
  try {
    if (!textFiles || textFiles.length === 0) {
      throw new Error('No text files provided');
    }

    // Create a new ZIP file
    const zip = new JSZip();
    let validFilesProcessed = 0;
    
    // Character mapping for special characters
    const charMap = {
      '\u25CF': '•',  // Black circle to bullet
      '\u25CB': '•',  // White circle to bullet
      '\u25A0': '•',  // Black square to bullet
      '\u25A1': '•',  // White square to bullet
      '\u25B2': '•',  // Black triangle to bullet
      '\u25B3': '•',  // White triangle to bullet
      '\u25C6': '•',  // Black diamond to bullet
      '\u25C7': '•',  // White diamond to bullet
      '\u2605': '•',  // Black star to bullet
      '\u2606': '•',  // White star to bullet
      '\u2192': '->', // Right arrow
      '\u2190': '<-', // Left arrow
      '\u2191': '^',  // Up arrow
      '\u2193': 'v',  // Down arrow
      '\u2026': '...', // Ellipsis
      '\u2014': '-',  // Em dash
      '\u2013': '-',  // En dash
      '\u201C': '"',  // Smart quotes
      '\u201D': '"',  // Smart quotes
      '\u2018': "'",  // Smart quotes
      '\u2019': "'",  // Smart quotes
      '\u00A9': '(c)', // Copyright
      '\u00AE': '(R)', // Registered
      '\u2122': '(TM)', // Trademark
      '\u00B1': '+/-', // Plus-minus
      '\u00D7': 'x',  // Multiplication
      '\u00F7': '/',  // Division
      '\u2260': '!=', // Not equal
      '\u2264': '<=', // Less than or equal
      '\u2265': '>=', // Greater than or equal
      '\u221E': 'inf', // Infinity
      '\u2211': 'sum', // Sum
      '\u220F': 'prod', // Product
      '\u221A': 'sqrt', // Square root
      '\u222B': 'int', // Integral
      '\u2206': 'delta', // Delta
      '\u03C0': 'pi', // Pi
      '\u00B5': 'mu', // Micro
      '\u00B0': 'deg', // Degree
      '\u00B2': '2',  // Superscript 2
      '\u00B3': '3',  // Superscript 3
      '\u2081': '1',  // Subscript 1
      '\u2082': '2',  // Subscript 2
      '\u2083': '3'   // Subscript 3
    };
    
    // Process each text file
    for (const textFile of textFiles) {
      try {
        // Read the text file using FileReader with UTF-8 encoding
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const content = e.target.result;
            if (!content || content.trim().length === 0) {
              reject(new Error(`File ${textFile.name} is empty`));
            } else {
              resolve(content);
            }
          };
          reader.onerror = () => reject(new Error(`Error reading file ${textFile.name}`));
          reader.readAsText(textFile, 'UTF-8');
        });

        // Replace special characters
        const processedText = text.replace(/[\u25CF\u25CB\u25A0\u25A1\u25B2\u25B3\u25C6\u25C7\u2605\u2606\u2192\u2190\u2191\u2193\u2026\u2014\u2013\u201C\u201D\u2018\u2019\u00A9\u00AE\u2122\u00B1\u00D7\u00F7\u2260\u2264\u2265\u221E\u2211\u220F\u221A\u222B\u2206\u03C0\u00B5\u00B0\u00B2\u00B3\u2081\u2082\u2083]/g, char => charMap[char] || char);

        // Create a new PDF document
        const pdfDoc = await PDFDocument.create();
        
        // Embed multiple fonts for better character support
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const timesFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        
        // Set up page and text formatting
        const pageWidth = 612; // Letter size width in points
        const pageHeight = 792; // Letter size height in points
        const margin = 50;
        const fontSize = 12;
        const lineHeight = fontSize * 1.2;
        
        let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        let yPosition = pageHeight - margin;
        
        // Function to add a new page
        const addNewPage = () => {
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          yPosition = pageHeight - margin;
        };
        
        // Function to check if text contains special characters
        const hasSpecialCharacters = (text) => {
          // Check for remaining special characters
          return /[^\x00-\x7F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u0250-\u02AF\u02B0-\u02FF\u0300-\u036F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u0800-\u083F\u0840-\u085F\u0860-\u086F\u0870-\u089F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u10A0-\u10FF\u1100-\u11FF\u1200-\u137F\u1380-\u139F\u13A0-\u13FF\u1400-\u167F\u1680-\u169F\u16A0-\u16FF\u1700-\u171F\u1720-\u173F\u1740-\u175F\u1760-\u177F\u1780-\u17FF\u1800-\u18AF\u18B0-\u18FF\u1900-\u194F\u1950-\u197F\u1980-\u19DF\u19E0-\u19FF\u1A00-\u1A1F\u1A20-\u1AAF\u1AB0-\u1AFF\u1B00-\u1B7F\u1B80-\u1BBF\u1BC0-\u1BFF\u1C00-\u1C4F\u1C50-\u1C7F\u1C80-\u1C8F\u1C90-\u1CBF\u1CC0-\u1CCF\u1CD0-\u1CFF\u1D00-\u1D7F\u1D80-\u1DBF\u1DC0-\u1DFF\u1E00-\u1EFF\u1F00-\u1FFF\u2000-\u206F\u2070-\u209F\u20A0-\u20CF\u20D0-\u20FF\u2100-\u214F\u2150-\u218F\u2190-\u21FF\u2200-\u22FF\u2300-\u23FF\u2400-\u243F\u2440-\u245F\u2460-\u24FF\u2500-\u257F\u2580-\u25FF\u2600-\u26FF\u2700-\u27BF\u27C0-\u27EF\u27F0-\u27FF\u2800-\u28FF\u2900-\u297F\u2980-\u29FF\u2A00-\u2AFF\u2B00-\u2BFF\u2C00-\u2C5F\u2C60-\u2C7F\u2C80-\u2CFF\u2D00-\u2D2F\u2D30-\u2D7F\u2D80-\u2DDF\u2DE0-\u2DFF\u2E00-\u2E7F\u2E80-\u2EFF\u2F00-\u2FDF\u2FF0-\u2FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3100-\u312F\u3130-\u318F\u3190-\u319F\u31A0-\u31BF\u31C0-\u31EF\u31F0-\u31FF\u3200-\u32FF\u3300-\u33FF\u3400-\u4DBF\u4DC0-\u4DFF\u4E00-\u9FFF\uA000-\uA48F\uA490-\uA4CF\uA4D0-\uA4FF\uA500-\uA63F\uA640-\uA69F\uA6A0-\uA6FF\uA700-\uA71F\uA720-\uA7FF\uA800-\uA82F\uA830-\uA83F\uA840-\uA87F\uA880-\uA8DF\uA8E0-\uA8FF\uA900-\uA92F\uA930-\uA95F\uA960-\uA97F\uA980-\uA9DF\uA9E0-\uA9FF\uAA00-\uAA5F\uAA60-\uAA7F\uAA80-\uAADF\uAAE0-\uAAFF\uAB00-\uAB2F\uAB30-\uAB6F\uAB70-\uABBF\uABC0-\uABFF\uAC00-\uD7AF\uD7B0-\uD7FF\uD800-\uDB7F\uDB80-\uDBFF\uDC00-\uDFFF\uE000-\uF8FF\uF900-\uFAFF\uFB00-\uFB4F\uFB50-\uFDFF\uFE00-\uFE0F\uFE10-\uFE1F\uFE20-\uFE2F\uFE30-\uFE4F\uFE50-\uFE6F\uFE70-\uFEFF\uFF00-\uFFEF\uFFF0-\uFFFF]/.test(text);
        };
        
        // Function to wrap text
        const wrapText = (text, maxWidth, font) => {
          const words = text.split(' ');
          const lines = [];
          let currentLine = '';
          
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const testWidth = font.widthOfTextAtSize(testLine, fontSize);
            
            if (testWidth <= maxWidth) {
              currentLine = testLine;
            } else {
              if (currentLine) {
                lines.push(currentLine);
              }
              currentLine = word;
            }
          }
          
          if (currentLine) {
            lines.push(currentLine);
          }
          
          return lines;
        };
        
        // Process the text content
        const lines = processedText.split('\n');
        const maxWidth = pageWidth - (2 * margin);
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) {
            yPosition -= lineHeight;
            continue;
          }
          
          // Choose font based on content
          const font = hasSpecialCharacters(trimmedLine) ? helveticaFont : timesFont;
          const wrappedLines = wrapText(trimmedLine, maxWidth, font);
          
          for (const wrappedLine of wrappedLines) {
            // Check if we need a new page
            if (yPosition < margin + lineHeight) {
              addNewPage();
            }
            
            try {
              // Draw the line
              currentPage.drawText(wrappedLine, {
                x: margin,
                y: yPosition,
                size: fontSize,
                font: font,
                color: rgb(0, 0, 0)
              });
            } catch (textError) {
              console.warn(`Warning: Could not render text with special characters: ${wrappedLine}`);
              // Try to draw a placeholder for problematic text
              currentPage.drawText('[Special characters not supported]', {
                x: margin,
                y: yPosition,
                size: fontSize,
                font: helveticaFont,
                color: rgb(0.5, 0, 0) // Red color to indicate warning
              });
            }
            
            yPosition -= lineHeight;
          }
          
          // Add space between paragraphs
          yPosition -= lineHeight * 0.5;
        }
        
        // Save the PDF
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        
        // Add to ZIP with original filename
        const fileName = `${textFile.name.replace('.txt', '')}.pdf`;
        zip.file(fileName, blob);
        validFilesProcessed++;
        
      } catch (fileError) {
        console.error(`Error processing file ${textFile.name}:`, fileError);
        throw new Error(`Error processing ${textFile.name}: ${fileError.message}`);
      }
    }
    
    if (validFilesProcessed === 0) {
      throw new Error('No files were successfully converted. Please check your text files.');
    }
    
    // Generate ZIP file
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    
    return {
      success: true,
      data: zipBlob,
      fileName: 'converted_texts.zip'
    };
    
  } catch (error) {
    console.error('Text to PDF conversion error:', error);
    return {
      success: false,
      error: error.message || 'Error converting text to PDF'
    };
  }
};

const sanitizeFileName = (fileName) => {
  return fileName
    .replace(/[/\\?%*:|"<>]/g, '-') // Replace invalid characters with hyphen
    .replace(/[\x00-\x1F\x7F]/g, '-'); // Replace control characters with hyphen
}; 