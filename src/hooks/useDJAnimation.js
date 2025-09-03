import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { getDerivedConfig, useDerivedConfig } from '../animation/config.js';

export function useDJAnimation({ refs, animation, setAnimation, ANIMATION, mouse }) {
  const rotationSpeedRef = useRef(0);
  const config = useDerivedConfig();

  // Initialize positions on mount
  useEffect(() => {
    if (refs.tonebarLeft.current) {
      refs.tonebarLeft.current.rotation.z = config.START_TONEBAR_LEFT_Z;
      refs.tonebarLeft.current.rotation.y = config.START_TONEBAR_LEFT_Y;
    }
    if (refs.tonebarRight.current) {
      refs.tonebarRight.current.rotation.z = config.START_TONEBAR_RIGHT_Z;
      refs.tonebarRight.current.rotation.y = config.START_TONEBAR_RIGHT_Y;
    } 
    if (refs.vinylLeft.current) {
      refs.vinylLeft.current.rotation.y = 0;
    }
    if (refs.vinylRight.current) {
      refs.vinylRight.current.rotation.y = 0;
    }
    // Reset rotationSpeedRef on mount
    rotationSpeedRef.current = 0;
  }, []);

  useFrame((state, delta) => {
    // === UP ANIMATION: Spin up vinyls first, then move tonebars ===
    if (animation === ANIMATION.UP) {
      if (
        refs.tonebarLeft.current &&
        refs.tonebarRight.current &&
        refs.vinylLeft.current &&
        refs.vinylRight.current
      ) {
        // 1. Spin up the vinyls first
        if (rotationSpeedRef.current < config.MAX_VINYL_SPEED_PER_SEC) {
          const speed_per_sec = rotationSpeedRef.current;
          const accel_per_sec = (config.VINYL_ACCEL_BASE + config.VINYL_ACCEL_SCALE * (speed_per_sec / config.MAX_VINYL_SPEED_PER_SEC));
          rotationSpeedRef.current = Math.min(speed_per_sec + accel_per_sec * delta, config.MAX_VINYL_SPEED_PER_SEC);
          refs.vinylLeft.current.rotation.y += rotationSpeedRef.current * delta;
          refs.vinylRight.current.rotation.y += rotationSpeedRef.current * delta;
        }
        // 2. After vinyls are at max speed, move tonebars (Z up → Y up → Z final)
        else {
          refs.vinylLeft.current.rotation.y += config.MAX_VINYL_SPEED_PER_SEC * delta;
          refs.vinylRight.current.rotation.y += config.MAX_VINYL_SPEED_PER_SEC * delta;
          // Move tonebars through Z up → Y up → Z final sequence (as before)
          const leftZDone = refs.tonebarLeft.current.rotation.z >= config.HIGH_TONEBAR_LEFT_Z;
          const rightZDone = refs.tonebarRight.current.rotation.z <= config.HIGH_TONEBAR_RIGHT_Z;
          const inInitialPhase = refs.tonebarLeft.current.rotation.y <= config.START_TONEBAR_LEFT_Y;
          if (inInitialPhase && (!leftZDone || !rightZDone)) {
            refs.tonebarLeft.current.rotation.z = Math.min(
              refs.tonebarLeft.current.rotation.z + config.TONEBAR_SPEED * delta * 60,
              config.HIGH_TONEBAR_LEFT_Z
            );
            refs.tonebarRight.current.rotation.z = Math.max(
              refs.tonebarRight.current.rotation.z - (config.TONEBAR_SPEED * config.LEFT_RIGHT_SF * delta * 60),
              config.HIGH_TONEBAR_RIGHT_Z
            );
          } else {
            const leftYDone = refs.tonebarLeft.current.rotation.y >= config.HIGH_TONEBAR_LEFT_Y;
            const rightYDone = refs.tonebarRight.current.rotation.y <= config.HIGH_TONEBAR_RIGHT_Y;
            if (!leftYDone || !rightYDone) {
              refs.tonebarLeft.current.rotation.y = Math.min(
                refs.tonebarLeft.current.rotation.y + config.TONEBAR_SPEED * delta * 60,
                config.HIGH_TONEBAR_LEFT_Y
              );
              refs.tonebarRight.current.rotation.y = Math.max(
                refs.tonebarRight.current.rotation.y - config.TONEBAR_SPEED * delta * 60,
                config.HIGH_TONEBAR_RIGHT_Y
              );
            } else {
              const leftFinalZDone = refs.tonebarLeft.current.rotation.z <= config.FINAL_TONEBAR_LEFT_Z;
              const rightFinalZDone = refs.tonebarRight.current.rotation.z >= config.FINAL_TONEBAR_RIGHT_Z;
              if (!leftFinalZDone || !rightFinalZDone) {
                refs.tonebarLeft.current.rotation.z = Math.max(
                  refs.tonebarLeft.current.rotation.z - config.TONEBAR_SPEED * delta * 60,
                  config.FINAL_TONEBAR_LEFT_Z
                );
                refs.tonebarRight.current.rotation.z = Math.min(
                  refs.tonebarRight.current.rotation.z + (config.TONEBAR_SPEED * config.LEFT_RIGHT_SF * delta * 60),
                  config.FINAL_TONEBAR_RIGHT_Z
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
        refs.tonebarLeft.current &&
        refs.tonebarRight.current &&
        refs.vinylLeft.current &&
        refs.vinylRight.current
      ) {
        // 1. Move tonebars back to start (Y then Z)
        const leftYResetDone = refs.tonebarLeft.current.rotation.y <= config.START_TONEBAR_LEFT_Y;
        const rightYResetDone = refs.tonebarRight.current.rotation.y >= config.START_TONEBAR_RIGHT_Y;
        if (!leftYResetDone || !rightYResetDone) {
          refs.tonebarLeft.current.rotation.y = Math.max(
            refs.tonebarLeft.current.rotation.y - config.TONEBAR_SPEED * delta * 60,
            config.START_TONEBAR_LEFT_Y
          );
          refs.tonebarRight.current.rotation.y = Math.min(
            refs.tonebarRight.current.rotation.y + config.TONEBAR_SPEED * delta * 60,
            config.START_TONEBAR_RIGHT_Y
          );
          if(rotationSpeedRef.current > 0){
            refs.vinylLeft.current.rotation.y += rotationSpeedRef.current * delta;
            refs.vinylRight.current.rotation.y += rotationSpeedRef.current * delta;
          }
        } else {
          const leftZResetDone = refs.tonebarLeft.current.rotation.z <= config.START_TONEBAR_LEFT_Z;
          const rightZResetDone = refs.tonebarRight.current.rotation.z >= config.START_TONEBAR_RIGHT_Z;
          if (!leftZResetDone || !rightZResetDone) {
            refs.tonebarLeft.current.rotation.z = Math.max(
              refs.tonebarLeft.current.rotation.z - config.TONEBAR_SPEED * delta * 60,
              config.START_TONEBAR_LEFT_Z
            );
            refs.tonebarRight.current.rotation.z = Math.min(
              refs.tonebarRight.current.rotation.z + (config.TONEBAR_SPEED * config.LEFT_RIGHT_SF * delta * 60),
              config.START_TONEBAR_RIGHT_Z
            );
            if(rotationSpeedRef.current > 0){
              refs.vinylLeft.current.rotation.y += rotationSpeedRef.current * delta;
              refs.vinylRight.current.rotation.y += rotationSpeedRef.current * delta;
            }
          }
          // 2. After tonebars are reset, decelerate the vinyls
          else if (rotationSpeedRef.current > 0) {
            const speed_per_sec = rotationSpeedRef.current;
            const decel_per_sec = (config.VINYL_DECEL_BASE + config.VINYL_DECEL_SCALE * (speed_per_sec / config.MAX_VINYL_SPEED_PER_SEC));
            const next = Math.max(speed_per_sec - decel_per_sec * delta, 0);
            rotationSpeedRef.current = next;
            refs.vinylLeft.current.rotation.y += next * delta;
            refs.vinylRight.current.rotation.y += next * delta;
          }
          // 3. When vinyls are stopped AND tonebars reset, go to idle
          else {
            setAnimation(ANIMATION.IDLE);
          }
        }
      }
    }
    else if (animation === ANIMATION.RUNNING || animation === ANIMATION.RUNNING_ACTIVATED) {
      if (refs.vinylLeft.current && refs.vinylRight.current) {
        refs.vinylLeft.current.rotation.y += config.MAX_VINYL_SPEED_PER_SEC * delta;
        refs.vinylRight.current.rotation.y += config.MAX_VINYL_SPEED_PER_SEC * delta;
      }
    }
    
    // Model group rotation logic
    if (refs.modelGroup.current) {
      if (animation === ANIMATION.IDLE) {
        const t = state.clock.getElapsedTime();
        const X_TILT = 0.8;
        const mouseX = (mouse.x - 0.5) * 2;
        const mouseY = (mouse.y - 0.5) * 2;
        const wobbleY = Math.sin(t * 0.7) * 0.33;
        const wobbleX = Math.cos(t * 0.7) * 0.4;
        const interactiveY = mouseX * 0.85;
        const interactiveX = -mouseY * 0.65;
        refs.modelGroup.current.rotation.y = wobbleY * 0.7 + interactiveY * 0.3;
        refs.modelGroup.current.rotation.x = X_TILT + wobbleX * 0.7 + interactiveX * 0.3;
        refs.modelGroup.current.rotation.z = 0;
      } else {
        // For all non-IDLE animations, smoothly lerp rotation to [0, 0, 0]
        const lerp = (a, b, t) => a + (b - a) * t;
        const rot = refs.modelGroup.current.rotation;
        const factor = 0.01;
        rot.x = lerp(rot.x, 1, factor);
        rot.y = lerp(rot.y, 0, factor);
        rot.z = lerp(rot.z, 0, factor);
      }
    }
  });
}
