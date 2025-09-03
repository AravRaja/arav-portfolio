import React from 'react';
import Header from './Header'
import Welcome from './welcomePage/Welcome'
import "./App.css"

export default function App() {
  return (
    <div style={{ width: '100dvw', height: '100dvh' }}>
      <Header />
      <Welcome />
    </div>
  )
}
