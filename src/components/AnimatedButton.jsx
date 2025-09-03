import React from 'react';
import { useSpring, a } from '@react-spring/three';

function AnimatedButton({ node, name, active, setActive }) {
  const isPressed = active === name;

  // Spring animation for the button press effect
  const { position } = useSpring({
    // Move down when pressed, otherwise stay at the original position
    position: isPressed ? [0, -0.03, 0] : [0, 0, 0],
    config: { tension: 100, friction: 10 },
  });

  const handlePointerUp = () => {
    setActive(null);
  };

  return (
    <a.group
      position={position}
      onPointerDown={() => setActive(name)}
      onPointerUp={handlePointerUp}
      onPointerOut={() => setActive(null)}
    >
      <primitive object={node} />
    </a.group>
  );
}

export default AnimatedButton;
