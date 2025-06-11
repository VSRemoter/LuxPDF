import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { FaFileUpload, FaCheck, FaSpinner, FaGripVertical, FaArrowUp, FaSearch, FaObjectGroup, FaCut, FaCompress, FaFileImage, FaFileAlt } from 'react-icons/fa';
import { mergePDFs, splitPDF, compressPDF, rotatePDF, convertPdfToImage, convertImageToPdf, convertMultipleImagesToPdf, convertPdfToText, convertTextToPdf } from '../utils/converter';
import { PDFDocument } from 'pdf-lib';

const ConverterContainer = styled.div`
  max-width: 900px;
  margin: 0 auto;
  padding: 0 1.5rem;
`;

const SearchContainer = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
  position: relative;
`;

const SearchIcon = styled.div`
  position: absolute;
  left: 0.8rem;
  color: ${props => props.theme.colors.primary};
  font-size: 0.9rem;
  opacity: 0.8;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 0.7rem 1rem 0.7rem 2.5rem;
  background-color: rgba(31, 31, 31, 0.8);
  border: 1px solid rgba(255, 191, 96, 0.2);
  border-radius: ${props => props.theme.borderRadius};
  font-size: 0.95rem;
  color: ${props => props.theme.colors.text};
  transition: ${props => props.theme.transition};
  
  &::placeholder {
    color: rgba(209, 207, 192, 0.5);
  }
  
  &:focus {
    outline: none;
    border-color: ${props => props.theme.colors.primary};
    box-shadow: 0 0 2px rgba(255, 191, 96, 0.2);
  }
`;

const TabsContainer = styled.div`
  display: flex;
  overflow-x: auto;
  margin-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 191, 96, 0.2);
`;

const Tab = styled.button`
  background: transparent;
  border: none;
  padding: 1rem 1.5rem;
  font-size: 0.95rem;
  font-weight: 500;
  color: ${props => props.active ? props.theme.colors.primary : props.theme.colors.text};
  white-space: nowrap;
  cursor: pointer;
  position: relative;
  transition: ${props => props.theme.transition};
  
  &:after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    width: ${props => props.active ? '100%' : '0'};
    height: 2px;
    background-color: ${props => props.theme.colors.primary};
    transition: width 0.3s ease;
  }
  
  &:hover {
    color: ${props => props.theme.colors.primary};
    
    &:after {
      width: 100%;
    }
  }
`;

const DropArea = styled.div`
  border: 2px dashed ${props => props.isDragging ? props.theme.colors.primary : 'rgba(209, 207, 192, 0.3)'};
  border-radius: ${props => props.theme.borderRadius};
  padding: 3rem 2rem;
  text-align: center;
  margin-bottom: 1.5rem;
  transition: ${props => props.theme.transition};
  background-color: ${props => props.isDragging ? 'rgba(255, 191, 96, 0.05)' : 'transparent'};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const UploadIcon = styled.div`
  font-size: 3.5rem;
  color: ${props => props.theme.colors.primary};
  margin-bottom: 1.5rem;
  opacity: 0.8;
`;

const UploadText = styled.p`
  margin-bottom: 0.5rem;
  font-weight: 500;
  font-size: 1.2rem;
`;

const UploadSubtext = styled.p`
  font-size: 0.95rem;
  opacity: 0.7;
  margin-bottom: 0;
`;

const FileInput = styled.input`
  display: none;
`;

const Button = styled.button`
  background-color: ${props => props.theme.colors.primary};
  color: #ffffff;
  border: none;
  border-radius: ${props => props.theme.borderRadius};
  padding: 0.9rem 2rem;
  font-weight: 600;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 1.5rem auto 0;
  transition: ${props => props.theme.transition};
  
  &:hover {
    background-color: #ffd699;
    transform: translateY(-2px);
  }
  
  &:disabled {
    background-color: rgba(255, 191, 96, 0.3);
    color: rgba(255, 255, 255, 0.7);
    cursor: not-allowed;
  }
`;

const FileList = styled.div`
  margin: 20px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const FileItem = styled.div`
  display: flex;
  align-items: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 8px;
  color: white;
  cursor: move;
  transition: all 0.3s ease;
  gap: 12px;
  transform: translateY(${props => props.isDragging ? '-2px' : '0'});
  opacity: ${props => props.isDragging ? '0.5' : '1'};
  box-shadow: ${props => props.isDragging ? '0 8px 20px rgba(255, 215, 0, 0.2)' : 'none'};
  
  &:hover {
    border-color: #FFD700;
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(255, 215, 0, 0.1);
  }

  &.dragging-over {
    border-color: #FFD700;
    background: rgba(255, 215, 0, 0.1);
  }
`;

const TabConverter = () => {
  const [activeTabId, setActiveTabId] = useState('merge-pdf');
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTabs, setFilteredTabs] = useState([]);
  
  const fileInputRef = useRef(null);
  const searchInputRef = useRef(null);

  // Memoize tabs to prevent recreation on every render
  const tabs = React.useMemo(() => [
    {
      id: 'merge-pdf',
      label: 'Merge PDFs',
      icon: <FaObjectGroup />,
      description: 'Combine multiple PDFs into one',
      accept: '.pdf',
      multiple: true,
      acceptedFormats: ['.pdf']
    },
    {
      id: 'split-pdf',
      label: 'Split PDF',
      icon: <FaCut />,
      description: 'Split PDF into multiple files',
      accept: '.pdf',
      multiple: false,
      acceptedFormats: ['.pdf']
    },
    {
      id: 'compress-pdf',
      label: 'Compress PDF',
      icon: <FaCompress />,
      description: 'Reduce PDF file size',
      accept: '.pdf',
      multiple: true,
      acceptedFormats: ['.pdf']
    },
    {
      id: 'rotate-pdf',
      label: 'Rotate PDF',
      icon: <FaArrowUp />,
      description: 'Rotate PDF pages',
      accept: '.pdf',
      multiple: false,
      acceptedFormats: ['.pdf']
    },
    {
      id: 'pdf-to-jpg',
      label: 'PDF to JPG',
      icon: <FaFileImage />,
      description: 'Convert PDF to JPG images',
      accept: '.pdf',
      multiple: false,
      acceptedFormats: ['.pdf']
    },
    {
      id: 'jpg-to-pdf',
      label: 'JPG to PDF',
      icon: <FaFileImage />,
      description: 'Convert JPG images to PDF',
      accept: '.jpg,.jpeg',
      multiple: true,
      acceptedFormats: ['.jpg', '.jpeg']
    },
    {
      id: 'pdf-to-png',
      label: 'PDF to PNG',
      icon: <FaFileImage />,
      description: 'Convert PDF to PNG images',
      accept: '.pdf',
      multiple: false,
      acceptedFormats: ['.pdf']
    },
    {
      id: 'png-to-pdf',
      label: 'PNG to PDF',
      icon: <FaFileImage />,
      description: 'Convert PNG images to PDF',
      accept: '.png',
      multiple: true,
      acceptedFormats: ['.png']
    },
    {
      id: 'pdf-to-webp',
      label: 'PDF to WebP',
      icon: <FaFileImage />,
      description: 'Convert PDF to WebP images',
      accept: '.pdf',
      multiple: false,
      acceptedFormats: ['.pdf']
    },
    {
      id: 'webp-to-pdf',
      label: 'WebP to PDF',
      icon: <FaFileImage />,
      description: 'Convert WebP images to PDF',
      accept: '.webp',
      multiple: true,
      acceptedFormats: ['.webp']
    },
    {
      id: 'pdf-to-text',
      label: 'PDF to Text',
      icon: <FaFileAlt />,
      description: 'Extract text from PDF',
      accept: '.pdf',
      multiple: false,
      acceptedFormats: ['.pdf']
    },
    {
      id: 'text-to-pdf',
      label: 'Text to PDF',
      icon: <FaFileAlt />,
      description: 'Convert text files to PDF',
      accept: '.txt',
      multiple: true,
      acceptedFormats: ['.txt']
    }
  ], []);

  // Memoize getActionText to prevent recreation on every render
  const getActionText = React.useCallback((tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    return tab ? tab.label : '';
  }, [tabs]);

  useEffect(() => {
    document.title = `LuxPDF - ${getActionText(activeTabId)}`;
    setFilteredTabs(tabs);
  }, [activeTabId, getActionText, tabs]);

  return (
    <ConverterContainer>
      <SearchContainer>
        <SearchIcon>
          <FaSearch />
        </SearchIcon>
        <SearchInput
          ref={searchInputRef}
          type="text"
          placeholder="Search conversions..."
          value={searchQuery}
          onChange={(e) => {
            const query = e.target.value.toLowerCase();
            setSearchQuery(query);
            setFilteredTabs(
              tabs.filter(tab =>
                tab.label.toLowerCase().includes(query) ||
                tab.description.toLowerCase().includes(query)
              )
            );
          }}
        />
      </SearchContainer>

      <TabsContainer>
        {filteredTabs.map(tab => (
          <Tab
            key={tab.id}
            active={activeTabId === tab.id}
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.icon} {tab.label}
          </Tab>
        ))}
      </TabsContainer>

      <DropArea
        isDragging={isDragging}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const droppedFiles = Array.from(e.dataTransfer.files);
          setFiles(prev => [...prev, ...droppedFiles]);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <FileInput
          ref={fileInputRef}
          type="file"
          accept={tabs.find(t => t.id === activeTabId)?.accept || ''}
          multiple={tabs.find(t => t.id === activeTabId)?.multiple || false}
          onChange={(e) => setFiles(Array.from(e.target.files))}
        />
        
        {files.length === 0 ? (
          <>
            <UploadIcon>
              <FaFileUpload />
            </UploadIcon>
            <UploadText>Drop your files here or click to browse</UploadText>
            <UploadSubtext>
              Supported formats: {tabs.find(t => t.id === activeTabId)?.acceptedFormats.join(', ')}
            </UploadSubtext>
          </>
        ) : (
          <FileList>
            {files.map((file, index) => (
              <FileItem key={`${file.name}-${index}`}>
                <FaGripVertical style={{ cursor: 'grab' }} />
                {file.name}
              </FileItem>
            ))}
          </FileList>
        )}
      </DropArea>

      <Button
        onClick={async () => {
          setIsConverting(true);
          setErrorMessage('');
          setSuccessMessage('');

          try {
            let result;
            switch (activeTabId) {
              case 'merge-pdf':
                result = await mergePDFs(files);
                break;
              case 'split-pdf':
                result = await splitPDF(files[0], 1, await PDFDocument.load(await files[0].arrayBuffer()).then(pdf => pdf.getPageCount()));
                break;
              case 'compress-pdf':
                result = await compressPDF(files[0]);
                break;
              case 'rotate-pdf':
                result = await rotatePDF(files[0], 90);
                break;
              case 'pdf-to-jpg':
                result = await convertPdfToImage(files[0], 'image/jpeg');
                break;
              case 'jpg-to-pdf':
                result = files.length === 1 ? await convertImageToPdf(files[0]) : await convertMultipleImagesToPdf(files);
                break;
              case 'pdf-to-png':
                result = await convertPdfToImage(files[0], 'image/png');
                break;
              case 'png-to-pdf':
                result = files.length === 1 ? await convertImageToPdf(files[0]) : await convertMultipleImagesToPdf(files);
                break;
              case 'pdf-to-webp':
                result = await convertPdfToImage(files[0], 'image/webp');
                break;
              case 'webp-to-pdf':
                result = files.length === 1 ? await convertImageToPdf(files[0]) : await convertMultipleImagesToPdf(files);
                break;
              case 'pdf-to-text':
                result = await convertPdfToText(files[0]);
                break;
              case 'text-to-pdf':
                result = await convertTextToPdf(files);
                break;
              default:
                throw new Error('Invalid operation');
            }

            if (!result.success) {
              throw new Error(result.error);
            }

            // Create and trigger download
            const url = URL.createObjectURL(result.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setSuccessMessage('Conversion completed successfully!');
            setIsComplete(true);
          } catch (error) {
            setErrorMessage(error.message);
          } finally {
            setIsConverting(false);
          }
        }}
        disabled={!files.length || isConverting}
      >
        {isConverting ? (
          <>
            <FaSpinner className="spin" /> Converting...
          </>
        ) : isComplete ? (
          <>
            <FaCheck /> Complete!
          </>
        ) : (
          <>
            Convert {files.length} {files.length === 1 ? 'file' : 'files'}
          </>
        )}
      </Button>

      {errorMessage && (
        <div style={{ color: 'red', marginTop: '1rem' }}>{errorMessage}</div>
      )}

      {successMessage && (
        <div style={{ color: 'green', marginTop: '1rem' }}>{successMessage}</div>
      )}
    </ConverterContainer>
  );
};

export default TabConverter;
