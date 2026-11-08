// The home page's crew, prepared once and cached for every visit to the music stage: the poser rig, the sync
// structure and the 9 bodies (L4 cast, seed 7). The body geometry is built in a worker (bodyWorker.js) while the data
// downloads; the main thread then only skins + retargets each body, one per idle callback (a few ms each), and only
// while `canBuild()` allows it, so that work never lands on the drop itself or on the deck's zoom into the stage.
// Without workers it falls back to building everything on the main thread, half a body per idle callback. Last, the
// roaming trips (roam.js) are planned for both orientations, one per idle slot, so mounting on the drop plans nothing.
import { Rig } from './rig.js';
import { loadCrewMeta, loadFinaleData, loadTravelData } from './data.js';
import { bodyFromData } from './crewBody.js';
import { generateCrew } from './looks.js';
import { buildNextDancer, createCrewKit, loadCrewTracks, rigCrewDancer, roamPlanFor } from './Crew.jsx';
import { CrewMotion } from './motion.js';

export const CREW_SEED = 7;
export const CREW_LAYOUT = 'L4';
// roam.js: which trips the crew makes (a number, or [landscape, portrait]; the lab's &roamseed=N overrides it). Picked
// from seeds 1-40 as one where every dancer but the lead dances in 3-5 areas of the floor in both orientations.
export const CREW_ROAM_SEED = 24;

const idle = (canBuild) => new Promise((resolve) => {
  const go = () => {
    if (!canBuild()) { setTimeout(go, 120); return; }
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 400 });
    else setTimeout(resolve, 16); // Safari: no idle callbacks
  };
  go();
});

function buildBodiesInWorker(looks) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./bodyWorker.js', import.meta.url), { type: 'module' });
    } catch (e) { reject(e); return; }
    const out = new Array(looks.length);
    let left = looks.length;
    const done = (err) => { clearTimeout(timer); worker.terminate(); if (err) reject(err); else resolve(out); };
    const timer = setTimeout(() => done(new Error('body worker timed out')), 20000);
    worker.onmessage = (e) => {
      const { id, data, error } = e.data;
      if (error) { done(new Error(error)); return; }
      out[id] = data;
      if (--left === 0) done();
    };
    worker.onerror = (e) => { e.preventDefault?.(); done(new Error(e.message || 'body worker failed')); };
    looks.forEach((l, id) => worker.postMessage({ id, outfit: l.outfit }));
  });
}

let pending = null;
let ready = null;

// Resolves to { kit, tracks } once everything is built. Safe to call repeatedly; `canBuild` from the latest caller wins.
let gate = () => true;
export function prepareCrew(canBuild) {
  if (canBuild) gate = canBuild;
  if (!pending) {
    pending = (async () => {
      const bodies = buildBodiesInWorker(generateCrew(CREW_SEED)).catch((e) => {
        console.warn('[dance] building the crew on the main thread:', e.message || e);
        return null;
      });
      const [data, meta] = await Promise.all([loadFinaleData(), loadCrewMeta().catch(() => null), loadTravelData().catch(() => null)]);
      const rig = new Rig(data);
      const tracks = await loadCrewTracks(rig, meta);
      const kit = createCrewKit(rig, CREW_SEED);
      const built = await bodies;
      for (;;) {
        await idle(() => gate());
        if (built) {
          const i = kit.dancers.length;
          kit.dancers.push(rigCrewDancer(rig, kit.looks[i], kit.materials, bodyFromData(built[i])));
          if (kit.dancers.length === kit.looks.length) break;
        } else if (buildNextDancer(kit)) break;
      }
      // the roaming trips (~50 ms each): this orientation first, then the other one, each in its own idle slot
      if (tracks.travel) {
        tracks.motion = new CrewMotion(tracks.rigs, tracks.meta);
        const here = window.innerHeight > window.innerWidth;
        for (const portrait of [here, !here]) {
          await idle(() => gate());
          try { roamPlanFor(tracks.motion, tracks.travel, CREW_LAYOUT, portrait, kit.dancers, CREW_ROAM_SEED); } catch (e) { console.warn('[dance] roaming plan failed:', e); }
        }
      }
      ready = { kit, tracks };
      try { performance.mark('dance-stage:kit-ready'); } catch { /* unsupported */ }
      return ready;
    })();
    pending.catch((e) => { pending = null; console.warn('[dance] crew unavailable:', e); });
  }
  return pending;
}

export const crewReady = () => ready;
