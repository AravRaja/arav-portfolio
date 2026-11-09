// The home page's crew, prepared once and cached for every visit to the music stage: the poser rig, the sync
// structure and the 9 bodies (L4 cast, seed 7). The body geometry is built in a worker (bodyWorker.js) while the data
// downloads; the main thread then only skins + retargets each body, one per idle callback (a few ms each), and only
// while `canBuild()` allows it, so that work never lands on the drop itself or on the deck's zoom into the stage.
// Without workers it falls back to building everything on the main thread, half a body per idle callback. Last, the
// roaming trips (roam.js) are planned for both orientations, one per idle slot, so mounting on the drop plans nothing.
// The sim crew (simBody.js: the same 9 dancers as MuJoCo capsule bodies, for the reveal wipe) is built in the same
// worker and wrapped into its skinned mesh in one more idle slot.
import { Rig } from './rig.js';
import { loadCrewMeta, loadFinaleData, loadTravelData } from './data.js';
import { bodyFromData } from './crewBody.js';
import { buildSimCrew, simCrewFromData } from './simBody.js';
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

// One worker builds the 9 toon bodies (posted right away) and then the sim crew (simBody.js: the 9 capsule bodies,
// posted once finale.json has the model's geoms). `bodies` resolves with the toon bodies' data, `sim(...)` with the
// sim crew's; the worker is closed once both are in (or on the first error, when the caller falls back to the main
// thread).
function startBodyWorker(looks) {
  let worker;
  try {
    worker = new Worker(new URL('./bodyWorker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    const failed = Promise.reject(e);
    failed.catch(() => {});
    return { bodies: failed, sim: () => failed };
  }
  const out = new Array(looks.length);
  let left = looks.length;
  let simJob = null; // { resolve, reject }
  let bodiesDone, bodiesFail;
  const bodies = new Promise((res, rej) => { bodiesDone = res; bodiesFail = rej; });
  let closed = false;
  const close = () => { if (!closed) { closed = true; clearTimeout(timer); worker.terminate(); } };
  const fail = (err) => { close(); bodiesFail(err); simJob?.reject(err); };
  const timer = setTimeout(() => fail(new Error('body worker timed out')), 20000);
  worker.onmessage = (e) => {
    const { id, data, error } = e.data;
    if (error) { fail(new Error(error)); return; }
    if (id === 'sim') { simJob?.resolve(data); close(); return; }
    out[id] = data;
    if (--left === 0) bodiesDone(out);
  };
  worker.onerror = (e) => { e.preventDefault?.(); fail(new Error(e.message || 'body worker failed')); };
  looks.forEach((l, id) => worker.postMessage({ id, outfit: l.outfit }));
  return {
    bodies,
    sim(model, count) {
      if (closed) return Promise.reject(new Error('body worker closed'));
      return new Promise((resolve, reject) => {
        simJob = { resolve, reject };
        worker.postMessage({ id: 'sim', bodies: model.map((b) => ({ geoms: b.geoms })), count });
      });
    },
  };
}

let pending = null;
let ready = null;

// Resolves to { kit, tracks } once everything is built. Safe to call repeatedly; `canBuild` from the latest caller wins.
let gate = () => true;
export function prepareCrew(canBuild) {
  if (canBuild) gate = canBuild;
  if (!pending) {
    pending = (async () => {
      const looks = generateCrew(CREW_SEED);
      const worker = startBodyWorker(looks);
      const bodies = worker.bodies.catch((e) => {
        console.warn('[dance] building the crew on the main thread:', e.message || e);
        return null;
      });
      const [data, meta] = await Promise.all([loadFinaleData(), loadCrewMeta().catch(() => null), loadTravelData().catch(() => null)]);
      // the sim crew's capsule bodies (simBody.js) are built in the same worker, behind the toon bodies
      const simBuilt = worker.sim(data.header.model.bodies, looks.length).catch((e) => {
        console.warn('[dance] building the sim crew on the main thread:', e.message || e);
        return null;
      });
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
      {
        const sim = await simBuilt;
        await idle(() => gate());
        kit.sim = sim ? simCrewFromData(sim) : buildSimCrew(rig, kit.looks.length);
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
