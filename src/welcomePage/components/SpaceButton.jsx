import { nextHoldState } from '../../audio/holdState.js';
import { holdSync } from '../../audio/holdSync.js';
import { useMuted } from '../../audio/muteState.js';
import { useEffect, useRef, useCallback, useState } from 'react';
import './SpaceButton.css'
import useSound from 'use-sound';

const CLICK_SOUND = '/click.mp3';


// How the key looks in each hold phase: up, filling, full (glowing red, "let go"), playing (glowing red, pressed)
const KEY_CLASS = {
  idle: 'space-up',
  holding: 'space-down',
  armed: 'space-down space-armed',
  playing: 'space-down-active',
};

export default function SpaceButton({ setAnimation, ANIMATION }) {

  const isPressed = useRef(false);
  const muted = useMuted();
  const [playClick] = useSound(CLICK_SOUND, { volume: 0.6, soundEnabled: !muted });
  const blocked = useRef(false);
  const phase = useRef('idle');
  const [view, setView] = useState('idle'); // mirrors phase, for rendering
  const keyRef = useRef(null);
  const fullTimer = useRef(0);
  const updatePhase = useCallback((event) => {
    const prev = phase.current;
    phase.current = nextHoldState(prev, event, { inSong: holdSync.songActive });
    // A new hold: decide how long it lasts (snapped to the beat) so the fill, deck and music agree
    // ...and when it's let go, how long the bar takes to drain (deck and fade follow it)
    let holdSeconds, drainSeconds;
    if (phase.current === 'holding' && prev !== 'holding') {
      holdSeconds = holdSync.plan();
      keyRef.current?.style.setProperty('--hold-seconds', `${holdSeconds}s`);
      // The bar is "full" on the same clock as its fill, so the two always line up
      clearTimeout(fullTimer.current);
      fullTimer.current = setTimeout(() => updatePhase('complete'), holdSeconds * 1000);
    } else if (phase.current === 'idle' && prev !== 'idle') {
      drainSeconds = holdSync.planDrain();
      keyRef.current?.style.setProperty('--drain-seconds', `${drainSeconds}s`);
    }
    if (phase.current !== 'holding') clearTimeout(fullTimer.current);
    setView(phase.current);
    window.dispatchEvent(new CustomEvent('dj-hold-change', { detail: { held: phase.current !== 'idle', armed: phase.current === 'armed', dropped: phase.current === 'playing', holdSeconds, drainSeconds } }));
    // The deck winds up while holding and down when let go; once full it finishes its own
    // wind-up (and stays running), so it's never cut off mid-move.
    if (phase.current === 'idle' && prev !== 'idle') setAnimation(ANIMATION.DOWN);
    else if (phase.current === 'holding' && prev !== 'holding') setAnimation(ANIMATION.UP);
  }, [setAnimation, ANIMATION]);
  const handlePressDown = useCallback(() => {
    if (isPressed.current || blocked.current) return;
    isPressed.current = true;
    playClick();
    updatePhase('press');
  }, [updatePhase, playClick]);
  const handlePressUp = useCallback(() => {
    if (!isPressed.current) return;
    isPressed.current = false;
    updatePhase('release');
  }, [updatePhase]);
  const stop = useCallback(() => {
    isPressed.current = false;
    updatePhase('reset');
  }, [updatePhase]);
  useEffect(() => {
    const down = (e) => {
      if (e.code !== 'Space' || e.repeat || e.target.closest?.('input,textarea,select,[contenteditable="true"],a,button')) return;
      e.preventDefault(); handlePressDown();
    };
    const up = (e) => { if (e.code === 'Space') { e.preventDefault(); handlePressUp(); } };
    const navigate = () => { blocked.current = true; stop(); };
    const hidden = () => { if (document.hidden) stop(); }; // only cancel when the tab goes away
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointerup', handlePressUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    window.addEventListener('dj-navigation-start', navigate);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointerup', handlePressUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      window.removeEventListener('dj-navigation-start', navigate);
      document.removeEventListener('visibilitychange', hidden);
      stop();
    };
  }, [handlePressDown, handlePressUp, stop]);


  return (
    <div className="space-full">
      <svg
        id="rectangle"
        ref={keyRef}
        className={KEY_CLASS[view]}
        role="button"
        tabIndex={0}
        aria-label={view === 'armed' ? "Let go of Space to drop the beat" : view === 'playing' ? "Press Space to stop music" : "Hold Space to activate music"}
        aria-pressed={view === 'playing'}
        onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); handlePressDown(); }}
        onPointerUp={handlePressUp}
        onPointerCancel={stop}
        onPointerLeave={handlePressUp}
        viewBox="0 0 400 50"
        xmlns="http://www.w3.org/2000/svg"
     >
        <path
          id="base-stroke"
          d="M 4 25 Q 4 5 26 5 H 376 Q 396 5 396 25
M 4 25 Q 4 45 26 45 H 376 Q 396 45 396 25"
        />
        <path
          id="stroke-top"
          d="M 4 25 Q 4 5 26 5 H 376 Q 396 5 396 25"
        />
        <path
          id="stroke-bottom"
          d="M 4 25 Q 4 45 26 45 H 376 Q 396 45 396 25"
        />
        <text
          className="space-label"
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {view === 'playing' ? "PRESS SPACE TO STOP" : view === 'armed' ? "LET GO" : "HOLD SPACE"}
        </text>
      </svg>
      <svg id="space-base" viewBox="0 0 400 50" xmlns="http://www.w3.org/2000/svg">
        <path id="stroke-bottom-base" d="M 4 19 Q 4 45 26 45 H 376 Q 396 45 396 19" />
      </svg>
    </div>
  );
}