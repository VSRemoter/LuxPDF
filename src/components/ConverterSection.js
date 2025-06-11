import React from 'react';
import styled from 'styled-components';
import TabConverter from './TabConverter';

const SectionContainer = styled.section`
  padding: 3rem 0;
`;

const SectionTitle = styled.h2`
  text-align: center;
  margin-bottom: 2.5rem;
  font-size: 2rem;
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


const ConverterSection = () => {
  return (
    <SectionContainer>
      <SectionTitle>Convert & Modify Your Files</SectionTitle>
      <TabConverter />
    </SectionContainer>
  );
};

export default ConverterSection;
