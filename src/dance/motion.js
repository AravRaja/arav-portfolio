// Crew motion without new training: every dancer plays one of the exported full-song trajectories
// (public/dance/finale + optional alternate-schedule rollouts listed in public/dance/crew.json), shifted by a
// whole number of 8-counts INSIDE the current section (so it is always on the beat and in the section's
// energy tier) and/or mirrored left <-> right. On the sync units (the drop's first 8-count and the first
// 8-count of every section, which also holds the 1-bar breakdowns) every dancer snaps to the lead: the
// finale trajectory, same unit, not mirrored. Changes of (track, unit, mirror) at an 8-count boundary are
// crossfaded over +-BLEND s (hinge angles lerp, root nlerp), so nobody pops.
import { Quaternion } from 'three';

const BLEND = 0.2;

// mirror map (dance_rl/mirror.py): left <-> right, shoulder1 / shoulder2 / ankle_x and abdomen_z / _x negated
export function mirrorMap(jointNames) {
  const perm = jointNames.map((n, i) => (n.startsWith('left_') ? jointNames.indexOf(`right_${n.slice(5)}`)
    : n.startsWith('right_') ? jointNames.indexOf(`left_${n.slice(6)}`) : i));
  const sign = jointNames.map((n) => (['abdomen_z', 'abdomen_x'].includes(n) || /_(shoulder1|shoulder2|ankle_x)$/.test(n) ? -1 : 1));
  return { perm, sign };
}

// Per-dancer motion recipes (index 0 = lead). Pairs (1,2), (3,4), ... share a recipe, the even one mirrored, so
// layouts that put them either side of the centre get a mirror-symmetric crew. `track` indexes the loaded
// trajectories (falls back to 0 when a track isn't available); `off` is the whole-8-count offset in the section.
export const RECIPES = [
  { track: 0, off: 0, mirror: false }, // lead
  { track: 0, off: 2, mirror: false }, { track: 0, off: 2, mirror: true }, // B while the lead does A (6-unit sections)
  { track: 0, off: 1, mirror: false }, { track: 0, off: 1, mirror: true }, // one 8-count ahead (canon)
  { track: 0, off: 3, mirror: false }, { track: 0, off: 3, mirror: true }, // three ahead (= one behind in 4-unit sections)
  { track: 0, off: 4, mirror: false }, { track: 0, off: 4, mirror: true }, // two ahead (= the lead / its mirror in 4-unit sections)
];

export class CrewMotion {
  // rigs: Rig per track (rigs[0] = finale, also used as the poser); meta: crew.json
  constructor(rigs, meta, recipes = RECIPES) {
    this.rigs = rigs;
    const h = rigs[0].header;
    this.anchor = h.grid_anchor;
    this.eight = h.eight;
    this.nu = h.units.length;
    this.drop = h.drop;
    this.mm = mirrorMap(h.joint_names);
    this.recipes = recipes.map((r) => ({ ...r, track: rigs[r.track] ? r.track : 0, off: rigs[r.track] ? r.off : r.off + (r.track || 0) }));
    // section of every unit: [start, length]
    this.secOf = new Array(this.nu);
    for (const [a, b] of meta.sections) for (let u = a; u < b; u++) this.secOf[u] = [a, b - a];
    this.syncUnits = new Set(meta.sync_units);
    this.a = new Float64Array(28); this.b = new Float64Array(28); this.tmp = new Float64Array(28);
    this.q = new Float64Array(28);
    this._qa = new Quaternion(); this._qb = new Quaternion();
  }

  isSync(u) { return u < 0 || u >= this.nu || this.syncUnits.has(u); }

  // (track, mapped unit, mirror) of dancer i in song unit u
  state(i, u) {
    const r = this.recipes[i];
    if (this.isSync(u) || (r.track === 0 && r.off === 0 && !r.mirror)) return [0, u, false];
    const [s, L] = this.secOf[u];
    return [r.track, s + (((u - s + r.off) % L) + L) % L, r.mirror];
  }

  // relative-to-stage qpos of a track at time ts, optionally mirrored, into out
  _sample([track, m, mirror], u, t, out, travel) {
    const rig = this.rigs[track];
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

  // qpos (stage-relative) of dancer i at song time t after the drop
  sample(i, t, travel = 1) {
    const u = Math.floor((t - this.anchor) / this.eight);
    const tb = this.anchor + u * this.eight; // start of unit u
    const cur = this.state(i, u);
    // nearest boundary: the one at tb (between u-1 and u) or at tb + eight (between u and u+1)
    let other = null, w = 0;
    if (t - tb < BLEND) {
      const prev = this.state(i, u - 1);
      if (!(prev[0] === cur[0] && prev[1] === cur[1] - 1 && prev[2] === cur[2])) {
        other = [prev, u - 1]; w = 0.5 - 0.5 * ((t - tb) / BLEND); // weight of the previous state
      }
    } else if (tb + this.eight - t < BLEND) {
      const next = this.state(i, u + 1);
      if (!(next[0] === cur[0] && next[1] === cur[1] + 1 && next[2] === cur[2])) {
        other = [next, u + 1]; w = 0.5 - 0.5 * ((tb + this.eight - t) / BLEND);
      }
    }
    const q = this._sample(cur, u, t, this.q, travel);
    if (!other || w <= 0) return q;
    w = w * w * (3 - 2 * w) ; // smooth
    const o = this._sample(other[0], other[1], t, this.b, travel);
    for (let k = 0; k < 28; k++) if (k < 3 || k >= 7) q[k] += (o[k] - q[k]) * w;
    const qa = this._qa.set(q[4], q[5], q[6], q[3]), qb = this._qb.set(o[4], o[5], o[6], o[3]);
    qa.slerp(qb, w);
    q[3] = qa.w; q[4] = qa.x; q[5] = qa.y; q[6] = qa.z;
    return q;
  }

  // label for the panel
  describe(i, t) {
    const u = Math.floor((t - this.anchor) / this.eight);
    const [tr, m, mir] = this.state(i, u);
    return this.isSync(u) ? 'SYNC' : `t${tr}u${m}${mir ? 'M' : ''}`;
  }
}
