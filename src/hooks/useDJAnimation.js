import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useDerivedConfig } from '../animation/config.js';
import { stepUp, stepDown, remainingUpSeconds, remainingDownSeconds } from '../animation/holdStep.js';
import { holdSync } from '../audio/holdSync.js';

export function useDJAnimation({ refs, animation, setAnimation, ANIMATION, mouse }) {
  const rotationSpeedRef = useRef(0);
  const config = useDerivedConfig();

  const readHoldState = () => ({
    speed: rotationSpeedRef.current,
    lZ: refs.tonebarLeft.current?.rotation.z ?? config.START_TONEBAR_LEFT_Z,
    lY: refs.tonebarLeft.current?.rotation.y ?? config.START_TONEBAR_LEFT_Y,
    rZ: refs.tonebarRight.current?.rotation.z ?? config.START_TONEBAR_RIGHT_Z,
    rY: refs.tonebarRight.current?.rotation.y ?? config.START_TONEBAR_RIGHT_Y,
  });

  // Let the space hold know how long the deck still needs from wherever it is now.
  useEffect(() => {
    holdSync.estimateRemaining = () => remainingUpSeconds(readHoldState(), config);
    holdSync.estimateDrain = () => remainingDownSeconds(readHoldState(), config);
  });

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, delta) => {
    // === UP ANIMATION: Spin up vinyls first, then move tonebars ===
    // Runs at holdSync.speed so the hold completes on the bar the music chose.
    if (animation === ANIMATION.UP) {
      if (
        refs.tonebarLeft.current &&
        refs.tonebarRight.current &&
        refs.vinylLeft.current &&
        refs.vinylRight.current
      ) {
        const s = readHoldState();
        const { spin, done } = stepUp(s, delta * holdSync.speed, config);
        rotationSpeedRef.current = s.speed;
        refs.tonebarLeft.current.rotation.z = s.lZ;
        refs.tonebarLeft.current.rotation.y = s.lY;
        refs.tonebarRight.current.rotation.z = s.rZ;
        refs.tonebarRight.current.rotation.y = s.rY;
        refs.vinylLeft.current.rotation.y += spin;
        refs.vinylRight.current.rotation.y += spin;
        // When both vinyls at max speed AND tonebars finished, set to RUNNING
        if (done) setAnimation(ANIMATION.RUNNING);
      }
    }
    // === DOWN ANIMATION: Move tonebars back, then decelerate vinyls ===
    // Runs at holdSync.drainSpeed so it empties in step with the space bar and the fade.
    else if (animation === ANIMATION.DOWN) {
      if (
        refs.tonebarLeft.current &&
        refs.tonebarRight.current &&
        refs.vinylLeft.current &&
        refs.vinylRight.current
      ) {
        const s = readHoldState();
        const { spin, done } = stepDown(s, delta * holdSync.drainSpeed, config);
        rotationSpeedRef.current = s.speed;
        refs.tonebarLeft.current.rotation.z = s.lZ;
        refs.tonebarLeft.current.rotation.y = s.lY;
        refs.tonebarRight.current.rotation.z = s.rZ;
        refs.tonebarRight.current.rotation.y = s.rY;
        refs.vinylLeft.current.rotation.y += spin;
        refs.vinylRight.current.rotation.y += spin;
        // When vinyls are stopped AND tonebars reset, go to idle
        if (done) setAnimation(ANIMATION.IDLE);
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
