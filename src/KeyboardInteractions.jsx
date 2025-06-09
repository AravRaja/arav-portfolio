

import { useEffect } from 'react';

export default function KeyboardInteractions({ animation, setAnimation, ANIMATION }) {
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

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setAnimation, ANIMATION]);

  return null;
}