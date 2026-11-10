// Who dances what, when: the crew's move schedule over the finale (public/dance/finale.json, 32 units = 8-counts).
// No new data and no training: every dancer plays a copy of the one trained trajectory, but each picks its OWN unit
// of it (any unit of the whole song, optionally mirrored left <-> right) and keeps going from there for a few 8-counts
// (m, m + 1, ...), then switches to another one at an 8-count boundary (crossfaded in motion.js). Seeded, planned
// once per stage visit (well under a millisecond), then just looked up per frame.
//
// Rules, per 8-count (except the unison payoffs):
//   - nobody shares a move as SEEN with anyone: no two dancers on the same (library move, mirrored-as-seen). This is
//     stricter than "same (unit, mirror)": units 2k / 2k + 1 of the finale are mostly one move and its mirror, so
//     (u0, plain) and (u1, mirrored) would look identical;
//   - at most two dancers on the same library move (then necessarily one plain and one mirrored), hence at most two on
//     the same unit;
//   - at most one dancer on a fused unit (legs of one move + arms of another: 4, 7, 22, 24);
//   - soft: avoid moves / sections someone else is already on (so neighbours rarely share a move and the crew mixes the
//     song's energy tiers), avoid repeating your own last move, avoid the finale's own unit (that's the "script").
// Unison payoffs (UNISON_UNITS): on these 8-counts everyone snaps to the finale's own unit, not mirrored (the lead's
// move), crossfading in and out; the 8-count after one, everyone picks afresh, so they split again at once.
// Fall-in: until the drop (8.37 s) everyone idles. From the drop itself every dancer is already easing out of its idle
// pose into its own move; dancer i is fully in at start[i] + FALL_IN_BLEND, with start[i] = drop + a random delay. On
// the page the crew only shows ~0.8 s after the drop (the zoom into the stage), so the delays are drawn within
// `fallInWindow` s (stageTiming.js), which has the last dancer fully in 0.25 s before the crew can first be seen: on the
// half-beat grid (0..FALL_IN_STEPS half-beats) when the window holds at least two half-beats, else on the 60 Hz frame
// grid. The variety at the first visible frame comes from the moves, mirrors and positions, which differ every visit.

// The two biggest section changes (public/dance/crew.json): the sections starting at unit 14 (68.13 s, with the 1-bar
// breakdown at 68.14 s) and unit 26 (119.13 s, its breakdown at 121.26 s). Edit this list to move / add payoffs; the
// roaming planner keeps its trips off them (CrewMotion.noTrip).
export const UNISON_UNITS = [14, 26];
export const FALL_IN_STEPS = 4; // start delay: at most 0..4 half-beats after the drop (0-2 beats), if the window allows
export const FALL_IN_MIN_SPREAD = 3; // half-beats: re-draw until the first and last are at least 1.5 beats apart
export const FALL_IN_BLEND = 0.35; // s, idle -> dance crossfade: from the drop until FALL_IN_BLEND after the start
const FALL_IN_FRAME = 1 / 60; // s, the delay grid when the window is too short for the half-beat one
const RUN = [2, 4]; // 8-counts a dancer stays on one run of the finale before it switches
const MAX_PER_MOVE = 2;
const MAX_FUSED = 1;

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A fresh seed per stage visit: the platform RNG mixed with the clock (0..999999, short enough to pin in a URL).
export function freshSeed() {
  let r = 0;
  try { r = crypto.getRandomValues(new Uint32Array(1))[0]; } catch { r = Math.floor(Math.random() * 4294967296); }
  r = (r ^ Math.imul(Date.now() & 0x7fffffff, 2654435761)) >>> 0;
  return r % 1000000;
}

// header: finale.json header (units, drop, beat, eight, grid_anchor, duration); sections: crew.json [start, end) pairs;
// fallInWindow: the longest fall-in delay after the drop, s (null: the full 0-2 beats).
// Returns { M: Int16Array, R: Uint8Array } (source unit + mirror per dancer per song unit u = -1 .. nu, row i * (nu + 2)
// + u + 1), start (fall-in time per dancer), info.
export function planSchedule({ header, sections, n, seed = 1, unison = UNISON_UNITS, fallInWindow = null }) {
  const units = header.units, nu = units.length;
  const rng = mulberry32(((seed >>> 0) * 2654435761) ^ 0x5eed5);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const W = nu + 2;
  const M = new Int16Array(n * W), R = new Uint8Array(n * W);
  const U = new Set(unison);

  // the pool: every unit whose data is complete (unit 31 runs past the end of the rollout), plain and mirrored
  let maxM = nu - 1;
  while (maxM > 0 && units[maxM].t1 > header.duration + 0.05) maxM--;
  const keys = [];
  const keyOf = units.map((x) => { const k = x.move.replace(/_M$/, ''); let j = keys.indexOf(k); if (j < 0) { j = keys.length; keys.push(k); } return j; });
  const seen = (m, mir) => ((!!units[m].mirrored) !== !!mir ? 1 : 0); // mirrored as seen on stage
  const fused = units.map((x) => !!x.fused);
  const secOf = new Int8Array(nu);
  (sections || [[0, nu]]).forEach(([a, b], s) => { for (let u = a; u < b && u < nu; u++) secOf[u] = s; });

  // fall-in delays: on the half-beat grid if the window holds 2+ half-beats, else on the frame grid; the earliest at the
  // drop itself, re-drawn until the first and last are a fair way apart (so it isn't one block in the lab)
  const half = header.beat / 2, win = fallInWindow == null ? FALL_IN_STEPS * half : Math.max(0, fallInWindow);
  const onBeat = win + 1e-9 >= 2 * half;
  const step = onBeat ? half : FALL_IN_FRAME;
  const maxK = onBeat ? Math.min(FALL_IN_STEPS, Math.floor(win / half + 1e-9)) : Math.floor(win / FALL_IN_FRAME + 1e-9);
  const minSpread = onBeat ? Math.min(FALL_IN_MIN_SPREAD, maxK) : Math.ceil(maxK / 2);
  let steps;
  do {
    steps = Array.from({ length: n }, () => ri(0, maxK));
    const lo = Math.min(...steps);
    steps = steps.map((k) => k - lo);
  } while (n > 2 && maxK > 0 && Math.max(...steps) < minSpread);
  const start = Float64Array.from(steps, (k) => header.drop + k * step);

  const cur = new Int16Array(n).fill(-1), mir = new Uint8Array(n), runLeft = new Int8Array(n), lastKey = new Int16Array(n).fill(-1);
  const seenUsed = new Uint8Array(keys.length * 2), keyCount = new Uint8Array(keys.length), secCount = new Uint8Array(sections ? sections.length : 1);
  let fusedCount = 0;
  const legal = (m, r) => !seenUsed[keyOf[m] * 2 + seen(m, r)] && keyCount[keyOf[m]] < MAX_PER_MOVE && !(fused[m] && fusedCount >= MAX_FUSED);
  const take = (i, m, r) => {
    cur[i] = m; mir[i] = r;
    seenUsed[keyOf[m] * 2 + seen(m, r)] = 1; keyCount[keyOf[m]]++; secCount[secOf[m]]++;
    if (fused[m]) fusedCount++;
  };
  const shuffled = () => {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let k = n - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
    return a;
  };
  let relaxed = 0;

  for (let u = 0; u < nu; u++) {
    if (U.has(u)) {
      for (let i = 0; i < n; i++) { cur[i] = u; mir[i] = 0; runLeft[i] = 0; lastKey[i] = keyOf[u]; M[i * W + u + 1] = u; R[i * W + u + 1] = 0; }
      continue;
    }
    seenUsed.fill(0); keyCount.fill(0); secCount.fill(0); fusedCount = 0;
    const order = shuffled();
    const pick = [];
    // dancers part-way through a run carry on (m + 1, same mirror) if that is still legal next to the others
    for (const i of order) {
      const m = cur[i] + 1;
      if (u > 0 && !U.has(u - 1) && runLeft[i] > 0 && m <= maxM && legal(m, mir[i])) { take(i, m, mir[i]); runLeft[i]--; } else pick.push(i);
    }
    // the rest start a new run somewhere else in the song
    for (const i of pick) {
      let best = -1, bestR = 0, bs = Infinity;
      for (let m = 0; m <= maxM; m++) {
        for (let r = 0; r < 2; r++) {
          if (!legal(m, r)) continue;
          const k = keyOf[m];
          const s = rng() + 3 * keyCount[k] + 0.8 * secCount[secOf[m]] + (k === lastKey[i] ? 4 : 0) + (m === u ? 0.6 : 0)
            + (m === maxM ? 0.5 : 0); // a run that can't continue
          if (s < bs) { bs = s; best = m; bestR = r; }
        }
      }
      if (best < 0) { // can't happen with 9 dancers and 13 moves; never leave anyone without a move
        relaxed++;
        best = ri(0, maxM); bestR = ri(0, 1);
      }
      take(i, best, bestR);
      runLeft[i] = ri(RUN[0], RUN[1]) - 1;
    }
    for (let i = 0; i < n; i++) { M[i * W + u + 1] = cur[i]; R[i * W + u + 1] = mir[i]; lastKey[i] = keyOf[cur[i]]; }
  }
  // u = -1 (drop -> first downbeat; on an off-beat release also up to a bar before the drop, see DanceStage) leads into
  // unit 0's run. Unit -1 of the finale is the standing before the drop, so a dancer starting on unit 0 plays unit 1
  // with its mirror flipped there instead (units 0 / 1 are one move and its mirror: the same move, an 8-count earlier),
  // crossfaded into unit 0 at the first downbeat like any switch. u = nu carries on past the end.
  for (let i = 0; i < n; i++) {
    M[i * W] = M[i * W + 1] - 1; R[i * W] = R[i * W + 1];
    if (M[i * W] < 0) { M[i * W] = 1; R[i * W] = 1 - R[i * W]; }
    M[i * W + nu + 1] = M[i * W + nu] + 1; R[i * W + nu + 1] = R[i * W + nu];
  }

  // self-check: duplicates as seen / per move / fused, per non-unison unit (all should be 0)
  const dup = { seen: 0, unitMirror: 0, perUnit: 0, perMove: 0, fused: 0 };
  let switches = 0;
  for (let u = 0; u < nu; u++) {
    if (U.has(u)) continue;
    const sSet = new Set(), umSet = new Set(), uC = new Map(), kC = new Map();
    let f = 0;
    for (let i = 0; i < n; i++) {
      const m = M[i * W + u + 1], r = R[i * W + u + 1];
      const sk = keyOf[m] * 2 + seen(m, r);
      if (sSet.has(sk)) dup.seen++; sSet.add(sk);
      if (umSet.has(m * 2 + r)) dup.unitMirror++; umSet.add(m * 2 + r);
      uC.set(m, (uC.get(m) || 0) + 1); kC.set(keyOf[m], (kC.get(keyOf[m]) || 0) + 1);
      if (fused[m]) f++;
      if (u > 0 && !(M[i * W + u] === m - 1 && R[i * W + u] === r)) switches++;
    }
    for (const c of uC.values()) if (c > 2) dup.perUnit++;
    for (const c of kC.values()) if (c > MAX_PER_MOVE) dup.perMove++;
    if (f > MAX_FUSED) dup.fused++;
  }
  const info = {
    seed, unison: [...U], start: [...start].map((t) => +t.toFixed(4)), fallInGrid: onBeat ? 'half-beat' : 'frame',
    fallInStep: +step.toFixed(5), fallInSteps: steps, fallInWindow: +win.toFixed(4),
    spreadS: +(Math.max(...start) - Math.min(...start)).toFixed(4), pool: (maxM + 1) * 2, moves: keys.length, dup, relaxed, switches,
  };
  return { M, R, W, start, info };
}
