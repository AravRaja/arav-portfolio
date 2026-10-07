// Tunable sound + build-up settings for the welcome-page music. Edited live from the
// tuning panel (dev or ?tune); copy the JSON from there into DEFAULT_PROFILE to ship it.
export const DEFAULT_PROFILE = {
  // Song points (seconds in now-get-busy.mp3)
  loopStart: 1.235,
  loopEnd: 3.36, // one bar
  dropHit: 8.37, // where the beat drops in; the hold completes straight into this

  // Filter: muffled while looping, opens as space is held
  muffledHz: 400,
  openHz: 20000,
  muffledQ: 1,
  openQ: 1,
  rolloff: -24,

  // Volume
  introGain: 0.8, // while looping
  buildLevel: 1, // volume reached when the bar is full (the intro sits at introGain)
  songLevel: 1, // volume after the drop

  // Build-up (holding space)
  holdSpeed: 1, // 1 = deck animation's natural pace (~3s for a full hold)
  buildCurve: 1.6, // build-up shape: 1 = even, >1 = gradual then bigger toward the end
  buildQ: 7, // filter resonance reached at the end of the build (the sweep's whistle)
  beatSync: true, // stretch the hold so it completes in time with the drop hit
  speedUpLimit: 1, // the hold may only speed up to this × its natural pace (1 = only ever slow down)
  syncLead: 0.06, // complete this many seconds before the hit point (absorbs frame lag)
  dropOn: 'bar', // on let go, the drop hit waits for the loop's next 'bar' (or 'beat')
  beatsPerBar: 4,
  stageZoomIn: 0.7, // seconds for the zoom into the blue music stage on let go (page buttons use 0.7)
  snapSeconds: 0.06, // filter snaps fully open this fast on completion

  // Letting go early
  releaseSeconds: 2.5,
  releaseCurve: 1,

  // Pressing space again after the drop: the bar drains and the song fades out where it is, in step.
  // Holding space again before it's silent brings the song back; once silent, the loop returns.
  drainSpeed: 1, // 1 = deck's natural wind-down (~2.9s from full)
  fadeTail: 0, // extra seconds of fade after the bar is empty (0 = silent exactly when it empties)
  fadeCurve: 1,
  loopFadeIn: 1, // seconds for the intro loop to come back up to its volume
};

const STORAGE_KEY = 'dj-sound-profile';
const listeners = new Set();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const known = Object.fromEntries(Object.entries(saved).filter(([k]) => k in DEFAULT_PROFILE));
      return { ...DEFAULT_PROFILE, ...known };
    }
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_PROFILE };
}

let profile = load();

export const getProfile = () => profile;

// Keep typed-in values from breaking the audio graph (log ramps need > 0, loops need length).
function sanitize(p) {
  return {
    ...p,
    muffledHz: Math.max(20, p.muffledHz),
    openHz: Math.max(20, p.openHz),
    muffledQ: Math.max(0.0001, p.muffledQ),
    openQ: Math.max(0.0001, p.openQ),
    holdSpeed: Math.max(0.05, p.holdSpeed),
    buildCurve: Math.max(0.05, p.buildCurve),
    buildQ: Math.max(0.0001, p.buildQ),
    fadeCurve: Math.max(0.05, p.fadeCurve),
    fadeTail: Math.max(0, p.fadeTail),
    drainSpeed: Math.max(0.05, p.drainSpeed),
    releaseCurve: Math.max(0.05, p.releaseCurve),
    beatsPerBar: Math.max(1, Math.round(p.beatsPerBar)),
    stageZoomIn: Math.max(0.05, p.stageZoomIn),
    loopStart: Math.max(0, p.loopStart),
    loopEnd: Math.max(p.loopEnd, Math.max(0, p.loopStart) + 0.1),
    speedUpLimit: Math.max(0.05, p.speedUpLimit),
  };
}

export function setProfile(patch) {
  profile = sanitize({ ...profile, ...patch });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ }
  listeners.forEach((fn) => fn(profile, patch));
}

export function resetProfile() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  setProfile({ ...DEFAULT_PROFILE });
}

export function subscribeProfile(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
