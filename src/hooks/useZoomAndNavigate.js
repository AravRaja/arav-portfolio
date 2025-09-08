import { useCallback } from 'react';

// Hook to play a zoom animation on the DJ model, then navigate
// Requires: setAnimation, ANIMATION, and a navigate function (from react-router-dom)
export function useZoomAndNavigate({ setAnimation, ANIMATION, navigate, delayMs = 700, startZoom }) {
  const zoomThenNavigate = useCallback((path) => {
    try {
      // Trigger an existing prominent animation; adjust if you add a dedicated ZOOM state
      if (setAnimation && ANIMATION && ANIMATION.RUNNING_ACTIVATED) {
        setAnimation(ANIMATION.RUNNING_ACTIVATED);
      }
      // Trigger camera zoom in the 3D scene
      if (typeof startZoom === 'function') startZoom();
    } finally {
      // Navigate after a short delay to let the animation play
      window.setTimeout(() => navigate(path), delayMs);
    }
  }, [setAnimation, ANIMATION, navigate, delayMs, startZoom]);

  return { zoomThenNavigate };
}
