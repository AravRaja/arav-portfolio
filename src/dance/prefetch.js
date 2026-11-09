// Tiny entry point for the music-stage crew, part of the welcome page's own chunk. The first time space is held it
// starts downloading the crew chunk and its data (finale.json / .bin, crew.json, travel.json / .bin for the roaming
// trips) and builds the bodies in idle time, so nothing is left to download or build when the drop lands. Building
// pauses while the bar is full (the drop is imminent) and for the stage zoom after it. Later holds build the next
// visit's stage plan (stageKit.js refreshStagePlan) if it isn't ready yet.
import { loadCrewMeta, loadFinaleData, loadTravelData } from './data.js';

export const loadDanceStage = () => import('./DanceStage.jsx');

let quietUntil = 0;
const canBuild = () => performance.now() >= quietUntil;
function onHold(e) {
  const { held, armed, dropped } = e.detail || {};
  if (armed) quietUntil = Infinity; // full and still held: the drop comes the moment it's let go
  else if (dropped) quietUntil = performance.now() + 1200; // the drop + the zoom into the stage (0.7 s) + the deck pausing
  else if (!held || quietUntil === Infinity) quietUntil = 0;
}

let started = null;
export function prefetchDanceStage() {
  // every later hold: if the last visit used up its stage plan (fresh seed per visit), build the next one now
  if (started) started.then(() => loadDanceStage()).then((m) => m.refreshStagePlan()).catch(() => {});
  if (!started) {
    window.addEventListener('dj-hold-change', onHold);
    loadFinaleData().catch(() => {});
    loadCrewMeta().catch(() => {});
    loadTravelData().catch(() => {});
    started = loadDanceStage()
      .then((m) => m.prepareCrew(canBuild))
      .catch((e) => { started = null; window.removeEventListener('dj-hold-change', onHold); throw e; });
    started.catch(() => {});
  }
  return started;
}
