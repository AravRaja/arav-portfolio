// Fetches for the dancing crew, memoised so the prefetch (started when space is first held) and the crew itself share
// one download each. No three.js here: this module is small enough to live in the welcome page's chunk.
const cache = new Map();

function once(key, load) {
  if (!cache.has(key)) {
    const p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // a failed download can be retried
  }
  return cache.get(key);
}

const ok = (r) => {
  if (!r.ok) throw new Error(`${r.url}: HTTP ${r.status}`);
  return r;
};

// The exported trajectories (dance-rl export_web.py): header JSON + Float32 frames.
export function loadFinaleData(base = '/dance/finale') {
  return once(base, async () => {
    const [header, buf] = await Promise.all([
      fetch(`${base}.json`).then(ok).then((r) => r.json()),
      fetch(`${base}.bin`).then(ok).then((r) => r.arrayBuffer()),
    ]);
    return { header, frames: new Float32Array(buf) };
  });
}

// The travelling 8-counts for the roaming crew (export_web.py travel): same header + Float32 frames format.
export function loadTravelData() {
  return loadFinaleData('/dance/travel');
}

// Crew sync structure: sections, sync units, extra tracks.
export function loadCrewMeta() {
  return once('/dance/crew.json', () => fetch('/dance/crew.json').then(ok).then((r) => r.json()));
}
