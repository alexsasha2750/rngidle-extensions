import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerMenuCommands, toggleMenu, TOGGLE_MENU } from '../menu-commands.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    writes: 0,
    async get(key) { return key in data ? { [key]: data[key] } : {}; },
    async set(values) { this.writes += 1; Object.assign(data, values); },
  };
}
function fakeChrome() {
  const listeners = [];
  return { listeners, commands: { onCommand: { addListener: listener => listeners.push(listener) } } };
}

test('the shortcut opens the menu, and pressing it again closes it', async () => {
  const storage = fakeStorage();
  const chrome = fakeChrome();
  const listener = registerMenuCommands({ storage, chrome });
  assert.equal(chrome.listeners.length, 1);
  assert.equal(chrome.listeners[0], listener);
  assert.equal(await listener(TOGGLE_MENU), true);
  assert.equal(storage.data.uiOpen, true);
  assert.equal(await listener(TOGGLE_MENU), false);
  assert.equal(storage.data.uiOpen, false);
  storage.data.uiOpen = 'yes';
  assert.equal(await listener(TOGGLE_MENU), true, 'anything but true counts as closed');
});

test('other commands leave the menu alone', async () => {
  const storage = fakeStorage({ uiOpen: true });
  const chrome = fakeChrome();
  registerMenuCommands({ storage, chrome });
  assert.equal(chrome.listeners[0]('_execute_action'), undefined);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(storage.writes, 0);
  assert.equal(storage.data.uiOpen, true);
});

test('the listener is registered once and copes with a missing API or storage errors', async () => {
  const storage = fakeStorage();
  const chrome = fakeChrome();
  assert.ok(registerMenuCommands({ storage, chrome }));
  assert.equal(registerMenuCommands({ storage, chrome }), null);
  assert.equal(chrome.listeners.length, 1);
  assert.equal(registerMenuCommands({ storage, chrome: {} }), null);
  assert.equal(registerMenuCommands(), null);
  const broken = { async get() { throw new Error('gone'); }, async set() {} };
  const other = fakeChrome();
  const listener = registerMenuCommands({ storage: broken, chrome: other });
  assert.equal(await listener(TOGGLE_MENU), null);
  // It falls back to chrome.storage.local when no storage is passed.
  const local = fakeStorage();
  const third = { ...fakeChrome(), storage: { local } };
  await registerMenuCommands({ chrome: third })(TOGGLE_MENU);
  assert.equal(local.data.uiOpen, true);
});

test('toggleMenu writes the opposite of what is saved', async () => {
  const storage = fakeStorage({ uiOpen: false });
  assert.equal(await toggleMenu(storage), true);
  assert.equal(await toggleMenu(storage), false);
});

test('the manifest declares the shortcut this handler listens for', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.commands?.[TOGGLE_MENU]?.suggested_key?.default, 'Alt+Shift+H');
});
