import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHoldGate } from '../src/audio/holdGate.js';
function setup() {
  const pending = [], events = [];
  const gate = createHoldGate({ prepare: () => new Promise(resolve => pending.push(resolve)), start: () => events.push('start'), stop: () => events.push('stop') });
  return { gate, pending, events };
}
test('release while loading cannot start playback later', async () => {
  const { gate, pending, events } = setup();
  const hold = gate.setHeld(true); await gate.setHeld(false); pending.shift()(); await hold;
  assert.deepEqual(events, ['stop']);
});
test('held playback stops on release and ignores key repeat', async () => {
  const { gate, pending, events } = setup();
  const hold = gate.setHeld(true); await gate.setHeld(true);
  assert.equal(pending.length, 1); pending.shift()(); await hold;
  await gate.setHeld(false); assert.deepEqual(events, ['start', 'stop']);
});
test('navigation/unmount invalidates pending playback', async () => {
  const { gate, pending, events } = setup();
  const hold = gate.setHeld(true); gate.dispose(); pending.shift()(); await hold;
  await gate.setHeld(true); assert.deepEqual(events, ['stop']);
});
test('rapid release and repress only starts the latest hold', async () => {
  const { gate, pending, events } = setup();
  const first = gate.setHeld(true); await gate.setHeld(false); const second = gate.setHeld(true);
  pending.shift()(); await first; assert.deepEqual(events, ['stop']);
  pending.shift()(); await second; assert.deepEqual(events, ['stop', 'start']);
});

const { nextHoldState } = await import('../src/audio/holdState.js');
test('completed hold stays playing after release; next press stops it', () => {
  let state = nextHoldState('idle', 'press');
  state = nextHoldState(state, 'complete');
  state = nextHoldState(state, 'release');
  assert.equal(state, 'playing');
  assert.equal(nextHoldState(state, 'press'), 'idle');
  assert.equal(nextHoldState(state, 'reset'), 'idle');
});
test('incomplete hold cancels and late completion cannot reactivate it', () => {
  let state = nextHoldState('idle', 'press');
  state = nextHoldState(state, 'release');
  assert.equal(state, 'idle');
  assert.equal(nextHoldState(state, 'complete'), 'idle');
});
