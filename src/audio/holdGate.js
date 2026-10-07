// A released or unmounted hold can never start audio after async loading finishes.
export function createHoldGate({ prepare, start, stop }) {
  let held = false;
  let disposed = false;
  let generation = 0;
  return {
    async setHeld(next) {
      if (disposed || next === held) return;
      held = next;
      const request = ++generation;
      if (!next) { stop(); return; }
      try {
        await prepare();
        if (!disposed && held && request === generation) start();
      } catch {
        if (!disposed && request === generation) { held = false; stop(); }
      }
    },
    dispose() { held = false; disposed = true; ++generation; stop(); },
  };
}
