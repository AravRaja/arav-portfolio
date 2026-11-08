import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { BrowserRouter, useLocation } from 'react-router-dom'

// Dev-only design lab for the dancing humanoid (/dance-lab). Outside dev it is only built with
// VITE_DANCE_LAB=1; otherwise the condition is false at build time and the page is left out.
const LAB_ENABLED = import.meta.env.DEV || import.meta.env.VITE_DANCE_LAB === '1'
const DanceLab = LAB_ENABLED ? lazy(() => import('./danceLab/DanceLab.jsx')) : null

function Root() {
  const { pathname } = useLocation()
  if (DanceLab && pathname === '/dance-lab') {
    return <Suspense fallback={null}><DanceLab /></Suspense>
  }
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>
)
