import React from 'react'
import DJScene from './DJScene'
import Header from './Header'
import Welcome from './Welcome'
import "./App.css"
export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Header />
      <Welcome />
      <DJScene />
    </div>
  )
}
