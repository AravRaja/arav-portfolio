// The sim reveal's DOM side (simReveal.js): the 1 px divider with its round handle and `← SIM` tag, and, clipped to the
// revealed region, a move tag over every capsule dancer. Nothing here re-renders per
// frame: Crew's frame loop writes the positions / clip / tag text straight into these elements via `store.dom`.
import React, { useLayoutEffect, useRef } from 'react';

export default function RevealOverlay({ store, count = 9 }) {
  const root = useRef(null), line = useRef(null), handle = useRef(null), clip = useRef(null);
  const tags = useRef([]);
  useLayoutEffect(() => {
    store.dom = { root: root.current, line: line.current, handle: handle.current, clip: clip.current, tags: tags.current };
    store.x = -2; // force the next frame to write everything
    return () => { store.dom = {}; };
  }, [store]);
  return (
    <div className="sim-reveal" ref={root} aria-hidden="true">
      <div className="sim-reveal-clip" ref={clip}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="sim-reveal-tag" ref={(el) => { tags.current[i] = el; }}><span /><span /></div>
        ))}
      </div>
      <div className="sim-reveal-line" ref={line} />
      <div className="sim-reveal-handle" ref={handle}>
        <span className="sim-reveal-label">← SIM</span>
        <span className="sim-reveal-knob">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 6.5 4.5 10 8 13.5M12 6.5l3.5 3.5-3.5 3.5" /></svg>
        </span>
      </div>
    </div>
  );
}
