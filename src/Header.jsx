import React from 'react'
import './Header.css'

export default function Header() {
  return (
    <header className="site-header">
      <div className="left-name">ARAV.RAJA</div>
      <div className= "centre"> 
        <nav className="nav-links">
          <a href="#about"><span className="nav-link-highlight">ABOUT</span></a>
          <a href="#projects"><span className="nav-link-highlight">PROJECTS</span></a>
          <a href="#experience"><span className="nav-link-highlight">EXPERIENCE</span></a>
          <a href="#contact"><span className="nav-link-highlight">CONTACT</span></a>
        </nav>
      </div>
      <div className="time-bubble">|||</div>
    </header>
  )
}