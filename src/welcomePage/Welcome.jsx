import React, { useState } from 'react';
import './Welcome.css';
import DJScene from './components/DJScene.jsx';
import SpaceButton from './components/SpaceButton.jsx';
import { ANIMATION } from '../animation/config.js';

export default function Welcome() {
  const [animation, setAnimation] = useState(ANIMATION.IDLE);

  return (
    <section className="welcome-container">
      <div className="welcome-header-row">
        <div className="welcome-left">
          <p className="intro-heading">
            DEV/MAKER<br />
            SPECIALISING IN ML & AUDIO TECH<br />
          </p>
        </div>

        <div className="welcome-right">
          <div className="label-block">[UNIVERSITY OF BRISTOL CS]</div>
          <div className="label-block">[BASED IN LONDON]</div>
          <div className="label-block">[AGE 20]</div>
        </div>
      </div>
      
      <DJScene 
        animation={animation}
        setAnimation={setAnimation}
        ANIMATION={ANIMATION}
      />
      
      <SpaceButton
        animation={animation}
        setAnimation={setAnimation}
        ANIMATION={ANIMATION}
      />
      
      <div className="project-info">
        <img src="/music-suggestion.png" alt="Music Suggestion Illustration" style={{ width: '100%', borderRadius: '6px', marginBottom: '10px' }} />
        <div>
          Music Recommendations with <strong>Interaction-Aware Neural Nets</strong>
        </div>
        <div style={{ marginTop: '8px' }}>
          <a href="#projects" className="see-more-link">See more →</a>
        </div>
      </div>
    </section>
  );
}