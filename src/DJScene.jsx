import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls } from '@react-three/drei';
import { useSpring, a } from '@react-spring/three';

// A reusable, animated button component
function AnimatedButton({ node, name, active, setActive }) {
  // Determine if this button is the one currently pressed
  const isPressed = active === name;

  // Spring animation for the button press effect
  const { position } = useSpring({
    // Move down when pressed, otherwise stay at the original position
    position: isPressed ? [0, -0.03, 0] : [0, 0, 0],
    config: { tension: 100, friction: 10 },
  });

  const handlePointerUp = () => {
    setActive(null); // Reset active button state
    console.log(`${name} clicked!`);
  };

  return (
    <a.group
      position={position} // Apply the animated position
      onPointerDown={() => setActive(name)} // Set this button as active on press
      onPointerUp={handlePointerUp}
      onPointerOut={() => setActive(null)} // Reset if the pointer leaves
    >
      <primitive object={node} />
    </a.group>
  );
}

function DJModel() {
  const { nodes } = useGLTF('/DJ1.glb');
  const [activeButton, setActiveButton] = useState(null);
  const [rotationSpeed, setRotationSpeed] = useState(0);

  const vinylLeftRef = useRef();
  const vinylRightRef = useRef();

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Speed up rotation when spacebar is held down
      if (e.code === 'Space') {
        setRotationSpeed((prev) => Math.min(prev + 0.005, 0.2)); // Capped at a max speed
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  
  useFrame(() => {
    if (vinylLeftRef.current) {
      vinylLeftRef.current.rotation.y += rotationSpeed;
    }
    if (vinylRightRef.current) {
      vinylRightRef.current.rotation.y += rotationSpeed;
    }
  });

  return (
    <group>
      {/* Base of the DJ deck */}
      <primitive object={nodes.Base} />

      {/* Animated Buttons */}
      <AnimatedButton node={nodes.About} name="About" active={activeButton} setActive={setActiveButton} />
      <AnimatedButton node={nodes.Experience} name="Experience" active={activeButton} setActive={setActiveButton} />
      <AnimatedButton node={nodes.Projects} name="Projects" active={activeButton} setActive={setActiveButton} />
      <AnimatedButton node={nodes.Contact} name="Contact" active={activeButton} setActive={setActiveButton} />

      {/* Spinning Vinyls */}
      <primitive
        ref={vinylLeftRef}
        object={nodes.VinylLeft}
        position={[-1.025, 0.35, -0.39]}
      />
      <primitive
        ref={vinylRightRef}
        object={nodes.VinylRight}
        position={[1.025, 0.35, -0.39]}
      />
    </group>
  );
}

export default function DJScene() {
  return (
    <Canvas
      camera={{ position: [0, 3, 8], fov: 45 }}
      style={{ background: 'white' }}
    >
      <ambientLight intensity={0} />
      <directionalLight position={[5, 5, 5]} intensity={5} />
      <DJModel />
      <OrbitControls />
    </Canvas>
  );
}