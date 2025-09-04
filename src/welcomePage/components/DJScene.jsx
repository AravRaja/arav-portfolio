import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import AnimatedButton from './AnimatedButton.jsx';
import { useResponsiveModel } from '../../hooks/useResponsiveModel.js';
import { useMouseOverCanvas } from '../../hooks/useMouseOverCanvas.js';
import { useDJAnimation } from '../../hooks/useDJAnimation.js';

function DJModel({animation, setAnimation, ANIMATION, onActivate, zoomTrigger}) {
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

  // Camera zoom-to-background effect
  const zoomState = useRef({ active: false, t: 0, duration: 0.7, from: { pos: [0, 3, 8], fov: 60 }, to: { pos: [0, 0, 1], fov: 20 } });

  useEffect(() => {
    if (!zoomTrigger) return;
    // Start a new zoom
    zoomState.current.active = true;
    zoomState.current.t = 0;
  }, [zoomTrigger]);

  useFrame((state, delta) => {
    if (!zoomState.current.active) return;
    const { camera } = state;
    const zs = zoomState.current;
    zs.t += delta / zs.duration; // normalize to [0,1]
    const k = Math.min(1, zs.t);

    // Ease-in-out
    const ease = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;

    const from = zs.from;
    const to = zs.to;
    // Lerp position
    camera.position.set(
      from.pos[0] + (to.pos[0] - from.pos[0]) * ease,
      from.pos[1] + (to.pos[1] - from.pos[1]) * ease,
      from.pos[2] + (to.pos[2] - from.pos[2]) * ease,
    );
    // Lerp fov
    camera.fov = from.fov + (to.fov - from.fov) * ease;
    camera.updateProjectionMatrix();
    // Look straight ahead (avoid focusing model)
    camera.lookAt(0, 0, -1);

    if (k >= 1) {
      zs.active = false;
    }
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



export default function DJScene({ animation, setAnimation, ANIMATION, onActivate, zoomTrigger }) {
  return (
    <Canvas camera={{ position: [0, 3, 8], fov: 60 }} 
      className="djscene-canvas"
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}
      resize={{ scroll: false, debounce: { scroll: 50, resize: 0 } }}
    >
      <ambientLight intensity={0} />
      <directionalLight position={[5, 5, 5]} intensity={5} />
      <DJModel
        animation={animation}
        setAnimation={setAnimation}
        ANIMATION={ANIMATION}
        onActivate={onActivate}
        zoomTrigger={zoomTrigger}
      />
    </Canvas>
  );
}