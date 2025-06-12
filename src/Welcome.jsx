import React from 'react';
import './Welcome.css';

export default function Welcome() {
  return (
    <section className="welcome-container">
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