import { useEffect, useState } from 'react';
import './KeyboardInteraction.css'

export default function KeyboardInteractions({ animation, setAnimation, ANIMATION }) {
  const SPACE = {
    UP: 'space-up',
    DOWN: 'space-down',
    UP_PERMANENT: 'space-down-perm'
  };
  const [spaceButtonState, setSpaceButtonState] = useState(SPACE.UP);

  // Handles both keyboard and mouse press down
  const handlePressDown = () => {
    // Only respond to Space key on keyboard events
    
    setAnimation((prev) => {
      if (prev === ANIMATION.IDLE) return ANIMATION.UP;
      if (prev === ANIMATION.RUNNING_ACTIVATED) return ANIMATION.DOWN;
      if (prev === ANIMATION.DOWN) return ANIMATION.UP;
      return prev;
    });
    setSpaceButtonState((prev) => {
      if (prev === SPACE.UP) return SPACE.DOWN;
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
    setSpaceButtonState((prev) => {
      if (prev === SPACE.DOWN) return SPACE.UP;
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
  }, [setAnimation, ANIMATION]);

  return (
    <div className = 'space-full' >
      <div
        className={`${spaceButtonState}`}
        onMouseDown={handlePressDown}
        onMouseUp={handlePressUp}
      >
        Press Space
      </div>
      <div className='space-base'></div>
    </div>


  );
}