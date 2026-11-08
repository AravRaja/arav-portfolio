// Four 9-dancer layouts for the music stage. A slot is [x, z, yaw (deg, + turns towards +x), scale];
// slot 0 is the lead, then pairs (1,2), (3,4), (5,6), (7,8): odd at +x, even (the mirrored dancer) at -x.
// `portrait` gives the phone version. fov / elevation [desktop, portrait] (deg) / travel (root wander kept, 1 = as
// rolled out) per layout. On a phone the width is the limit, so the portrait versions go deep and the camera looks
// down more, stacking rows vertically instead of spreading them sideways.

const pairs = (f) => [1, 2, 3, 4].flatMap((k) => { const [x, z, yaw = 0, s = 1] = f(k); return [[x, z, yaw, s], [-x, z, -yaw, s]]; });

export const LAYOUTS = {
  L1: {
    name: 'Formation (3x3)',
    // skewed 3x3: middle row = lead +- s, front row shifted -s/2.5, back row +s/2.5 (point-symmetric about the lead,
    // so nobody stands straight behind anybody)
    slots(portrait) {
      const s = portrait ? 1.15 : 2.3, d = portrait ? 2.8 : 1.9, o = s / 2.5;
      const back = 0.96;
      return [
        [0, 0, 0, 1],
        [s, 0, 0, 1], [-s, 0, 0, 1],
        [s + o, -d, 0, back], [-s - o, d, 0, 1],
        [o, -d, 0, back], [-o, d, 0, 1],
        [s - o, d, 0, 1], [-(s - o), -d, 0, back],
      ];
    },
    fov: 22, elevation: [18, 25], travel: 0.4,
  },
  L2: {
    name: 'Line',
    slots(portrait) {
      if (!portrait) return [[0, 0, 0, 1], ...pairs((k) => [0.95 * k, 0])];
      // two staggered rows: lead + 4 in front, 4 behind in the gaps
      return [[0, 0.8, 0, 1], [0.85, 0.8], [-0.85, 0.8], [1.7, 0.8], [-1.7, 0.8], [0.425, -0.8], [-0.425, -0.8], [1.275, -0.8], [-1.275, -0.8]]
        .map(([x, z, y = 0, s = 1]) => [x, z, y, s]);
    },
    fov: 26, elevation: [9, 16], travel: 0.4,
  },
  L3: {
    name: 'Wedge',
    slots(portrait) {
      const sx = portrait ? 0.45 : 0.95, sz = portrait ? 1.45 : 0.85;
      return [[0, 1.6, 0, 1], ...pairs((k) => [sx * k, 1.6 - sz * k, k > 2 ? -6 : 0])];
    },
    fov: 28, elevation: [12, 24], travel: 0.55,
  },
  L4: {
    name: 'Club',
    // Hand-scattered, yaw +-12-30 deg, varied depth. Desktop: compressed sideways / stretched in depth from the first
    // round so the crew is bigger on 16:9. Portrait: narrow at the front, wider at the back and deep (6.3 m), looked
    // down on a little more, so 9 dancers fill a phone between the header and the space key instead of leaving empty
    // bands (width is the limit there: every dancer needs +-0.9 m for arms + measured root wander).
    slots(portrait) {
      const D = [
        [0, 0.5, 0, 1],
        [1.45, 0.05, -24, 1], [-1.55, 0.25, 28, 1],
        [2.75, -0.85, -30, 1], [-2.55, -0.6, 18, 1],
        [0.75, -1.35, 12, 1], [-0.9, -1.75, -14, 1],
        [3.3, 0.55, 26, 1], [-3.35, 0.35, -26, 1],
      ].map(([x, z, y, s]) => [x * 0.8, z * 1.8, y, s]);
      const Pt = [
        [0, 1.9, 0, 1],
        [0.62, 0.85, -24, 1], [-0.66, 1.05, 28, 1],
        [0.95, -0.55, -30, 1], [-0.9, -0.25, 18, 1],
        [0.35, -1.75, 12, 1], [-0.4, -2.55, -14, 1],
        [1.2, -2.6, 26, 1], [-1.15, -1.6, -26, 1],
      ].map(([x, z, y, s]) => [x * 0.9, z * 1.4, y, s]);
      return portrait ? Pt : D;
    },
    fov: 30, elevation: [[12, 18], [18, 28]], travel: 1.0,
  },
};
export const LAYOUT_KEYS = Object.keys(LAYOUTS);
