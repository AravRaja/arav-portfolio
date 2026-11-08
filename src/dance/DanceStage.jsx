// The 9-dancer crew on the home page's music stage (the blue page after the hold-release drop).
// Welcome mounts this only while the stage is up (plus its fade-out). The WebGL canvas is created once the deck has
// paused (the deck stops drawing when the zoom into the stage finishes), so only one scene ever renders at a time:
//   active -> canvas mounts, shaders compile off the main thread (compileAsync), then the crew fades / scales in;
//   inactive (the song fades, the user leaves the stage, a page change) -> the crew freezes on its last frame and fades
//   out while the deck takes over, then the canvas unmounts and its GPU resources and WebGL context are released.
// Time source: holdSync.songTime(), the Tone.js player's position in now-get-busy.mp3 as heard (Header.jsx). Before the
// drop hit (8.37 s) the crew stands and breathes; from it they dance, in sync with the song.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import Crew from './Crew.jsx';
import { CAPTIONS } from './captions.js';
import { WebGLRecovery } from './useWebGLRecovery.js';
import { CREW_LAYOUT, CREW_ROAM_SEED, CREW_SEED, crewReady, prepareCrew } from './stageKit.js';
import { holdSync } from '../audio/holdSync.js';
import './DanceStage.css';

export { prepareCrew };

const CAPTION = CAPTIONS[3]; // [RL] first just the song, then real dancers
const FADE_OUT_MS = 380;
const HI_DPI = typeof window !== 'undefined' && window.devicePixelRatio >= 1.5;
// phones: cap the pixel ratio at 1.5 (the crew is small on screen, and phones are fill-rate bound); desktop: 2
const PHONE = typeof window !== 'undefined' && (Math.min(window.innerWidth, window.innerHeight) < 600
  || (window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 768));
const DPR = [1, PHONE ? 1.5 : 2];
// timeline marks (Performance panel / perf checks): mount -> compiled -> first-frame
const mark = (name) => { try { performance.mark(`dance-stage:${name}`); } catch { /* unsupported */ } };

// Compile every program before the first visible frame (KHR_parallel_shader_compile where available), then report the
// first rendered frame so the fade-in starts on real pixels.
function Warmup({ onCompiled, onFirstFrame, live }) {
  const { gl, scene, camera } = useThree();
  const done = useRef(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { await gl.compileAsync(scene, camera); } catch { /* compile on first render instead */ }
      if (alive) onCompiled();
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame(() => {
    if (!live || done.current) return;
    done.current = true;
    onFirstFrame();
  });
  return null;
}

function StageScene({ ready, clock, live, onCompiled, onFirstFrame, onContextGone }) {
  const { size } = useThree();
  const narrow = size.width <= 900;
  return (
    <>
      {/* same margins as the lab: below the intro text (146 / 108 px; L4 pins 112 / 150 on desktop), above the caption */}
      <Crew rig={ready.kit.rig} clock={clock} layout={CREW_LAYOUT} seed={CREW_SEED} kit={ready.kit} tracks={ready.tracks} roam roamSeed={CREW_ROAM_SEED}
        top={narrow ? 146 : 108} bottom={118} />
      <Warmup onCompiled={onCompiled} onFirstFrame={onFirstFrame} live={live} />
      <WebGLRecovery onUnrecoverable={onContextGone} />
    </>
  );
}

export default function DanceStage({ active, onExited }) {
  const [ready, setReady] = useState(crewReady);
  const [mounted, setMounted] = useState(false); // canvas exists
  const [compiled, setCompiled] = useState(false); // programs ready (per canvas)
  const [drawn, setDrawn] = useState(false); // first live frame rendered (per canvas)
  const [leaving, setLeaving] = useState(false); // page change in progress
  const [glKey, setGlKey] = useState(0);
  const on = active && !leaving;

  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    prepareCrew().then((r) => { if (alive) setReady(r); }).catch(() => {});
    return () => { alive = false; };
  }, [ready]);

  useEffect(() => {
    const nav = () => setLeaving(true);
    window.addEventListener('dj-navigation-start', nav);
    return () => window.removeEventListener('dj-navigation-start', nav);
  }, []);

  // mount when active (and built); when inactive, fade the frozen frame out and then unmount everything
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;
  useEffect(() => {
    if (on) {
      if (ready && !mounted) { mark('mount'); setMounted(true); }
      return undefined;
    }
    const timer = setTimeout(() => {
      setMounted(false);
      setCompiled(false);
      setDrawn(false);
      exitedRef.current?.();
    }, mounted ? FADE_OUT_MS : 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ready]);

  // Song clock for the crew: the player's position as heard; idle (breathing) until the drop hit
  const clock = useMemo(() => ({
    read() {
      const t = holdSync.songTime();
      const wall = performance.now() / 1000;
      const drop = ready ? ready.kit.rig.drop : 8.37;
      if (t === null || t < drop) return { t: t ?? 0, idle: true, clock: wall, frozen: false };
      return { t, idle: false, clock: wall, frozen: false };
    },
  }), [ready]);

  if (!mounted || !ready) return null;
  const live = on && compiled; // frozen (not drawing) while fading out
  const visible = live && drawn;
  return (
    <div className={`dance-stage ${visible ? 'is-visible' : ''}`} aria-hidden={!visible}>
      <Canvas key={glKey} flat dpr={DPR} gl={{ antialias: !HI_DPI, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 30, position: [0, 1.25, 8] }} frameloop={live ? 'always' : 'never'} className="dance-stage-canvas"
        // shader error checks read each program's info log on first use, a ~30 ms stall on a cold shader cache
        onCreated={({ gl }) => { gl.debug.checkShaderErrors = import.meta.env.DEV; }}>
        <StageScene ready={ready} clock={clock} live={live}
          onCompiled={() => { mark('compiled'); setCompiled(true); }}
          onFirstFrame={() => { mark('first-frame'); requestAnimationFrame(() => setDrawn(true)); }}
          onContextGone={() => { setCompiled(false); setDrawn(false); setGlKey((k) => k + 1); }} />
      </Canvas>
      <p className="dancer-caption">
        <span className="dancer-caption-tag">[{CAPTION.tag}]</span> {CAPTION.text}
      </p>
    </div>
  );
}
