// Crew looks: a small seeded generator that dresses the procedural body (proceduralBody.js) in
// 9 distinct but cohesive outfits from one palette that sits on the site blue. Every look is plain data
// (the outfit params buildDancer() takes), so a crew is reproducible from its seed and can be exported
// as JSON (window.__crew.looks in the lab, dance-rl/export/designs/crew/looks.json).
//
// Rules: 6 templates (hoodie / tracksuit / tee + jeans / all black, plus crop hoodie + high-waist cargos and
// an oversized tee worn as a dress over leggings), garments only from PALETTE, at most one loud garment colour
// (red or yellow) per look, yellow kept for accents (drawstrings, soles, laces, headphones, belt, hair ties)
// except on one tee (and the yellow hoodie that replaces a second all-black look on the same body, see the end of
// generateCrew). Look 0 is the lead (white hoodie + yellow headphones, either body).
//
// Bodies: by default 5 women ('f' body in proceduralBody.js) and 4 men, shuffled over the slots by the seed
// (the lead can be either). Hairstyles are dealt without repeats per body (women: ponytail / bob / puffs /
// braids / crop; men: crop / afro / curtains / buzz), so the crew shows 8-9 different heads; hats and
// headphones only go on styles they fit over (never on an afro or puffs).

export const PALETTE = {
  yellow: '#f0ff18',
  white: '#f4f5f8',
  black: '#16171d',
  red: '#d8232c',
  offwhite: '#e9e2cf',
  bluegrey: '#6b7690',
};
const P = PALETTE;
const SKINS = ['#f1c9a5', '#e2b896', '#c98e68', '#b07a55', '#8a5a3c', '#6a4430', '#d9a882', '#9c6a48', '#5a3a28'];
const HAIRS = ['#141414', '#1b1d2e', '#2e2219', '#0e0f14', '#4a3322', '#3a2618', '#5b3b24'];
export const HAIR_STYLES = { f: ['ponytail', 'bob', 'puffs', 'braids', 'crop'], m: ['crop', 'afro', 'curtains', 'none'] };
// which headwear fits over which hairstyle
const FITS = {
  phones: ['crop', 'none', 'curtains', 'ponytail', 'braids'], // a bob disappears under the cups
  cap: ['crop', 'none', 'ponytail', 'braids'],
  bucket: ['crop', 'none', 'bob', 'braids'],
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const shuffle = (r, a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const shade = (hex, k) => { // k < 0 darkens towards black, > 0 lightens towards white
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
const loud = (c) => c === P.red || c === P.yellow;

const TEMPLATES = {
  hoodie(r, want) {
    // (yellow only comes from the all-black fix below: the deck never deals a yellow hoodie)
    const top = [P.offwhite, P.bluegrey, P.red, P.white, P.yellow].includes(want) ? want : pick(r, [P.offwhite, P.bluegrey, P.red]);
    const pants = pick(r, loud(top) ? [P.black, P.bluegrey] : [P.black, P.bluegrey, P.offwhite].filter((c) => c !== top));
    return {
      top, topCuff: shade(top, -0.1), hood: true, pocket: r() < 0.7,
      strings: top === P.yellow ? P.white : top === P.white || top === P.offwhite ? P.yellow : pick(r, [P.yellow, P.white]),
      oversize: 1.08 + 0.06 * r(), topLength: 'long', pants, cargo: r() < 0.5 ? shade(pants, -0.15) : undefined, baggy: 1.1 + 0.1 * r(),
      shoe: pick(r, [P.white, P.offwhite]), sole: pick(r, [P.yellow, P.white, P.offwhite]), lace: P.white, chunky: 1.06 + 0.08 * r(), sock: P.white,
    };
  },
  tracksuit(r, want) {
    const top = [P.red, P.bluegrey, P.white, P.black].includes(want) ? want : pick(r, [P.red, P.bluegrey]);
    const stripe = top === P.white ? pick(r, [P.red, P.black]) : pick(r, [P.white, P.yellow]);
    return {
      top, topCuff: shade(top, -0.15), stripe, zip: stripe, pants: top, cuff: shade(top, -0.15), taper: true, baggy: 1.0 + 0.04 * r(),
      shoe: pick(r, [P.white, P.black]), sole: pick(r, [P.offwhite, P.white]), lace: P.white, chunky: 1.0 + 0.06 * r(), sock: P.white,
    };
  },
  tee(r, want) {
    const top = [P.white, P.offwhite, P.yellow, P.red, P.bluegrey].includes(want) ? want : pick(r, [P.white, P.offwhite, P.yellow]);
    return {
      top, topCuff: shade(top, -0.08), sleeves: 'short', oversize: 1.04 + 0.06 * r(), topLength: r() < 0.5 ? 'long' : undefined,
      pants: pick(r, top === P.black ? [P.bluegrey, P.offwhite] : [P.bluegrey, P.black]), baggy: 1.12 + 0.1 * r(),
      shoe: pick(r, [P.white, P.black, P.red].filter((c) => !(loud(c) && loud(top)))), sole: P.white, lace: P.white, chunky: 1.05 + 0.1 * r(), sock: P.white,
    };
  },
  // cropped hoodie (a strip of midriff) over high-waisted cargos
  cropHoodie(r, want) {
    const top = [P.offwhite, P.bluegrey, P.red, P.white].includes(want) ? want : pick(r, [P.offwhite, P.bluegrey, P.red]);
    const pants = pick(r, loud(top) ? [P.black, P.bluegrey] : [P.black, P.bluegrey, P.offwhite].filter((c) => c !== top));
    return {
      top, topCuff: shade(top, -0.1), hood: true, strings: top === P.white || top === P.offwhite ? P.yellow : pick(r, [P.yellow, P.white]),
      oversize: 1.05 + 0.04 * r(), topLength: 'crop', midriff: true, highWaist: true, waistband: shade(pants, -0.25),
      pants, cargo: shade(pants, -0.15), baggy: 1.12 + 0.08 * r(), taper: r() < 0.5,
      shoe: pick(r, [P.white, P.offwhite]), sole: pick(r, [P.yellow, P.white]), lace: P.white, chunky: 1.1 + 0.06 * r(), sock: P.white,
    };
  },
  // oversized tee worn as a dress (mid-thigh) over leggings
  teeDress(r, want) {
    const top = [P.white, P.offwhite, P.yellow, P.red, P.bluegrey].includes(want) ? want : pick(r, [P.white, P.offwhite, P.bluegrey]);
    return {
      top, topCuff: shade(top, -0.1), sleeves: 'short', oversize: 1.1 + 0.05 * r(), topLength: 'long', dress: +(0.71 - 0.04 * r()).toFixed(3),
      pants: P.black, baggy: 0.8, taper: true,
      shoe: pick(r, [P.white, P.black, P.red].filter((c) => !(loud(c) && loud(top)))), sole: P.white, lace: P.white, chunky: 1.12 + 0.06 * r(),
      sock: pick(r, [P.white, P.black]),
    };
  },
  allblack(r) {
    const acc = pick(r, [P.yellow, P.yellow, P.red]);
    return {
      top: P.black, topCuff: '#22232c', hood: r() < 0.7, strings: acc, oversize: 1.04 + 0.04 * r(), pants: '#121318', baggy: 1.0 + 0.08 * r(), taper: true,
      shoe: P.black, sole: acc, lace: acc, belt: r() < 0.6 ? acc : undefined, chunky: 1.06 + 0.04 * r(), sock: P.black,
    };
  },
};

// D4's look, recoloured into the palette: the lead (LEAD_F when the seed makes the lead a woman)
const LEAD_F = {
  template: 'cropHoodie',
  outfit: {
    top: P.white, topCuff: shade(P.white, -0.1), hood: true, strings: P.yellow, oversize: 1.08, topLength: 'crop', midriff: true,
    highWaist: true, waistband: '#0d0e12', pants: P.black, cargo: '#0d0e12', baggy: 1.18, shoe: P.white, sole: P.yellow, lace: '#d9dce8',
    chunky: 1.14, sock: P.white, headphones: true, phonesCol: P.yellow, hairStyle: 'ponytail', hairTie: P.yellow,
  },
};
const LEAD = {
  template: 'hoodie',
  outfit: {
    top: P.white, topCuff: shade(P.white, -0.1), hood: true, pocket: true, strings: P.yellow, oversize: 1.12, topLength: 'long',
    pants: P.black, cargo: '#0d0e12', baggy: 1.18, shoe: P.white, sole: P.yellow, lace: '#d9dce8', chunky: 1.12, sock: P.white,
    headphones: true, phonesCol: P.yellow,
  },
};

export function generateCrew(seed = 7, n = 9, { women = Math.round((n * 5) / 9) } = {}) {
  const r = mulberry32(seed);
  const bodies = shuffle(r, [...Array(n)].map((_, i) => (i < women ? 'f' : 'm')));
  // templates for the others: the two feminine ones go to the first two women, everyone else is dealt
  // from 2 tracksuits, 2 all-black, 1 hoodie, 1 tee (cycled if n grows)
  // (a woman lead already wears the crop hoodie, so then only the dress is reserved and one more hoodie is dealt)
  const fem = bodies[0] === 'f' ? ['teeDress'] : shuffle(r, ['cropHoodie', 'teeDress']);
  const generic = shuffle(r, ['hoodie', 'tracksuit', 'tracksuit', 'tee', 'allblack', 'allblack', ...(bodies[0] === 'f' ? ['hoodie'] : [])]);
  let g = 0;
  const templates = bodies.map((b, i) => (i === 0 ? null : b === 'f' && fem.length ? fem.shift() : generic[g++ % generic.length]));
  const skins = shuffle(r, SKINS);
  // top colours for the non-black looks: a deck so the crew spreads over the palette (2 red, 2 blue-grey,
  // 1 off-white, 1 yellow, the lead + maybe 1 more white)
  const deck = shuffle(r, [P.red, P.red, P.bluegrey, P.bluegrey, P.offwhite, P.yellow]);
  const used = new Set(); // template:colour already dealt, so no two looks share both
  const want = (template) => {
    const ok = {
      hoodie: [P.offwhite, P.bluegrey, P.red], tracksuit: [P.red, P.bluegrey], tee: [P.yellow, P.offwhite, P.red, P.bluegrey],
      cropHoodie: [P.offwhite, P.bluegrey, P.red], teeDress: [P.yellow, P.offwhite, P.bluegrey, P.red],
    }[template] || [];
    let k = deck.findIndex((c) => ok.includes(c) && !used.has(`${template}:${c}`));
    if (k < 0) k = deck.findIndex((c) => ok.includes(c));
    const c = k >= 0 ? deck.splice(k, 1)[0] : P.white;
    used.add(`${template}:${c}`);
    return c;
  };
  // hairstyles: dealt without repeats per body (the lead keeps its own); headwear only where it fits
  const hairDeck = { f: shuffle(r, HAIR_STYLES.f), m: shuffle(r, HAIR_STYLES.m) };
  const leadHair = bodies[0] === 'f' ? 'ponytail' : 'crop';
  hairDeck[bodies[0]].splice(hairDeck[bodies[0]].indexOf(leadHair), 1);
  const accDeck = shuffle(r, ['bucket', 'cap', 'phones', 'phones', null, null, null, null]);
  // deal top colours most-constrained template first (tracksuits only come in red / blue-grey)
  const rank = { tracksuit: 0, cropHoodie: 1, hoodie: 1, teeDress: 2, tee: 2 };
  const tops = {};
  templates.map((t, i) => [t, i]).filter(([t]) => t && t !== 'allblack').sort((a, b) => rank[a[0]] - rank[b[0]] || a[1] - b[1])
    .forEach(([t, i]) => { tops[i] = want(t); });
  const looks = [];
  for (let i = 0; i < n; i++) {
    const body = bodies[i];
    const lead = body === 'f' ? LEAD_F : LEAD;
    const template = i === 0 ? lead.template : templates[i];
    const o = i === 0 ? { ...lead.outfit } : TEMPLATES[template](r, tops[i] ?? null);
    if (body === 'f' && template === 'tracksuit') o.baggy = +(0.94 + 0.04 * r()).toFixed(3); // fitted
    o.body = body;
    o.skin = skins[i % skins.length];
    o.hair = pick(r, HAIRS);
    if (i > 0) {
      const d = hairDeck[body];
      o.hairStyle = d.length ? d.shift() : pick(r, HAIR_STYLES[body]);
    }
    if (['ponytail', 'puffs', 'braids'].includes(o.hairStyle) && !o.hairTie) o.hairTie = pick(r, [P.yellow, P.white, P.red].filter((c) => !(c === P.red && o.top === P.red)));
    if (o.hairStyle === 'crop') delete o.hairStyle; // the default
    const style = o.hairStyle || 'crop';
    let a = i === 0 ? 'phones' : null;
    if (i > 0) {
      const k = accDeck.findIndex((x) => x === null || FITS[x].includes(style));
      if (k >= 0) a = accDeck.splice(k, 1)[0];
    }
    if (a === 'bucket') { o.hat = 'bucket'; o.hatCol = pick(r, [P.offwhite, P.black, P.white].filter((c) => c !== o.top)); }
    if (a === 'cap') { o.hat = 'cap'; o.hatCol = pick(r, [P.black, P.red, P.white, P.yellow].filter((c) => c !== o.top && !(loud(c) && loud(o.top)))); }
    if (a === 'phones') { o.headphones = true; o.phonesCol = o.phonesCol || pick(r, o.top === P.yellow ? [P.white, P.black] : [P.yellow, P.white]); o.bandCol = '#14183a'; }
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    const height = i === 0 ? (body === 'f' ? 0.95 : 1.0) : body === 'f' ? 0.915 + 0.055 * r() : 0.97 + 0.07 * r();
    looks.push({ id: i, body, template, hairStyle: style, height: +height.toFixed(3), outfit: o });
  }
  // Two all-black looks on the same body read as one dark shape when they end up side by side (seed 7: both women in
  // black, next to each other on the phone), so the later one is re-dressed in a yellow hoodie. It is dressed from
  // its own RNG stream, so every other look, and this one's body, skin, hair, headwear and height, stay as dealt.
  const black = looks.filter((l) => l.template === 'allblack');
  black.forEach((l, k) => {
    if (!black.slice(0, k).some((b) => b.body === l.body)) return;
    const old = l.outfit;
    const o = TEMPLATES.hoodie(mulberry32(seed * 7919 + l.id), P.yellow);
    for (const key of ['body', 'skin', 'hair', 'hairStyle', 'hairTie', 'hat', 'hatCol', 'headphones', 'phonesCol', 'bandCol']) if (key in old) o[key] = old[key];
    if (o.hairTie === P.yellow) o.hairTie = P.white; // one loud colour per look, and keep the accents visible
    if (o.phonesCol === P.yellow) o.phonesCol = P.white;
    if (loud(o.hatCol)) o.hatCol = P.black;
    for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key];
    l.template = 'hoodie';
    l.outfit = o;
  });
  return looks;
}
