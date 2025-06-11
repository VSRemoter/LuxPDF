import React from 'react';
import styled from 'styled-components';
import { FaLock, FaCode, FaFileAlt, FaRocket } from 'react-icons/fa';

const HeroContainer = styled.section`
  background-color: ${props => props.theme.colors.background};
  padding: 5rem 0;
  text-align: center;
  border-top: 1px solid rgba(247, 111, 83, 0.1);
`;

const HeroContent = styled.div`
  max-width: 800px;
  margin: 0 auto;
  padding: 0 1.5rem;
`;

const HeroTitle = styled.h1`
  font-size: 2.5rem;
  margin-bottom: 1.5rem;
  color: ${props => props.theme.colors.text};
  
  @media (min-width: ${props => props.theme.breakpoints.tablet}) {
    font-size: 3rem;
  }
`;

const HeroSubtitle = styled.p`
  font-size: 1.2rem;
  margin-bottom: 2rem;
  opacity: 0.9;
`;

const FeatureGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2rem;
  margin-top: 3rem;
  
  @media (max-width: ${props => props.theme.breakpoints.mobile}) {
    grid-template-columns: 1fr;
  }
`;

const FeatureCard = styled.div`
  background-color: ${props => props.theme.colors.secondary};
  border-radius: ${props => props.theme.borderRadius};
  padding: 1.5rem;
  box-shadow: ${props => props.theme.boxShadow};
  transition: ${props => props.theme.transition};
  border: 1px solid rgba(255, 191, 96, 0.2);
  
  &:hover {
    transform: translateY(-5px);
    border-color: rgba(255, 191, 96, 0.5);
  }
`;

const FeatureIcon = styled.div`
  font-size: 2rem;
  color: ${props => props.theme.colors.primary};
  margin-bottom: 1rem;
`;

const FeatureTitle = styled.h3`
  font-size: 1.2rem;
  margin-bottom: 0.5rem;
`;

const FeatureDescription = styled.p`
  font-size: 0.95rem;
  opacity: 0.8;
`;

const Hero = () => {
  return (
    <HeroContainer>
      <HeroContent>
        <HeroTitle> A Decentralized, Open Source, Private, and Free PDF Toolkit</HeroTitle>
        <HeroSubtitle>
          Anonymously convert and modify your PDF Files with our free, client-side, PDF tools.
        </HeroSubtitle>
        
        <FeatureGrid>
          <FeatureCard>
            <FeatureIcon>
              <FaLock />
            </FeatureIcon>
            <FeatureTitle>Decentralized & Anonymized</FeatureTitle>
            <FeatureDescription>
              All file conversions and modifications are done client-side. We can't touch nor view any file uploaded. Ever. 
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <FaCode />
            </FeatureIcon>
            <FeatureTitle>Open Source</FeatureTitle>
            <FeatureDescription>
              Transparent and open source code for anyone to review and contribute to.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <FaFileAlt />
            </FeatureIcon>
            <FeatureTitle>No Sign Ups, Free & Unlimited</FeatureTitle>
            <FeatureDescription>
              All our conversion tools are completely free to use with no hidden fees or limitations.
              No sign ups, no data stored, no tracking.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <FaRocket />
            </FeatureIcon>
            <FeatureTitle>Optimized For Speed</FeatureTitle>
            <FeatureDescription>
              No home page, client-side performance, for a fast, optimized experience. 
            </FeatureDescription>
          </FeatureCard>
        </FeatureGrid>
      </HeroContent>
    </HeroContainer>
  );
};

export default Hero;
