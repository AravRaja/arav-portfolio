// Keeps a react-three-fiber canvas drawing after the browser drops its WebGL context
// (GPU memory pressure, driver reset, too many contexts, a laptop switching GPUs).
//
// three.js already does half the job: WebGLRenderer calls preventDefault() on 'webglcontextlost'
// (so the browser is allowed to give the context back) and rebuilds all its GL state on
// 'webglcontextrestored'; geometry, shaders and textures then re-upload from their CPU copies on
// the next render. What it can't do:
//   - draw that next frame when r3f isn't looping (frameloop 'never' or 'demand'), so a canvas
//     restored while paused would stay blank;
//   - cope with a context that never comes back (the browser can refuse to restore it).
// This hook covers both: on restore it renders one frame straight away, and if no restore
// arrives within `timeoutMs` it calls `onUnrecoverable`, where the caller remounts the
// <Canvas> (bump its `key`) to get a brand-new context.
//
// Use it inside a <Canvas>, e.g. as <WebGLRecovery onUnrecoverable={() => setGlKey(k => k + 1)} />.
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

export function useWebGLRecovery({ onUnrecoverable, timeoutMs = 3000 } = {}) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const giveUp = useRef(onUnrecoverable);
  giveUp.current = onUnrecoverable;

  useEffect(() => {
    const canvas = gl.domElement;
    let timer = null;

    const onLost = (e) => {
      e.preventDefault(); // three does this too; without it the browser never restores
      clearTimeout(timer);
      timer = setTimeout(() => giveUp.current?.(), timeoutMs);
    };

    const onRestored = () => {
      clearTimeout(timer);
      // three's own 'restored' listener was added first, so its GL state is rebuilt by now.
      // Draw one frame even if the loop is paused; while it is running this is just an extra frame.
      const state = get();
      state.invalidate();
      state.advance(performance.now(), true);
    };

    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      clearTimeout(timer);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [gl, get, timeoutMs]);
}

export function WebGLRecovery(props) {
  useWebGLRecovery(props);
  return null;
}
