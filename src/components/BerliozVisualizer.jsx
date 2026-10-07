import { useEffect, useRef } from 'react';
import { djBounds } from './djBounds.js';
import './BerliozVisualizer.css';

export default function BerliozVisualizer({ fft }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame, width, height, energy = 0;
    const resize = () => {
      width = innerWidth; height = innerHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = width * ratio; canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    // Fixed ordered-dither ink: texture stays attached to the paper, never flickers.
    const tile = document.createElement('canvas');
    tile.width = tile.height = 4;
    const ink = tile.getContext('2d');
    ink.fillStyle = '#252525';
    [[0,0], [2,2], [0,2], [2,0], [1,3], [3,1]].forEach(([x,y]) => ink.fillRect(x,y,1,1));
    const stipple = ctx.createPattern(tile, 'repeat');
    const draw = (time) => {
      ctx.clearRect(0, 0, width, height);
      const bounds = djBounds.current;
      if (bounds && !reducedMotion.matches) {
        const values = fft?.getValue();
        const level = values ? Math.max(0, Math.min(1, (values[4] + 70) / 70)) : 0;
        energy += (level - energy) * 0.08;
        // Six hand-drawn-looking ribbons, each with fine contour echoes.
        // Their entire motion envelope fits inside the measured free gutters.
        [[24, Math.min(width * 0.32, bounds.left)],
         [Math.max(width * 0.68, bounds.right), width - 24]].forEach(([left, right], side) => {
          const available = right - left;
          if (available < 70) return;
          const count = available > 140 ? 3 : 2;
          const lane = available / count;
          const top = Math.max(170, height * 0.24);
          const bottom = height * 0.67;
          if (bottom - top < 100) return;
          for (let ribbon = 0; ribbon < count; ribbon++) {
            const centre = left + lane * (ribbon + 0.5);
            const amplitude = Math.max(1, Math.min(28, lane / 2 - 13));
            const phase = side * 2.4 + ribbon * 1.7;
            const start = top + (ribbon % 2) * 28;
            const length = (bottom - top) * (0.72 + ribbon * 0.08);
            const path = (offset) => {
              ctx.beginPath();
              for (let i = 0; i <= 120; i++) {
                const t = i / 120;
                const drift = time * 0.0006;
                const wave = Math.sin(t * 8.3 + phase + drift) * 0.65
                  + Math.sin(t * 15 - phase - drift * 0.6) * 0.25;
                const taper = Math.sin(Math.PI * t) * 0.3 + 0.7;
                const x = centre + wave * amplitude * taper * (0.75 + energy * 0.25) + offset;
                const y = start + t * length;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
              }
            };
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            path(0); ctx.strokeStyle = stipple; ctx.lineWidth = 10 + energy * 3; ctx.stroke();
            [-7, -3, 4, 8].forEach((offset, index) => {
              path(offset); ctx.strokeStyle = index % 2 ? '#25252566' : '#252525b3';
              ctx.lineWidth = 0.65; ctx.stroke();
            });
          }
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); };
  }, [fft]);
  return <canvas className="berlioz-canvas" ref={canvasRef} aria-hidden="true" />;
}
