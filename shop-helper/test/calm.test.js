import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function fakeDocument() {
  const nodes = [];
  const head = { append(node) { node.parent = head; nodes.push(node); } };
  return {
    nodes,
    head,
    documentElement: head,
    getElementById: id => nodes.find(node => node.id === id && node.parent) ?? null,
    createElement: () => ({ remove() { this.parent = null; } }),
  };
}

async function load() {
  const document = fakeDocument();
  globalThis.document = document;
  delete globalThis.chrome;
  await import(`../calm.js?${Math.random()}`);
  return { calm: globalThis.shopHelperCalm, document };
}

test('turning the setting on adds one stylesheet and turning it off removes it', async () => {
  const { calm, document } = await load();
  calm.set(true);
  calm.set(true);
  const style = document.getElementById('rngidle-shop-helper-calm');
  assert.ok(style, 'the stylesheet is added');
  assert.equal(document.nodes.length, 1, 'turning it on twice does not stack stylesheets');
  assert.equal(style.textContent, calm.CSS);
  calm.set(false);
  assert.equal(document.getElementById('rngidle-shop-helper-calm'), null);
  calm.set(false);
});

test('the stylesheet covers the page-wide distortions', async () => {
  const { calm } = await load();
  for (const needle of ['.gbr-jolt', '.gbr-flip', '.gbr-tilt', 'text-shadow: none', 'clip-path: none', '.gbr-static', '.gbr-scan', '.ui-glitching']) {
    assert.ok(calm.CSS.includes(needle), `missing ${needle}`);
  }
});

test('every rule stays inside the game’s breach classes and leaves gameplay alone', async () => {
  const { calm } = await load();
  const rules = [...calm.CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  assert.ok(rules.length >= 10);
  for (const { selector } of rules) {
    for (const part of selector.split(/,(?![^(]*\))/).map(s => s.trim())) {
      assert.match(part, /^(?::root\.gbr-|\.gbr-)/, `“${part}” could reach beyond the breach styling`);
    }
  }
  for (const forbidden of ['chaos', 'glx-', 'gbr-skip', 'gbr-arrive', 'gbr-cf', 'gbr-npc', 'pointer-events', 'display:', 'display :']) {
    assert.ok(!calm.CSS.includes(forbidden), `the stylesheet must not touch ${forbidden}`);
  }
  assert.ok(calm.CSS.includes(':not(.gbr-run)'), 'the minigame run keeps its own straight, clean screen');
  assert.ok(rules.every(({ body }) => body.includes('!important')), 'each rule has to win over the game’s styles');
});

test('the script only toggles a stylesheet', () => {
  const source = fs.readFileSync(new URL('../calm.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|outerHTML|eval\(|fetch\(|sendMessage/.test(source), 'the script only toggles a stylesheet');
});
