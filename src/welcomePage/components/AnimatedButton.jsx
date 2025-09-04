import React from 'react';
import { useSpring, animated  } from '@react-spring/three';

const AnimatedGroup = animated.group;

function AnimatedButton({ node, name, active, setActive, onActivate }) {
  const isPressed = active === name;

  // Spring animation for the button press effect
  const { position } = useSpring({
    // Move down when pressed, otherwise stay at the original position
    position: isPressed ? [0, -0.03, 0] : [0, 0, 0],
    config: { tension: 100, friction: 10 },
  });

  const handlePointerUp = () => {
    setActive(null);
    if (onActivate) onActivate(name);
  };

  return (
    <AnimatedGroup
      position={position}
      onPointerDown={() => setActive(name)}
      onPointerUp={handlePointerUp}
      onPointerOut={() => setActive(null)}
    >
      <primitive object={node} />
    </AnimatedGroup>
  );
}

export default AnimatedButton;
