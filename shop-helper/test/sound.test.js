import test from 'node:test';
import assert from 'node:assert/strict';

function fakeContext() {
  const made = { oscillators: [], resumed: 0 };
  class Context {
    constructor() { this.currentTime = 1; this.state = 'suspended'; this.destination = {}; }
    resume() { made.resumed += 1; return Promise.resolve(); }
    createOscillator() {
      const osc = { frequency: {}, connect() {}, start(at) { this.startedAt = at; }, stop(at) { this.stoppedAt = at; } };
      made.oscillators.push(osc);
      return osc;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  }
  return { Context, made };
}

test('cues are synthesized, scaled by volume and refuse bad requests', async () => {
  const { Context, made } = fakeContext();
  globalThis.AudioContext = Context;
  await import('../sound.js');
  const sound = globalThis.shopHelperSound;

  assert.ok(sound.names.includes('alert') && sound.names.includes('success') && sound.names.includes('wrong'));
  assert.equal(sound.play('success', 0.5), true);
  assert.equal(made.oscillators.length, 3, 'the success cue has three notes');
  assert.equal(made.resumed, 1, 'a suspended context is resumed');
  assert.ok(made.oscillators.every(osc => osc.stoppedAt > osc.startedAt));
  assert.deepEqual(made.oscillators.map(osc => osc.frequency.value), [660, 880, 1320]);

  assert.equal(sound.play('success', 0), false, 'a silent volume plays nothing');
  assert.equal(sound.play('nope', 1), false, 'unknown cue');
  assert.equal(made.oscillators.length, 3);
  assert.equal(sound.play('tick', 2), true, 'a volume above 1 is clamped, not refused');
  delete globalThis.AudioContext;
});
