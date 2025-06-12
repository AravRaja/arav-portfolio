import { useEffect, useRef } from 'react';
import './KeyboardInteraction.css'

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

  const clickAudio = useRef(null);

  useEffect(() => {
    clickAudio.current = new window.Audio(CLICK_SOUND);
  }, []);

  const playClick = () => {
    if (clickAudio.current) {
      clickAudio.current.currentTime = 0;
      clickAudio.current.play();
    }
  };

  // Handles both keyboard and mouse press down
  const handlePressDown = () => { 
    playClick();
    isPressed.current = true;
    setAnimation((prev) => {
      if (prev === ANIMATION.IDLE) return ANIMATION.UP;
      if (prev === ANIMATION.RUNNING_ACTIVATED) return ANIMATION.DOWN;
      if (prev === ANIMATION.DOWN) return ANIMATION.UP;
      return prev;
    });
  };

  // Handles both keyboard and mouse release
  const handlePressUp = () => {
    if (!isPressed.current) return;
    setAnimation((prev) => {
      if (prev === ANIMATION.UP) return ANIMATION.DOWN;
      if (prev === ANIMATION.RUNNING) return ANIMATION.RUNNING_ACTIVATED;
      return prev;
    });
    isPressed.current = false;
  };

  useEffect(() => {
    const onKeyDown = () => {
      if (!isPressed.current) { 
        playClick();
        isPressed.current = true;
        setAnimation((prev) => {
          if (prev === ANIMATION.IDLE) return ANIMATION.UP;
          if (prev === ANIMATION.RUNNING_ACTIVATED) return ANIMATION.DOWN;
          if (prev === ANIMATION.DOWN) return ANIMATION.UP;
          return prev;
        });
      }
    };

    const onKeyUp = () => {
      if (!isPressed.current) return;
      setAnimation((prev) => {
        if (prev === ANIMATION.UP) return ANIMATION.DOWN;
        if (prev === ANIMATION.RUNNING) return ANIMATION.RUNNING_ACTIVATED;
        return prev;
      });
      isPressed.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mouseup', handlePressUp);
    window.addEventListener('touchend', handlePressUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mouseup', handlePressUp);
      window.removeEventListener('touchend', handlePressUp);
    };
  }, [setAnimation, ANIMATION]);

  return (
    <div className = 'space-full' >
      <svg
        id="rectangle"
        className={getSpaceButtonState()}
        onMouseDown={handlePressDown}
        onTouchStart={handlePressDown}
        viewBox="0 0 400 50"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          id="base-stroke"
          d="M 4 25 Q 4 5 26 5 H 376 Q 396 5 396 25
M 4 25 Q 4 45 26 45 H 376 Q 396 45 396 25"
        />
        <path 
          id="stroke-top"
          d="M 4 25 Q 4 5 26 5 H 376 Q 396 5 396 25"
        />
        <path
          id="stroke-bottom"
          d="M 4 25 Q 4 45 26 45 H 376 Q 396 45 396 25"
        />
        <text
          className = "space-label"
          x="50%"
          y="50%" 
          dominantBaseline="middle"
          textAnchor="middle"
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          HOLD SPACE
        </text>
      </svg>
      <svg
        id="space-base"
        viewBox="0 0 400 50"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          id="stroke-bottom-base"
          d="M 4 19 Q 4 45 26 45 H 376 Q 396 45 396 19"
        />
      </svg>
    </div>
  );
}