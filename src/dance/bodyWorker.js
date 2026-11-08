// Builds the crew's bodies off the main thread: { id, outfit } in, { id, data } (typed arrays transferred) out.
import { buildCrewBodyData, transferables } from './crewBody.js';

self.onmessage = (e) => {
  const { id, outfit } = e.data;
  try {
    const data = buildCrewBodyData(outfit);
    self.postMessage({ id, data }, transferables(data));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
