import { useState, useEffect } from 'react';

export function useResponsiveModel() {
  const [modelScale, setModelScale] = useState(1);
  const [modelPosition, setModelPosition] = useState([0, 0.5, 0]);

  useEffect(() => {
    function updateScale() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (width < 600) {
        setModelScale(0.8);
      } else if (width < 900) {
        setModelScale(1);
      } else {
        setModelScale(1.7);
      }
      if (height < 700) {
        setModelPosition([0, 0.8, 0]);
      } else {
        setModelPosition([0, 0.5, 0]);
      }
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return { modelScale, modelPosition };
}
