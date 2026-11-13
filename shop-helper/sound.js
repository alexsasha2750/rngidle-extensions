// Short synthesized cues, so the extension ships no audio files. Loaded as a plain script both
// by the menu and as a content script, which is why it publishes itself on globalThis.
(() => {
  // [frequency Hz, start s, length s, wave]
  const CUES = {
    alert: [[880, 0, 0.12, 'sine'], [1175, 0.14, 0.12, 'sine'], [1568, 0.28, 0.26, 'sine']],
    success: [[660, 0, 0.09, 'triangle'], [880, 0.09, 0.09, 'triangle'], [1320, 0.18, 0.24, 'triangle']],
    fail: [[330, 0, 0.16, 'triangle'], [247, 0.16, 0.3, 'triangle']],
    correct: [[784, 0, 0.08, 'sine'], [1175, 0.08, 0.16, 'sine']],
    wrong: [[196, 0, 0.14, 'sawtooth'], [147, 0.14, 0.26, 'sawtooth']],
    start: [[523, 0, 0.07, 'sine'], [784, 0.07, 0.12, 'sine']],
    tick: [[1000, 0, 0.04, 'square']],
  };
  const PEAK = 0.22;

  let audio = null;
  function context() {
    if (audio) return audio;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return null;
    try { audio = new Context(); } catch { audio = null; }
    return audio;
  }

  // Returns true when a cue was scheduled. Browsers keep audio suspended until the page has
  // been interacted with, so a cue may stay silent on a page the player never touched.
  function play(name, volume = 0.5) {
    const notes = CUES[name];
    const level = Math.min(1, Math.max(0, Number(volume)));
    if (!notes || !(level > 0)) return false;
    const ctx = context();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
    const begin = ctx.currentTime + 0.02;
    for (const [frequency, offset, length, wave] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = begin + offset;
      osc.type = wave;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(PEAK * level, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + length + 0.03);
    }
    return true;
  }

  globalThis.shopHelperSound = { play, names: Object.keys(CUES) };
})();
