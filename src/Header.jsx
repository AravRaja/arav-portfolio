import React from 'react'
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
  return (
    <header className={`site-header ${isBlue ? 'blue' : ''}`}>
      <div className="left-name">ARAV.RAJA</div>
      <div className="centre"> 
        <nav className="nav-links">
          <Link to="/about" onClick={handleNavClick('/about')}><span className="nav-link-highlight">ABOUT</span></Link>
          <Link to="/projects" onClick={handleNavClick('/projects')}><span className="nav-link-highlight">PROJECTS</span></Link>
          <Link to="/experience" onClick={handleNavClick('/experience')}><span className="nav-link-highlight">EXPERIENCE</span></Link>
          <Link to="/contact" onClick={handleNavClick('/contact')}><span className="nav-link-highlight">CONTACT</span></Link>
        </nav>
      </div>
      <div className="time-bubble">|</div>
    </header>
  )
}