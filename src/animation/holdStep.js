// One frame of the space-hold "up" animation: spin the vinyls up to speed, then swing
// the tonebars (Z up → Y across → Z down). Pure, so the remaining time can be simulated.
// state: { speed, lZ, lY, rZ, rY }; returns { spin, done }.
export function stepUp(s, delta, c) {
  if (s.speed < c.MAX_VINYL_SPEED_PER_SEC) {
    const accel = c.VINYL_ACCEL_BASE + c.VINYL_ACCEL_SCALE * (s.speed / c.MAX_VINYL_SPEED_PER_SEC);
    s.speed = Math.min(s.speed + accel * delta, c.MAX_VINYL_SPEED_PER_SEC);
    return { spin: s.speed * delta, done: false };
  }
  const spin = c.MAX_VINYL_SPEED_PER_SEC * delta;
  const step = c.TONEBAR_SPEED * delta * 60;
  const inInitialPhase = s.lY <= c.START_TONEBAR_LEFT_Y;
  if (inInitialPhase && (s.lZ < c.HIGH_TONEBAR_LEFT_Z || s.rZ > c.HIGH_TONEBAR_RIGHT_Z)) {
    s.lZ = Math.min(s.lZ + step, c.HIGH_TONEBAR_LEFT_Z);
    s.rZ = Math.max(s.rZ - step * c.LEFT_RIGHT_SF, c.HIGH_TONEBAR_RIGHT_Z);
  } else if (s.lY < c.HIGH_TONEBAR_LEFT_Y || s.rY > c.HIGH_TONEBAR_RIGHT_Y) {
    s.lY = Math.min(s.lY + step, c.HIGH_TONEBAR_LEFT_Y);
    s.rY = Math.max(s.rY - step, c.HIGH_TONEBAR_RIGHT_Y);
  } else if (s.lZ > c.FINAL_TONEBAR_LEFT_Z || s.rZ < c.FINAL_TONEBAR_RIGHT_Z) {
    s.lZ = Math.max(s.lZ - step, c.FINAL_TONEBAR_LEFT_Z);
    s.rZ = Math.min(s.rZ + step * c.LEFT_RIGHT_SF, c.FINAL_TONEBAR_RIGHT_Z);
  } else {
    return { spin, done: true };
  }
  return { spin, done: false };
}

// One frame of the release ("down") animation: tonebars back (Y then Z), then the
// vinyls decelerate to a stop. Same state shape as stepUp.
export function stepDown(s, delta, c) {
  const step = c.TONEBAR_SPEED * delta * 60;
  if (s.lY > c.START_TONEBAR_LEFT_Y || s.rY < c.START_TONEBAR_RIGHT_Y) {
    s.lY = Math.max(s.lY - step, c.START_TONEBAR_LEFT_Y);
    s.rY = Math.min(s.rY + step, c.START_TONEBAR_RIGHT_Y);
    return { spin: s.speed * delta, done: false };
  }
  if (s.lZ > c.START_TONEBAR_LEFT_Z || s.rZ < c.START_TONEBAR_RIGHT_Z) {
    s.lZ = Math.max(s.lZ - step, c.START_TONEBAR_LEFT_Z);
    s.rZ = Math.min(s.rZ + step * c.LEFT_RIGHT_SF, c.START_TONEBAR_RIGHT_Z);
    return { spin: s.speed * delta, done: false };
  }
  if (s.speed > 0) {
    const decel = c.VINYL_DECEL_BASE + c.VINYL_DECEL_SCALE * (s.speed / c.MAX_VINYL_SPEED_PER_SEC);
    s.speed = Math.max(s.speed - decel * delta, 0);
    return { spin: s.speed * delta, done: false };
  }
  return { spin: 0, done: true };
}

// Seconds an animation step needs (at speed 1) to finish from the given state.
function remainingSeconds(step, state, c, dt) {
  const s = { ...state };
  for (let t = 0; t < 30; t += dt) {
    if (step(s, dt, c).done) return t;
  }
  return 30;
}

export const remainingUpSeconds = (state, c, dt = 1 / 60) => remainingSeconds(stepUp, state, c, dt);
export const remainingDownSeconds = (state, c, dt = 1 / 60) => remainingSeconds(stepDown, state, c, dt);
