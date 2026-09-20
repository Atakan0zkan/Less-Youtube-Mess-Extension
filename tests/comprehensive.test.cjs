// Less Youtube Mess — Comprehensive AI-less static + unit suite.
// Zero dependencies. Runs with: node --test tests/comprehensive.test.cjs
// Complements tests/regression.test.cjs (13 focused lifecycle tests) with
// contract/policy/normalization coverage for all 25 settings. No network,
// no browser, no AI, no tokens — pure dumb assertions for CI blocking job.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const source = (file) => readFileSync(join(root, file), 'utf8');

// ---------- minimal DOM harness (same shape as regression.test.cjs) ----------
function element() {
  const attrs = new Map();
  const styles = new Map();
  return {
    nodeType: 1, isConnected: true, checked: false, disabled: false,
    children: [], textContent: '',
    setAttribute: (key, value) => attrs.set(key, value),
    getAttribute: (key) => attrs.get(key) ?? null,
    hasAttribute: (key) => attrs.has(key),
    removeAttribute: (key) => attrs.delete(key),
    querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, remove() {}, addEventListener() {},
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
    style: {
      setProperty: (k, v) => styles.set(k, v),
      removeProperty: (k) => styles.delete(k),
      getPropertyValue: (k) => styles.get(k) || '',
      getPropertyPriority: () => '',
    },
  };
}

function environment(file) {
  const nodes = new Map();
  const timers = new Map();
  const listeners = new Map();
  const pending = { local: [], sync: [] };
  let timerId = 0;
  const document = {
    documentElement: element(), body: element(), head: element(), hidden: false,
    getElementById: (id) => nodes.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => element(), addEventListener() {},
  };
  const context = vm.createContext({
    console, URL, Set, Map, AbortController, TextDecoder, Uint8Array,
    Node: { ELEMENT_NODE: 1 }, document,
    location: new URL('https://www.youtube.com/watch?v=abcdefghijk'),
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id), queueMicrotask: () => {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    dispatchEvent: (event) => listeners.get(event.type)?.(event),
    CustomEvent: class { constructor(type) { this.type = type; } },
    getComputedStyle: (el) => ({ display: el.style.getPropertyValue('display') || 'block', visibility: 'visible', opacity: '1' }),
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    localStorage: { setItem() {} },
    chrome: {
      runtime: { id: 'test', getURL: (f) => `chrome-extension://test/${f}` },
      storage: {
        local: { get: (keys, cb) => pending.local.push(cb), set() {} },
        sync: { get: (keys, cb) => pending.sync.push(cb), set() {} },
        onChanged: { addListener() {} },
      },
    },
  });
  context.window = context;
  context.self = context;
  vm.runInContext(source('shared/constants.js'), context);
  vm.runInContext(source(file), context);
  return { context, document, nodes, timers, pending, run: (code) => vm.runInContext(code, context) };
}

// ================= STATIC / CONTRACT =================

test('static: manifest least-privilege contract', () => {
  const m = JSON.parse(source('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.content_scripts[0].matches, ['https://www.youtube.com/*']);
  assert.deepEqual(m.web_accessible_resources[0].matches, ['https://www.youtube.com/*']);
  assert.deepEqual(m.web_accessible_resources[0].resources, ['page-audio-bridge.js']);
  assert.deepEqual(m.content_scripts[0].js, ['shared/constants.js', 'content.js']);
  assert.ok(m.content_scripts[0].css.includes('styles.css'));
  assert.equal(m.content_scripts[0].run_at, 'document_start');
  assert.equal(m.minimum_chrome_version, '105');
  assert.equal(m.default_locale, 'en');
  assert.equal(m.action.default_popup, 'popup.html');
  assert.match(m.content_security_policy.extension_pages, /script-src 'self'/);
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
});

test('static: package version matches manifest', () => {
  const pkg = JSON.parse(source('package.json'));
  const m = JSON.parse(source('manifest.json'));
  assert.equal(pkg.version, m.version);
  assert.ok(pkg.engines.node.includes('22'));
  assert.ok(pkg.scripts.test.includes('regression') && pkg.scripts.test.includes('comprehensive'));
});

test('static: 25 settings contract — keys, defaults, popup inputs', () => {
  const env = environment('popup.js');
  const keys = env.context.SETTINGS_KEYS;
  assert.equal(keys.length, 25);
  assert.ok(Object.values(env.context.DEFAULTS).every((v) => v === false));
  const inputs = [...source('popup.html').matchAll(/<input[^>]*id="([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(inputs, Array.from(keys).sort());
  // UI-only prefs must NOT leak into sync keys
  assert.ok(!keys.includes('theme'));
  assert.ok(!keys.includes('extension_enabled'));
  assert.ok(!keys.includes('popup_language_override'));
  assert.ok(!keys.includes('collapsed_groups'));
});

test('static: popup wiring — ENG, power, compact dependency', () => {
  const html = source('popup.html');
  const js = source('popup.js');
  assert.ok(html.includes('id="language-toggle"'));
  assert.ok(html.includes('id="power-toggle"'));
  assert.ok(html.includes('id="compact_list_view"'));
  assert.ok(js.includes('popup_language_override'));
  assert.ok(js.includes('applyExtensionDisabledState'));
  assert.ok(js.includes('updateCompactRowState'));
  assert.ok(html.includes('aria-pressed'));
});

test('static: locales — 24 folders, 59 keys, same set, no empty', () => {
  const locales = readdirSync(join(root, '_locales'));
  assert.equal(locales.length, 24);
  const enKeys = Object.keys(JSON.parse(source('_locales/en/messages.json'))).sort();
  assert.equal(enKeys.length, 59);
  assert.ok(enKeys.includes('extDescription'));
  for (const locale of locales) {
    const data = JSON.parse(source(`_locales/${locale}/messages.json`));
    assert.deepEqual(Object.keys(data).sort(), enKeys, locale);
    for (const [k, v] of Object.entries(data)) {
      assert.ok(v.message && v.message.trim().length > 0, `${locale}/${k} empty`);
    }
  }
});

test('static: CSS policy — no dub-menu hiding, no global overflow, scoped clip', () => {
  const css = source('styles.css');
  assert.doesNotMatch(css, /html\[disable_auto_dubbing/);
  assert.doesNotMatch(css, /body[^{]*\{[^}]*overflow-x\s*:\s*hidden/);
  assert.doesNotMatch(css, /position\s*:\s*absolute/);
  assert.ok(css.includes(':has('));
  assert.ok(css.includes('ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'));
  assert.ok(css.includes('ENGAGEMENT_PANEL_VISIBILITY_VISIBLE'));
  assert.ok(css.includes('overflow-x: clip'));
  // blur must use Shadow-DOM-safe container filter + clip-path
  assert.ok(css.includes('blur_thumbnails'));
  assert.ok(css.includes('clip-path: inset(0)'));
});

test('static: selector centralization — no hardcoded item selectors in content.js', () => {
  const content = source('content.js');
  const constants = source('shared/constants.js');
  assert.ok(constants.includes('ytd-rich-item-renderer'));
  assert.ok(!content.includes('ytd-rich-item-renderer'));
  assert.ok(content.includes('queryOne('));
  assert.ok(content.includes('queryAll('));
  assert.ok(content.includes('matchesAny('));
  assert.ok(content.includes('SELECTORS.SUBSCRIPTION_ITEM'));
  assert.ok(content.includes('getSubscriptionItems'));
});

test('static: packaging — zip helper and required files exist', () => {
  const bat = source('package.bat');
  for (const f of ['page-audio-bridge.js', 'shared', 'icons', '_locales', 'manifest.json', 'content.js', 'styles.css', 'popup.html']) {
    assert.ok(bat.includes(f), `package.bat missing ${f}`);
  }
  for (const f of ['manifest.json', 'content.js', 'styles.css', 'popup.html', 'popup.js', 'page-audio-bridge.js', 'shared/constants.js']) {
    assert.ok(existsSync(join(root, f)), `missing ${f}`);
  }
  const bridge = source('page-audio-bridge.js');
  assert.doesNotMatch(bridge, /chrome\.storage/);
  assert.doesNotMatch(bridge, /fetch\s*\(/);
});

// ================= UNIT (vm) =================

test('unit: boolean normalization matrix (legacy strings safe)', () => {
  const env = environment('content.js');
  const { coerceBooleanLike } = env.context;
  for (const v of [true, 'true', ' TRUE ', '1', 'yes', 'YES', 'on', 'ON']) assert.equal(coerceBooleanLike(v, false), true);
  for (const v of [false, 'false', ' FALSE ', '0', 'no', 'NO', 'off', 'OFF']) assert.equal(coerceBooleanLike(v, true), false);
  assert.equal(coerceBooleanLike('maybe', true), true);
  assert.equal(coerceBooleanLike('maybe', false), false);
  assert.equal(coerceBooleanLike(undefined, true), true);
  assert.equal(coerceBooleanLike(null, false), false);
  assert.equal(coerceBooleanLike(1, false), false); // only boolean+string accepted
});

test('unit: normalizeSettings — legacy "false" never enables', () => {
  const env = environment('content.js');
  const out = env.run('normalizeSettings({ hide_shorts: "false", hide_sidebar: "1", list_view: true })');
  assert.equal(out.hide_shorts, false);
  assert.equal(out.hide_sidebar, true);
  assert.equal(out.list_view, true);
  assert.equal(out.hide_comments, false);
});

test('unit: shouldRedirectToSubscriptions — homepage only', () => {
  const env = environment('content.js');
  assert.equal(env.run('shouldRedirectToSubscriptions("https://www.youtube.com/")'), true);
  assert.equal(env.run('shouldRedirectToSubscriptions("https://www.youtube.com/?themeRefresh=1")'), true);
  assert.equal(env.run('shouldRedirectToSubscriptions("https://www.youtube.com/feed/subscriptions")'), false);
  assert.equal(env.run('shouldRedirectToSubscriptions("https://www.youtube.com/watch?v=abcdefghijk")'), false);
  assert.equal(env.run('shouldRedirectToSubscriptions("not a url")'), false);
});

test('unit: applySettings maps all 25 keys, strips when disabled', () => {
  const env = environment('content.js');
  env.run('extensionEnabled = true; applySettings({ hide_shorts: true })');
  assert.equal(env.document.documentElement.getAttribute('hide_shorts'), 'true');
  assert.equal(env.document.documentElement.getAttribute('hide_comments'), 'false');
  assert.equal(env.run('SETTINGS_KEYS.length'), 25);
  env.run('extensionEnabled = false; applySettings(cachedSettings)');
  for (const k of env.run('SETTINGS_KEYS')) {
    assert.equal(env.document.documentElement.getAttribute(k), null, k);
  }
  assert.equal(env.timers.size, 0);
});

test('unit: description pipeline budgets', () => {
  const env = environment('content.js');
  assert.equal(env.run('MAX_CONCURRENT_FETCHES'), 3);
  assert.equal(env.run('MAX_DESCRIPTION_QUEUE'), 100);
  assert.equal(env.run('MAX_DESCRIPTION_CACHE_ENTRIES'), 250);
  assert.equal(env.run('MAX_DESCRIPTION_HEAD_BYTES'), 15000);
});

test('unit: transcript override constants cover both native states', () => {
  const env = environment('content.js');
  assert.equal(env.run('TRANSCRIPT_SIDEBAR_MARKER'), 'data-lym-transcript-active');
  assert.equal(env.run('TRANSCRIPT_OPEN_GRACE_MS'), 5000);
  const natives = env.run('TRANSCRIPT_NATIVE_ACTIVE_SELECTORS.join("\\n")');
  assert.ok(natives.includes('ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'));
  assert.ok(natives.includes('ENGAGEMENT_PANEL_VISIBILITY_VISIBLE'));
});

test('unit: audio retry schedule is exactly 5 content-owned attempts', () => {
  const env = environment('content.js');
  assert.equal(JSON.stringify(env.run('ORIGINAL_AUDIO_RETRY_DELAYS_MS')), JSON.stringify([0, 600, 1500, 3500, 6000]));
});

test('unit: audio bridge multilingual originals beat dubbed labels', () => {
  const cases = [
    ['Orijinal ses', true],
    ['Originalton', true],
    ['オリジナル', true],
    ['원본 오디오', true],
    ['English (dubbed)', false],
    ['Otomatik dublaj', false],
    ['Doblaje automático', false],
  ];
  for (const [label, isOriginal] of cases) {
    const env = environment('page-audio-bridge.js');
    const other = { name: isOriginal ? 'English (dubbed)' : 'Original audio' };
    const target = { name: label };
    const tracks = isOriginal ? [other, target] : [target, other];
    let selected;
    env.document.getElementById = () => ({ getAvailableAudioTracks: () => tracks, setAudioTrack: (t) => { selected = t; } });
    env.run("dispatchEvent(new CustomEvent('less-youtube-mess:force-original-audio'))");
    assert.equal(selected && selected.name, isOriginal ? label : 'Original audio', label);
  }
});

test('unit: extension-owned markers are namespaced for reversible cleanup', () => {
  const env = environment('content.js');
  for (const name of ['CONTROL_HIDE_MARKER', 'THUMBNAIL_PLAYBACK_MARKER', 'PREMIUM_DIALOG_MARKER', 'PREMIUM_BACKDROP_MARKER', 'PREMIUM_PROMO_MARKER']) {
    const v = env.run(name);
    assert.ok(String(v).startsWith('data-lym-'), `${name}=${v}`);
  }
});
