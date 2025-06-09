import React from 'react'
import './Header.css'

export default function Header() {
  return (
    <header className="site-header">
      <div className="left-name"> [ARAV RAJA]</div>
      <nav className="nav-links">
        <a href="#about">ABOUT</a>
        <a href="#projects">PROJECTS</a>
        <a href="#experience">EXPERIENCE</a>
        <a href="#contact">CONTACT</a>
      </nav>
      <div className="time-bubble">|||</div>
    </header>
  )
}