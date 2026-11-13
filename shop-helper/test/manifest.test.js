import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const exists = (path) => fs.existsSync(new URL(path, root));
const manifest = JSON.parse(read('manifest.json'));

test('every file the manifest references is packaged', () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(script => script.js),
    ...manifest.web_accessible_resources.flatMap(entry => entry.resources),
  ];
  for (const file of files) assert.ok(exists(file), `${file} is missing`);
});

test('the version shown in the menu is consistent', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const [major, minor] = manifest.version.split('.');
  assert.ok(manifest.version_name.includes(`${major}.${minor}`), 'version_name should match version');
});

test('the in-game menu is wired up and limited to the game site', () => {
  assert.ok(manifest.content_scripts[0].js.includes('overlay.js'));
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://rngidle.fun/*']);
  const [shared] = manifest.web_accessible_resources;
  assert.deepEqual(shared.resources, ['popup.html']);
  assert.deepEqual(shared.matches, ['https://rngidle.fun/*']);
  assert.ok(read('overlay.js').includes('popup.html?embedded=1'));
  assert.ok(read('overlay.js').includes('glitchAlert'), 'the in-game button should react to Glitch alerts');
});

test('popup.html has unique ids and every id the scripts look up', () => {
  const html = read('popup.html');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids in popup.html');
  for (const file of ['popup.js', 'popup-ui.js', 'popup-glitch.js', 'popup-market.js', 'popup-history.js', 'popup-settings.js']) {
    for (const [, id] of read(file).matchAll(/(?:getElementById|\$)\(["']([^"']+)["']\)/g)) {
      assert.ok(ids.includes(id), `${file} looks up #${id}, which popup.html does not define`);
    }
  }
});

test('popup.html loads only packaged scripts and styles', () => {
  const html = read('popup.html');
  for (const [, file] of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)) {
    assert.ok(exists(file), `${file} is referenced but missing`);
  }
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'inline scripts are blocked by the extension CSP');
});

test('the menu never uses blocking dialogs or HTML injection', () => {
  for (const file of ['popup.js', 'popup-ui.js', 'popup-glitch.js', 'popup-market.js', 'popup-history.js', 'popup-settings.js', 'glitch.js', 'overlay.js']) {
    const source = read(file).replace(/\/\/.*$/gm, '');
    assert.ok(!/\b(?:alert|confirm|prompt)\(/.test(source), `${file} uses a blocking dialog`);
    assert.ok(!/\.(?:innerHTML|outerHTML)\s*=/.test(source.replace(/root\.innerHTML = `[\s\S]*?`;/, '')), `${file} assigns HTML`);
  }
});

test('sound and notifications are wired without widening access', () => {
  assert.deepEqual(manifest.content_scripts[0].js, ['sound.js', 'content.js', 'overlay.js'], 'sound.js must load before the overlay uses it');
  assert.ok(manifest.permissions.includes('notifications'));
  assert.deepEqual(manifest.host_permissions, ['https://rngidle.fun/*']);
  assert.ok(read('popup.html').includes('src="sound.js"'), 'the menu plays its own cues');
});

test('every module the menu loads is packaged and every tab has its panel', () => {
  const html = read('popup.html');
  for (const [, file] of html.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(exists(file), `${file} is missing`);
  for (const tab of ['autobuy', 'glitch', 'checker', 'history', 'settings']) {
    assert.ok(html.includes(`id="panel-${tab}"`) && html.includes(`data-tab="${tab}"`), `the ${tab} tab is incomplete`);
  }
});
