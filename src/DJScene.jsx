import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls } from '@react-three/drei';
import { useSpring, a } from '@react-spring/three';


import { Perf } from 'r3f-perf';

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

function DJModel({animation, setAnimation, ANIMATION}) {
  const { nodes } = useGLTF('/DJ1.glb');
  const [activeButton, setActiveButton] = useState(null);
  const tonebarLeftRef = useRef();
  const tonebarRightRef = useRef();
  const vinylLeftRef = useRef();
  const vinylRightRef = useRef();
  const modelGroupRef = useRef();

  // Responsive model scale state
  const [modelScale, setModelScale] = useState(1);

  useEffect(() => {
    function updateScale() {
      const width = window.innerWidth;
      if (width < 600) {
        setModelScale(0.8);
      } else if (width < 900) {
        setModelScale(1);
      } else {
        setModelScale(1.4);
      }
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Mouse state for interactive rotation
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  // === CONFIGURABLE CONSTANTS ===

  const fpsRef = useRef(60);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let rafId;

    const loop = () => {
      const now = performance.now();
      frames++;
      if (now - last >= 1000) {
        fpsRef.current = frames;
        frames = 0;
        last = now;
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId); 
  }, []);

  const fps = fpsRef.current;
  const scale = 1; 
  const TONEBAR_SPEED = 0.01*scale;
  const LEFT_RIGHT_SF = 3.3; 
  const MAX_VINYL_SPEED_PER_SEC = 0.4*60*scale;
  
  const VINYL_ACCEL_BASE = 8 * scale; 
  const VINYL_ACCEL_SCALE = 20 * scale;  
  const VINYL_DECEL_BASE = 6 * scale;
  const VINYL_DECEL_SCALE = 20 * scale; 

  // Starting positions (change to adjust initial pose)
  const START_TONEBAR_LEFT_Z = -0.08;
  const START_TONEBAR_LEFT_Y = -0.59;
  const START_TONEBAR_RIGHT_Z = 0.24;
  const START_TONEBAR_RIGHT_Y = -0.02;

  // Animation targets (change to adjust how far tonebars move)
  const HIGH_TONEBAR_Y = 0.59;       // How high the tonebars lift (Y axis)
  const HIGH_TONEBAR_Z = 0.18;       // How far the tonebars swing (Z axis)
  const FINAL_TONEBAR_Z = 0.08;      // Final Z offset after animation

  // === DERIVED CONSTANTS (do not change unless you know what you're doing) ===
  const HIGH_TONEBAR_LEFT_Z = HIGH_TONEBAR_Z + START_TONEBAR_LEFT_Z;
  const HIGH_TONEBAR_RIGHT_Z = START_TONEBAR_RIGHT_Z - (HIGH_TONEBAR_Z * LEFT_RIGHT_SF);
  const HIGH_TONEBAR_LEFT_Y = HIGH_TONEBAR_Y + START_TONEBAR_LEFT_Y;
  const HIGH_TONEBAR_RIGHT_Y = START_TONEBAR_RIGHT_Y - (HIGH_TONEBAR_Z * 3.07);
  const FINAL_TONEBAR_LEFT_Z = FINAL_TONEBAR_Z + START_TONEBAR_LEFT_Z;
  const FINAL_TONEBAR_RIGHT_Z = START_TONEBAR_RIGHT_Z - (FINAL_TONEBAR_Z * LEFT_RIGHT_SF);
  const rotationSpeedRef = useRef(0);

  // Debug timing refs
  const upStartTimeRef = useRef(null);
  const upToRunningLoggedRef = useRef(false);
  const downStartTimeRef = useRef(null);
  const downToIdleLoggedRef = useRef(false);

  useEffect(() => {
    const now = performance.now();

    if (animation === ANIMATION.UP) {
      upStartTimeRef.current = now;
      upToRunningLoggedRef.current = false;
    } else if (
      animation === ANIMATION.RUNNING &&
      upStartTimeRef.current !== null &&
      !upToRunningLoggedRef.current
    ) {
      console.log('UP → RUNNING duration (ms):', now - upStartTimeRef.current);
      upToRunningLoggedRef.current = true;
    }

    if (animation === ANIMATION.DOWN) {
      downStartTimeRef.current = now;
      downToIdleLoggedRef.current = false;
    } else if (
      animation === ANIMATION.IDLE &&
      downStartTimeRef.current !== null &&
      !downToIdleLoggedRef.current
    ) {
      console.log('DOWN → IDLE duration (ms):', now - downStartTimeRef.current);
      downToIdleLoggedRef.current = true;
    }
  }, [animation]);

  useEffect(() => {
    if (tonebarLeftRef.current) {
      tonebarLeftRef.current.rotation.z = START_TONEBAR_LEFT_Z;
      tonebarLeftRef.current.rotation.y = START_TONEBAR_LEFT_Y;
    }
    if (tonebarRightRef.current) {
      tonebarRightRef.current.rotation.z = START_TONEBAR_RIGHT_Z;
      tonebarRightRef.current.rotation.y = START_TONEBAR_RIGHT_Y;
    }
    if (vinylLeftRef.current) {
      vinylLeftRef.current.rotation.y = 0;
    }
    // Reset rotationSpeedRef on mount
    rotationSpeedRef.current = 0;
  }, []);

  // Mouse move effect for interactive model rotation
  useEffect(() => {
    const handleMouseMove = (e) => {
      const rect = document.querySelector('.djscene-canvas').getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      setMouse({ x: relX, y: relY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);


  useFrame((state, delta) => {
    // === UP ANIMATION: Spin up vinyls first, then move tonebars ===
    if (animation === ANIMATION.UP) {
      if (
        tonebarLeftRef.current &&
        tonebarRightRef.current &&
        vinylLeftRef.current &&
        vinylRightRef.current
      ) {
        // 1. Spin up the vinyls first
        if (rotationSpeedRef.current < MAX_VINYL_SPEED_PER_SEC) {
          const speed_per_sec = rotationSpeedRef.current;
          const accel_per_sec = (VINYL_ACCEL_BASE + VINYL_ACCEL_SCALE * (speed_per_sec / MAX_VINYL_SPEED_PER_SEC));
          rotationSpeedRef.current = Math.min(speed_per_sec + accel_per_sec * delta, MAX_VINYL_SPEED_PER_SEC);
          vinylLeftRef.current.rotation.y += rotationSpeedRef.current * delta;
          vinylRightRef.current.rotation.y += rotationSpeedRef.current * delta;
        }
        // 2. After vinyls are at max speed, move tonebars (Z up → Y up → Z final)
        else {
          vinylLeftRef.current.rotation.y += MAX_VINYL_SPEED_PER_SEC * delta;
          vinylRightRef.current.rotation.y += MAX_VINYL_SPEED_PER_SEC * delta;
          // Move tonebars through Z up → Y up → Z final sequence (as before)
          const leftZDone = tonebarLeftRef.current.rotation.z >= HIGH_TONEBAR_LEFT_Z;
          const rightZDone = tonebarRightRef.current.rotation.z <= HIGH_TONEBAR_RIGHT_Z;
          const inInitialPhase = tonebarLeftRef.current.rotation.y <= START_TONEBAR_LEFT_Y;
          if (inInitialPhase && (!leftZDone || !rightZDone)) {
            tonebarLeftRef.current.rotation.z = Math.min(
              tonebarLeftRef.current.rotation.z + TONEBAR_SPEED * delta * 60,
              HIGH_TONEBAR_LEFT_Z
            );
            tonebarRightRef.current.rotation.z = Math.max(
              tonebarRightRef.current.rotation.z - (TONEBAR_SPEED * LEFT_RIGHT_SF * delta * 60),
              HIGH_TONEBAR_RIGHT_Z
            );
          } else {
            const leftYDone = tonebarLeftRef.current.rotation.y >= HIGH_TONEBAR_LEFT_Y;
            const rightYDone = tonebarRightRef.current.rotation.y <= HIGH_TONEBAR_RIGHT_Y;
            if (!leftYDone || !rightYDone) {
              tonebarLeftRef.current.rotation.y = Math.min(
                tonebarLeftRef.current.rotation.y + TONEBAR_SPEED * delta * 60,
                HIGH_TONEBAR_LEFT_Y
              );
              tonebarRightRef.current.rotation.y = Math.max(
                tonebarRightRef.current.rotation.y - TONEBAR_SPEED * delta * 60,
                HIGH_TONEBAR_RIGHT_Y
              );
            } else {
              const leftFinalZDone = tonebarLeftRef.current.rotation.z <= FINAL_TONEBAR_LEFT_Z;
              const rightFinalZDone = tonebarRightRef.current.rotation.z >= FINAL_TONEBAR_RIGHT_Z;
              if (!leftFinalZDone || !rightFinalZDone) {
                tonebarLeftRef.current.rotation.z = Math.max(
                  tonebarLeftRef.current.rotation.z - TONEBAR_SPEED * delta * 60,
                  FINAL_TONEBAR_LEFT_Z
                );
                tonebarRightRef.current.rotation.z = Math.min(
                  tonebarRightRef.current.rotation.z + (TONEBAR_SPEED * LEFT_RIGHT_SF * delta * 60),
                  FINAL_TONEBAR_RIGHT_Z
                );
              } else {
                // When both vinyls at max speed AND tonebars finished, set to RUNNING
                setAnimation(ANIMATION.RUNNING);
              }
            }
          }
        }
      }
    }
    // === DOWN ANIMATION: Move tonebars back, then decelerate vinyls ===
    else if (animation === ANIMATION.DOWN) {
      if (
        tonebarLeftRef.current &&
        tonebarRightRef.current &&
        vinylLeftRef.current &&
        vinylRightRef.current
      ) {
        // 1. Move tonebars back to start (Y then Z)
        const leftYResetDone = tonebarLeftRef.current.rotation.y <= START_TONEBAR_LEFT_Y;
        const rightYResetDone = tonebarRightRef.current.rotation.y >= START_TONEBAR_RIGHT_Y;
        if (!leftYResetDone || !rightYResetDone) {
          tonebarLeftRef.current.rotation.y = Math.max(
            tonebarLeftRef.current.rotation.y - TONEBAR_SPEED * delta * 60,
            START_TONEBAR_LEFT_Y
          );
          tonebarRightRef.current.rotation.y = Math.min(
            tonebarRightRef.current.rotation.y + TONEBAR_SPEED * delta * 60,
            START_TONEBAR_RIGHT_Y
          );
          if(rotationSpeedRef.current > 0){
            vinylLeftRef.current.rotation.y += rotationSpeedRef.current * delta;
            vinylRightRef.current.rotation.y += rotationSpeedRef.current * delta;
          }
        } else {
          const leftZResetDone = tonebarLeftRef.current.rotation.z <= START_TONEBAR_LEFT_Z;
          const rightZResetDone = tonebarRightRef.current.rotation.z >= START_TONEBAR_RIGHT_Z;
          if (!leftZResetDone || !rightZResetDone) {
            tonebarLeftRef.current.rotation.z = Math.max(
              tonebarLeftRef.current.rotation.z - TONEBAR_SPEED * delta * 60,
              START_TONEBAR_LEFT_Z
            );
            tonebarRightRef.current.rotation.z = Math.min(
              tonebarRightRef.current.rotation.z + (TONEBAR_SPEED * LEFT_RIGHT_SF * delta * 60),
              START_TONEBAR_RIGHT_Z
            );
            if(rotationSpeedRef.current > 0){
              vinylLeftRef.current.rotation.y += rotationSpeedRef.current * delta;
              vinylRightRef.current.rotation.y += rotationSpeedRef.current * delta;
            }
          }
          // 2. After tonebars are reset, decelerate the vinyls
          else if (rotationSpeedRef.current > 0) {
            const speed_per_sec = rotationSpeedRef.current;
            const decel_per_sec = (VINYL_DECEL_BASE + VINYL_DECEL_SCALE * (speed_per_sec / MAX_VINYL_SPEED_PER_SEC));
            const next = Math.max(speed_per_sec - decel_per_sec * delta, 0);
            rotationSpeedRef.current = next;
            vinylLeftRef.current.rotation.y += next * delta;
            vinylRightRef.current.rotation.y += next * delta;
          }
          // 3. When vinyls are stopped AND tonebars reset, go to idle
          else {
            setAnimation(ANIMATION.IDLE);
          }
        }
      }
    }
    else if (animation === ANIMATION.RUNNING || animation === ANIMATION.RUNNING_ACTIVATED) {
      if (vinylLeftRef.current && vinylRightRef.current) {
        vinylLeftRef.current.rotation.y += MAX_VINYL_SPEED_PER_SEC * delta;
        vinylRightRef.current.rotation.y += MAX_VINYL_SPEED_PER_SEC * delta;
      }
    }
    if (modelGroupRef.current) {
      if (animation === ANIMATION.IDLE) {
        const t = state.clock.getElapsedTime();
        const X_TILT = 0.8;
        const mouseX = (mouse.x - 0.5) * 2;
        const mouseY = (mouse.y - 0.5) * 2;
        const wobbleY = Math.sin(t * 0.7) * 0.33;
        const wobbleX = Math.cos(t * 0.7) * 0.4;
        const interactiveY = mouseX * 0.85;
        const interactiveX = -mouseY * 0.65;
        modelGroupRef.current.rotation.y = wobbleY * 0.7 + interactiveY * 0.3;
        modelGroupRef.current.rotation.x = X_TILT + wobbleX * 0.7 + interactiveX * 0.3;
        modelGroupRef.current.rotation.z = 0;
      } else {
        // For all non-IDLE animations, smoothly lerp rotation to [0, 0, 0]
        const lerp = (a, b, t) => a + (b - a) * t;
        const rot = modelGroupRef.current.rotation;
        const factor = 0.01;
        rot.x = lerp(rot.x, 1, factor);
        rot.y = lerp(rot.y, 0, factor);
        rot.z = lerp(rot.z, 0, factor);
      }
    }
  });

  return (
    <group ref={modelGroupRef} scale={[modelScale, modelScale, modelScale]} position={[0, 0.5, 0]}>
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