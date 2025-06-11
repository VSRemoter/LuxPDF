import React from 'react';
import styled from 'styled-components';
import { FaInfoCircle, FaDollarSign, FaUsers, FaLightbulb, FaCheck, FaTimes } from 'react-icons/fa';

const AboutContainer = styled.section`
  padding: 5rem 0;
`;

const AboutContent = styled.div`
  max-width: 800px;
  margin: 0 auto;
  padding: 0 1.5rem;
`;

const AboutTitle = styled.h1`
  text-align: center;
  margin-bottom: 3rem;
  font-size: 2.5rem;
  color: ${props => props.theme.colors.text};
  
  &:after {
    content: '';
    display: block;
    width: 80px;
    height: 3px;
    background-color: ${props => props.theme.colors.primary};
    margin: 0.8rem auto 0;
  }
`;

const AboutSection = styled.div`
  margin-bottom: 3rem;
`;

const AboutSectionTitle = styled.h2`
  font-size: 1.8rem;
  margin-bottom: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  
  svg {
    color: ${props => props.theme.colors.primary};
  }
`;

const AboutText = styled.p`
  font-size: 1.1rem;
  line-height: 1.7;
  margin-bottom: 1.5rem;
`;

const TeamGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 2rem;
  margin-top: 2rem;
`;

const TeamMember = styled.div`
  text-align: center;
`;

const TeamMemberImage = styled.div`
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background-color: ${props => props.theme.colors.secondary};
  margin: 0 auto 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.5rem;
  color: ${props => props.theme.colors.primary};
`;

const TeamMemberName = styled.h3`
  font-size: 1.2rem;
  margin-bottom: 0.5rem;
`;

const TeamMemberRole = styled.p`
  font-size: 0.9rem;
  opacity: 0.8;
`;

const ComparisonTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin: 2rem 0;
  background: ${props => props.theme.colors.background};
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
`;

const TableHeader = styled.th`
  padding: 1rem;
  background: #080b0d;
  color: white;
  font-weight: 600;
  text-align: left;
  &:first-child {
    width: 40%;
  }
`;

const TableRow = styled.tr`
  &:nth-child(even) {
    background: rgba(0, 0, 0, 0.02);
  }
`;

const TableCell = styled.td`
  padding: 1rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
`;

const CheckIcon = styled(FaCheck)`
  color: #22c55e;
  font-size: 1.2rem;
`;

const XIcon = styled(FaTimes)`
  color: #ef4444;
  font-size: 1.2rem;
`;

const About = () => {
  return (
    <AboutContainer>
      <AboutContent>
        <AboutTitle>About Us</AboutTitle>
        
        <AboutSection>
          <AboutSectionTitle>
            <FaInfoCircle /> What Is LuxPDF?
          </AboutSectionTitle>
          <AboutText>
            LuxPDF is unlike any other PDF Toolkit out there. We built LuxPDF with the sole purpose of providing a fast, 
            decentralized, and blazing-fast PDF Toolkit for everyone. 
            We're not here to sell your data, add watermarks to your files, or obtain email addresses.
          </AboutText>
        </AboutSection>
        
        <AboutSection>
          <AboutSectionTitle>
            <FaDollarSign /> How Are We Funded?
          </AboutSectionTitle>
          <AboutText>
            LuxPDF generates a small revenue through Ads, to pay for servers, and to keep the site running.
            We include Ads in such a way that they don't interfere with Performance or User Experience.
            We also use BuyMeACoffee for donations and tips, which are greatly appreciated. 
            We do wish to provide an ad-free expierence, however, as college students, due to hosting, maintaining (and Student Loans) costs,
            it is very difficult to afford the service to be ad-free.
          </AboutText>
        </AboutSection>
        
        <AboutSection>
          <AboutSectionTitle>
            <FaUsers /> Who is LuxPDF For?
          </AboutSectionTitle>
          <AboutText>
            LuxPDF is meant for anyone seeking a basic, PDF Toolkit that nails all the bells and whistles. We target Privacy-conscious users, Freelancers, Small Businesses, Students, 
            and people who just want to convert and modify their files quickly and easily with a gorgeous UI.
            We are not meant for Enterprises, or people who need the most advanced features.
          </AboutText>
        </AboutSection>
        
        <AboutSection>
          <AboutSectionTitle>
            <FaLightbulb /> Why did we make LuxPDF?
          </AboutSectionTitle>
          <AboutText>
            We built it because all other PDF Toolkits out there were terrible. We always felt that other PDF Toolkit websites
            were spying on our files, and slow, especially when submitting homeworks last minute. They also store data, ask for emails,
            are paid, have watermarks, are centralized, have terrible UI and performance numbers. We built LuxPDF to be the only
            basic, PDF Toolkit you need. We do not offer the most advanced features, but we offer the absolute best, basic
            conversions and modifications.
          </AboutText>
        </AboutSection>

        <AboutSection>
          <AboutSectionTitle>
            <FaInfoCircle /> LuxPDF vs Other Toolkits
          </AboutSectionTitle>
          <ComparisonTable>
            <thead>
              <tr>
                <TableHeader>Feature</TableHeader>
                <TableHeader>LuxPDF</TableHeader>
                <TableHeader>Other Toolkits</TableHeader>
              </tr>
            </thead>
            <tbody>
              <TableRow>
                <TableCell>PDF ↔ Image Conversion</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><CheckIcon /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Basic PDF Modifications</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><CheckIcon /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>PDF ↔ TXT Conversion</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><CheckIcon /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Completely Free</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><XIcon /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Decentralized</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><XIcon /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>No Sign Ups</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><XIcon /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Anonymized & Private</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><XIcon /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Open Source</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><XIcon /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Optimized & Efficient UI</TableCell>
                <TableCell><CheckIcon /></TableCell>
                <TableCell><XIcon /></TableCell>
              </TableRow>
            </tbody>
          </ComparisonTable>
        </AboutSection>
      </AboutContent>
    </AboutContainer>
  );
};

export default About;
