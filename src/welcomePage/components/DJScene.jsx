import { Box3, Vector3 } from 'three';
import { djBounds } from '../../components/djBounds.js';
import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import AnimatedButton from './AnimatedButton.jsx';
import { useResponsiveModel } from '../../hooks/useResponsiveModel.js';
import { useMouseOverCanvas } from '../../hooks/useMouseOverCanvas.js';
import { useDJAnimation } from '../../hooks/useDJAnimation.js';
import { holdSync } from '../../audio/holdSync.js';

// The deck pulses on the beat during the build-up: not at all at the start of the hold,
// growing as the filter opens, strongest when the bar is full.
// Each beat nudges a spring, so the deck bounces up and settles with a little overshoot.
const BEAT_PULSE = 0.06; // roughly the extra scale at the top of a bounce, at full build
const SPRING_STIFFNESS = 180; // higher = quicker bounce
const SPRING_DAMPING = 11; // lower = more wobble after each bounce
const BEAT_LEAD = 0.17; // nudge this far (fraction of a beat) early so the bounce peaks on the beat

// Camera framings: the normal page view, and zoomed into the deck (used for page changes
// and for the music stage after the beat drop).
const VIEW_HOME = { pos: [0, 3, 8], fov: 60, look: [0, 0, 0] };
const VIEW_IN = { pos: [0, 0, 1], fov: 20, look: [0, 0, -1] };

function DJModel({animation, setAnimation, ANIMATION, onActivate, zoomTrigger, stageZoom}) {
  const { nodes } = useGLTF('/DJ1.glb');
  const [activeButton, setActiveButton] = useState(null);
  
  // Create refs object for cleaner organization
  const refs = {
    tonebarLeft: useRef(),
    tonebarRight: useRef(),
    vinylLeft: useRef(),
    vinylRight: useRef(),
    modelGroup: useRef(),
  };

  // Use extracted hooks
  const { modelScale, modelPosition } = useResponsiveModel();
  const mouse = useMouseOverCanvas('.djscene-canvas');
  
  // Use animation hook
  useDJAnimation({ refs, animation, setAnimation, ANIMATION, mouse });

  // Camera zoom: eases from wherever the camera is now to a target framing
  const zoomState = useRef({ active: false, t: 0, duration: 0.7, from: VIEW_HOME, to: VIEW_IN });
  const look = useRef([...VIEW_HOME.look]);
  const camera = useThree((state) => state.camera);
  const startZoom = (to, duration) => {
    zoomState.current = {
      active: true,
      t: 0,
      duration: Math.max(0.05, duration),
      from: { pos: camera.position.toArray(), fov: camera.fov, look: [...look.current] },
      to,
    };
  };

  useEffect(() => {
    if (zoomTrigger) startZoom(VIEW_IN, 0.7);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomTrigger]);

  useEffect(() => {
    if (stageZoom) startZoom(stageZoom.inward ? VIEW_IN : VIEW_HOME, stageZoom.seconds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageZoom]);

  useFrame((state, delta) => {
    if (!zoomState.current.active) return;
    const zs = zoomState.current;
    zs.t += delta / zs.duration; // normalize to [0,1]
    const k = Math.min(1, zs.t);

    // Ease-in-out
    const ease = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
    const lerp = (a, b) => a + (b - a) * ease;
    const { from, to } = zs;
    camera.position.set(lerp(from.pos[0], to.pos[0]), lerp(from.pos[1], to.pos[1]), lerp(from.pos[2], to.pos[2]));
    camera.fov = lerp(from.fov, to.fov);
    camera.updateProjectionMatrix();
    look.current = [lerp(from.look[0], to.look[0]), lerp(from.look[1], to.look[1]), lerp(from.look[2], to.look[2])];
    camera.lookAt(...look.current);

    if (k >= 1) {
      zs.active = false;
    }
  });


  const spring = useRef({ x: 0, v: 0, lastPhase: null });
  useFrame((_, delta) => {
    const group = refs.modelGroup.current;
    if (!group) return;
    const sp = spring.current;
    const dt = Math.min(delta, 1 / 30);
    const phase = holdSync.beatPhase();
    const build = Math.pow(holdSync.openness(), 1.5);
    if (phase !== null) {
      const shifted = (phase + BEAT_LEAD) % 1;
      if (sp.lastPhase !== null && shifted < sp.lastPhase) {
        sp.v += BEAT_PULSE * build * Math.sqrt(SPRING_STIFFNESS) * 1.7; // new beat: nudge
      }
      sp.lastPhase = shifted;
    } else {
      sp.lastPhase = null;
    }
    sp.v += (-SPRING_STIFFNESS * sp.x - SPRING_DAMPING * sp.v) * dt;
    sp.x += sp.v * dt;
    group.scale.setScalar(modelScale * (1 + sp.x));
  });

  const projectedBox = useRef(new Box3());
  const corner = useRef(new Vector3());
  useEffect(() => () => { djBounds.current = null; }, []);
  useFrame(({ camera, size }) => {
    if (!refs.modelGroup.current) return;
    refs.modelGroup.current.updateWorldMatrix(true, true);
    const box = projectedBox.current.setFromObject(refs.modelGroup.current);
    let left = Infinity, right = -Infinity;
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
      corner.current.set(x ? box.max.x : box.min.x, y ? box.max.y : box.min.y, z ? box.max.z : box.min.z).project(camera);
      const px = (corner.current.x + 1) * size.width / 2;
      left = Math.min(left, px); right = Math.max(right, px);
    }
    djBounds.current = { left: left - 48, right: right + 48 };
  });


  return (
    <group ref={refs.modelGroup} scale={[modelScale, modelScale, modelScale]} position={modelPosition}>
      {/* Base of the DJ deck */}
      <primitive object={nodes.Base} />

      {/* Animated Buttons */}
      <AnimatedButton node={nodes.About} name="About" active={activeButton} setActive={setActiveButton} onActivate={onActivate} />
      <AnimatedButton node={nodes.Experience} name="Experience" active={activeButton} setActive={setActiveButton} onActivate={onActivate} />
      <AnimatedButton node={nodes.Projects} name="Projects" active={activeButton} setActive={setActiveButton} onActivate={onActivate} />
      <AnimatedButton node={nodes.Contact} name="Contact" active={activeButton} setActive={setActiveButton} onActivate={onActivate} />

      {/* Spinning Vinyls */}
      <primitive
        ref={refs.vinylLeft}
        object={nodes.VinylLeft}
        position={[-1.025, 0.35, -0.39]}
      />
      <primitive
        ref={refs.vinylRight}
        object={nodes.VinylRight}
        position={[1.025, 0.35, -0.39]}
      />
      <primitive
        ref={refs.tonebarLeft}
        object={nodes.TonebarLeft}
        position={[-2.29, 0.56, -1.05]}
      />
      <primitive
        ref={refs.tonebarRight}
        object={nodes.TonebarRight}
        position={[2.29, 0.56, -1.05]}
      />
    </group>
  );
}



// A full-screen canvas is the page's biggest memory cost. On retina screens the extra pixels
// already smooth the edges, so skip multisampling there (it multiplies the buffers ~4x).
const HI_DPI = typeof window !== 'undefined' && window.devicePixelRatio >= 1.5;

export default function DJScene({ animation, setAnimation, ANIMATION, onActivate, zoomTrigger, stageZoom }) {
  // On the music stage the deck is hidden, so stop drawing it once the zoom-in has finished.
  // Leaving the stage resumes straight away (with a fresh clock, so the zoom-out doesn't jump).
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!stageZoom?.inward) { setPaused(false); return; }
    const timer = setTimeout(() => setPaused(true), stageZoom.seconds * 1000 + 100);
    return () => clearTimeout(timer);
  }, [stageZoom]);

  return (
    <Canvas camera={{ position: [0, 3, 8], fov: 60 }}
      frameloop={paused ? 'never' : 'always'}
      dpr={[1, 2]}
      gl={{ antialias: !HI_DPI }}
      className="djscene-canvas"
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}
      resize={{ scroll: false, debounce: { scroll: 50, resize: 0 } }}
    >
      <ambientLight intensity={0}/>
      <directionalLight position={[5, 5, 5]} intensity={5} />
      <DJModel
        animation={animation}
        setAnimation={setAnimation}
        ANIMATION={ANIMATION}
        onActivate={onActivate}
        zoomTrigger={zoomTrigger}
        stageZoom={stageZoom}
      />
    </Canvas>
  );
}