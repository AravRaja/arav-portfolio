import React, { useState, useCallback, useEffect } from 'react';
import './Welcome.css';
import DJScene from './components/DJScene.jsx';
import SpaceButton from './components/SpaceButton.jsx';
import { ANIMATION } from '../animation/config.js';
import { useNavigate } from 'react-router-dom';
import { useZoomAndNavigate } from '../hooks/useZoomAndNavigate.js';
import { loadDanceStage, prefetchDanceStage } from '../dance/prefetch.js';

export default function Welcome() {
  const [animation, setAnimation] = useState(ANIMATION.IDLE);
  const [zoomTrigger, setZoomTrigger] = useState(0);
  // Music stage: after the drop the camera zooms into the deck and the page turns blue
  const [stageZoom, setStageZoom] = useState(null);
  // The crew appears once the deck has stopped drawing (end of the zoom in) and stays mounted through its fade-out
  const [deckPaused, setDeckPaused] = useState(false);
  const crewActive = !!stageZoom?.inward && deckPaused;
  const [crewMounted, setCrewMounted] = useState(false);
  useEffect(() => { if (crewActive) setCrewMounted(true); }, [crewActive]);
  const crewExited = useCallback(() => setCrewMounted(false), []);
  // The dancing crew is its own chunk, fetched (with its data, and its bodies built) as soon as space is first held.
  // Held as a plain component once loaded rather than through React.lazy + Suspense, whose reveal throttle would
  // hold the crew back ~300 ms on its first appearance.
  const [DanceStage, setDanceStage] = useState(null);
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

  // Start fetching / building the crew the moment space is first held, so the drop never waits on it
  useEffect(() => {
    let alive = true;
    const handler = (e) => {
      if (!e.detail?.held) return;
      prefetchDanceStage().catch(() => {});
      loadDanceStage().then((m) => { if (alive) setDanceStage(() => m.default); }).catch(() => {});
    };
    window.addEventListener('dj-hold-change', handler);
    return () => { alive = false; window.removeEventListener('dj-hold-change', handler); };
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
      {crewMounted && DanceStage && <DanceStage active={crewActive} onExited={crewExited} />}
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
        onPausedChange={setDeckPaused}
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