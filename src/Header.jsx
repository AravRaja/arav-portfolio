import React, { useEffect } from 'react'
import './Header.css'
import { Link, useLocation } from 'react-router-dom'

export default function Header() {
  const location = useLocation();
  const isBlue = location.pathname !== '/';
  const onHome = location.pathname === '/';

  const handleNavClick = (path) => (e) => {
    // If we're on the Welcome page, trigger the zoom-first navigation.
    if (onHome) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('welcome-header-nav', { detail: { path } }));
    }
    // Otherwise, allow normal Link navigation.
  };

  useEffect(() => {
    // Add meta tags for iPhone status bar styling
    const addMetaTag = (name, content) => {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = name;
        document.head.appendChild(meta);
      }
      meta.content = content;
    };

    // Set theme color to match header background
    addMetaTag(
      'theme-color',
      onHome ? 'rgb(255, 255, 255)' : 'rgb(1, 23, 213)'
    );
    addMetaTag('apple-mobile-web-app-capable', 'yes');
    addMetaTag('apple-mobile-web-app-status-bar-style', 'black-translucent');
    
    // Update viewport meta tag to include viewport-fit=cover
    let viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    }
  }, []);
  return (
    <header className={`site-header ${isBlue ? 'blue' : ''}`}>
      <Link to="/" className="left-name"><span className="nav-link-highlight">ARAV.RAJA</span></Link>
      <div className="centre"> 
        <nav className="nav-links">
          <Link to="/about" onClick={handleNavClick('/about')}><span className="nav-link-highlight">ABOUT</span></Link>
          <Link to="/projects" onClick={handleNavClick('/projects')}><span className="nav-link-highlight">PROJECTS</span></Link>
          <Link to="/experience" onClick={handleNavClick('/experience')}><span className="nav-link-highlight">EXPERIENCE</span></Link>
          <Link to="/contact" onClick={handleNavClick('/contact')}><span className="nav-link-highlight">CONTACT</span></Link>
        </nav>
      </div>
      <div className="time-bubble">|||</div>
    </header>
  )
}