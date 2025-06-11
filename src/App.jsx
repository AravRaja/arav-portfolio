import React, { useState } from 'react';
import DJScene from './DJScene'
import Header from './Header'
import Welcome from './Welcome'
import KeyboardInteractions from './KeyboardInteractions'
import "./App.css"
export default function App() {
  const ANIMATION = {
          IDLE: 0,
          UP: 1,
          DOWN: 2,
          RUNNING: 3,
          RUNNING_ACTIVATED: 4,
    };
  
  const [animation, setAnimation] = useState(ANIMATION.IDLE)
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Header />
      <Welcome />
      <KeyboardInteractions animation={animation} setAnimation={setAnimation} ANIMATION={ANIMATION} />
      <DJScene animation={animation} setAnimation={setAnimation} ANIMATION={ANIMATION} />
    </div>
  )
}
