import React, { useEffect, useRef } from 'react';
import './SoundWaveBubble.css';
import { holdSync } from '../audio/holdSync.js';

// A live waveform that fills the sound pill and only ever shows the audio right now: a
// noisy line whose height follows the current bass/kick level (flat between hits), with
// the mids adding texture once the filter opens after the drop. Nothing lingers: as soon
// as a sound passes, the line drops straight back. Kicks draw a symmetric spike in the
// middle and, after the drop, pulse the whole pill.
const STEP = 1.25; // px between waveform points
const RELEASE = 0.06; // seconds for the line to fall back once a sound has passed
const KICK_RELEASE = 0.11; // ...and for a kick spike
const NOISE_MS = 30; // how often the line's texture re-rolls
const KICK_WIDTH = 0.2; // how wide the kick spike is, as a share of the pill
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

    let level = 0; // current line height (0..1), instant attack, quick release
    let spike = 0; // current kick spike (0..1)
    let noise = [];
    let lastNoise = 0;
    let bassPeak = BASS_FLOOR; // adaptive ceiling: the loudest recent kick reaches full height
    const recent = []; // { t, bass } over the last RISE_WINDOW ms, to spot each kick's attack
    let openness = 0; // 0 = muffled, 1 = filter open
    let ink = getComputedStyle(canvas).color || '#000'; // line colour, from the pill's CSS colour
    let ticks = 0;
    let lastHit = 0;
    let lastFrame = performance.now();
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

    const draw = () => {
      const now = performance.now();
      const { bass, mid, hit } = read(now);
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      bassPeak = Math.max(bass, bassPeak * Math.pow(0.5, dt / 4), BASS_FLOOR); // ~4s half-life
      if (hit) {
        spike = 1;
        if (holdSync.songActive) pulse(hit); // the pill only pulses after the drop; before it, the deck does
      }

      // The line's height is the sound right now: jumps up instantly, falls back in RELEASE s
      const bassNow = Math.pow(Math.min(1, bass / bassPeak), 2); // peaky: flat between hits
      const midsNow = Math.min(1, mid / MID_REF) * MID_SHARE;
      level = Math.max(Math.min(1, bassNow * 0.9 + midsNow), level * Math.exp(-dt / RELEASE));
      spike *= Math.exp(-dt / KICK_RELEASE);
      const count = Math.ceil(width / STEP) + 1;
      if (now - lastNoise > NOISE_MS || noise.length !== count) {
        lastNoise = now;
        noise = Array.from({ length: count }, () => 0.35 + 0.65 * Math.random());
      }

      const cy = height / 2;
      const half = height / 2 - 2;
      const size = mix(SIZE, openness);
      ctx.clearRect(0, 0, width, height);
      if (++ticks % 10 === 0) ink = getComputedStyle(canvas).color || ink; // follows the theme transition
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, cy);
      for (let i = 0; i < count; i++) {
        const x = Math.min(width, i * STEP);
        const u = x / width;
        // Full height through the middle, easing to a low line at both ends
        const taper = EDGE_LEVEL + (1 - EDGE_LEVEL) * smoothstep(0, 0.3, u) * smoothstep(0, 0.3, 1 - u);
        const body = (HUM + level) * noise[i] * taper * size * half;
        const kick = spike * Math.exp(-(((u - 0.5) / KICK_WIDTH) ** 2)) * (0.85 + 0.15 * noise[i]) * size * half;
        if (kick > body && kick > 1) { // symmetric spike, above and below the line at once
          ctx.lineTo(x, cy - kick);
          ctx.lineTo(x, cy + kick);
        } else {
          ctx.lineTo(x, cy + (i % 2 ? body : -body));
        }
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
