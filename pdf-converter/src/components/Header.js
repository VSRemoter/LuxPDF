import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { FaCrown } from 'react-icons/fa';

const HeaderContainer = styled.header`
  background-color: ${props => props.theme.colors.background};
  box-shadow: 0 2px 10px ${props => props.theme.colors.shadow};
  padding: 1rem 0;
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid rgba(247, 111, 83, 0.1);
`;

const NavContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
`;

const Logo = styled(Link)`
  display: flex;
  align-items: center;
  font-family: ${props => props.theme.fonts.heading};
  font-size: 1.5rem;
  font-weight: 700;
  color: ${props => props.theme.colors.text};
  
  svg {
    color: #FFD700;
    margin-right: 0.5rem;
    font-size: 1.8rem;
  }
  
  &:hover {
    color: ${props => props.theme.colors.text};
    
    svg {
      color: #B8860B;
    }
  }
`;

const Nav = styled.nav`
  display: flex;
  align-items: center;
  
  @media (max-width: ${props => props.theme.breakpoints.tablet}) {
    display: none;
  }
`;

const NavLink = styled(Link)`
  margin-left: 2rem;
  color: ${props => props.theme.colors.text};
  font-weight: 500;
  position: relative;
  
  &:after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 0;
    width: 0;
    height: 2px;
    background-color: ${props => props.theme.colors.primary};
    transition: width 0.3s ease;
  }
  
  &:hover, &.active {
    color: ${props => props.theme.colors.text};
    
    &:after {
      width: 100%;
    }
  }
`;

const MobileMenuButton = styled.button`
  display: none;
  background: none;
  border: none;
  font-size: 1.5rem;
  color: ${props => props.theme.colors.text};
  
  @media (max-width: ${props => props.theme.breakpoints.tablet}) {
    display: block;
  }
`;

const Header = () => {
  return (
    <HeaderContainer>
      <NavContainer>
        <Logo to="/">
          <FaCrown />
          <span>LuxPDF</span>
        </Logo>
        
        <Nav>
          <NavLink to="/about" className={window.location.pathname === '/about' ? 'active' : ''}>
            About
          </NavLink>
        </Nav>
        
        <MobileMenuButton aria-label="Toggle menu">
          ☰
        </MobileMenuButton>
      </NavContainer>
    </HeaderContainer>
  );
};

export default Header;

