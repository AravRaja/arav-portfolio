import React, { useEffect, lazy, Suspense } from 'react';
import Header from './Header'
import "./App.css"
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

// Each page loads on demand, so three.js and the 3D deck only download on the home page
const Welcome = lazy(() => import('./welcomePage/Welcome'))
const Projects = lazy(() => import('./pages/Projects.jsx'))
const Experience = lazy(() => import('./pages/Experiences.jsx'))
const Contact = lazy(() => import('./pages/Contact'))
const ImageBoard = lazy(() => import('./pages/ImageBoard.jsx'))
const About = lazy(() => import('./pages/About.jsx'))

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Header />
      <Suspense fallback={null}>
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
      </Suspense>
    </div>
  )
}
