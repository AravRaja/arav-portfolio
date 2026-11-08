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
    // Hand-scattered so it reads as people on a floor, not a lattice: no two dancers share an x or z line, neighbour
    // gaps vary by about +-30%, loose clusters plus a loner or two, yaw within +-35 deg (mostly turned towards the
    // camera), and nobody hidden more than ~20% by a dancer in front. The lead is at the front, a little left of centre.
    // Desktop: the round-1 framing (a flat 13 deg camera with lots of air around the crew), spread ~9% wider than
    // round 1 (7.2 m). Clusters: the left pair (8, 4) + 6, then 2 / lead / 5 in the middle, 1 + 3 on the right, 7 alone.
    // Portrait (round 5, "less crowded"): spread wider (x -1.28..1.28) and deeper (7.7 m), looked down on more (24-30 deg,
    // 30 at 390x844), staggered so nobody stands straight behind anybody. Dancers are ~14% smaller on a 390x844 phone
    // (136 vs 158 px tall) for ~35% more space between them (nearest neighbour 0.66 vs 0.49 body heights); occlusion at
    // 8.6 / 41.04 / 100 s is <= 7% there (<= 14% at 375x667 and 360x640, where the 24 deg floor keeps the rows apart).
    // Width is the limit on a phone: every dancer needs +-0.9 m for arms + root wander. Rows: lead + 1 in front, 2 alone
    // on the left, 3 / 4 mid (apart, they're a mirrored pair), 5 / 6, then 7 / 8 at the back; 8 (yellow hoodie) is kept
    // away from 4 (the crew's one all-black look).
    slots(portrait) {
      const D = [
        [-0.38, 0.88, 6, 1],
        [1.46, -0.25, -18, 1], [-1.15, -0.62, 20, 1],
        [2.62, -1.28, -26, 1], [-3.1, -0.98, 30, 1],
        [0.52, -1.5, 14, 1], [-2.0, 0.42, -10, 1],
        [3.5, 0.62, -22, 1], [-3.72, 0.22, 24, 1],
      ];
      const Pt = [
        [-0.237, 3.66, 6, 1],
        [0.48, 2.85, -16, 1], [-0.997, 1.74, 24, 1],
        [1.06, 0.5, -26, 1], [-0.57, 0.12, 14, 1],
        [0.332, -1.86, 16, 1], [-1.28, -1.62, -12, 1],
        [1.282, -3.3, -26, 1], [-0.522, -4.02, 20, 1],
      ];
      return portrait ? Pt : D;
    },
    fov: 30, elevation: [13, [24, 30]], travel: 1.0, desktopFrame: { top: 112, bottom: 150 },
  },
};
export const LAYOUT_KEYS = Object.keys(LAYOUTS);
