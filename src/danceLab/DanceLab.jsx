// Dev-only design lab for the RL-trained dancer on the music stage (/dance-lab).
// Not part of the site's page flow: main.jsx only mounts it in dev (or with VITE_DANCE_LAB=1).
//
// Keys: 1-9, 0 / A-D design (5-9, 0 = D1-D6 from designs/index.js) · C caption · Space play/pause (from the drop) · P play with 4 s of
// idle before the drop · ←/→ ±1 8-count · K freeze on the 41.04 s clap · H hide site chrome · L crew layout (L1-L4, off)
// URL: ?design=A..D, D1..D6&caption=0..3&t=41.04 (freeze at a song time) &chrome=0 &view=verify
//      &crew=L1..L4 (9-dancer crew, crew/; &seed=N re-rolls the looks; &lineup=front|back: the looks in a row, bind pose)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import Header from '../Header.jsx';
import '../welcomePage/Welcome.css';
import '../welcomePage/components/SpaceButton.css';
import './DanceLab.css';
import { Rig, loadFinale } from './rig.js';
import { CAPTIONS } from './captions.js';
import { WebGLRecovery } from './useWebGLRecovery.js';
import { StageCamera } from './designs/common.jsx';
import InkFigure from './designs/InkFigure.jsx';
import CapsuleMannequin from './designs/CapsuleMannequin.jsx';
import NeonWire from './designs/NeonWire.jsx';
import LowPolyCharacter from './designs/LowPolyCharacter.jsx';
import { EXTRA_DESIGNS } from './designs/index.js'; // D1-D6 (keys 5-9, 0)
import Crew from './crew/Crew.jsx';
import { LAYOUTS, LAYOUT_KEYS } from './crew/layouts.js';

const DESIGNS = {
  A: { name: 'Ink figure', Component: InkFigure, stage: 'blue', dpr: 2 },
  B: { name: 'Capsule mannequin', Component: CapsuleMannequin, stage: 'blue', dpr: 2 },
  // the glow is soft anyway, so the neon stage renders at up to 1.5x to keep its overdraw cheap
  C: { name: 'Neon wire', Component: NeonWire, stage: 'club', dpr: 1.5 },
  D: { name: 'Low-poly character', Component: LowPolyCharacter, stage: 'blue', dpr: 2 },
  ...EXTRA_DESIGNS,
};
const KEYS = Object.keys(DESIGNS);
const CLAP_T = 41.04;
const HI_DPI = typeof window !== 'undefined' && window.devicePixelRatio >= 1.5;

const fmt = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
};

// Song clock shared by the designs: the audio element is the source of truth while playing.
function useSongClock(audio, drop) {
  return useMemo(() => {
    const start = performance.now();
    const c = {
      mode: 'idle', // idle (waiting, breathing) | audio | frozen
      frozenT: 0,
      frozenWall: null,
      read() {
        const wall = (performance.now() - start) / 1000;
        if (c.mode === 'frozen') {
          const fz = c.frozenWall === null;
          return { t: c.frozenT, idle: c.frozenT < drop - 1, clock: fz ? 0 : c.frozenWall, frozen: fz };
        }
        if (c.mode === 'audio') return { t: audio.currentTime, idle: false, clock: wall, frozen: false };
        return { t: 0, idle: true, clock: wall, frozen: false };
      },
    };
    return c;
  }, [audio, drop]);
}

function Stats({ statsRef }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ n: 0, t: performance.now(), calls: 0 });
  useEffect(() => { gl.info.autoReset = false; return () => { gl.info.autoReset = true; }; }, [gl]);
  useFrame(() => {
    const a = acc.current;
    a.calls = gl.info.render.calls; // previous frame, including the contact-shadow passes
    gl.info.reset();
    a.n++;
    const now = performance.now();
    if (now - a.t > 500 && statsRef.current) {
      statsRef.current.textContent = `${Math.round((a.n * 1000) / (now - a.t))} fps · ${a.calls} draw calls`;
      a.n = 0; a.t = now;
    }
  }, -2);
  return null;
}

// Same camera as dance-rl's contact sheets (MuJoCo free camera: distance 3.6, elevation -12°,
// azimuth 180°, look-at = root xy at 1 m, fovy 45°) to compare poses against the sheet tiles.
function VerifyCamera({ rig }) {
  const { camera } = useThree();
  useFrame(() => {
    const p = rig.wpos[0];
    const el = (-12 * Math.PI) / 180;
    const look = [p.y, 1.0, p.x]; // three = (mj y, mj z, mj x)
    camera.fov = 45;
    camera.clearViewOffset();
    camera.position.set(look[0], look[1] - 3.6 * Math.sin(el), look[2] + 3.6 * Math.cos(el));
    camera.lookAt(...look);
    camera.updateProjectionMatrix();
  });
  return null;
}

function Stage({ rig, clock, design, verify, statsRef, onContextGone, crew, seed, lineup }) {
  const { size } = useThree();
  const get = useThree((s) => s.get);
  useEffect(() => { window.__labThree = get; return () => { delete window.__labThree; }; }, [get]);
  const Design = DESIGNS[design].Component;
  const narrow = size.width <= 900;
  return (
    <>
      {crew ? <Crew rig={rig} clock={clock} layout={crew} seed={seed} lineup={lineup} top={lineup ? 24 : narrow ? 146 : 108} bottom={lineup ? 24 : 118} /> : (
        <>
          {verify ? <VerifyCamera rig={rig} /> : <StageCamera top={narrow ? 150 : 112} bottom={narrow ? 150 : 150} />}
          <Design rig={rig} clock={clock} />
        </>
      )}
      <Stats statsRef={statsRef} />
      <WebGLRecovery onUnrecoverable={onContextGone} />
    </>
  );
}

export default function DanceLab() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [rig, setRig] = useState(null);
  const [design, setDesign] = useState(() => (KEYS.includes(params.get('design')) ? params.get('design') : 'A'));
  const [caption, setCaption] = useState(() => Number(params.get('caption') || DESIGNS[params.get('design')]?.caption || (params.get('crew') ? 3 : 0)) % CAPTIONS.length);
  const [chrome, setChrome] = useState(params.get('chrome') !== '0');
  const [panel] = useState(params.get('panel') !== '0');
  const [playing, setPlaying] = useState(false);
  const [crew, setCrew] = useState(() => (LAYOUT_KEYS.includes(params.get('crew')) ? params.get('crew') : null));
  const seed = Number(params.get('seed') || 7);
  const lineup = ['front', 'back'].includes(params.get('lineup')) ? params.get('lineup') : null;
  const [glKey, setGlKey] = useState(0); // bumped to remount the canvas if its WebGL context never comes back
  const verify = params.get('view') === 'verify';
  const audio = useMemo(() => {
    const a = new Audio('/now-get-busy.mp3');
    a.preload = 'auto';
    return a;
  }, []);
  const clock = useSongClock(audio, 8.37);
  const timeRef = useRef(null);
  const unitRef = useRef(null);
  const statsRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadFinale().then((d) => {
      if (!alive) return;
      const r = new Rig(d);
      const err = r.verify();
      console.info(`[dance-lab] FK vs MuJoCo xpos at t=${d.header.verify.t}s: max |Δ| = ${err.toExponential(2)} m`);
      r.verifyErr = err;
      setRig(r);
    });
    return () => { alive = false; audio.pause(); };
  }, [audio]);

  // URL freeze (?t=41.04) for stills, and a hook for the capture script
  useEffect(() => {
    if (!rig) return;
    const t = params.get('t');
    if (t !== null) { clock.mode = 'frozen'; clock.frozenT = Number(t); }
    window.__lab = {
      rig,
      ready: true,
      verifyErr: rig.verifyErr,
      freeze(t, wall = null) { clock.mode = 'frozen'; clock.frozenT = t; clock.frozenWall = wall; },
      setDesign, setCaption, setChrome, setCrew,
    };
    return () => { delete window.__lab; };
  }, [rig, clock, params]);

  const play = (fromT) => {
    clock.mode = 'audio';
    if (fromT !== undefined) audio.currentTime = fromT;
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  const toggle = () => {
    if (!audio.paused) { audio.pause(); setPlaying(false); return; }
    if (clock.mode !== 'audio' || audio.ended) play(8.37);
    else play();
  };
  const seek = (dt) => {
    const t = Math.max(0, Math.min(audio.duration || 141.8, (clock.mode === 'audio' ? audio.currentTime : clock.read().t) + dt));
    audio.currentTime = t;
    if (clock.mode !== 'audio') { clock.mode = 'frozen'; clock.frozenT = t; clock.frozenWall = null; }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (KEYS.includes(k)) setDesign(k);
      else if ('1234567890'.includes(k) && KEYS['1234567890'.indexOf(k)]) setDesign(KEYS['1234567890'.indexOf(k)]);
      else if (k === 'C') setCaption((c) => (c + 1) % CAPTIONS.length);
      else if (k === 'L') setCrew((c) => [...LAYOUT_KEYS, null][(LAYOUT_KEYS.indexOf(c) + 1 + LAYOUT_KEYS.length + 1) % (LAYOUT_KEYS.length + 1)]);
      else if (k === 'H') setChrome((c) => !c);
      else if (k === 'P') play(8.37 - 4);
      else if (k === 'K') { audio.pause(); setPlaying(false); clock.mode = 'frozen'; clock.frozenT = CLAP_T; clock.frozenWall = null; }
      else if (e.key === 'ArrowRight') seek(4.25);
      else if (e.key === 'ArrowLeft') seek(-4.25);
      else if (e.key === ' ') { e.preventDefault(); toggle(); }
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // song time + current 8-count in the panel (DOM writes, no re-render per frame)
  useEffect(() => {
    let raf;
    const tick = () => {
      if (rig && timeRef.current) {
        const s = clock.read();
        timeRef.current.textContent = s.idle && clock.mode === 'idle' ? 'waiting for the drop' : fmt(s.t);
        const u = rig.unitAt(s.t);
        unitRef.current.textContent = (!u || s.idle ? (s.t < rig.drop ? 'IDLE (before the drop)' : '') :
          u.fused ? `u${u.u} FUSED · LEGS ${u.legs} · ARMS ${u.arms}` : `u${u.u} ${u.move}`) +
          (window.__crew && !s.idle ? ` · crew ${window.__crew.describe(s.t).join(' ')}` : '');
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [rig, clock]);

  const cap = CAPTIONS[caption];
  return (
    <div className={`dance-lab stage-${DESIGNS[design].stage}`}>
      {chrome && !verify && (
        <>
          <Header />
          <div className="lab-intro welcome-header-row">
            <div className="welcome-left"><p className="intro-heading">FOUNDER / ENGINEER<br />ROBOTICS, ML & MUSIC<br /></p></div>
            <div className="welcome-right">
              <div className="label-block">[CO-FOUNDER & CEO / BZZD]</div>
              <div className="label-block">[BASED IN LONDON]</div>
              <div className="label-block">[BRISTOL CS / 2026]</div>
            </div>
          </div>
          <div className="space-full lab-space" aria-hidden="true">
            <svg id="rectangle" className="space-down-active" viewBox="0 0 400 50">
              <path id="base-stroke" d="M 4 25 Q 4 5 26 5 H 376 Q 396 5 396 25 M 4 25 Q 4 45 26 45 H 376 Q 396 45 396 25" />
              <path id="stroke-top" d="M 4 25 Q 4 5 26 5 H 376 Q 396 5 396 25" />
              <path id="stroke-bottom" d="M 4 25 Q 4 45 26 45 H 376 Q 396 45 396 25" />
              <text className="space-label" x="50%" y="50%" dominantBaseline="middle" textAnchor="middle">PRESS SPACE TO STOP</text>
            </svg>
            <svg id="space-base" viewBox="0 0 400 50"><path id="stroke-bottom-base" d="M 4 19 Q 4 45 26 45 H 376 Q 396 45 396 19" /></svg>
          </div>
        </>
      )}
      {rig && (
        <Canvas key={`${design}-${glKey}`} flat dpr={[1, DESIGNS[design].dpr]} gl={{ antialias: !HI_DPI, alpha: true }}
          camera={{ fov: 26, position: [0, 1.25, 8] }} className="dance-lab-canvas">
          <Stage rig={rig} clock={clock} design={design} verify={verify} statsRef={statsRef} crew={crew} seed={seed} lineup={lineup}
            onContextGone={() => setGlKey((k) => k + 1)} />
        </Canvas>
      )}
      {!verify && (
        <p className="dancer-caption" key={caption}>
          <span className="dancer-caption-tag">[{cap.tag}]</span> {cap.text}
        </p>
      )}
      {panel && !verify && (
        <div className="lab-panel">
          <div className="lab-row">
            {KEYS.map((k, i) => (
              <button key={k} type="button" className={design === k ? 'on' : ''} onClick={(e) => { setDesign(k); e.currentTarget.blur(); }}
                title={`${i + 1} / ${k}`}>{k} · {DESIGNS[k].name}</button>
            ))}
          </div>
          <div className="lab-row">
            {[...LAYOUT_KEYS, null].map((k) => (
              <button key={k || 'off'} type="button" className={crew === k ? 'on' : ''} onClick={(e) => { setCrew(k); e.currentTarget.blur(); }}>
                {k ? `crew ${k} · ${LAYOUTS[k].name}` : 'solo'}</button>
            ))}
          </div>
          <div className="lab-row">
            <button type="button" onClick={(e) => { toggle(); e.currentTarget.blur(); }}>{playing ? 'pause' : 'play from drop'}</button>
            <button type="button" onClick={(e) => { play(8.37 - 4); e.currentTarget.blur(); }}>pre-roll</button>
            <button type="button" onClick={(e) => { setCaption((c) => (c + 1) % CAPTIONS.length); e.currentTarget.blur(); }}>caption {caption + 1}/{CAPTIONS.length}</button>
            <button type="button" onClick={(e) => { audio.pause(); setPlaying(false); clock.mode = 'frozen'; clock.frozenT = CLAP_T; clock.frozenWall = null; e.currentTarget.blur(); }}>clap 41.04</button>
          </div>
          <div className="lab-row lab-readout">
            <span ref={timeRef} className="lab-time" />
            <span ref={statsRef} />
          </div>
          <div className="lab-unit" ref={unitRef} />
          {rig && <div className="lab-unit">FK vs MuJoCo: {rig.verifyErr.toExponential(1)} m · keys 1-9 0 C space P ←→ K H L</div>}
        </div>
      )}
    </div>
  );
}
