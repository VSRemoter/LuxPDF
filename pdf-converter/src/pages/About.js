import React from 'react';
import styled from 'styled-components';

const AboutContainer = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  color: ${props => props.theme.colors.text};
`;

const AboutHeader = styled.h1`
  font-size: 2.5rem;
  color: ${props => props.theme.colors.primary};
  margin-bottom: 2rem;
  text-align: center;
`;

const AboutContent = styled.div`
  display: grid;
  gap: 2rem;
`;

const Section = styled.section`
  background: rgba(255, 255, 255, 0.05);
  padding: 2rem;
  border-radius: ${props => props.theme.borderRadius};
  border: 1px solid rgba(255, 191, 96, 0.1);
`;

const SectionTitle = styled.h2`
  color: ${props => props.theme.colors.primary};
  margin-bottom: 1rem;
  font-size: 1.8rem;
`;

const SectionText = styled.p`
  line-height: 1.6;
  margin-bottom: 1rem;
  font-size: 1.1rem;
  color: ${props => props.theme.colors.text};
`;

const FeatureList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 1rem 0;
`;

const FeatureItem = styled.li`
  margin-bottom: 1rem;
  padding-left: 1.5rem;
  position: relative;
  
  &:before {
    content: "•";
    color: ${props => props.theme.colors.primary};
    position: absolute;
    left: 0;
  }
`;

const About = () => {
  return (
    <AboutContainer>
      <AboutHeader>About LuxPDF</AboutHeader>
      <AboutContent>
        <Section>
          <SectionTitle>Our Mission</SectionTitle>
          <SectionText>
            LuxPDF is dedicated to providing a seamless and efficient PDF conversion experience. 
            We understand the importance of reliable document handling in today's digital world, 
            and we're here to make that process as smooth as possible.
          </SectionText>
        </Section>

        <Section>
          <SectionTitle>Key Features</SectionTitle>
          <FeatureList>
            <FeatureItem>Convert PDFs to various image formats (JPG, PNG, WEBP)</FeatureItem>
            <FeatureItem>Convert images to PDF with high quality preservation</FeatureItem>
            <FeatureItem>Extract text from PDF documents</FeatureItem>
            <FeatureItem>Merge multiple PDFs into a single document</FeatureItem>
            <FeatureItem>Split PDFs into smaller documents</FeatureItem>
            <FeatureItem>Compress PDFs while maintaining quality</FeatureItem>
            <FeatureItem>Rotate PDF pages with precision</FeatureItem>
          </FeatureList>
        </Section>

        <Section>
          <SectionTitle>Privacy & Security</SectionTitle>
          <SectionText>
            Your privacy is our top priority. All file processing is done locally in your browser - 
            we never upload your files to any server. This ensures maximum security and privacy 
            for your sensitive documents.
          </SectionText>
        </Section>
      </AboutContent>
    </AboutContainer>
  );
};

export default About;
