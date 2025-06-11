

import { useEffect, useState } from 'react';
import './KeyboardInteraction.css'

export default function KeyboardInteractions({ animation, setAnimation, ANIMATION }) {
  const SPACE = {
    UP: 'space-up',
    DOWN: 'space-down',
    UP_PERMANENT: 'space-down-perm'
  };
  const [spaceButtonState, setSpaceButtonState] = useState(SPACE.UP);
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
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
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setAnimation((prev) => {
          if (prev === ANIMATION.UP) return ANIMATION.DOWN;
          if (prev === ANIMATION.RUNNING) return ANIMATION.RUNNING_ACTIVATED;
          return prev;
        });
        setSpaceButtonState((prev) => {
          if (prev === SPACE.DOWN) return SPACE.UP;
          return prev;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setAnimation, ANIMATION]);

  return (
    <div className = 'space-full' >
      <div className={`${spaceButtonState}`}>Press Space</div>
      <div className='space-base'></div>
    </div>


  );
}