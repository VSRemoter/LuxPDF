import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { FaFileUpload, FaCheck, FaSpinner, FaTrash, FaGripVertical, FaArrowUp, FaArrowDown, FaSearch, FaFileImage, FaFileAlt, FaFilePdf, FaObjectGroup, FaCut, FaCompress } from 'react-icons/fa';
import { saveAs } from 'file-saver';
import { convertPdfToImage, convertImageToPdf, convertMultipleImagesToPdf, mergePDFs, splitPDF, compressPDF, rotatePDF, convertPdfToText } from '../utils/converter';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';

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

const SearchIcon = styled.div`
  position: absolute;
  left: 0.8rem;
  color: ${props => props.theme.colors.primary};
  font-size: 0.9rem;
  opacity: 0.8;
`;

const TabsContainer = styled.div`
  display: flex;
  overflow-x: auto;
  margin-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 191, 96, 0.2);
  
  &::-webkit-scrollbar {
    height: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: rgba(209, 207, 192, 0.1);
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 191, 96, 0.3);
    border-radius: 4px;
  }
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

const DragHandle = styled.div`
  color: #FFD700;
  display: flex;
  align-items: center;
  padding: 4px;
  opacity: 0.7;
  cursor: move;
  
  &:hover {
    opacity: 1;
  }
`;

const FileDetails = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const FileName = styled.div`
  font-weight: 500;
`;

const FileSize = styled.div`
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
`;

const FileOrderNumber = styled.div`
  background: rgba(255, 215, 0, 0.15);
  color: #FFD700;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  min-width: 28px;
  text-align: center;
`;

const FileActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const ActionButton = styled.button`
  background: transparent;
  border: none;
  color: ${props => props.theme.colors.text};
  cursor: pointer;
  padding: 0.3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  
  &:hover {
    color: ${props => props.theme.colors.primary};
    opacity: 1;
  }
  
  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

const RemoveButton = styled.button`
  background: transparent;
  border: none;
  color: ${props => props.theme.colors.text};
  cursor: pointer;
  padding: 0.3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover {
    color: ${props => props.theme.colors.primary};
  }
`;

const StatusMessage = styled.div`
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: ${props => props.theme.borderRadius};
  background-color: ${props => props.success ? 'rgba(75, 181, 67, 0.1)' : 'rgba(255, 191, 96, 0.1)'};
  border: 1px solid ${props => props.success ? 'rgba(75, 181, 67, 0.3)' : 'rgba(255, 191, 96, 0.3)'};
  color: ${props => props.success ? '#4bb543' : props.theme.colors.primary};
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const SplitControls = styled.div`
  margin: 20px 0;
  padding: 20px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 10px;
  border: 1px solid rgba(255, 215, 0, 0.3);
  backdrop-filter: blur(10px);
`;

const SplitTitle = styled.h3`
  color: #FFD700;
  margin-bottom: 15px;
  font-size: 1.2rem;
  text-align: center;
`;

const PageInputGroup = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  margin-top: 15px;
`;

const PageInputWrapper = styled.div`
  position: relative;
  flex: 1;
  max-width: 150px;
`;

const PageInput = styled.input`
  width: 100%;
  padding: 12px 15px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 8px;
  color: white;
  font-size: 1rem;
  transition: all 0.3s ease;
  text-align: center;
  
  &:focus {
    outline: none;
    border-color: #FFD700;
    box-shadow: 0 0 10px rgba(255, 215, 0, 0.2);
  }
  
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  
  &::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }
`;

const PageLabel = styled.label`
  position: absolute;
  top: -20px;
  left: 0;
  color: #FFD700;
  font-size: 0.9rem;
  opacity: 0.8;
`;

const Separator = styled.span`
  color: #FFD700;
  font-size: 1.2rem;
  font-weight: bold;
`;

const PageInfo = styled.div`
  margin-top: 15px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.9rem;
  text-align: center;
`;

const ErrorText = styled.div`
  color: #ff4444;
  font-size: 0.9rem;
  margin-top: 10px;
  text-align: center;
  animation: fadeIn 0.3s ease;

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

const RotationControls = styled.div`
  margin: 20px 0;
  padding: 20px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 10px;
  border: 1px solid rgba(255, 215, 0, 0.3);
  backdrop-filter: blur(10px);
`;

const RotationTitle = styled.h3`
  color: #FFD700;
  margin-bottom: 15px;
  font-size: 1.2rem;
  text-align: center;
`;

const RotationGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  margin-top: 15px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const RotationButton = styled.button`
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.9));
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 8px;
  padding: 15px;
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;

  &:hover {
    transform: translateY(-2px);
    border-color: rgba(255, 215, 0, 0.8);
    box-shadow: 0 5px 15px rgba(255, 215, 0, 0.2);
  }

  &.active {
    background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 215, 0, 0.2));
    border-color: #FFD700;
  }

  svg {
    font-size: 1.5rem;
    color: #FFD700;
  }
`;

const RotationIcon = styled.div`
  transform: rotate(${props => props.angle}deg);
  transition: transform 0.3s ease;
`;

const ErrorMessage = styled.div`
  background-color: rgba(220, 53, 69, 0.1);
  border: 1px solid #dc3545;
  color: #dc3545;
  padding: 1rem;
  border-radius: ${props => props.theme.borderRadius};
  margin: 1rem 0;
  text-align: center;
  animation: fadeInOut 3s ease-in-out;
  opacity: 0;

  @keyframes fadeInOut {
    0% { opacity: 0; }
    10% { opacity: 1; }
    90% { opacity: 1; }
    100% { opacity: 0; }
  }
`;

const ConversionToggle = styled.div`
  margin: 20px 0;
  padding: 20px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 10px;
  border: 1px solid rgba(255, 215, 0, 0.3);
  backdrop-filter: blur(10px);
  text-align: center;
`;

const ToggleButton = styled.button`
  background: ${props => props.active ? 'linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 215, 0, 0.3))' : 'linear-gradient(135deg, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.9))'};
  border: 1px solid ${props => props.active ? '#FFD700' : 'rgba(255, 215, 0, 0.3)'};
  border-radius: 8px;
  padding: 12px 24px;
  color: ${props => props.active ? '#FFD700' : 'white'};
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 auto;

  &:hover {
    transform: translateY(-2px);
    border-color: #FFD700;
    box-shadow: 0 5px 15px rgba(255, 215, 0, 0.1);
  }

  svg {
    font-size: 1.2rem;
    transition: transform 0.3s ease;
    transform: ${props => props.active ? 'rotate(360deg)' : 'rotate(0)'};
  }
`;

const ToggleDescription = styled.p`
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.9rem;
  margin-top: 12px;
  line-height: 1.4;
`;

const DeleteButton = styled.button`
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  padding: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  width: 24px;
  height: 24px;

  &:hover {
    background: rgba(255, 0, 0, 0.1);
    color: #ff4444;
    transform: scale(1.1);
  }

  &:active {
    transform: scale(0.95);
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
  const [draggedFile, setDraggedFile] = useState(null);
  const [dragOverFile, setDragOverFile] = useState(null);
  const [startPage, setStartPage] = useState('');
  const [endPage, setEndPage] = useState('');
  const [totalPages, setTotalPages] = useState(null);
  const [splitError, setSplitError] = useState('');
  const [rotationAngle, setRotationAngle] = useState(90);
  const [individualConversion, setIndividualConversion] = useState(false);
  
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

  // Auto-focus the search input when component mounts
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // Filter tabs based on search query
  useEffect(() => {
    if (!searchQuery) {
      setFilteredTabs(tabs);
      return;
    }
    
    const query = searchQuery.toLowerCase();
    const filtered = tabs.filter(tab => 
      tab.label.toLowerCase().includes(query) ||
      tab.description.toLowerCase().includes(query)
    );
    
    setFilteredTabs(filtered);
    
    // If current active tab is not in filtered results and there are results,
    // set the first filtered tab as active
    if (filtered.length > 0 && !filtered.find(tab => tab.id === activeTabId)) {
      setActiveTabId(filtered[0].id);
    }
  }, [searchQuery, activeTabId]);
  
  const activeTabData = tabs.find(tab => tab.id === activeTabId);
  
  const handleSearchChange = (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);
    setFilteredTabs(
      tabs.filter(tab =>
        tab.label.toLowerCase().includes(query) ||
        tab.description.toLowerCase().includes(query)
      )
    );
  };
  
  const handleTabChange = (tabId) => {
    setActiveTabId(tabId);
    setFiles([]);
    setIsComplete(false);
  };
  
  const handleFileChange = async (event) => {
    const newFiles = Array.from(event.target.files);
    setFiles(newFiles);
    
    if (activeTabId === 'split-pdf' && newFiles.length === 1) {
      try {
        const arrayBuffer = await newFiles[0].arrayBuffer();
        const pdf = await PDFDocument.load(arrayBuffer);
        const totalPages = pdf.getPageCount();
        
        // Update the max values of the page inputs
        const startPageInput = document.getElementById('startPage');
        const endPageInput = document.getElementById('endPage');
        if (startPageInput && endPageInput) {
          startPageInput.max = totalPages;
          endPageInput.max = totalPages;
          startPageInput.value = '1';
          endPageInput.value = totalPages.toString();
        }
      } catch (error) {
        console.error('Error reading PDF:', error);
      }
    }
  };
  
  const handleAreaDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleAreaDragLeave = () => {
    setIsDragging(false);
  };
  
  const handleDragOver = (e, file) => {
    e.preventDefault();
    if (file !== draggedFile) {
      setDragOverFile(file);
    }
  };
  
  const handleDrop = (e, targetFile) => {
    e.preventDefault();
    if (!draggedFile || targetFile === draggedFile) return;

    const newFiles = [...files];
    const draggedIndex = newFiles.indexOf(draggedFile);
    const targetIndex = newFiles.indexOf(targetFile);

    // Remove dragged file from array
    newFiles.splice(draggedIndex, 1);
    // Insert it at the new position
    newFiles.splice(targetIndex, 0, draggedFile);

    setFiles(newFiles);
    setDraggedFile(null);
    setDragOverFile(null);
  };
  
  const handleFilesDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    if (!activeTab) return;
    
    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(file => {
      const extension = `.${file.name.split('.').pop().toLowerCase()}`;
      return activeTab.acceptedFormats.includes(extension);
    });

    // Only show error if there are invalid files
    if (validFiles.length < files.length) {
      setErrorMessage(`Please drop only ${activeTab.acceptedFormats.join(', ')} files`);
    } else {
      setErrorMessage(''); // Clear any existing error message
    }

    // Add valid files even if some were invalid
    if (validFiles.length > 0) {
      setFiles(prevFiles => [...prevFiles, ...validFiles]);
    }
  };
  
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
  };
  
  const handlePageInput = async (files, type, value) => {
    setSplitError('');
    
    if (type === 'start') {
      setStartPage(value);
    } else {
      setEndPage(value);
    }

    // Only validate if we have both values
    if (!startPage || !endPage) return;

    // Get total pages if we haven't already
    if (!totalPages && files.length > 0) {
      try {
        const arrayBuffer = await files[0].arrayBuffer();
        const pdf = await PDFDocument.load(arrayBuffer);
        setTotalPages(pdf.getPageCount());
      } catch (error) {
        console.error('Error loading PDF:', error);
        setSplitError('Error reading PDF file');
        return;
      }
    }

    const start = parseInt(type === 'start' ? value : startPage);
    const end = parseInt(type === 'end' ? value : endPage);

    // Validation
    if (isNaN(start) || isNaN(end)) {
      setSplitError('Please enter valid page numbers');
      return;
    }

    if (start < 1) {
      setSplitError('Start page must be at least 1');
      return;
    }

    if (totalPages && end > totalPages) {
      setSplitError(`End page cannot exceed total pages (${totalPages})`);
      return;
    }

    if (start > end) {
      setSplitError('Start page cannot be greater than end page');
      return;
    }
  };
  
  // Add character mapping function
  const mapSpecialCharacters = (text) => {
    const charMap = {
      '●': '*', // bullet point (black circle)
      '○': 'o', // white circle
      '•': '*', // alternative bullet point
      '→': '->', // right arrow
      '←': '<-', // left arrow
      '↑': '^', // up arrow
      '↓': 'v', // down arrow
      '—': '--', // em dash
      '–': '-', // en dash
      '\u201C': '"', // left double quote
      '\u201D': '"', // right double quote
      '\u2018': "'", // left single quote
      '\u2019': "'", // right single quote
      '…': '...', // ellipsis
      '≤': '<=', // less than or equal
      '≥': '>=', // greater than or equal
      '×': 'x', // multiplication
      '÷': '/', // division
      '≠': '!=', // not equal
      '≈': '~', // approximately
      '≡': '===', // identical to / triple bar
      // Mathematical brackets and symbols
      '⌊': '|_', // floor left
      '⌋': '_|', // floor right
      '⌈': '|^', // ceiling left
      '⌉': '^|', // ceiling right
      '⟨': '<', // mathematical left angle bracket
      '⟩': '>', // mathematical right angle bracket
      '⟪': '<<', // mathematical double left angle bracket
      '⟫': '>>', // mathematical double right angle bracket
      '⌜': '|^', // top-left corner
      '⌝': '^|', // top-right corner
      '⌞': '|_', // bottom-left corner
      '⌟': '_|', // bottom-right corner
      '⟦': '[[', // mathematical left white square bracket
      '⟧': ']]', // mathematical right white square bracket
      '⟮': '(', // mathematical left parenthesis
      '⟯': ')', // mathematical right parenthesis
      '⦃': '{{', // mathematical left white curly bracket
      '⦄': '}}', // mathematical right white curly bracket
      '∀': 'for all', // for all
      '∃': 'exists', // there exists
      '∄': '!exists', // does not exist
      '∅': 'empty', // empty set
      '∈': 'in', // element of
      '∉': '!in', // not element of
      '∋': 'contains', // contains
      '∌': '!contains', // does not contain
      '∩': 'intersection', // intersection
      '∪': 'union', // union
      '⊂': 'subset', // subset
      '⊃': 'superset', // superset
      '⊆': 'subset=', // subset or equal
      '⊇': 'superset=', // superset or equal
      '⊕': '(+)', // circled plus
      '⊗': '(x)', // circled times
      '∑': 'sum', // summation
      '∏': 'product', // product
      '√': 'sqrt', // square root
      '∛': 'cbrt', // cube root
      '∜': '4rt', // fourth root
      '∫': 'integral', // integral
      '∮': 'contour', // contour integral
      '∝': 'prop to', // proportional to
      '∞': 'inf', // infinity
      '∠': 'angle', // angle
      '∡': 'measured angle', // measured angle
      '∢': 'spherical angle', // spherical angle
      '©': '(c)', // copyright
      '®': '(R)', // registered
      '™': '(TM)', // trademark
      '€': 'EUR', // euro
      '£': 'GBP', // pound
      '¥': 'JPY', // yen
      '°': 'deg', // degree
      '±': '+/-', // plus-minus
      '§': 'S', // section
      '¶': 'P', // paragraph
      // Subscript numbers
      '₀': '_0',
      '₁': '_1',
      '₂': '_2',
      '₃': '_3',
      '₄': '_4',
      '₅': '_5',
      '₆': '_6',
      '₇': '_7',
      '₈': '_8',
      '₉': '_9',
      // Subscript letters
      'ₐ': '_a',
      'ₑ': '_e',
      'ₕ': '_h',
      'ᵢ': '_i',
      'ⱼ': '_j',
      'ₖ': '_k',
      'ₗ': '_l',
      'ₘ': '_m',
      'ₙ': '_n',
      'ₒ': '_o',
      'ₚ': '_p',
      'ᵣ': '_r',
      'ₛ': '_s',
      'ₜ': '_t',
      'ᵤ': '_u',
      'ᵥ': '_v',
      'ₓ': '_x',
      // Common chemical subscripts
      '₍': '(',
      '₎': ')',
      // Greek letters
      'α': 'alpha',
      'β': 'beta',
      'γ': 'gamma',
      'δ': 'delta',
      'ε': 'epsilon',
      'ζ': 'zeta',
      'η': 'eta',
      'θ': 'theta',
      'ι': 'iota',
      'κ': 'kappa',
      'λ': 'lambda',
      'μ': 'mu',
      'ν': 'nu',
      'ξ': 'xi',
      'ο': 'omicron',
      'π': 'pi',
      'ρ': 'rho',
      'σ': 'sigma',
      'τ': 'tau',
      'υ': 'upsilon',
      'φ': 'phi',
      'χ': 'chi',
      'ψ': 'psi',
      'ω': 'omega',
      // Uppercase Greek letters
      'Α': 'Alpha',
      'Β': 'Beta',
      'Γ': 'Gamma',
      'Δ': 'Delta',
      'Ε': 'Epsilon',
      'Ζ': 'Zeta',
      'Η': 'Eta',
      'Θ': 'Theta',
      'Ι': 'Iota',
      'Κ': 'Kappa',
      'Λ': 'Lambda',
      'Μ': 'Mu',
      'Ν': 'Nu',
      'Ξ': 'Xi',
      'Ο': 'Omicron',
      'Π': 'Pi',
      'Ρ': 'Rho',
      'Σ': 'Sigma',
      'Τ': 'Tau',
      'Υ': 'Upsilon',
      'Φ': 'Phi',
      'Χ': 'Chi',
      'Ψ': 'Psi',
      'Ω': 'Omega'
    };

    return text.split('').map(char => charMap[char] || char).join('');
  };

  // Update the processTextForPDF function
  const processTextForPDF = async (text, pdfDoc) => {
    let font;
    const mappedText = mapSpecialCharacters(text);
    
    // Try loading fonts in order of preference
    try {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    } catch (error) {
      try {
        font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      } catch (error) {
        try {
          font = await pdfDoc.embedFont(StandardFonts.Courier);
        } catch (error) {
          throw new Error('Failed to load any supported font');
        }
      }
    }

    return { font, text: mappedText };
  };

  // Update the drawTextContent function signature to include pdfDoc
  const drawTextContent = (page, text, font, fontSize, lineHeight, margin, startY, pdfDoc) => {
    const { width, height } = page.getSize();
    let currentY = startY || height - margin;

    // Split text into paragraphs
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
      // Handle bullet points and special characters
      const lines = [];
      let currentLine = '';
      
      // Split into lines, preserving certain line breaks
      const rawLines = paragraph.split(/\n/);
      for (const rawLine of rawLines) {
        const words = rawLine.split(/\s+/);
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const lineWidth = font.widthOfTextAtSize(testLine, fontSize);

          if (lineWidth < width - (2 * margin)) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        
        // Force a line break at the end of each raw line
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
      }

      // Draw paragraph
      for (const line of lines) {
        if (currentY < margin + lineHeight) {
          // Add new page if we run out of space
          const newPage = pdfDoc.addPage();
          currentY = newPage.getSize().height - margin;
          page = newPage; // Update the current page reference
        }

        page.drawText(line.trim(), {
          x: margin,
          y: currentY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          lineHeight,
        });
        currentY -= lineHeight;
      }
      // Add space between paragraphs
      currentY -= lineHeight;
    }
    
    return currentY;
  };
  
  const handleConvert = async () => {
    if (!files.length) return;

    setIsConverting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const activeTab = tabs.find(tab => tab.id === activeTabId);
      if (!activeTab) throw new Error('Invalid tab selected');

      if (activeTabId === 'text-to-pdf') {
        if (individualConversion) {
          const zipFile = new JSZip();
          
          for (const file of files) {
            try {
              const text = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file, 'UTF-8');
              });

              const pdfDoc = await PDFDocument.create();
              const { font, text: processedText } = await processTextForPDF(text, pdfDoc);
              
              const page = pdfDoc.addPage();
              const fontSize = 12;
              const lineHeight = fontSize * 1.2;
              const margin = 50;

              drawTextContent(page, processedText, font, fontSize, lineHeight, margin, null, pdfDoc);

              const pdfBytes = await pdfDoc.save();
              const fileName = file.name.split('.')[0] + '.pdf';
              zipFile.file(fileName, pdfBytes);
            } catch (error) {
              console.error('Error converting file:', file.name, error);
              throw new Error(`Failed to convert ${file.name}: ${error.message}`);
            }
          }
          
          const zipContent = await zipFile.generateAsync({ type: 'blob' });
          saveAs(zipContent, 'individual_text_pdfs.zip');
        } else {
          // Combined conversion
          const pdfDoc = await PDFDocument.create();
          
          for (const file of files) {
            try {
              const text = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file, 'UTF-8');
              });

              const { font, text: processedText } = await processTextForPDF(text, pdfDoc);
              const page = pdfDoc.addPage();
              const fontSize = 12;
              const lineHeight = fontSize * 1.2;
              const margin = 50;

              // Add file name as header
              page.drawText(file.name, {
                x: margin,
                y: page.getSize().height - margin,
                size: fontSize + 2,
                font,
                color: rgb(0, 0, 0),
              });

              // Draw content starting below header
              drawTextContent(
                page,
                processedText,
                font,
                fontSize,
                lineHeight,
                margin,
                page.getSize().height - margin - (2 * lineHeight),
                pdfDoc
              );
            } catch (error) {
              console.error('Error processing file:', file.name, error);
              throw new Error(`Failed to process ${file.name}: ${error.message}`);
            }
          }

          const pdfBytes = await pdfDoc.save();
          saveAs(new Blob([pdfBytes]), 'combined_text.pdf');
        }
      } else if (activeTabId === 'jpg-to-pdf' || activeTabId === 'png-to-pdf' || activeTabId === 'webp-to-pdf') {
        if (individualConversion) {
          // Individual conversion logic
          const zipFile = new JSZip();
          
          for (const file of files) {
            try {
              const img = await createImageBitmap(file);
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              
              const pdfDoc = await PDFDocument.create();
              const page = pdfDoc.addPage([img.width, img.height]);
              
              const jpgImage = await canvas.toDataURL('image/jpeg', 0.95);
              const jpgBytes = await fetch(jpgImage).then(res => res.arrayBuffer());
              const image = await pdfDoc.embedJpg(jpgBytes);
              
              page.drawImage(image, {
                x: 0,
                y: 0,
                width: img.width,
                height: img.height,
              });
              
              const pdfBytes = await pdfDoc.save();
              const fileName = file.name.split('.')[0] + '.pdf';
              zipFile.file(fileName, pdfBytes);
            } catch (error) {
              console.error('Error converting file:', file.name, error);
              throw new Error(`Failed to convert ${file.name}: ${error.message}`);
            }
          }
          
          const zipContent = await zipFile.generateAsync({ type: 'blob' });
          saveAs(zipContent, 'converted_pdfs.zip');
        } else {
          // Combined PDF logic
          const pdfDoc = await PDFDocument.create();
          
          for (const file of files) {
            try {
              const img = await createImageBitmap(file);
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              
              const jpgImage = await canvas.toDataURL('image/jpeg', 0.95);
              const jpgBytes = await fetch(jpgImage).then(res => res.arrayBuffer());
              const image = await pdfDoc.embedJpg(jpgBytes);
              
              const page = pdfDoc.addPage([img.width, img.height]);
              page.drawImage(image, {
                x: 0,
                y: 0,
                width: img.width,
                height: img.height,
              });
            } catch (error) {
              console.error('Error converting file:', file.name, error);
              throw new Error(`Failed to convert ${file.name}: ${error.message}`);
            }
          }
          
          const pdfBytes = await pdfDoc.save();
          const fileName = files.length > 1 ? 'combined_images.pdf' : files[0].name.split('.')[0] + '.pdf';
          saveAs(new Blob([pdfBytes]), fileName);
        }
      } else if (activeTabId === 'pdf-to-jpg' || activeTabId === 'pdf-to-png' || activeTabId === 'pdf-to-webp') {
        // Handle PDF to image conversions
        const format = activeTabId.split('-').pop().toUpperCase();
        
        for (const file of files) {
          try {
            const result = await convertPdfToImage(file, format);
            if (!result.success) {
              throw new Error(`Failed to convert ${file.name}: ${result.error}`);
            }

            // Each PDF gets its own ZIP file containing its pages
            if (Array.isArray(result.data)) {
              // Multiple pages - create ZIP
              const zipFile = new JSZip();
              result.data.forEach((pageData, index) => {
                const baseName = file.name.split('.')[0];
                zipFile.file(`${baseName}_page_${index + 1}.${format.toLowerCase()}`, pageData);
              });
              const zipContent = await zipFile.generateAsync({ type: 'blob' });
              const zipName = `${file.name.split('.')[0]}_${format.toLowerCase()}_pages.zip`;
              saveAs(zipContent, zipName);
            } else {
              // Single page - save directly
              saveAs(new Blob([result.data]), result.fileName);
            }
          } catch (error) {
            console.error('Error converting file:', file.name, error);
            throw new Error(`Failed to convert ${file.name}: ${error.message}`);
          }
        }
      } else if (activeTabId === 'pdf-to-text') {
        // Handle PDF to text conversions
        if (files.length === 1) {
          // Single file - convert and save directly
          const result = await convertPdfToText(files[0]);
          if (!result.success) {
            throw new Error(`Failed to convert ${files[0].name}: ${result.error}`);
          }
          saveAs(new Blob([result.data]), result.fileName);
        } else {
          // Multiple files - create ZIP with all text files
          const zipFile = new JSZip();
          
          for (const file of files) {
            try {
              const result = await convertPdfToText(file);
              if (!result.success) {
                throw new Error(`Failed to convert ${file.name}: ${result.error}`);
              }
              
              const fileName = file.name.split('.')[0] + '.txt';
              zipFile.file(fileName, result.data);
            } catch (error) {
              console.error('Error converting file:', file.name, error);
              throw new Error(`Failed to convert ${file.name}: ${error.message}`);
            }
          }
          
          const zipContent = await zipFile.generateAsync({ type: 'blob' });
          saveAs(zipContent, 'converted_text_files.zip');
        }
      } else {
        // Handle other conversion types
        let result;
        switch (activeTabId) {
        case 'merge-pdf':
          result = await mergePDFs(files);
          break;
        case 'split-pdf':
          if (!startPage || !endPage) {
            throw new Error('Please enter both start and end page numbers');
          }
          result = await splitPDF(files[0], parseInt(startPage), parseInt(endPage));
          break;
        case 'compress-pdf':
          result = await compressPDF(files);
          break;
          case 'rotate-pdf':
            result = await rotatePDF(files[0], rotationAngle);
            break;
        default:
          throw new Error('Unsupported conversion type');
      }

        if (result && result.data) {
          saveAs(new Blob([result.data]), result.fileName);
        }
      }

      setIsComplete(true);
      const fileText = files.length === 1 ? 'file' : 'files';
      setSuccessMessage(`Successfully ${getActionText(activeTab)} ${fileText}!`);
    } catch (error) {
      console.error('Conversion error:', error);
      setErrorMessage(error.message || 'Error during conversion. Please try again.');
    } finally {
      setIsConverting(false);
    }
  };
  
  const isReorderable = (tabId) => {
    return tabId === 'mergePdfs' || 
           tabId === 'jpgToPdf' || 
           tabId === 'pngToPdf' || 
           tabId === 'webpToPdf' ||
           tabId === 'txtToPdf';
  };
  
  const isConversionWithIndividualOption = (tabId) => {
    return ['jpg-to-pdf', 'png-to-pdf', 'webp-to-pdf', 'text-to-pdf'].includes(tabId);
  };
  
  const removeFile = (indexToRemove) => {
    setFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
    setErrorMessage(''); // Clear any error messages when removing files
  };
  
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
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.icon} {tab.label}
          </Tab>
        ))}
      </TabsContainer>

      <DropArea
        isDragging={isDragging}
        onDragOver={handleAreaDragOver}
        onDragLeave={handleAreaDragLeave}
        onDrop={handleFilesDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <FileInput
          id="file-upload"
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept={tabs.find(t => t.id === activeTabId)?.accept || ''}
          multiple={tabs.find(t => t.id === activeTabId)?.multiple || false}
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
          <>
            <FileList>
              {files.map((file, index) => (
                <FileItem
                  key={`${file.name}-${index}`}
                  isDragging={draggedFile === file}
                  className={dragOverFile === file ? 'dragging-over' : ''}
                  draggable={isReorderable(activeTabId)}
                  onDragStart={() => setDraggedFile(file)}
                  onDragEnd={() => {
                    setDraggedFile(null);
                    setDragOverFile(null);
                  }}
                  onDragOver={(e) => handleDragOver(e, file)}
                  onDrop={(e) => handleDrop(e, file)}
                >
                  <FaGripVertical style={{ cursor: 'grab' }} />
                  {file.name} ({formatFileSize(file.size)})
                </FileItem>
              ))}
            </FileList>
          </>
        )}
      </DropArea>

      {activeTabId === 'split-pdf' && files.length > 0 && (
        <div>
          <h3>Select Pages to Extract</h3>
          <div>
            <input
              type="number"
              min="1"
              max={totalPages}
              value={startPage}
              onChange={(e) => handlePageInput(files, 'start', e.target.value)}
              placeholder="Start Page"
            />
            <span> to </span>
            <input
              type="number"
              min={startPage || 1}
              max={totalPages}
              value={endPage}
              onChange={(e) => handlePageInput(files, 'end', e.target.value)}
              placeholder="End Page"
            />
          </div>
          {splitError && <div style={{ color: 'red' }}>{splitError}</div>}
          {totalPages && <div>Total pages: {totalPages}</div>}
        </div>
      )}

      {activeTabId === 'rotate-pdf' && files.length > 0 && (
        <div>
          <h3>Choose Rotation Angle</h3>
          <div>
            <button onClick={() => setRotationAngle(90)}>
              90° {rotationAngle === 90 && '✓'}
            </button>
            <button onClick={() => setRotationAngle(180)}>
              180° {rotationAngle === 180 && '✓'}
            </button>
            <button onClick={() => setRotationAngle(270)}>
              270° {rotationAngle === 270 && '✓'}
            </button>
          </div>
        </div>
      )}

      {files.length > 0 && isConversionWithIndividualOption(activeTabId) && (
        <div>
          <label>
            <input
              type="checkbox"
              checked={individualConversion}
              onChange={() => setIndividualConversion(!individualConversion)}
            />
            Convert files individually
          </label>
        </div>
      )}

      <Button
        onClick={handleConvert}
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
