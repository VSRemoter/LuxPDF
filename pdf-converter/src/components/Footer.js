import React from 'react';
import styled from 'styled-components';
import { FaGithub, FaHeart } from 'react-icons/fa';

const FooterContainer = styled.footer`
  background-color: ${props => props.theme.colors.background};
  padding: 2rem 0;
  margin-top: 2rem;
  border-top: 1px solid rgba(247, 111, 83, 0.1);
`;

const FooterContent = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
`;

const FooterLogo = styled.div`
  font-family: ${props => props.theme.fonts.heading};
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
`;

const FooterText = styled.p`
  margin-bottom: 1.5rem;
  max-width: 600px;
`;

const FooterLinks = styled.div`
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
`;

const FooterLink = styled.a`
  color: ${props => props.theme.colors.text};
  display: flex;
  align-items: center;
  gap: 0.5rem;
  
  &:hover {
    color: ${props => props.theme.colors.accent};
  }
`;

const Copyright = styled.p`
  font-size: 0.9rem;
  color: ${props => props.theme.colors.text};
  opacity: 0.8;
`;

const Footer = () => {
  const currentYear = new Date().getFullYear();
  
  return (
    <FooterContainer>
      <FooterContent>
        <FooterLogo>LuxPDF</FooterLogo>
        <FooterText>
          Never feel worried about your privacy or security when using our tools.
          Made for Privacy-conscious users, Freelancers, and Small Businesses.
        </FooterText>
        
        <FooterLinks>
          <FooterLink href="https://github.com/pdf-converter" target="_blank" rel="noopener noreferrer">
            <FaGithub /> GitHub
          </FooterLink>
        </FooterLinks>
        
        <Copyright>
          Contact: LuxPDFOfficial@gmail.com <FaHeart style={{ color: '#ffd601' }} /> | © {currentYear} LuxPDF
        </Copyright>
      </FooterContent>
    </FooterContainer>
  );
};

export default Footer;
