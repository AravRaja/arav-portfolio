// Builds the crew's bodies off the main thread: { id, outfit } in, { id, data } (typed arrays transferred) out; and the
// sim crew (simBody.js, the 9 MuJoCo capsule bodies merged): { id: 'sim', bodies, count } in, { id: 'sim', data } out.
import { buildCrewBodyData, transferables } from './crewBody.js';
import { buildSimBodyData, simTransferables } from './simBody.js';

self.onmessage = (e) => {
  const { id, outfit, bodies, count } = e.data;
  try {
    if (id === 'sim') {
      const data = buildSimBodyData(bodies, count);
      self.postMessage({ id, data }, simTransferables(data));
      return;
    }
    const data = buildCrewBodyData(outfit);
    self.postMessage({ id, data }, transferables(data));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
