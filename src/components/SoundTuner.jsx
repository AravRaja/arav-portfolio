import React, { useEffect, useState } from 'react';
import { getProfile, setProfile, resetProfile, subscribeProfile, DEFAULT_PROFILE } from '../audio/soundProfile.js';
import './SoundTuner.css';

// Dev-only panel (or ?tune) for shaping the welcome-page music live.
const SECTIONS = [
  {
    title: 'Muffle',
    hint: 'Low-pass filter: muffled while looping, open after the drop',
    controls: [
      { key: 'muffledHz', label: 'Muffled cutoff', min: 50, max: 5000, log: true, unit: 'Hz' },
      { key: 'openHz', label: 'Open cutoff', min: 500, max: 20000, log: true, unit: 'Hz' },
      { key: 'muffledQ', label: 'Muffled resonance', min: 0.1, max: 20, step: 0.1 },
      { key: 'openQ', label: 'Open resonance', min: 0.1, max: 20, step: 0.1 },
      { key: 'rolloff', label: 'Slope', options: [-12, -24, -48, -96], unit: 'dB/oct' },
    ],
  },
  {
    title: 'Volume',
    controls: [
      { key: 'introGain', label: 'Intro loop', min: 0, max: 1.5, step: 0.01 },
      { key: 'buildLevel', label: 'End of build', min: 0, max: 1.5, step: 0.01 },
      { key: 'songLevel', label: 'After drop', min: 0, max: 1.5, step: 0.01 },
    ],
  },
  {
    title: 'Build-up',
    hint: 'Holding space. The hold slows down to finish on the next beat drop. Curve >1 = slow start, fast finish',
    controls: [
      { key: 'holdSpeed', label: 'Hold speed', min: 0.3, max: 3, step: 0.01, unit: '×' },
      { key: 'buildCurve', label: 'Build curve', min: 0.2, max: 5, step: 0.05 },
      { key: 'buildQ', label: 'Build resonance', min: 0.1, max: 20, step: 0.1 },
      { key: 'beatSync', label: 'Snap hold to the bar', toggle: true },
      { key: 'speedUpLimit', label: 'Allowed speed-up', min: 0.5, max: 1, step: 0.01, unit: '×' },
      { key: 'syncLead', label: 'Finish early by', min: 0, max: 0.3, step: 0.005, unit: 's' },
      { key: 'dropOn', label: 'Drop lands on next', options: ['bar', 'beat'] },
      { key: 'beatsPerBar', label: 'Beats per bar', min: 1, max: 8, step: 1 },
      { key: 'beatOffset', label: 'Deck pulse offset', min: -0.25, max: 0.25, step: 0.005, unit: 's' },
      { key: 'stageZoomIn', label: 'Zoom-in time', min: 0.1, max: 2, step: 0.05, unit: 's' },
      { key: 'snapSeconds', label: 'Final snap open', min: 0, max: 1.5, step: 0.01, unit: 's' },
    ],
  },
  {
    title: 'Release',
    hint: 'Letting go before the hold completes',
    controls: [
      { key: 'releaseSeconds', label: 'Back to muffled', min: 0, max: 8, step: 0.05, unit: 's' },
      { key: 'releaseCurve', label: 'Release curve', min: 0.2, max: 5, step: 0.05 },
    ],
  },
  {
    title: 'After the drop',
    hint: 'Pressing space again: the song fades out with the bar. Hold space before it empties to get back in; once silent the loop returns',
    controls: [
      { key: 'drainSpeed', label: 'Bar drain speed', min: 0.25, max: 3, step: 0.01, unit: '×' },
      { key: 'fadeTail', label: 'Extra fade after empty', min: 0, max: 5, step: 0.05, unit: 's' },
      { key: 'fadeCurve', label: 'Fade curve', min: 0.2, max: 5, step: 0.05 },
      { key: 'loopFadeIn', label: 'Loop fade-in', min: 0, max: 5, step: 0.05, unit: 's' },
    ],
  },
  {
    title: 'Song points',
    hint: 'Seconds into the track',
    controls: [
      { key: 'loopStart', label: 'Loop start', min: 0, max: 10, step: 0.005, unit: 's' },
      { key: 'loopEnd', label: 'Loop end', min: 0.5, max: 12, step: 0.005, unit: 's' },
      { key: 'dropHit', label: 'Drop hits at', min: 0, max: 30, step: 0.005, unit: 's' },
    ],
  },
];

const toSlider = (c, v) => (c.log ? Math.log(v / c.min) / Math.log(c.max / c.min) : v);
const fromSlider = (c, s) => (c.log ? Math.round(c.min * Math.pow(c.max / c.min, s)) : s);
const blurSoon = (e) => e.currentTarget.blur(); // hand Space back to the deck

function Control({ c, value }) {
  if (c.toggle) {
    return (
      <label className="tuner-row tuner-toggle">
        <span>{c.label}</span>
        <input type="checkbox" checked={value} onChange={(e) => { setProfile({ [c.key]: e.target.checked }); blurSoon(e); }} />
      </label>
    );
  }
  if (c.options) {
    return (
      <label className="tuner-row">
        <span>{c.label}</span>
        <select value={value} onChange={(e) => { setProfile({ [c.key]: typeof value === 'number' ? Number(e.target.value) : e.target.value }); blurSoon(e); }}>
          {c.options.map((o) => <option key={o} value={o}>{o}{c.unit ? ` ${c.unit}` : ''}</option>)}
        </select>
      </label>
    );
  }
  const changed = value !== DEFAULT_PROFILE[c.key];
  return (
    <label className={`tuner-row ${changed ? 'changed' : ''}`}>
      <span>{c.label}</span>
      <input
        type="range"
        min={c.log ? 0 : c.min}
        max={c.log ? 1 : c.max}
        step={c.log ? 0.001 : c.step}
        value={toSlider(c, value)}
        onChange={(e) => setProfile({ [c.key]: fromSlider(c, Number(e.target.value)) })}
        onPointerUp={blurSoon}
        onDoubleClick={() => setProfile({ [c.key]: DEFAULT_PROFILE[c.key] })}
        title="Double-click to reset"
      />
      <input
        type="number"
        className="tuner-number"
        step={c.step ?? 1}
        value={value}
        onChange={(e) => e.target.value !== '' && setProfile({ [c.key]: Number(e.target.value) })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {c.unit && <em>{c.unit}</em>}
    </label>
  );
}

export default function SoundTuner() {
  const [profile, setLocal] = useState(getProfile);
  const [open, setOpen] = useState(false);
  const [lastHold, setLastHold] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeProfile(setLocal), []);
  useEffect(() => {
    const onHold = (e) => { if (e.detail.holdSeconds) setLastHold(e.detail.holdSeconds); };
    window.addEventListener('dj-hold-change', onHold);
    return () => window.removeEventListener('dj-hold-change', onHold);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const bar = profile.loopEnd - profile.loopStart;
  return (
    <div className={`sound-tuner ${open ? 'open' : ''}`}>
      <button type="button" className="tuner-tab" onClick={(e) => { setOpen((o) => !o); blurSoon(e); }}>
        {open ? 'CLOSE TUNER' : 'SOUND TUNER'}
      </button>
      {open && (
        <div className="tuner-body">
          <div className="tuner-status">
            bar {bar.toFixed(3)}s · {(240 / bar).toFixed(1)} bpm
            {lastHold && <> · last hold {lastHold.toFixed(2)}s</>}
          </div>
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h4>{section.title}</h4>
              {section.hint && <p className="tuner-hint">{section.hint}</p>}
              {section.controls.map((c) => <Control key={c.key} c={c} value={profile[c.key]} />)}
            </section>
          ))}
          <div className="tuner-actions">
            <button type="button" onClick={(e) => { copy(); blurSoon(e); }}>{copied ? 'COPIED' : 'COPY SETTINGS'}</button>
            <button type="button" onClick={(e) => { resetProfile(); blurSoon(e); }}>RESET ALL</button>
          </div>
        </div>
      )}
    </div>
  );
}
