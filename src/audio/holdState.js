// Fill the bar to arm the drop, then let go to drop it; an early release cancels it.
// idle → holding → armed (full, still held) → playing (released) → press → idle
// Re-holding while the song is still fading out (inSong) skips the armed step: the song
// comes straight back once the bar is full.
export function nextHoldState(state, event, { inSong = false } = {}) {
  if (event === 'reset') return 'idle';
  if (event === 'press') return state === 'playing' ? 'idle' : 'holding';
  if (event === 'complete' && state === 'holding') return inSong ? 'playing' : 'armed';
  if (event === 'release' && state === 'holding') return 'idle';
  if (event === 'release' && state === 'armed') return 'playing';
  return state;
}
