import { useEffect } from 'react';
import './KeyboardInteraction.css'

export default function KeyboardInteractions({ animation, setAnimation, ANIMATION }) {
  const SPACE = {
    UP: 'space-up',
    DOWN: 'space-down',
  };

  const getSpaceButtonState = () => {
    if (
      animation === ANIMATION.UP ||
      animation === ANIMATION.RUNNING ||
      animation === ANIMATION.RUNNING_ACTIVATED
    ) {
      return SPACE.DOWN;
    }
    return SPACE.UP;
  };

  // Handles both keyboard and mouse press down
  const handlePressDown = () => {
    // Only respond to Space key on keyboard events
    
    setAnimation((prev) => {
      if (prev === ANIMATION.IDLE) return ANIMATION.UP;
      if (prev === ANIMATION.RUNNING_ACTIVATED) return ANIMATION.DOWN;
      if (prev === ANIMATION.DOWN) return ANIMATION.UP;
      return prev;
    });
  };

  // Handles both keyboard and mouse release
  const handlePressUp = () => {
    // Only respond to Space key on keyboard events
    setAnimation((prev) => {
      if (prev === ANIMATION.UP) return ANIMATION.DOWN;
      if (prev === ANIMATION.RUNNING) return ANIMATION.RUNNING_ACTIVATED;
      return prev;
    });

  };

  useEffect(() => {
    window.addEventListener('keydown', handlePressDown);
    window.addEventListener('keyup', handlePressUp);

    return () => {
      window.removeEventListener('keydown', handlePressDown);
      window.removeEventListener('keyup', handlePressUp);
    };
  }, []);

  return (
    <div className = 'space-full' >
      <div
        className={getSpaceButtonState()}
        onMouseDown={handlePressDown}
        onMouseUp={handlePressUp}
        onTouchStart={handlePressDown}
        onTouchEnd={handlePressUp}
      >
        Press Space
      </div>
      <div className='space-base'></div>
    </div>


  );
}