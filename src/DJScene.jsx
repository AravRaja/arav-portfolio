import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls } from '@react-three/drei';
import { useSpring, a } from '@react-spring/three';

function AnimatedButton({ node, name, active, setActive }) {
  const isPressed = active === name;

  // Spring animation for the button press effect
  const { position ,scale} = useSpring({
    // Move down when pressed, otherwise stay at the original position
    position: isPressed ? [0, -0.03, 0] : [0, 0, 0],
    config: { tension: 100, friction: 10 },
  });

  const handlePointerUp = () => {
    setActive(null);
    console.log(`${name} clicked!`);
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

function DJModel() {
  const { nodes } = useGLTF('/DJ1.glb');
  const [activeButton, setActiveButton] = useState(null);

  const ANIMATION = {
        IDLE: 0,
        UP: 1,
        DOWN: 2,
        RUNNING: 3,
        RUNNING_ACTIVATED: 4,
  };

  const [animation, setAnimation] = useState(ANIMATION.IDLE)

  const tonebarLeftRef = useRef();
  const tonebarRightRef = useRef();
  const vinylLeftRef = useRef();
  const vinylRightRef = useRef();

  // Ensure initial rotations are set to 0
  useEffect(() => {
    if (tonebarLeftRef.current) {
      tonebarLeftRef.current.rotation.z = -0.08;
      tonebarLeftRef.current.rotation.y = -0.59;
    }
    if (tonebarRightRef.current){
        tonebarRightRef.current.rotation.z = 0.24;
        tonebarRightRef.current.rotation.y = -0.02;
    }
    if (vinylLeftRef.current) {
      vinylLeftRef.current.rotation.y = 0;
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        setAnimation((prev) => {
          if (prev === ANIMATION.IDLE) return ANIMATION.UP;
          if (prev === ANIMATION.RUNNING_ACTIVATED) return ANIMATION.DOWN;
          if (prev === ANIMATION.DOWN) return ANIMATION.UP;
          return prev;
        });
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setAnimation((prev) => {
          if (prev === ANIMATION.UP) return ANIMATION.DOWN;
          if (prev === ANIMATION.RUNNING) return ANIMATION.RUNNING_ACTIVATED;
            return prev;
          });
        }
      };
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp); 
    };
  }, []);


  // Animation state variables
  const START_TONEBAR_LEFT_Z = -0.08;
  const START_TONEBAR_LEFT_Y =  -0.59;
  const START_TONEBAR_RIGHT_Z = 0.24;
  const START_TONEBAR_RIGHT_Y = -0.02
  const HIGH_TONEBAR_Y = 0.59; 
  const HIGH_TONEBAR_Z = 0.18; 
  const FINAL_TONEBAR_Z = 0.08;
  const LEFT_RIGHT_SF = 3.3;
  const TONEBAR_SPEED = 0.01;
  const HIGH_TONEBAR_LEFT_Z = HIGH_TONEBAR_Z + START_TONEBAR_LEFT_Z; 
  const HIGH_TONEBAR_RIGHT_Z = (START_TONEBAR_RIGHT_Z - ((HIGH_TONEBAR_Z)*LEFT_RIGHT_SF));
  const HIGH_TONEBAR_LEFT_Y = HIGH_TONEBAR_Y + START_TONEBAR_LEFT_Y;
  const HIGH_TONEBAR_RIGHT_Y = START_TONEBAR_RIGHT_Y  - ((HIGH_TONEBAR_Z)*  3.07);
  const FINAL_TONEBAR_LEFT_Z = FINAL_TONEBAR_Z + START_TONEBAR_LEFT_Z;  
  const FINAL_TONEBAR_RIGHT_Z =  START_TONEBAR_RIGHT_Z - (FINAL_TONEBAR_Z * LEFT_RIGHT_SF);
  const MAX_VINYL_SPEED = 0.25; 
 
  const [rotationSpeed, setRotationSpeed] = useState(0); 
  useFrame(() => {
    if (animation === ANIMATION.UP) { 
      if (
        tonebarLeftRef.current &&
        tonebarRightRef.current &&
        vinylLeftRef.current &&
        vinylRightRef.current
      ) {

        // 1. Animate both tonebars' Z rotation up to their respective HIGH_TONEBAR_*_Z
        const leftZDone = tonebarLeftRef.current.rotation.z >= HIGH_TONEBAR_LEFT_Z;
        const rightZDone = tonebarRightRef.current.rotation.z <= HIGH_TONEBAR_RIGHT_Z;

        // Only run initial Z-up phase if Y hasn’t moved yet
        const inInitialPhase = tonebarLeftRef.current.rotation.y <= START_TONEBAR_LEFT_Y;
        if (inInitialPhase && (!leftZDone || !rightZDone)) {
          
          tonebarLeftRef.current.rotation.z = Math.min(
            tonebarLeftRef.current.rotation.z + TONEBAR_SPEED,
            HIGH_TONEBAR_LEFT_Z
          );
          tonebarRightRef.current.rotation.z = Math.max(
            tonebarRightRef.current.rotation.z - (TONEBAR_SPEED * LEFT_RIGHT_SF),
            HIGH_TONEBAR_RIGHT_Z
          );
        }
        // 2. Animate both tonebars' Y rotation up to their respective HIGH_TONEBAR_*_Y
        else {
          const leftYDone = tonebarLeftRef.current.rotation.y >= HIGH_TONEBAR_LEFT_Y;
          const rightYDone = tonebarRightRef.current.rotation.y <= HIGH_TONEBAR_RIGHT_Y;

          if (!leftYDone || !rightYDone) {
            tonebarLeftRef.current.rotation.y = Math.min(
              tonebarLeftRef.current.rotation.y + TONEBAR_SPEED,
              HIGH_TONEBAR_LEFT_Y
            );
            tonebarRightRef.current.rotation.y = Math.max(
              tonebarRightRef.current.rotation.y - TONEBAR_SPEED,
              HIGH_TONEBAR_RIGHT_Y
            );
          }
          // 3. Animate both tonebars' Z rotation to their FINAL_TONEBAR_*_Z
          else {
            const leftFinalZDone = tonebarLeftRef.current.rotation.z <= FINAL_TONEBAR_LEFT_Z;
            const rightFinalZDone = tonebarRightRef.current.rotation.z >= FINAL_TONEBAR_RIGHT_Z;

            if (!leftFinalZDone || !rightFinalZDone) {
              tonebarLeftRef.current.rotation.z = Math.max(
                tonebarLeftRef.current.rotation.z - TONEBAR_SPEED,
                FINAL_TONEBAR_LEFT_Z
              );
              tonebarRightRef.current.rotation.z = Math.min(
                tonebarRightRef.current.rotation.z + (TONEBAR_SPEED * LEFT_RIGHT_SF),
                FINAL_TONEBAR_RIGHT_Z
              );
            }
            // 4. Spin up the vinyls
            else if (rotationSpeed < MAX_VINYL_SPEED) {
              setRotationSpeed((speed) => {
                const accel = 0.0001 + 0.002 * (speed / MAX_VINYL_SPEED); // ease-in
                return Math.min(speed + accel, MAX_VINYL_SPEED);
              });
              vinylLeftRef.current.rotation.y += rotationSpeed;
              vinylRightRef.current.rotation.y += rotationSpeed;
            }
            // 5. When all is done, set to RUNNING
            else {
              setAnimation(ANIMATION.RUNNING);
            }
          }
        }
      }
    } else if (animation === ANIMATION.DOWN) {
      if (
        tonebarLeftRef.current &&
        tonebarRightRef.current &&
        vinylLeftRef.current &&
        vinylRightRef.current
      ) {
        // 1. Slow down the vinyls
        if (rotationSpeed > 0) {
          setRotationSpeed((speed) => {
            const decel = 0.0001 + 0.002 * (speed / MAX_VINYL_SPEED); // ease-out
            const next = Math.max(speed - decel, 0);
            vinylLeftRef.current.rotation.y += next;
            vinylRightRef.current.rotation.y += next;
            return next;
          });
        }
        // 2. Reset both tonebars' Y rotation to START_TONEBAR_*_Y
        else {
          const leftYResetDone = tonebarLeftRef.current.rotation.y <= START_TONEBAR_LEFT_Y;
          const rightYResetDone = tonebarRightRef.current.rotation.y >= START_TONEBAR_RIGHT_Y;

          if (!leftYResetDone || !rightYResetDone) {
            tonebarLeftRef.current.rotation.y = Math.max(
              tonebarLeftRef.current.rotation.y - TONEBAR_SPEED,
              START_TONEBAR_LEFT_Y
            );
            tonebarRightRef.current.rotation.y = Math.min(
              tonebarRightRef.current.rotation.y + TONEBAR_SPEED,
              START_TONEBAR_RIGHT_Y
            );
          }
          // 3. Reset both tonebars' Z rotation to START_TONEBAR_*_Z
          else {
            const leftZResetDone = tonebarLeftRef.current.rotation.z <= START_TONEBAR_LEFT_Z;
            const rightZResetDone = tonebarRightRef.current.rotation.z >= START_TONEBAR_RIGHT_Z;

            if (!leftZResetDone || !rightZResetDone) {
              tonebarLeftRef.current.rotation.z = Math.max(
                tonebarLeftRef.current.rotation.z - TONEBAR_SPEED,
                START_TONEBAR_LEFT_Z
              );
              tonebarRightRef.current.rotation.z = Math.min(
                tonebarRightRef.current.rotation.z + (TONEBAR_SPEED * LEFT_RIGHT_SF),
                START_TONEBAR_RIGHT_Z
              );
            }
            // 4. When all is reset, go back to idle
            else {
              setAnimation(ANIMATION.IDLE);
            }
          }
        }
      }
    } else if (animation === ANIMATION.RUNNING || animation === ANIMATION.RUNNING_ACTIVATED) {
      if (vinylLeftRef.current && vinylRightRef.current) {
        vinylLeftRef.current.rotation.y += MAX_VINYL_SPEED;
        vinylRightRef.current.rotation.y += MAX_VINYL_SPEED;
      }
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
      <primitive
        ref={tonebarLeftRef}
        object={nodes.TonebarLeft}
        position={[-2.29, 0.56, -1.05]}
      />
      <primitive
        ref={tonebarRightRef}
        object={nodes.TonebarRight}
        position={[2.29, 0.56, -1.05]}
      />
    </group>
  );
}

export default function DJScene() {
  return (
    <Canvas
      camera={{ position: [0, 3, 8], fov: 60 }}
      style={{ background: 'white' }}
    >
      <ambientLight intensity={0} />
      <directionalLight position={[5, 5, 5]} intensity={5} />
      <DJModel />
      <OrbitControls />
    </Canvas>
  );
}