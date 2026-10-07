import React, { useEffect, useRef } from 'react';
import './SoundWaveBubble.css';
import { holdSync } from '../audio/holdSync.js';

// A waveform that fills the sound pill: new audio enters at the right edge and scrolls
// across to the left, settling to a low line at both ends. Its height follows the
// bass/kick envelope (flat between hits), with the mids adding texture once the filter
// opens after the drop. Kicks draw a symmetric spike and pulse the whole pill.
const STEP = 1.25; // px between waveform points
const SPEED = 45; // px per second the line scrolls left
const SAMPLE_MS = (STEP / SPEED) * 1000;
const HUM = 0.03; // flat-line jitter as a fraction of the half-height
const BASS_FLOOR = 0.015; // bass scale never shrinks below this (the intro's bass peaks ~0.026)
const MID_REF = 0.008; // mid level that counts as "full" (only reached after the drop)
const MID_SHARE = 0.35; // how much of the height the mids can add
const RISE_WINDOW = 70; // ms to look back for a kick's attack
// Activity follows how open the low-pass is: calm while muffled, building up as space is
// held, fully reactive once open. [muffled, open]
const RISE = [0.55, 0.3]; // how sharp a rise (as a share of the recent peak) counts as a kick
const MIN_GAP = [260, 90]; // ms between kicks
const SIZE = [0.3, 1]; // waveform height scale
const BUILD_EASE = 1.6; // >1 keeps the build calmer until it nears the top
const mix = ([muffled, open], k) => muffled + (open - muffled) * k;
const EDGE_LEVEL = 0.12; // how big the wave is at the very ends (the "low line")

const toLinear = (db) => (Number.isFinite(db) ? Math.pow(10, db / 20) : 0);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SoundWaveBubble = ({ fft, isPlaying }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (fft) fft.smoothing = 0.2; // the default (0.8) lags behind the music

    const points = []; // { t, amp (0..1), sign, beat }
    let bassHold = 0; // loudest bass since the last point
    let midHold = 0;
    let bassPeak = BASS_FLOOR; // adaptive ceiling: the loudest recent kick reaches full height
    const recent = []; // { t, bass } over the last RISE_WINDOW ms, to spot each kick's attack
    let openness = 0; // 0 = muffled, 1 = filter open
    let ink = getComputedStyle(canvas).color || '#000'; // line colour, from the pill's CSS colour
    let ticks = 0;
    let lastHit = 0;
    let spike = 0; // kick energy, decays over a few points
    let sign = 1;
    let lastPoint = performance.now();
    let lastFrame = lastPoint;
    let frame = 0;

    const read = (now) => {
      if (!fft || !isPlaying) return { bass: 0, mid: 0, hit: 0 };
      const values = fft.getValue();
      const bass = (toLinear(values[1]) + toLinear(values[2]) + toLinear(values[3])) / 3; // ~40–170Hz
      let mid = 0;
      for (let i = 8; i < 60; i++) mid += toLinear(values[i]); // ~350Hz–2.5kHz
      // A kick is a sharp rise in the bass, not just a loud moment, so back-to-back kicks
      // ("do-do") each register even though the bass hasn't fallen between them.
      recent.push({ t: now, bass });
      while (recent.length && now - recent[0].t > RISE_WINDOW) recent.shift();
      const floor = Math.min(...recent.map((r) => r.bass));
      openness = Math.pow(holdSync.openness(), BUILD_EASE);
      const isHit = bass - floor > bassPeak * mix(RISE, openness)
        && bass > bassPeak * 0.35
        && now - lastHit > mix(MIN_GAP, openness);
      if (isHit) lastHit = now;
      return { bass, mid: mid / 52, hit: isHit ? Math.min(1, bass / bassPeak) : 0 };
    };

    // The whole pill pulses on a kick, harder for harder (and more open) kicks.
    const pulse = (strength) => {
      const pill = canvas.parentElement;
      if (!pill) return;
      const glow = getComputedStyle(pill).getPropertyValue('--pulse-glow').trim() || '0, 0, 0';
      const scale = 1 + (0.12 + 0.14 * strength) * mix(SIZE, openness);
      pill.animate(
        [
          { transform: `scale(${scale})`, boxShadow: `0 0 0 3px rgba(${glow}, 0.55)` },
          { transform: 'scale(1)', boxShadow: `0 0 0 9px rgba(${glow}, 0)` },
        ],
        { duration: 240, easing: 'cubic-bezier(.2,.9,.3,1)' },
      );
    };

    // One waveform point: alternates sides like a real wave. The bass part is steady so the
    // kicks read clearly; the mids part is rough, for texture. Kicks are symmetric.
    const nextPoint = (t) => {
      const bass = Math.pow(Math.min(1, bassHold / bassPeak), 2); // peaky: drops back between hits
      const mids = Math.min(1, midHold / MID_REF) * MID_SHARE;
      const kick = spike * (0.85 + 0.15 * Math.random());
      const body = HUM * Math.random() + bass * (0.8 + 0.2 * Math.random()) + mids * Math.random();
      sign = -sign;
      spike *= 0.4;
      bassHold = 0;
      midHold = 0;
      const amp = Math.min(1, Math.max(body, kick)) * mix(SIZE, openness);
      return { t, amp, sign, beat: kick > 0.5 && kick >= body };
    };

    const draw = () => {
      const now = performance.now();
      const { bass, mid, hit } = read(now);
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;
      bassPeak = Math.max(bass, bassPeak * Math.pow(0.5, dt / 4), BASS_FLOOR); // ~4s half-life
      bassHold = Math.max(bassHold, bass);
      midHold = Math.max(midHold, mid);
      if (hit) {
        spike = 1;
        if (holdSync.songActive) pulse(hit); // the pill only pulses after the drop; before it, the deck does
      }
      while (now - lastPoint >= SAMPLE_MS) {
        lastPoint += SAMPLE_MS;
        points.push(nextPoint(lastPoint));
        if (points.length > width / STEP + 4) points.shift();
      }

      const cy = height / 2;
      const half = height / 2 - 2;
      // Each point has scrolled `d` px in from the right edge; it is full height through the
      // middle and eases down to a low line near both ends.
      const place = (p) => {
        const d = (now - p.t) * (SPEED / 1000);
        const u = d / width;
        const taper = EDGE_LEVEL + (1 - EDGE_LEVEL) * smoothstep(0, 0.15, u) * (1 - smoothstep(0.7, 1, u));
        return { x: width - d, a: p.amp * taper * half };
      };
      const vertex = (x, p, a) => {
        if (p.beat) {
          ctx.lineTo(x, cy - a);
          ctx.lineTo(x, cy + a);
        } else {
          ctx.lineTo(x, cy + p.sign * a);
        }
      };

      ctx.clearRect(0, 0, width, height);
      if (++ticks % 10 === 0) ink = getComputedStyle(canvas).color || ink; // follows the theme transition
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, cy);
      for (let i = 0; i < points.length; i++) { // oldest (left) → newest (right)
        const { x, a } = place(points[i]);
        if (x >= 0) vertex(x, points[i], a);
      }
      ctx.lineTo(width, cy);
      ctx.stroke();
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fft, isPlaying]);

  return <canvas ref={canvasRef} className="wave-canvas" />;
};

export default SoundWaveBubble;
