import React, { useState, useCallback, useEffect } from 'react';
import './Welcome.css';
import DJScene from './components/DJScene.jsx';
import SpaceButton from './components/SpaceButton.jsx';
import { ANIMATION } from '../animation/config.js';
import { useNavigate } from 'react-router-dom';
import { useZoomAndNavigate } from '../hooks/useZoomAndNavigate.js';

export default function Welcome() {
  const [animation, setAnimation] = useState(ANIMATION.IDLE);
  const [zoomTrigger, setZoomTrigger] = useState(0);
  // Music stage: after the drop the camera zooms into the deck and the page turns blue
  const [stageZoom, setStageZoom] = useState(null);
  const navigate = useNavigate();

  const startZoom = useCallback(() => {
    // Increment trigger value; DJScene listens to changes and starts the camera animation
    setZoomTrigger((n) => n + 1);
  }, []);

  const { zoomThenNavigate } = useZoomAndNavigate({ setAnimation, ANIMATION, navigate, delayMs: 700, startZoom });

  const routeByName = {
    Projects: '/projects',
    Experience: '/experience',
    Contact: '/contact',
    About: '/about',
  };

  const handleActivate = (name) => {
    const path = routeByName[name];
    if (path) zoomThenNavigate(path);
  };

  // Listen for header-triggered navigation when on Welcome page
  useEffect(() => {
    const handler = (e) => {
      const path = e?.detail?.path;
      if (path) {
        zoomThenNavigate(path);
      }
    };
    window.addEventListener('welcome-header-nav', handler);
    return () => window.removeEventListener('welcome-header-nav', handler);
  }, [zoomThenNavigate]);

  useEffect(() => {
    const handler = (e) => setStageZoom({ inward: e.detail.inward, seconds: e.detail.seconds });
    window.addEventListener('dj-stage', handler);
    return () => window.removeEventListener('dj-stage', handler);
  }, []);

  // Dispatch animation state changes to Header for audio control
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('animation-state-change', { 
      detail: { state: animation } 
    }));
  }, [animation]);

  return (
    <section
      className={`welcome-container ${stageZoom?.inward ? 'music-stage' : ''}`}
      style={{ '--stage-seconds': `${stageZoom?.seconds ?? 0.7}s` }}
    >
      <div className="welcome-header-row">
        <div className="welcome-left">
          <p className="intro-heading">
            FOUNDER / ENGINEER<br />
            ROBOTICS, ML & MUSIC<br />
          </p>
        </div>

        <div className="welcome-right">
          <div className="label-block">[CO-FOUNDER & CEO / BZZD]</div>
          <div className="label-block">[BASED IN LONDON]</div>
          <div className="label-block">[BRISTOL CS / 2026]</div>
        </div>
      </div>
      
      <DJScene 
        animation={animation}
        setAnimation={setAnimation}
        ANIMATION={ANIMATION}
        onActivate={handleActivate}
        zoomTrigger={zoomTrigger}
        stageZoom={stageZoom}
      />
      
      <SpaceButton
        animation={animation}
        setAnimation={setAnimation}
        ANIMATION={ANIMATION}
      />
      
      <div className="project-info">
        <img src="/projects/bzzd-prototype.webp" alt="bzzd haircutting prototype" style={{ width: '100%', borderRadius: '6px', marginBottom: '10px' }} />
        <div>
          <strong>bzzd</strong><br />Autonomous barber stations.
        </div>
        <div style={{ marginTop: '8px' }}>
          <a
            href="/projects?id=bzzd"
            className="see-more-link"
            onClick={(e) => {
              console.log("See more clicked")
              e.preventDefault();
              if (typeof zoomThenNavigate === 'function') {
                zoomThenNavigate('/projects?id=bzzd');
              } else {
                window.location.href = '/projects?id=bzzd';
              }
            }}
          >
            See more →
          </a>
        </div>
      </div>
    </section>
  );
}