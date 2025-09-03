import { useEffect, useRef, useCallback } from 'react';
import './KeyboardInteraction.css'
import SpaceButton from './components/SpaceButton.jsx';
import useSound from 'use-sound';

const CLICK_SOUND = '/click.mp3';

export default function KeyboardInteractions({ animation, setAnimation, ANIMATION }) {
  const SPACE = {
    UP: 'space-up',
    DOWN: 'space-down',
    DOWN_ACTIVATED: 'space-down-active',
  };

  const getSpaceButtonState = () => {
    
    if (
      animation === ANIMATION.RUNNING ||
      animation === ANIMATION.RUNNING_ACTIVATED
    ) {
      return SPACE.DOWN_ACTIVATED;
    }
    if (animation === ANIMATION.UP) {
      return SPACE.DOWN;
    }
    return SPACE.UP;
  };

  // Track if button is currently pressed
  const isPressed = useRef(false);
  const [playClick] = useSound(CLICK_SOUND, { volume: 0.6 });

  // Unified press down logic
  const handlePressDown = useCallback(() => {
    if (isPressed.current) return; // Prevent double-press

    playClick();
    isPressed.current = true;
    setAnimation((prev) => {
      if (prev === ANIMATION.IDLE) return ANIMATION.UP;
      if (prev === ANIMATION.RUNNING_ACTIVATED) return ANIMATION.DOWN;
      if (prev === ANIMATION.DOWN) return ANIMATION.UP;
      return prev;
    });
  }, [playClick, setAnimation, ANIMATION]);

  // Unified press up logic
  const handlePressUp = useCallback(() => {
    if (!isPressed.current) return;
    
    setAnimation((prev) => {
      if (prev === ANIMATION.UP) return ANIMATION.DOWN;
      if (prev === ANIMATION.RUNNING) return ANIMATION.RUNNING_ACTIVATED;
      return prev;
    });
    isPressed.current = false;
  }, [setAnimation, ANIMATION]);

  const handleKeyDown = useCallback((e) => {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      handlePressDown();
    }
  }, [handlePressDown]);

  const handleKeyUp = useCallback((e) => {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      handlePressUp();
    }
  }, [handlePressUp]);

  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    handlePressDown();
  }, [handlePressDown]);

  const handlePointerUp = useCallback((e) => {
    e.preventDefault();
    handlePressUp();
  }, [handlePressUp]);

  const handlePointerCancel = useCallback((e) => {
    e.preventDefault();
    handlePressUp();
  }, [handlePressUp]);

  const handlePointerLeave = useCallback((e) => {
    e.preventDefault();
    handlePressUp();
  }, [handlePressUp]);

  useEffect(() => {
    // Add global event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('pointerup', handlePressUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('pointerup', handlePressUp);
    };
  }, [handleKeyDown, handleKeyUp, handlePressUp]);


  return (
    <SpaceButton
      stateClass={getSpaceButtonState()}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
    />
  );
}