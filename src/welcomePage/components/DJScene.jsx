import React, { useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import AnimatedButton from './AnimatedButton.jsx';
import { useResponsiveModel } from '../../hooks/useResponsiveModel.js';
import { useMouseOverCanvas } from '../../hooks/useMouseOverCanvas.js';
import { useDJAnimation } from '../../hooks/useDJAnimation.js';

function DJModel({animation, setAnimation, ANIMATION}) {
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


  return (
    <group ref={refs.modelGroup} scale={[modelScale, modelScale, modelScale]} position={modelPosition}>
      {/* Base of the DJ deck */}
      <primitive object={nodes.Base} />

      {/* Animated Buttons */}
      <AnimatedButton node={nodes.About} name="About" active={activeButton} setActive={setActiveButton} />
      <AnimatedButton node={nodes.Experience} name="Experience" active={activeButton} setActive={setActiveButton} />
      <AnimatedButton node={nodes.Projects} name="Projects" active={activeButton} setActive={setActiveButton} />
      <AnimatedButton node={nodes.Contact} name="Contact" active={activeButton} setActive={setActiveButton} />

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



export default function DJScene({ animation, setAnimation, ANIMATION }) {
  return (
    <Canvas camera={{ position: [0, 3, 8], fov: 60 }} className="djscene-canvas" >
      <ambientLight intensity={0} />
      <directionalLight position={[5, 5, 5]} intensity={5} />
      <DJModel
        animation={animation}
        setAnimation={setAnimation}
        ANIMATION={ANIMATION}
      />
    </Canvas>
  );
}