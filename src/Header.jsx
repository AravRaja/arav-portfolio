import React, { useEffect, useState, useRef } from 'react'
import './Header.css'
import { Link, useLocation } from 'react-router-dom'
import * as Tone from 'tone'
import SoundWaveBubble from './components/SoundWaveBubble'
import SoundTuner from './components/SoundTuner'
import { holdSync } from './audio/holdSync.js'
import { getProfile, subscribeProfile } from './audio/soundProfile.js'
import { isMuted, setMuted, subscribeMuted, useMuted } from './audio/muteState.js'

// Ramp `param` from its current value to `to` over `seconds`, shaped by t^shape.
// Frequencies interpolate on a log scale so the sweep sounds even.
function shapedRamp(param, to, seconds, shape = 1, log = false) {
  const now = Tone.getContext().currentTime + 0.005;
  const from = param.getValueAtTime(now);
  param.cancelAndHoldAtTime(now);
  if (seconds <= 0.01 || from === to) { param.setValueAtTime(to, now); return now; }
  const steps = Math.max(2, Math.ceil(seconds * 60));
  for (let i = 1; i <= steps; i++) {
    const t = Math.pow(i / steps, shape);
    const value = log ? from * Math.pow(to / from, t) : from + (to - from) * t;
    param.linearRampToValueAtTime(value, now + (seconds * i) / steps);
  }
  return now + seconds;
}

export default function Header() {
  const location = useLocation();
  const onHome = location.pathname === '/';
  // On the music stage (after the drop) the home page becomes a blue page like About
  const [onStage, setOnStage] = useState(false);
  const [stageSeconds, setStageSeconds] = useState(null); // header fade time while the stage changes
  const isBlue = !onHome;
  const showTuner = import.meta.env.DEV || new URLSearchParams(location.search).has('tune');
  const [isPlaying, setIsPlaying] = useState(false);
  const muted = useMuted();
  const meterRef = useRef(null);
  const fftRef = useRef(null);

  const handleNavClick = (path) => (e) => {
    if (onHome) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('welcome-header-nav', { detail: { path } }));
    }
  };

  useEffect(() => {
    if (!onHome) return;
    let P = getProfile();
    const output = new Tone.Gain(0).toDestination(); // silent while muted or the tab is hidden
    const meter = new Tone.Meter();
    const fft = new Tone.FFT(512);
    const player = new Tone.Player({ url: '/now-get-busy.mp3', loop: true, loopStart: P.loopStart, loopEnd: P.loopEnd });
    const filter = new Tone.Filter({ type: 'lowpass', frequency: P.muffledHz, Q: P.muffledQ, rolloff: P.rolloff });
    const level = new Tone.Gain(P.introGain);
    player.chain(filter, level, output);
    output.connect(meter);
    output.connect(fft);
    meterRef.current = meter;
    fftRef.current = fft;

    // The intro loops (muffled) from the first interaction. Holding space opens the filter;
    // filling the bar and then letting go jumps straight to the drop hit.
    let started = false;
    let disposed = false;
    let dropped = false; // the song (not the intro loop) is playing
    let song = 'on'; // after the drop: 'on' | 'fading' (let go) | 'reviving' (held again)
    let fadeTimer = 0;
    let stageTimer = 0;
    let settled = { at: 0, open: false }; // where the filter ends up once its current ramp finishes
    let anchor = { time: 0, offset: 0 }; // context time at which playback was at `offset`
    const ctxNow = () => Tone.getContext().currentTime;
    const loopPosition = (time) => {
      const p = anchor.offset + (time - anchor.time);
      if (p < P.loopEnd) return p;
      return P.loopStart + ((p - P.loopStart) % (P.loopEnd - P.loopStart));
    };
    // Seconds until the loop reaches the spot that lines up with the drop hit (same place in the bar).
    const untilHitPoint = (time) => {
      const bar = P.loopEnd - P.loopStart;
      const phase = (((P.dropHit - P.loopStart) % bar) + bar) % bar;
      let d = P.loopStart + phase - loopPosition(time);
      while (d < 0) d += bar;
      return d;
    };
    const playIntro = (offset) => {
      const time = Tone.now();
      player.loop = true;
      if (player.state === 'started') player.stop(time);
      player.start(time + 0.01, offset);
      anchor = { time: time + 0.01, offset };
    };
    // The camera zooms into the deck and the page becomes the blue music stage (or back out).
    // The header stays transparent and fades its text to white (or back) over the same time.
    let staged = false; // whether this player has put the page on the music stage
    const stage = (inward, seconds) => {
      staged = inward;
      clearTimeout(stageTimer);
      setStageSeconds(seconds);
      setOnStage(inward);
      stageTimer = setTimeout(() => setStageSeconds(null), seconds * 1000); // back to snappy hovers
      window.dispatchEvent(new CustomEvent('dj-stage', { detail: { inward, seconds } }));
    };
    // Land the drop hit on the loop's next bar (or beat), never mid-beat.
    const drop = () => {
      const now = ctxNow();
      const bar = P.loopEnd - P.loopStart;
      const grid = P.dropOn === 'beat' ? bar / P.beatsPerBar : bar;
      let wait = untilHitPoint(now) % grid;
      if (wait < 0.005) wait += grid; // too close to schedule; take the next one
      player.loop = false;
      player.restart(now + wait, P.dropHit);
      stage(true, P.stageZoomIn);
    };

    // Stretch the hold so the bar fills on the next drop-hit point it can reach without
    // going faster than speedUpLimit allows, so letting go right as it fills lands on the beat.
    holdSync.pickDuration = (natural) => {
      const nominal = natural / P.holdSpeed;
      if (!P.beatSync || !started || dropped || player.state !== 'started') return nominal;
      const bar = P.loopEnd - P.loopStart;
      let seconds = untilHitPoint(ctxNow()) - P.syncLead;
      while (seconds < nominal * P.speedUpLimit) seconds += bar;
      return seconds;
    };

    const sweep = (open, seconds, shape) => {
      shapedRamp(filter.frequency, open ? P.openHz : P.muffledHz, seconds, shape, true);
      shapedRamp(filter.Q, open ? P.openQ : P.muffledQ, seconds, shape);
      settled = { at: ctxNow() + seconds, open };
    };
    const release = () => {
      sweep(false, P.releaseSeconds, P.releaseCurve);
      shapedRamp(level.gain, P.introGain, P.releaseSeconds, P.releaseCurve);
    };

    const begin = async () => {
      if (started || disposed) return;
      started = true;
      try {
        await Tone.start();
        await Tone.loaded();
      } catch {
        started = false;
        return;
      }
      if (disposed) return;
      playIntro(0);
      applyOutput();
      setIsPlaying(true);
    };
    const backToIntro = () => {
      clearTimeout(fadeTimer);
      dropped = false;
      holdSync.songActive = false;
      song = 'on';
      playIntro(P.loopStart);
      stage(false, 0.6);
      sweep(false, 0.05, 1);
      level.gain.cancelAndHoldAtTime(ctxNow());
      level.gain.setValueAtTime(0, ctxNow());
      shapedRamp(level.gain, P.introGain, P.loopFadeIn);
    };
    const hold = (event) => {
      if (!started) return;
      const { held, armed, dropped: released, holdSeconds, drainSeconds } = event.detail;
      if (armed) return; // bar full and still held: keep looping (opened up) until it's let go
      if (dropped && player.state !== 'started') { backToIntro(); return; } // the song had finished
      if (player.state !== 'started') return;
      if (released) {
        if (dropped) {
          if (song !== 'on') {
            // Caught the song again with a full hold: back onto the music stage
            clearTimeout(fadeTimer);
            if (!staged) stage(true, P.stageZoomIn);
            song = 'on';
            sweep(true, P.snapSeconds, 1);
            shapedRamp(level.gain, P.songLevel, P.snapSeconds);
          }
          return;
        }
        dropped = true;
        holdSync.songActive = true;
        song = 'on';
        sweep(true, P.snapSeconds, 1);
        shapedRamp(level.gain, P.songLevel, P.snapSeconds);
        drop();
      } else if (dropped) {
        if (held) {
          // Caught it before it faded out: bring the song back without losing its place
          clearTimeout(fadeTimer);
          song = 'reviving';
          const seconds = holdSeconds ?? 3;
          // The page only zooms back into the stage once this hold fills the bar, so a tap
          // while the song fades doesn't bounce it back to blue
          sweep(true, seconds, P.buildCurve);
          shapedRamp(level.gain, P.songLevel, seconds, P.buildCurve);
        } else if (song !== 'fading') {
          // Let go after the drop: fade the song out where it is (it can be caught again until
          // it's silent), then bring the intro loop back
          // Silent as the bar runs out of juice (plus any tail)
          song = 'fading';
          clearTimeout(fadeTimer);
          const seconds = (drainSeconds ?? 3) + P.fadeTail;
          stage(false, seconds);
          sweep(false, seconds, P.fadeCurve);
          shapedRamp(level.gain, 0, seconds, P.fadeCurve);
          fadeTimer = setTimeout(() => { if (!disposed && dropped && song === 'fading') backToIntro(); }, seconds * 1000);
        }
      } else if (held) {
        const seconds = holdSeconds ?? 3;
        // Build-up: the filter opens over the whole hold, gradually then bigger, while the
        // resonance climbs (the sweep's whistle) and the volume lifts into the drop
        sweep(true, seconds, P.buildCurve);
        shapedRamp(filter.Q, P.buildQ, seconds, P.buildCurve);
        shapedRamp(level.gain, P.buildLevel, seconds, P.buildCurve);
      } else {
        release();
        // No song is playing, so the page must not be left on the blue stage
        if (staged) stage(false, drainSeconds ?? 0.6);
      }
    };
    holdSync.pickDrain = (natural) => natural / P.drainSpeed;
    // Where the listener is within the current beat (on the same grid the drop lands on)
    // Where the listener is within the current beat of the intro loop. The intro's beats
    // land on the loop's bar line (plus beatOffset), measured from the audio.
    holdSync.beatPhase = () => {
      if (!started || dropped || player.state !== 'started') return null;
      const latency = Tone.getContext().rawContext.outputLatency || 0;
      const beat = (P.loopEnd - P.loopStart) / P.beatsPerBar;
      const intoLoop = loopPosition(ctxNow() - latency) - P.loopStart - P.beatOffset;
      return (((intoLoop % beat) + beat) % beat) / beat;
    };
    holdSync.openness = () => {
      const k = Math.log(filter.frequency.value / P.muffledHz) / Math.log(P.openHz / P.muffledHz);
      return Math.min(1, Math.max(0, k));
    };
    const unsubscribe = subscribeProfile((next, patch) => {
      P = next;
      filter.rolloff = P.rolloff;
      player.loopStart = P.loopStart;
      player.loopEnd = P.loopEnd;
      if (started && !dropped && ('loopStart' in patch || 'loopEnd' in patch)) playIntro(P.loopStart);
      // Retune immediately unless a sweep is in progress
      if (ctxNow() >= settled.at) {
        filter.frequency.cancelAndHoldAtTime(ctxNow());
        filter.frequency.setValueAtTime(settled.open ? P.openHz : P.muffledHz, ctxNow());
        filter.Q.cancelAndHoldAtTime(ctxNow());
        filter.Q.setValueAtTime(settled.open ? P.openQ : P.muffledQ, ctxNow());
        level.gain.cancelAndHoldAtTime(ctxNow());
        level.gain.setValueAtTime(dropped ? P.songLevel : P.introGain, ctxNow());
      }
    });
    const shutdown = () => {
      disposed = true;
      clearTimeout(fadeTimer);
      output.gain.value = 0;
      if (player.state === 'started') player.stop();
      setIsPlaying(false);
    };
    const applyOutput = () => {
      if (started && !disposed) output.gain.rampTo(document.hidden || isMuted() ? 0 : 1, 0.05);
    };
    const unsubscribeMuted = subscribeMuted(applyOutput);
    window.addEventListener('pointerdown', begin);
    window.addEventListener('keydown', begin);
    window.addEventListener('dj-hold-change', hold);
    window.addEventListener('dj-navigation-start', shutdown);
    document.addEventListener('visibilitychange', applyOutput);
    // Returning to home after audio was already unlocked: resume the loop straight away.
    if (Tone.getContext().state === 'running') begin();
    // A fresh player starts on the normal page, even if an earlier one left it on the stage
    window.dispatchEvent(new CustomEvent('dj-stage', { detail: { inward: false, seconds: 0.6 } }));
    return () => {
      shutdown();
      unsubscribe();
      unsubscribeMuted();
      holdSync.pickDuration = (seconds) => seconds;
      holdSync.pickDrain = (seconds) => seconds;
      holdSync.openness = () => 0;
      holdSync.beatPhase = () => null;
      holdSync.songActive = false;
      clearTimeout(stageTimer);
      setOnStage(false);
      window.removeEventListener('pointerdown', begin);
      window.removeEventListener('keydown', begin);
      window.removeEventListener('dj-hold-change', hold);
      window.removeEventListener('dj-navigation-start', shutdown);
      document.removeEventListener('visibilitychange', applyOutput);
      player.dispose(); filter.dispose(); level.dispose(); output.dispose(); meter.dispose(); fft.dispose();
      meterRef.current = null; fftRef.current = null;
    };
  }, [onHome]);

  useEffect(() => {
    // Add meta tags for iPhone status bar styling
    const addMetaTag = (name, content) => {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = name;
        document.head.appendChild(meta);
      }
      meta.content = content;
    };

    // Set theme color to match header background
    addMetaTag(
      'theme-color',
      isBlue || onStage ? 'rgb(1, 23, 213)' : 'rgb(255, 255, 255)'
    );
    addMetaTag('apple-mobile-web-app-capable', 'yes');
    addMetaTag('apple-mobile-web-app-status-bar-style', 'black-translucent');
    
    // Update viewport meta tag to include viewport-fit=cover
    let viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    }
  }, [isBlue, onStage]);
  return (
    <>
      <header
        className={`site-header ${isBlue ? 'blue' : ''} ${onHome && onStage ? 'stage' : ''}`}
        style={stageSeconds ? { '--stage-seconds': `${stageSeconds}s` } : undefined}
      >
        <Link to="/" className="left-name"><span className="nav-link-highlight">ARAV.RAJA</span></Link>
        <div className="centre"> 
          <nav className="nav-links">
            <Link to="/about" onClick={handleNavClick('/about')}><span className="nav-link-highlight">ABOUT</span></Link>
            <Link to="/projects" onClick={handleNavClick('/projects')}><span className="nav-link-highlight">PROJECTS</span></Link>
            <Link to="/experience" onClick={handleNavClick('/experience')}><span className="nav-link-highlight">EXPERIENCE</span></Link>
            <Link to="/contact" onClick={handleNavClick('/contact')}><span className="nav-link-highlight">CONTACT</span></Link>
          </nav>
        </div>
        <div className="header-right">
          {onHome && (
            <button
              type="button"
              className={`mute-button ${muted ? 'muted' : ''}`}
              aria-label={muted ? 'Unmute music' : 'Mute music'}
              aria-pressed={muted}
              onClick={(e) => { setMuted(!muted); e.currentTarget.blur(); }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4z" />
                {muted
                  ? <path d="M16 9l6 6M22 9l-6 6" />
                  : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
              </svg>
            </button>
          )}
          <div className="time-bubble">
            <SoundWaveBubble fft={fftRef.current} isPlaying={isPlaying && !muted} />
          </div>
        </div>
      </header>
      {onHome && showTuner && !onStage && <SoundTuner />}
    </>
  )
}