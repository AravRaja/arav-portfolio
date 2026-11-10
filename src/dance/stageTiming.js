// When the home page's crew first shows, relative to the drop hit, and the fall-in window that follows from it.
// The page flow (Header.jsx, DJScene.jsx, Welcome.jsx, DanceStage.jsx): letting go of a full hold schedules the drop hit
// `syncLead` s later (the hold is timed to fill that far ahead of the hit point) and starts the zoom into the stage
// (`stageZoomIn` s). The deck stops drawing DECK_PAUSE_DELAY after the zoom ends; only then does the crew's canvas mount,
// compile, draw its first frame and, one animation frame later, start fading in (DanceStage's `is-visible`).
// The compile is left out on purpose (it's ~0.1 s on a cold cache, less on later visits): this is the earliest the crew
// can show, so the fall-in below is over before then even on a fast device.
import { getProfile } from '../audio/soundProfile.js';
import { FALL_IN_BLEND } from './schedule.js';

export const DECK_PAUSE_DELAY = 0.1; // s, DJScene.jsx: setPaused(true) at stageZoom.seconds * 1000 + 100 ms
export const FIRST_FRAME_FRAMES = 2; // first live frame + the requestAnimationFrame before `is-visible` (DanceStage)
export const FRAME = 1 / 60;
export const VISIBLE_MARGIN = 0.25; // s: every dancer is fully in its move this long before the crew can first show

// song seconds after the drop hit at which the crew can first be seen (release right at the drop, as the hold is timed)
export function crewVisibleAfterDrop(profile = getProfile()) {
  return profile.stageZoomIn + DECK_PAUSE_DELAY + FIRST_FRAME_FRAMES * FRAME - profile.syncLead;
}

// the longest fall-in delay (s) a dancer may draw: its crossfade (which starts at the drop and ends FALL_IN_BLEND after
// its start) is then over VISIBLE_MARGIN before the crew can first show
export function fallInWindow(profile = getProfile()) {
  return Math.max(0, crewVisibleAfterDrop(profile) - VISIBLE_MARGIN - FALL_IN_BLEND);
}

const mod = (a, m) => ((a % m) + m) % m;
// Before the drop hit, holdSync.songTime() is the intro loop's position. Once the hold is let go the drop is already
// scheduled on the loop's next hit point (Header.jsx: the next bar, or beat with dropOn 'beat'), so the song time the
// loop position stands for is the drop minus the time left until that hit point. It runs on the same bar grid and joins
// the real song time exactly when the drop lands (no jump). null when the loop position is unusable.
export function preDropSongTime(loopPos, drop, profile = getProfile()) {
  const P = profile;
  const bar = P.loopEnd - P.loopStart;
  if (loopPos == null || !Number.isFinite(loopPos) || !(bar > 0) || loopPos < P.loopStart - 0.05 || loopPos > P.loopEnd + 0.05) return null;
  const grid = P.dropOn === 'beat' ? bar / Math.max(1, P.beatsPerBar) : bar;
  const hit = P.loopStart + mod(P.dropHit - P.loopStart, bar);
  let left = mod(hit - loopPos, grid); // seconds until the drop lands
  if (left > grid - 0.05) left -= grid; // just past the hit point: the switch to the song is a frame away
  return drop - left;
}
