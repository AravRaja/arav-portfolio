// The 9-dancer crew on the home page's music stage (the blue page after the hold-release drop).
// Welcome mounts this only while the stage is up (plus its fade-out). The WebGL canvas is created once the deck has
// paused (the deck stops drawing when the zoom into the stage finishes), so only one scene ever renders at a time:
//   active -> canvas mounts, shaders compile off the main thread (compileAsync), then the crew fades / scales in;
//   inactive (the song fades, the user leaves the stage, a page change) -> the crew freezes on its last frame and fades
//   out while the deck takes over, then the canvas unmounts and its GPU resources and WebGL context are released.
// Time source: holdSync.songTime(), the Tone.js player's position in now-get-busy.mp3 as heard (Header.jsx). Before the
// drop hit (8.37 s) the crew stands and breathes; from it they dance, in sync with the song.
// Sim reveal (simReveal.js): a divider parked at the right edge; dragging it left (the handle, or anywhere on the stage)
// shows the same crew as the MuJoCo capsule bodies on the simulator's floor. Once per stage entry, 0.9 s after the
// crew fades in, it sweeps out to 35% and back by itself so the gesture is discoverable.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import Crew from './Crew.jsx';
import { CAPTIONS, DEFAULT_CAPTION } from './captions.js';
import CaptionText from './CaptionText.jsx';
import RevealOverlay from './RevealOverlay.jsx';
import { armSweep, createReveal, primeClipping, useRevealDrag } from './simReveal.js';
import { WebGLRecovery } from './useWebGLRecovery.js';
import { CREW_LAYOUT, CREW_ROAM_SEED, CREW_SEED, crewReady, prepareCrew } from './stageKit.js';
import { holdSync } from '../audio/holdSync.js';
import './DanceStage.css';

export { prepareCrew };

const CAPTION = CAPTIONS[DEFAULT_CAPTION]; // [RL] RL-trained in MuJoCo · I think dancers are safe for now...
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
      try {
        primeClipping(gl, camera); // the reveal's clipped programs: compile the variant the first frame uses
        await gl.compileAsync(scene, camera);
      } catch { /* compile on first render instead */ }
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

function StageScene({ ready, clock, live, reveal, onCompiled, onFirstFrame, onContextGone }) {
  const { size } = useThree();
  const narrow = size.width <= 900;
  return (
    <>
      {/* same margins as the lab: below the intro text (146 / 108 px; L4 pins 112 / 150 on desktop), above the caption */}
      <Crew rig={ready.kit.rig} clock={clock} layout={CREW_LAYOUT} seed={CREW_SEED} kit={ready.kit} tracks={ready.tracks} roam roamSeed={CREW_ROAM_SEED}
        reveal={reveal} top={narrow ? 146 : 108} bottom={118} />
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

  // one reveal per stage entry (a fresh canvas): parked, with its sweep still to come
  const reveal = useMemo(() => (mounted ? createReveal() : null), [mounted]);
  const live = on && compiled; // frozen (not drawing) while fading out
  const visible = !!(mounted && ready) && live && drawn;
  useRevealDrag(reveal, visible);
  useEffect(() => { if (visible && reveal) armSweep(reveal); }, [visible, reveal]);
  useEffect(() => {
    if (!import.meta.env.DEV || !reveal) return undefined;
    window.__simReveal = reveal; // dev / capture hook
    return () => { if (window.__simReveal === reveal) delete window.__simReveal; };
  }, [reveal]);

  if (!mounted || !ready) return null;
  return (
    <div className={`dance-stage ${visible ? 'is-visible' : ''}`} aria-hidden={!visible}>
      <Canvas key={glKey} flat dpr={DPR} gl={{ antialias: !HI_DPI, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 30, position: [0, 1.25, 8] }} frameloop={live ? 'always' : 'never'} className="dance-stage-canvas"
        // shader error checks read each program's info log on first use, a ~30 ms stall on a cold shader cache
        onCreated={({ gl }) => { gl.debug.checkShaderErrors = import.meta.env.DEV; }}>
        <StageScene ready={ready} clock={clock} live={live} reveal={reveal}
          onCompiled={() => { mark('compiled'); setCompiled(true); }}
          onFirstFrame={() => { mark('first-frame'); requestAnimationFrame(() => setDrawn(true)); }}
          onContextGone={() => { setCompiled(false); setDrawn(false); setGlKey((k) => k + 1); }} />
      </Canvas>
      <RevealOverlay store={reveal} count={ready.kit.dancers.length} />
      <p className="dancer-caption">
        <CaptionText caption={CAPTION} />
      </p>
    </div>
  );
}
