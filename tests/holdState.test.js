import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHoldState } from '../src/audio/holdState.js';

const run = (events, state = 'idle') => events.reduce(nextHoldState, state);

test('the drop only happens when a full hold is let go', () => {
  assert.equal(run(['press', 'complete']), 'armed');
  assert.equal(run(['press', 'complete', 'release']), 'playing');
});
test('letting go before the bar is full cancels', () => {
  assert.equal(run(['press', 'release']), 'idle');
  assert.equal(run(['press', 'release', 'complete']), 'idle');
});
test('pressing after the drop ends it; a reset never drops', () => {
  assert.equal(run(['press'], 'playing'), 'idle');
  assert.equal(run(['press', 'complete', 'reset']), 'idle');
});
test('re-holding while the song fades comes straight back without a let-go step', () => {
  const step = (state, event) => nextHoldState(state, event, { inSong: true });
  assert.equal(['press', 'complete'].reduce(step, 'idle'), 'playing');
});
