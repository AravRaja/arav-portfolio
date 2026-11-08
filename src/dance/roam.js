// Roaming choreography for the crew: over the song every dancer makes a few trips to other parts of the stage, so
// the formation keeps reshuffling instead of standing on a grid. Deterministic (seeded) from the crew's sync
// structure, planned once per layout / orientation (~50 ms, cached), then just looked up per frame by CrewMotion.
//
// A trip fills one whole 8-count that is NOT a unison unit (sync units, i.e. the drop and every section's first
// 8-count, keep everyone doing the lead's moves, wherever they stand). The dancer plays a travelling 8-count from the
// move library (travel.json) instead of its finale copy: the clip is re-rooted where the dancer stands and turned to its
// current heading (so the trip starts without a pop), plus an aim turn eased in over the first two beats
// (|delta| <= 45 deg) and a path scale (0.87-1.15) so it lands in a free spot; over the last two beats it turns to face
// the camera +-35 deg (|eps| <= 45 deg). Then it carries on with its finale copy from the new spot. One trip per dancer
// is only a turn in place (25-45 deg) instead. Rules (checked on the actual sampled root paths, 10 Hz, including the
// finale's own in-place wander, from the trip to the end of the song):
//   - at most 3 trips (walks or turns) in one 8-count, none for a dancer in two 8-counts in a row;
//   - no two dancers' roots closer than MIN_GAP at any time (the others as already planned);
//   - every root stays inside the slots' convex hull + a margin within the camera fit's dance box, so the framing,
//     which is fit to the slots, never changes;
//   - a landing is >= FREE from everyone, in another area of a floor plan (the slots + up to 6 gap spots), and not
//     more than about half hidden behind / in front of anyone on screen (nobody stands right in line with it later);
//   - the lead (dancer 0) drifts less: 2 walks + 1 turn, every landing within LEAD_RADIUS of its slot, and nobody
//     parks right in front of it.
// Units: the plan works in stage metres (three.js x / z); a dancer's transforms are stored in its own slot frame
// (MuJoCo x forward / y left, in rig units, i.e. stage metres / its scale K).

const MIN_GAP = 0.7;
const DT = 0.1;
const MAX_DELTA = (45 * Math.PI) / 180;
const MAX_EPS = (45 * Math.PI) / 180;
const MAX_FACE = (35 * Math.PI) / 180;
const SIGMA = [0.87, 1.15];
const JITTER = 0.3; // landings within this of a floor-plan spot score best
const FREE = 1.0; // a landing needs this much room to everyone else's spot
const MATCH_W = 2; // per radian (rms) of leg-pose mismatch at the trip's start + end
const OCCLUDE_X = 0.6; // stage x closer than this: the two overlap on screen
const HIDE_X = 0.32; // landing: + up to 0.2 m more when the two are close in depth
const ECLIPSE_X = 0.25; // later on (the in-place wander moves them): only near-total eclipses are ruled out
const MAX_PER_UNIT = 3;
const MAX_V_START = 0.7, MAX_V_END = 0.6; // m/s: a clip must start and settle at walking pace
const LEAD_RADIUS = 1.1;
const REC = 14; // [kind, ox, oy, phi, clip | dphi, Sx, Sy, th0, delta, eps, sigma, ox', oy', phi']

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const TURN_IN = 2 * 0.53125, TURN_OUT = 2 * 0.53125; // same as motion.js
const heading = (q) => Math.atan2(2 * (q[4] * q[5] + q[3] * q[6]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- floor geometry
function convexHull(pts) {
  const p = pts.map((v) => [v[0], v[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const v of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
  for (let i = p.length - 1; i >= 0; i--) { const v = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], v) <= 0) up.pop(); up.push(v); }
  return lo.slice(0, -1).concat(up.slice(0, -1)); // counter-clockwise in (x, z)
}
// signed distance to a convex polygon: < 0 inside
function hullDist(H, x, z) {
  let inside = true, best = Infinity;
  for (let i = 0; i < H.length; i++) {
    const [ax, az] = H[i], [bx, bz] = H[(i + 1) % H.length];
    const ex = bx - ax, ez = bz - az;
    if (ex * (z - az) - ez * (x - ax) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - t * ex, z - az - t * ez));
  }
  return inside ? -best : best;
}

// ---------- the plan
export class RoamPlan {
  constructor(n, nu, travel) {
    this.n = n; this.nu = nu; this.travel = travel;
    this.recs = new Float64Array(n * (nu + 1) * REC); // unit nu = the home after the song (held past the end)
    this.trips = [];
  }
  _r(i, u) { return (i * (this.nu + 1) + (u < 0 ? 0 : u > this.nu ? this.nu : u)) * REC; }
  kind(i, u) { return this.recs[this._r(i, u)]; }
  // offset of (i, u)'s record in recs
  off(i, u) { return this._r(i, u); }
}

// motion: CrewMotion (its _base gives the un-roamed finale copy); travel: TravelLib;
// slots: [[x, z, yawDeg, s], ...] (stage); K: per-dancer stage metres per rig unit; travelK: the layout's `travel`.
export function planRoam(motion, travel, { slots, K, travelK = 1, seed = 1, lead = 0, elevation = 13 } = {}) {
  // dancers this much apart in depth no longer hide each other (the camera looks down `elevation` deg)
  const occZ = Math.min(4, 1 / Math.tan((elevation * Math.PI) / 180));
  // stage-x gap below which a dancer at depth gap dz hides more than about half of the other (wider when level)
  const hideX = (dz) => (dz >= occZ ? 0 : HIDE_X + 0.2 * Math.max(0, 1 - dz / 2));
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const n = slots.length, nu = motion.nu, E = motion.eight, A = motion.anchor;
  const dur = motion.rigs[0].header.duration;
  const rng = mulberry32((seed * 2654435761) ^ (n * 97) ^ Math.round(slots[0][0] * 1000));
  const plan = new RoamPlan(n, nu, travel);
  const psi = slots.map((s) => (s[2] * Math.PI) / 180);

  // slot frame (MuJoCo a = forward, b = the dancer's left; three.js x = b, z = a, before the slot yaw) -> stage
  const KC = psi.map((p, i) => K[i] * Math.cos(p)), KS = psi.map((p, i) => K[i] * Math.sin(p));
  const SX = slots.map((s) => s[0]), SZ = slots.map((s) => s[1]);
  const toX = (i, a, b) => SX[i] + b * KC[i] + a * KS[i];
  const toZ = (i, a, b) => SZ[i] - b * KS[i] + a * KC[i];

  // the un-roamed finale copies: root xy per dancer, 10 Hz over the song
  const nK = Math.floor((dur - A) / DT) + 1;
  const Dx = [], Dy = [];
  for (let i = 0; i < n; i++) {
    const x = new Float32Array(nK), y = new Float32Array(nK);
    for (let k = 0; k < nK; k++) { const q = motion._base(i, A + k * DT, travelK); x[k] = q[0]; y[k] = q[1]; }
    Dx.push(x); Dy.push(y);
  }
  // root xy + heading + leg hinges (qpos 10..21) of the un-roamed copy at t
  const Dat = (i, t) => { const q = motion._base(i, t, travelK); return [q[0], q[1], heading(q), q.slice(10, 22)]; };
  // leg pose of every clip's first / last frame: trips whose stance matches the finale's there blend with less sliding
  const legs0 = [], legs1 = [];
  { const q = new Float64Array(28); travel.clips.forEach((_, ci) => { legs0.push(travel.sample(ci, 0, q).slice(10, 22)); legs1.push(travel.sample(ci, E, q).slice(10, 22)); }); }
  const legDist = (a, b) => { let s = 0; for (let k = 0; k < 12; k++) s += (a[k] - b[k]) ** 2; return Math.sqrt(s / 12); };

  // floor plan: the slots + up to 6 extra spots in the biggest gaps (>= 0.9 m from any other); frame = the slots' hull
  const P = slots.map((s) => [s[0], s[1]]);
  const hull = convexHull(P.length >= 3 ? P : [...P, [P[0][0], P[0][1] + 0.6]]);
  let H = hull;
  let area = 0;
  for (let i = 0; i < H.length; i++) { const [ax, az] = H[i], [bx, bz] = H[(i + 1) % H.length]; area += ax * bz - bx * az; }
  if (Math.abs(area) / 2 < 1.0) H = convexHull(P.flatMap(([x, z]) => [[x, z - 0.5], [x, z + 0.5]])); // a line: give it some depth
  // fast frame test for the timelines: max signed distance to the hull's edge lines (a mitred offset of the hull)
  const HE = H.map(([ax, az], k) => {
    const [bx, bz] = H[(k + 1) % H.length];
    const l = Math.hypot(bx - ax, bz - az);
    const nx = (bz - az) / l, nz = -(bx - ax) / l; // outward normal (hull is counter-clockwise in x, z)
    return [nx, nz, -(nx * ax + nz * az)];
  });
  const lineDist = (x, z) => { let m = -Infinity; for (const [nx, nz, c] of HE) { const d = nx * x + nz * z + c; if (d > m) m = d; } return m; };
  // a landing may sit a touch outside the hull (its corners are slots), inside the camera's wander margin
  const homeMargin = Math.min(0.1, 0.15 * travelK), pathMargin = 0.3 * travelK + 0.15;
  const spots = P.map((p) => p.slice());
  const span0 = Math.max(...P.map((p) => p[0])) - Math.min(...P.map((p) => p[0]));
  const cx0 = P.reduce((a, p) => a + p[0], 0) / P.length;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of H) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const grid = [];
  for (let x = x0; x <= x1; x += 0.2) for (let z = z0; z <= z1; z += 0.2) if (hullDist(H, x, z) < -0.25) grid.push([x, z]);
  for (let e = 0; e < 6 && grid.length; e++) {
    let best = null, bd = -1;
    for (const g of grid) {
      let d = Infinity;
      for (const s of spots) d = Math.min(d, Math.hypot(g[0] - s[0], g[1] - s[1]));
      if (d > bd) { bd = d; best = g; }
    }
    if (bd < 0.9) break;
    spots.push(best.slice());
  }

  // state per dancer: current home (slot frame) and the timeline of stage positions it is committed to
  const home = slots.map(() => ({ ox: 0, oy: 0, phi: 0 }));
  const PX = [], PZ = [];
  let RX = 0, RZ = 0; // rootAt's result
  let cPhi = NaN, cC = 1, cS = 0;
  const rootAt = (i, h, k) => {
    if (h.phi !== cPhi) { cPhi = h.phi; cC = Math.cos(cPhi); cS = Math.sin(cPhi); }
    const c = cC, s = cS;
    const a = h.ox + c * Dx[i][k] - s * Dy[i][k], b = h.oy + s * Dx[i][k] + c * Dy[i][k];
    RX = toX(i, a, b); RZ = toZ(i, a, b);
  };
  for (let i = 0; i < n; i++) {
    const x = new Float32Array(nK), z = new Float32Array(nK);
    for (let k = 0; k < nK; k++) { rootAt(i, home[i], k); x[k] = RX; z[k] = RZ; }
    PX.push(x); PZ.push(z);
  }
  const anchorOf = (i, h) => [toX(i, h.ox, h.oy), toZ(i, h.ox, h.oy)];
  const fill = (i, u0, u1, kind, h) => {
    for (let u = u0; u < u1; u++) {
      const o = plan._r(i, u);
      plan.recs[o] = kind; plan.recs[o + 1] = h.ox; plan.recs[o + 2] = h.oy; plan.recs[o + 3] = h.phi;
    }
  };
  const baseline = (() => { // closest approach of the un-roamed layout (for the report)
    let m = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = 0; k < nK; k += 2) m = Math.min(m, Math.hypot(PX[i][k] - PX[j][k], PZ[i][k] - PZ[j][k]));
    return m;
  })();

  // check a candidate timeline for dancer i from sample k0 on: gaps to everyone else + inside the frame
  // (pathMargin: the camera's dance box around every slot covers arms + the in-place wander)
  // and, once it has landed, nobody stands right in front of / behind it (checked every second, wander included)
  const ok = (i, x, z, k0, kTripEnd) => {
    for (let k = k0; k < nK; k++) {
      if (lineDist(x[k], z[k]) > pathMargin) { dbg.frame++; return false; }
      if (k > kTripEnd && (k - kTripEnd) % 10 === 0) {
        for (let j = 0; j < n; j++) if (j !== i && Math.abs(x[k] - PX[j][k]) < ECLIPSE_X && Math.abs(z[k] - PZ[j][k]) < occZ) { dbg.hidden++; return false; }
      }
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = x[k] - PX[j][k], dz = z[k] - PZ[j][k];
        if (dx * dx + dz * dz < MIN_GAP * MIN_GAP) { dbg[k <= kTripEnd ? 'gapTrip' : 'gapAfter']++; return false; }
      }
    }
    return true;
  };
  const dbg = { tries: 0, noCand: 0, frame: 0, gapTrip: 0, gapAfter: 0, hidden: 0, cands: 0 }; // why candidates were rejected
  const kOf = (t) => Math.max(0, Math.min(nK - 1, Math.round((t - A) / DT)));

  // candidate timelines (scratch)
  const cx = new Float32Array(nK), cz = new Float32Array(nK), qs = new Float64Array(28);

  const syncs = motion.syncUnits;
  const units = [];
  for (let u = 0; u < nu; u++) if (!syncs.has(u) && A + (u + 1) * E <= dur + 0.05) units.push(u);
  // trips per dancer: the lead 3, the others 4-5; one of every four is a turn in place (never the first trip)
  const quota = slots.map((_, i) => (i === lead ? 3 : 4 + (rng() < 0.4 ? 1 : 0)));
  const turnAt = quota.map((q) => 1 + Math.floor(rng() * (q - 1)));
  const done = slots.map(() => 0), last = slots.map(() => -9);
  const visited = slots.map((_, i) => new Set([i]));
  const nearestSpot = (X, Z) => { let b = 0, bd = Infinity; spots.forEach((s, j) => { const d = Math.hypot(s[0] - X, s[1] - Z); if (d < bd) { bd = d; b = j; } }); return b; };

  const tryTurn = (i, u) => {
    const tb = A + u * E;
    const h = home[i];
    const face = psi[i] + h.phi;
    const mag = ((25 + 20 * rng()) * Math.PI) / 180;
    const opts = rng() < 0.5 ? [mag, -mag] : [-mag, mag];
    for (const d of opts) {
      if (Math.abs(wrap(face + d)) > MAX_FACE) continue;
      const h2 = { ox: h.ox, oy: h.oy, phi: h.phi + d };
      const k0 = kOf(tb);
      cx.set(PX[i]); cz.set(PZ[i]);
      const hh = { ox: h.ox, oy: h.oy, phi: 0 };
      for (let k = k0; k < nK; k++) {
        const tt = A + k * DT;
        hh.phi = tt < tb + E ? h.phi + d * smooth((tt - tb) / E) : h2.phi;
        rootAt(i, hh, k); cx[k] = RX; cz[k] = RZ;
      }
      if (!ok(i, cx, cz, k0, k0)) continue;
      PX[i].set(cx); PZ[i].set(cz);
      const o = plan._r(i, u);
      plan.recs[o] = 2; plan.recs[o + 1] = h.ox; plan.recs[o + 2] = h.oy; plan.recs[o + 3] = h.phi; plan.recs[o + 4] = d;
      plan.recs[o + 11] = h2.ox; plan.recs[o + 12] = h2.oy; plan.recs[o + 13] = h2.phi;
      home[i] = h2;
      plan.trips.push({ i, u, t: +tb.toFixed(2), kind: 'turn', turnDeg: Math.round((d * 180) / Math.PI), faceDeg: Math.round((wrap(face + d) * 180) / Math.PI) });
      return true;
    }
    return false;
  };

  const tryTravel = (i, u) => {
    const tb = A + u * E;
    const h = home[i];
    const [dx0, dy0, dh0, lg0] = Dat(i, tb);
    const c0 = Math.cos(h.phi), s0 = Math.sin(h.phi);
    const Sx = h.ox + c0 * dx0 - s0 * dy0, Sy = h.oy + s0 * dx0 + c0 * dy0;
    const th0 = h.phi + dh0;
    const [dx1, dy1, dh1, lg1] = Dat(i, tb + E);
    const match = travel.clips.map((_, ci) => legDist(lg0, legs0[ci]) + legDist(lg1, legs1[ci]));
    const Xs = toX(i, Sx, Sy), Zs = toZ(i, Sx, Sy);
    const siHere = nearestSpot(...anchorOf(i, h));
    // occupied: everyone else's current anchor (their committed position at the end of this 8-count)
    const kEnd = kOf(tb + E);
    const others = [];
    for (let j = 0; j < n; j++) if (j !== i) others.push([j, PX[j][kEnd], PZ[j][kEnd]]);
    let sx0 = Infinity, sx1 = -Infinity;
    let sxSum = 0;
    for (const [, X] of others) { sx0 = Math.min(sx0, X); sx1 = Math.max(sx1, X); sxSum += X; }
    const cands = [];
    // landings the clips can reach from here: aim turn delta, length scale sigma
    travel.clips.forEach((cl, ci) => {
      if (cl.v_end > MAX_V_END || cl.v_start > MAX_V_START) return; // would lurch into / out of the dance
      for (let dd = -MAX_DELTA; dd <= MAX_DELTA + 1e-6; dd += MAX_DELTA / 3) {
        const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, dd + (rng() - 0.5) * (MAX_DELTA / 3)));
        const th = th0 + delta + cl.dir;
        for (let ks = 0; ks < 3; ks++) {
          const sigma = Math.max(SIGMA[0], Math.min(SIGMA[1], 0.9 + 0.1 * ks + (rng() - 0.5) * 0.1));
          const ga = Sx + sigma * cl.disp_m * Math.cos(th), gb = Sy + sigma * cl.disp_m * Math.sin(th);
          const GX = toX(i, ga, gb), GZ = toZ(i, ga, gb);
          if (lineDist(GX, GZ) > homeMargin) continue;
          if (i === lead && Math.hypot(GX - slots[lead][0], GZ - slots[lead][1]) > LEAD_RADIUS) continue;
          let near = Infinity;
          for (const [, X, Z] of others) near = Math.min(near, Math.hypot(X - GX, Z - GZ));
          if (near < FREE) continue;
          const si = nearestSpot(GX, GZ);
          if (si === siHere) continue; // a trip goes to another area of the floor
          const ds = Math.hypot(spots[si][0] - GX, spots[si][1] - GZ);
          // facing after the trip: the heading at the end of the clip, minus the finale copy's own heading then
          const raw = wrap(psi[i] + th0 + delta + cl.yawEnd - dh1);
          const want = Math.max(-0.3, Math.min(0.3, -0.07 * GX)) + (rng() - 0.5) * 0.3; // a little towards the centre
          const eps = Math.max(-MAX_EPS, Math.min(MAX_EPS, wrap(want - raw)));
          if (Math.abs(wrap(raw + eps)) > MAX_FACE) continue;
          // overlap on screen: the camera looks along -z, so dancers with close x hide each other unless far apart in depth
          let occl = 0, hidden = false;
          for (const [j, X, Z] of others) {
            const ddx = Math.abs(X - GX);
            if (ddx < hideX(Math.abs(Z - GZ))) hidden = true; // more than about half hidden: never park there
            if (ddx < OCCLUDE_X && Math.abs(Z - GZ) < occZ) occl += (1 - ddx / OCCLUDE_X) * (1 - Math.abs(Z - GZ) / occZ);
            if (j === lead && GZ > Z && ddx < 1.0) occl += 2;
          }
          if (hidden) continue;
          const score = Math.abs(delta) / MAX_DELTA + 1.5 * Math.abs(sigma - 1) / 0.15 + 0.5 * Math.abs(eps) / MAX_EPS
            + 2.5 * occl + (visited[i].has(si) ? 3 : 0) + 3 * Math.max(0, ds - JITTER) + 1.2 * Math.max(0, 1.5 - near)
            + 0.8 * Math.max(0, span0 - Math.max(sx1, GX) + Math.min(sx0, GX)) // keep the crew as wide as the layout
            + 1.5 * Math.abs((sxSum + GX) / n - cx0) // and centred where it was
            + MATCH_W * match[ci] + 0.6 * rng();
          cands.push({ si, GX, GZ, ci, delta, sigma, eps, score });
        }
      }
    });
    cands.sort((a, b) => a.score - b.score);
    dbg.tries++; dbg.cands += cands.length; if (!cands.length) dbg.noCand++;
    const k0 = kOf(tb);
    const q = qs;
    for (let c = 0; c < Math.min(cands.length, 30); c++) {
      const cd = cands[c];
      const cl = travel.clips[cd.ci];
      // end home: continuous with the clip's last frame
      travel.sample(cd.ci, E, q);
      const thE = th0 + cd.delta;
      const ce = Math.cos(thE), se = Math.sin(thE);
      const Ex = Sx + cd.sigma * (ce * q[0] - se * q[1]), Ey = Sy + cd.sigma * (se * q[0] + ce * q[1]);
      const phi2 = wrap(thE + cd.eps + heading(q) - dh1);
      const c2 = Math.cos(phi2), s2 = Math.sin(phi2);
      const h2 = { ox: Ex - (c2 * dx1 - s2 * dy1), oy: Ey - (s2 * dx1 + c2 * dy1), phi: phi2 };
      cx.set(PX[i]); cz.set(PZ[i]);
      for (let k = k0; k < nK; k++) {
        const tt = A + k * DT;
        let X, Z;
        if (tt <= tb + E) {
          const tau = Math.max(0, tt - tb);
          travel.sample(cd.ci, tau, q);
          const th = th0 + cd.delta * smooth(tau / TURN_IN);
          const c = Math.cos(th), s = Math.sin(th);
          const a = Sx + cd.sigma * (c * q[0] - s * q[1]), b = Sy + cd.sigma * (s * q[0] + c * q[1]);
          X = toX(i, a, b); Z = toZ(i, a, b);
        } else { rootAt(i, h2, k); X = RX; Z = RZ; }
        cx[k] = X; cz[k] = Z;
      }
      if (!ok(i, cx, cz, k0, kEnd)) continue;
      PX[i].set(cx); PZ[i].set(cz);
      const o = plan._r(i, u);
      const R = plan.recs;
      R[o] = 1; R[o + 1] = h.ox; R[o + 2] = h.oy; R[o + 3] = h.phi; R[o + 4] = cd.ci;
      R[o + 5] = Sx; R[o + 6] = Sy; R[o + 7] = th0; R[o + 8] = cd.delta; R[o + 9] = cd.eps; R[o + 10] = cd.sigma;
      R[o + 11] = h2.ox; R[o + 12] = h2.oy; R[o + 13] = h2.phi;
      home[i] = h2;
      visited[i].add(cd.si);
      const [AX, AZ] = anchorOf(i, h2);
      plan.trips.push({
        i, u, t: +tb.toFixed(2), kind: 'travel', clip: cl.id, from: [+Xs.toFixed(2), +Zs.toFixed(2)], to: [+AX.toFixed(2), +AZ.toFixed(2)],
        spot: cd.si, distM: +Math.hypot(AX - Xs, AZ - Zs).toFixed(2), sigma: +cd.sigma.toFixed(3),
        deltaDeg: Math.round((cd.delta * 180) / Math.PI), epsDeg: Math.round((cd.eps * 180) / Math.PI),
        faceDeg: Math.round((wrap(psi[i] + phi2) * 180) / Math.PI), legMismatch: +match[cd.ci].toFixed(2),
      });
      return true;
    }
    return false;
  };

  units.forEach((u, ui) => {
    const left = units.length - ui;
    const need = slots.map((_, i) => (quota[i] - done[i]) / left);
    const expect = need.reduce((a, b) => a + b, 0);
    let k = Math.floor(expect + rng());
    k = Math.max(expect > 0.4 ? 1 : 0, Math.min(MAX_PER_UNIT, k));
    const order = slots.map((_, i) => i).filter((i) => done[i] < quota[i] && last[i] < u - 1)
      .map((i) => [i, need[i] + 0.25 * rng()]).sort((a, b) => b[1] - a[1]).map(([i]) => i);
    let moved = 0;
    for (const i of order) {
      if (moved >= k) break;
      const wantTurn = done[i] === turnAt[i];
      let went = wantTurn ? tryTurn(i, u) : tryTravel(i, u);
      if (!went && wantTurn) went = tryTravel(i, u);
      if (went) { done[i]++; last[i] = u; moved++; }
    }
  });

  // fill the home records between trips
  for (let i = 0; i < n; i++) {
    let h = { ox: 0, oy: 0, phi: 0 };
    for (let u = 0; u <= nu; u++) {
      const o = plan._r(i, u);
      if (plan.recs[o] === 0) fill(i, u, u + 1, 0, h);
      else h = { ox: plan.recs[o + 11], oy: plan.recs[o + 12], phi: plan.recs[o + 13] };
    }
  }

  // report: closest approach + frame margin over the final timelines, areas visited
  let minGap = Infinity, worstFrame = -Infinity;
  for (let k = 0; k < nK; k++) {
    for (let i = 0; i < n; i++) {
      worstFrame = Math.max(worstFrame, lineDist(PX[i][k], PZ[i][k]));
      for (let j = i + 1; j < n; j++) minGap = Math.min(minGap, Math.hypot(PX[i][k] - PX[j][k], PZ[i][k] - PZ[j][k]));
    }
  }
  // areas: the floor-plan spots a dancer dances at (its start + every landing)
  const areas = slots.map((_, i) => new Set([i, ...plan.trips.filter((t) => t.i === i && t.kind === 'travel').map((t) => nearestSpot(t.to[0], t.to[1]))]).size);
  plan.info = {
    seed, K: K.map((k) => +k.toFixed(4)), ms: +((typeof performance !== 'undefined' ? performance.now() : 0) - t0).toFixed(1), spots: spots.map((s) => s.map((v) => +v.toFixed(2))),
    hull: H.map((s) => s.map((v) => +v.toFixed(2))), minGap: +minGap.toFixed(3), baselineGap: +baseline.toFixed(3),
    worstFrame: +worstFrame.toFixed(3), pathMargin, areas, done, quota, rejects: dbg, trips: plan.trips.length,
    travels: plan.trips.filter((t) => t.kind === 'travel').length, turns: plan.trips.filter((t) => t.kind === 'turn').length,
  };
  plan.timeline = { PX, PZ, dt: DT, t0: A };
  return plan;
}

// Plans are cached per motion (WeakMap) and per layout / orientation / seed, so the page can plan in idle time before
// the drop (stageKit.js) and a remount or a rotate back costs nothing.
const cache = new WeakMap();
export function cachedRoamPlan(motion, travel, key, opts) {
  let m = cache.get(motion);
  if (!m) { m = new Map(); cache.set(motion, m); }
  if (!m.has(key)) m.set(key, planRoam(motion, travel, opts));
  return m.get(key);
}
