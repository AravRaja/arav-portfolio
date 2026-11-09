// Crew motion without new training: every dancer plays the exported full-song trajectory (public/dance/finale), but
// from its own unit of it, picked by the seeded schedule (schedule.js): any 8-count of the whole song, optionally
// mirrored left <-> right, carried on for a few 8-counts and then swapped for another, so no two dancers share a move
// and the crew never looks scripted. On the unison payoffs (schedule.js UNISON_UNITS) everyone snaps to the finale's
// own unit, not mirrored. Changes of (unit, mirror) at an 8-count boundary are crossfaded over +-BLEND s (hinge angles
// lerp, root slerp), so nobody pops. Before the drop everyone idles; each dancer falls in at its own time just after
// it (fallIn, crossfaded from the idle pose by Crew.jsx).
// On top of that, a roaming plan (roam.js, set with setRoam) moves / turns each dancer's copy to its current spot on
// the floor and swaps in a travelling 8-count from travel.json (TravelLib) for its trips.
// Per frame nothing is allocated: the schedule is two typed arrays and every scratch buffer is preallocated.
import { Quaternion } from 'three';
import { FALL_IN_BLEND, UNISON_UNITS, planSchedule } from './schedule.js';

const BLEND = 0.2;
// a trip swaps the whole pose (other feet, other stance), so it blends in / out a bit slower than the finale switches
const TRIP_BLEND = 0.35;

// mirror map (dance_rl/mirror.py): left <-> right, shoulder1 / shoulder2 / ankle_x and abdomen_z / _x negated
export function mirrorMap(jointNames) {
  const perm = jointNames.map((n, i) => (n.startsWith('left_') ? jointNames.indexOf(`right_${n.slice(5)}`)
    : n.startsWith('right_') ? jointNames.indexOf(`left_${n.slice(6)}`) : i));
  const sign = jointNames.map((n) => (['abdomen_z', 'abdomen_x'].includes(n) || /_(shoulder1|shoulder2|ankle_x)$/.test(n) ? -1 : 1));
  return { perm, sign };
}

export class CrewMotion {
  // rigs: Rig per track (rigs[0] = finale, also the poser; the schedule only uses the finale); meta: crew.json;
  // seed: the stage visit's seed (schedule + fall-in); n: dancers; unison: the payoff units.
  constructor(rigs, meta, { seed = 1, n = 9, unison = UNISON_UNITS } = {}) {
    this.rigs = rigs;
    const h = rigs[0].header;
    this.anchor = h.grid_anchor;
    this.eight = h.eight;
    this.nu = h.units.length;
    this.drop = h.drop;
    this.mm = mirrorMap(h.joint_names);
    this.n = n;
    this.seed = seed;
    this.unison = new Set(unison.filter((u) => u >= 0 && u < this.nu));
    this.syncUnits = this.unison; // (old name)
    // the roaming planner keeps its trips off the fall-in (unit 0) and off the payoffs; a trip's blend reaches 0.35 s
    // past its own 8-count, so the 8-counts either side of a payoff are kept clear too
    this.noTrip = new Set([0]);
    for (const u of this.unison) for (let d = -1; d <= 1; d++) this.noTrip.add(u + d);
    this.sched = planSchedule({ header: h, sections: meta.sections, n, seed, unison: [...this.unison] });
    const { M, R, W, start } = this.sched;
    this.M = M; this.R = R; this.W = W;
    // fall-in crossfade window per dancer: [fa, fb] (never before the drop)
    this.fa = Float64Array.from(start, (s) => Math.max(this.drop, s - FALL_IN_BLEND));
    this.fb = Float64Array.from(start, (s) => s + FALL_IN_BLEND);
    this.a = new Float64Array(28); this.b = new Float64Array(28); this.tmp = new Float64Array(28);
    this.q = new Float64Array(28);
    this.ra = new Float64Array(28); this.rb = new Float64Array(28);
    this.roam = null;
    this._qa = new Quaternion(); this._qb = new Quaternion();
    this._mv = { id: '', mirror: false, trip: false };
  }

  isSync(u) { return this.unison.has(u); }

  // source unit of the finale that dancer i plays in song unit u (rows cover u = -1 .. nu; beyond, it carries on)
  src(i, u) {
    const c = u < -1 ? -1 : u > this.nu ? this.nu : u;
    return this.M[i * this.W + c + 1] + (u - c);
  }
  mir(i, u) {
    const c = u < -1 ? -1 : u > this.nu ? this.nu : u;
    return this.R[i * this.W + c + 1];
  }
  // [track, mapped unit, mirror] (debug / panel)
  state(i, u) { return [0, this.src(i, u), !!this.mir(i, u)]; }

  // when dancer i falls in after the drop, and how far (0 = still idle, 1 = dancing) at song time t
  startOf(i) { return this.sched.start[i]; }
  fallIn(i, t) {
    const a = this.fa[i], b = this.fb[i];
    return t <= a ? 0 : t >= b ? 1 : smooth((t - a) / (b - a));
  }

  // out = lerp(out, o, w) on the root position + hinges, slerp on the root quaternion (MuJoCo w, x, y, z)
  mix(out, o, w) {
    for (let k = 0; k < 28; k++) if (k < 3 || k >= 7) out[k] += (o[k] - out[k]) * w;
    const qa = this._qa.set(out[4], out[5], out[6], out[3]), qb = this._qb.set(o[4], o[5], o[6], o[3]);
    qa.slerp(qb, w);
    out[3] = qa.w; out[4] = qa.x; out[5] = qa.y; out[6] = qa.z;
    return out;
  }

  // relative-to-stage qpos of the finale's unit m, played in song unit u at time t, optionally mirrored, into out
  _sample(m, mirror, u, t, out, travel) {
    const rig = this.rigs[0];
    const ts = t + (m - u) * this.eight;
    const q = rig.sample(ts, this.tmp);
    out.set(q);
    out[0] = (q[0] - rig.offsetX) * travel;
    out[1] = (q[1] - rig.offsetY) * travel;
    if (mirror) {
      out[1] = -out[1];
      out[4] = -q[4]; out[6] = -q[6]; // quat (w, x, y, z) -> (w, -x, y, -z)
      const { perm, sign } = this.mm;
      for (let j = 0; j < 21; j++) out[7 + j] = sign[j] * q[7 + perm[j]];
    }
    return out;
  }

  // qpos (dancer-local, before roaming) of dancer i at song time t after the drop
  _base(i, t, travel = 1) {
    const u = Math.floor((t - this.anchor) / this.eight);
    const tb = this.anchor + u * this.eight; // start of unit u
    const m = this.src(i, u), r = this.mir(i, u);
    // nearest boundary: the one at tb (between u-1 and u) or at tb + eight (between u and u+1); no blend while the
    // dancer just carries on through its run (m - 1 -> m, same mirror)
    let ou = 0, w = 0;
    if (t - tb < BLEND) {
      const pm = this.src(i, u - 1), pr = this.mir(i, u - 1);
      if (!(pm === m - 1 && pr === r)) { ou = u - 1; w = 0.5 - 0.5 * ((t - tb) / BLEND); } // weight of the previous state
    } else if (tb + this.eight - t < BLEND) {
      const nm = this.src(i, u + 1), nr = this.mir(i, u + 1);
      if (!(nm === m + 1 && nr === r)) { ou = u + 1; w = 0.5 - 0.5 * ((tb + this.eight - t) / BLEND); }
    }
    const q = this._sample(m, r, u, t, this.q, travel);
    if (w <= 0) return q;
    const o = this._sample(this.src(i, ou), this.mir(i, ou), ou, t, this.b, travel);
    return this.mix(q, o, w * w * (3 - 2 * w));
  }

  // qpos of dancer i at song time t after the drop, in the dancer's slot frame (Crew places that frame at the
  // layout slot): the finale copy from _base, moved / turned by the roaming plan when one is set (roam.js).
  sample(i, t, travel = 1) {
    const R = this.roam;
    if (!R) return this._base(i, t, travel);
    const u = Math.floor((t - this.anchor) / this.eight);
    const tb = this.anchor + u * this.eight;
    const out = this._seg(i, u, t, travel, this.ra);
    // trips blend in / out over +-TRIP_BLEND around their 8-count boundaries (homes and turns are continuous)
    let v = -1, w = 0;
    if (t - tb < TRIP_BLEND) { v = u - 1; w = 0.5 - 0.5 * ((t - tb) / TRIP_BLEND); } else if (tb + this.eight - t < TRIP_BLEND) { v = u + 1; w = 0.5 - 0.5 * ((tb + this.eight - t) / TRIP_BLEND); }
    if (v === -1 || !(R.kind(i, u) === 1 || R.kind(i, v) === 1) || w <= 0) return out;
    const o = this._seg(i, v, t, travel, this.rb);
    return this.mix(out, o, w * w * (3 - 2 * w));
  }

  // pose of dancer i at time t under the roaming segment of unit u, into out
  _seg(i, u, t, travel, out) {
    const R = this.roam;
    const r = R.recs, o = R.off(i, u);
    const kind = r[o];
    if (kind === 1) { // trip: the travel clip, re-rooted at S, turned to th0 (+ delta early, + eps late), scaled by sigma
      const tau = Math.min(this.eight, Math.max(0, t - (this.anchor + u * this.eight)));
      const q = R.travel.sample(r[o + 4], tau, this.tmp);
      const s1 = smooth(tau / TURN_IN), s2 = smooth((tau - (this.eight - TURN_OUT)) / TURN_OUT);
      const th = r[o + 7] + r[o + 8] * s1, sg = r[o + 10];
      const c = Math.cos(th), s = Math.sin(th);
      out.set(q);
      out[0] = r[o + 5] + sg * (c * q[0] - s * q[1]);
      out[1] = r[o + 6] + sg * (s * q[0] + c * q[1]);
      return rotQuat(out, q, th + r[o + 9] * s2);
    }
    const q = this._base(i, t, travel);
    let phi = r[o + 3];
    if (kind === 2) phi += r[o + 4] * smooth((t - (this.anchor + u * this.eight)) / this.eight);
    const c = Math.cos(phi), s = Math.sin(phi);
    out.set(q);
    out[0] = r[o + 1] + c * q[0] - s * q[1];
    out[1] = r[o + 2] + s * q[0] + c * q[1];
    return rotQuat(out, q, phi);
  }

  setRoam(plan) { this.roam = plan; }

  // the move dancer i is doing at time t, for the sim-side tags: { id (library move, without the _M suffix), mirror
  // (as seen: the unit's own mirroring x the dancer's), trip }. Trips report their travelling clip. Returns one reused
  // object (read it straight away).
  moveAt(i, t) {
    const u = Math.floor((t - this.anchor) / this.eight);
    const R = this.roam, mv = this._mv;
    if (R && R.kind(i, u) === 1) {
      const c = R.travel.clips[R.recs[R.off(i, u) + 4]];
      if (c) { mv.id = c.src; mv.mirror = !!c.mirrored; mv.trip = true; return mv; }
    }
    const units = this.rigs[0].header.units;
    const unit = units[Math.max(0, Math.min(units.length - 1, this.src(i, u)))];
    mv.id = unit.move.replace(/_M$/, ''); mv.mirror = !!unit.mirrored !== !!this.mir(i, u); mv.trip = false;
    return mv;
  }

  // label for the panel
  describe(i, t) {
    const u = Math.floor((t - this.anchor) / this.eight);
    const base = this.isSync(u) ? 'SYNC' : `u${this.src(i, u)}${this.mir(i, u) ? 'M' : ''}`;
    const k = this.roam ? this.roam.kind(i, u) : 0;
    return k === 1 ? `${base}>TRIP` : k === 2 ? `${base}>TURN` : base;
  }
}

const TURN_IN = 2 * 0.53125, TURN_OUT = 2 * 0.53125; // the trip's extra aim / facing turns: over its first / last 2 beats
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// out quat = Rz(a) * q quat (MuJoCo (w, x, y, z), z up): turns the whole body about the vertical
function rotQuat(out, q, a) {
  const w1 = Math.cos(a / 2), z1 = Math.sin(a / 2);
  out[3] = w1 * q[3] - z1 * q[6];
  out[4] = w1 * q[4] - z1 * q[5];
  out[5] = w1 * q[5] + z1 * q[4];
  out[6] = w1 * q[6] + z1 * q[3];
  return out;
}

// The travelling 8-counts (public/dance/travel.{json,bin}, dance-rl export_web.py travel): one clip per move and per
// mirror, re-rooted (root xy 0, heading +x at t = 0), sampled like the finale (linear, quaternion nlerp).
export class TravelLib {
  constructor({ header, frames }) {
    this.header = header;
    this.frames = frames;
    this.stride = header.stride;
    this.fps = header.fps;
    this.n = header.n_per_clip;
    this.clips = header.clips.map((c) => ({
      ...c,
      yawEnd: Math.atan2(Math.sin(c.yaw_end), Math.cos(c.yaw_end)),
      dir: Math.atan2(c.disp[1], c.disp[0]),
    }));
  }

  sample(clip, tau, out) {
    const x = Math.max(0, Math.min(this.n - 1, tau * this.fps));
    const k0 = Math.floor(x), k1 = Math.min(this.n - 1, k0 + 1), a = x - k0;
    const base = this.clips[clip].offset;
    const o0 = (base + k0) * this.stride + 1, o1 = (base + k1) * this.stride + 1, F = this.frames;
    for (let i = 0; i < 28; i++) out[i] = F[o0 + i] * (1 - a) + F[o1 + i] * a;
    const dot = F[o0 + 3] * F[o1 + 3] + F[o0 + 4] * F[o1 + 4] + F[o0 + 5] * F[o1 + 5] + F[o0 + 6] * F[o1 + 6];
    const sg = dot < 0 ? -1 : 1;
    let l = 0;
    for (let i = 3; i < 7; i++) { out[i] = F[o0 + i] * (1 - a) + sg * F[o1 + i] * a; l += out[i] * out[i]; }
    l = Math.sqrt(l);
    for (let i = 3; i < 7; i++) out[i] /= l;
    return out;
  }
}
