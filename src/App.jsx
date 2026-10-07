import React, { useEffect } from 'react';
import Header from './Header'
import Welcome from './welcomePage/Welcome'
import "./App.css"
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Projects from './pages/Projects.jsx'
import Experience from './pages/Experiences.jsx'
import Contact from './pages/Contact';
import ImageBoard from './pages/ImageBoard.jsx'
import About from './pages/About.jsx'

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Header />
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/experience" element={<Experience />} />
        <Route path="/contact" element={<Contact />} />
              <Route path="/imageboard" element={<ImageBoard />} />
        <Route path="/about" element={<About />} />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
