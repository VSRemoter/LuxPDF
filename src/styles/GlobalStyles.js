import { createGlobalStyle } from 'styled-components';

const GlobalStyles = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Poppins:wght@300;400;500;600&display=swap');
  
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
      sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background-color: ${props => props.theme.colors.background};
    color: ${props => props.theme.colors.text};
    line-height: 1.6;
    font-size: 16px;
  }
  
  h1, h2, h3, h4, h5, h6 {
    font-family: ${props => props.theme.fonts.heading};
    font-weight: 600;
    margin-bottom: 1rem;
  }
  
  p {
    margin-bottom: 1rem;
  }
  
  a {
    text-decoration: none;
    color: ${props => props.theme.colors.accent};
    transition: ${props => props.theme.transition};
    
    &:hover {
      color: ${props => props.theme.colors.primary};
    }
  }
  
  button {
    cursor: pointer;
    font-family: ${props => props.theme.fonts.main};
    transition: ${props => props.theme.transition};
  }
  
  img {
    max-width: 100%;
    height: auto;
  }
  
  .container {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1rem;
  }
  
  section {
    padding: 4rem 0;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  .spin {
    animation: spin 1s linear infinite;
  }
  
  .file-drag-ghost {
    position: absolute;
    width: 2px;
    height: 2px;
    background: transparent;
    top: -1000px;
    left: -1000px;
    opacity: 0;
  }
  
  /* Add a subtle transition effect for file reordering */
  .file-list-item {
    transition: transform 0.2s ease;
  }

  code {
    font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
      monospace;
  }
`;

export default GlobalStyles;
