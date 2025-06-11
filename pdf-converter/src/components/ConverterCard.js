import React, { useState } from 'react';
import styled from 'styled-components';
import { FaFileUpload, FaCheck, FaSpinner } from 'react-icons/fa';

const Card = styled.div`
  background-color: ${props => props.theme.colors.background};
  border-radius: ${props => props.theme.borderRadius};
  box-shadow: ${props => props.theme.boxShadow};
  padding: 1.5rem;
  transition: ${props => props.theme.transition};
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(247, 111, 83, 0.1);
  
  &:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    border-color: rgba(247, 111, 83, 0.3);
  }
`;

const CardTitle = styled.h3`
  font-size: 1.2rem;
  margin-bottom: 1rem;
  color: ${props => props.theme.colors.text};
`;

const UploadArea = styled.div`
  border: 2px dashed ${props => props.isDragging ? props.theme.colors.primary : 'rgba(209, 207, 192, 0.3)'};
  border-radius: ${props => props.theme.borderRadius};
  padding: 2rem 1rem;
  text-align: center;
  margin-bottom: 1.5rem;
  transition: ${props => props.theme.transition};
  background-color: ${props => props.isDragging ? 'rgba(247, 111, 83, 0.1)' : 'transparent'};
  cursor: pointer;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const UploadIcon = styled.div`
  font-size: 2.5rem;
  color: ${props => props.theme.colors.primary};
  margin-bottom: 1rem;
`;

const UploadText = styled.p`
  margin-bottom: 0.5rem;
  font-weight: 500;
`;

const UploadSubtext = styled.p`
  font-size: 0.9rem;
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
  padding: 0.8rem 1.5rem;
  font-weight: 600;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  
  &:hover {
    background-color: #ff8266;
    transform: translateY(-2px);
  }
  
  &:disabled {
    background-color: rgba(247, 111, 83, 0.3);
    color: rgba(255, 255, 255, 0.7);
    cursor: not-allowed;
  }
`;

const SelectedFile = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background-color: rgba(247, 111, 83, 0.1);
  padding: 0.5rem 1rem;
  border-radius: ${props => props.theme.borderRadius};
  margin-bottom: 1rem;
  font-size: 0.9rem;
  border: 1px solid rgba(247, 111, 83, 0.2);
`;

const FileName = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
`;

const ConverterCard = ({ title, acceptedFormats, outputFormat, onConvert }) => {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setIsComplete(false);
    }
  };
  
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setIsComplete(false);
    }
  };
  
  const handleConvert = async () => {
    if (!file) return;
    
    setIsConverting(true);
    
    try {
      // In a real implementation, this would call the actual conversion function
      // For now, we'll just simulate a conversion with a timeout
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      if (onConvert) {
        await onConvert(file);
      }
      
      setIsComplete(true);
    } catch (error) {
      console.error('Conversion error:', error);
    } finally {
      setIsConverting(false);
    }
  };
  
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      
      <FileInput 
        type="file" 
        id={`file-${title}`} 
        accept={acceptedFormats.join(',')}
        onChange={handleFileChange}
      />
      
      {!file ? (
        <UploadArea 
          isDragging={isDragging}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById(`file-${title}`).click()}
        >
          <UploadIcon>
            <FaFileUpload />
          </UploadIcon>
          <UploadText>Click or drag file to upload</UploadText>
          <UploadSubtext>
            Supports {acceptedFormats.join(', ')}
          </UploadSubtext>
        </UploadArea>
      ) : (
        <>
          <SelectedFile>
            <FileName>{file.name}</FileName>
            <span>({Math.round(file.size / 1024)} KB)</span>
          </SelectedFile>
          
          <UploadArea 
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById(`file-${title}`).click()}
            style={{ flexGrow: 0, padding: '1rem' }}
          >
            <UploadSubtext>
              Click or drag to replace file
            </UploadSubtext>
          </UploadArea>
        </>
      )}
      
      <Button 
        onClick={handleConvert} 
        disabled={!file || isConverting || isComplete}
      >
        {isConverting ? (
          <>
            <FaSpinner className="spin" /> Converting...
          </>
        ) : isComplete ? (
          <>
            <FaCheck /> Convert to {outputFormat}
          </>
        ) : (
          `Convert to ${outputFormat}`
        )}
      </Button>
    </Card>
  );
};

export default ConverterCard;
