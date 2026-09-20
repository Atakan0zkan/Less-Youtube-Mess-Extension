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

// ---------- subscription item + control fakes for supplement tests ----------
function subItem({ href = null, overlay = false, badge = '', button = '', meta = '' } = {}) {
  const attrs = new Map();
  const link = href ? { href } : null;
  const overlayEl = overlay ? {} : null;
  const badgeEls = badge ? [{ textContent: badge }] : [];
  const buttonEls = button ? [{ textContent: button }] : [];
  const metaEl = meta ? { textContent: meta } : null;
  return {
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    querySelector: (sel) => {
      if (sel.includes('/watch')) return link;
      if (sel.includes('overlay-style')) return overlayEl;
      if (sel.includes('metadata')) return metaEl;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('button')) return buttonEls;
      if (sel.includes('badge-shape') || sel.includes('attributed-string')) return badgeEls;
      return [];
    },
  };
}

function controlFake({ text = '', labelled = '', upload = false } = {}) {
  const attrs = new Map();
  if (labelled) attrs.set('aria-label', labelled);
  return {
    nodeType: 1, textContent: text, children: [{},],
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    matches: (sel) => upload && sel.includes('/upload'),
    querySelector: (sel) => (upload && sel.includes('/upload') ? {} : null),
    style: {
      _props: new Map(),
      setProperty: function (k, v) { this._props.set(k, v); },
      removeProperty: function (k) { this._props.delete(k); },
      getPropertyValue: function (k) { return this._props.get(k) || ''; },
      getPropertyPriority: () => '',
    },
  };
}

test('unit: live/premiere marking — overlay, badge, reminder, recycle, skip', () => {
  const env = environment('content.js');
  env.context.item = subItem({ href: '/watch?v=abcdefghijk', overlay: true });
  env.run('markLiveAndPremieres([item])');
  assert.equal(env.run(`item.getAttribute('data-live-premiere')`), 'true');
  assert.equal(env.run(`item.getAttribute('data-live-checked')`), 'https://www.youtube.com/watch?v=abcdefghijk');

  // NOTE: all-caps Turkish 'CANLI' does NOT match badgeText (/i folds I->i,
  // not Turkish dotless ı). Known product gap, documented in riskBacklog;
  // this test locks current behavior with mixed-case 'Canlı'.
  env.context.item2 = subItem({ href: '/watch?v=abcdefghijk', badge: 'Canlı' });
  env.run('markLiveAndPremieres([item2])');
  assert.equal(env.run(`item2.getAttribute('data-live-premiere')`), 'true');

  env.context.item3 = subItem({ href: '/watch?v=abcdefghijk', button: 'Remind me' });
  env.run('markLiveAndPremieres([item3])');
  assert.equal(env.run(`item3.getAttribute('data-live-premiere')`), 'true');

  env.context.item4 = subItem({ href: '/watch?v=abcdefghijk' });
  env.run('markLiveAndPremieres([item4])');
  assert.equal(env.run(`item4.getAttribute('data-live-premiere')`), null);
  assert.ok(env.run(`item4.getAttribute('data-live-checked')`));

  // Recycled card: same item, new video, no live signal -> old mark removed.
  env.context.item.setAttribute('data-live-premiere', 'true');
  env.run(`item.querySelector = (sel) => sel.includes('/watch') ? { href: '/watch?v=12345678901' } : null`);
  env.run(`item.querySelectorAll = () => []`);
  env.run('markLiveAndPremieres([item])');
  assert.equal(env.run(`item.getAttribute('data-live-premiere')`), null);

  // Shorts / malformed hrefs are skipped entirely.
  env.context.item5 = subItem({ href: '/shorts/abcdefghijk', overlay: true });
  env.run('markLiveAndPremieres([item5])');
  assert.equal(env.run(`item5.getAttribute('data-live-checked')`), null);
});

test('unit: like text supplement hides, skips empties, cleans on off', () => {
  const env = environment('content.js');
  const text = element();
  text.textContent = '12K';
  env.document.querySelectorAll = () => [text];
  env.run('cachedSettings.hide_likes = true; likesDirty = true; forceLikesVisibility()');
  assert.equal(text.getAttribute('data-lym-likes-applied'), 'hidden');
  assert.equal(text.style.getPropertyValue('display'), 'none');

  const empty = element();
  env.context.emptyEl = empty;
  env.run('hideLikeTextElement(emptyEl)');
  assert.equal(env.run(`emptyEl.getAttribute('data-lym-likes-applied')`), null);

  env.run('cachedSettings.hide_likes = false; forceLikesVisibility()');
  assert.equal(text.getAttribute('data-lym-likes-applied'), null);
  assert.equal(text.style.getPropertyValue('display'), '');
});

test('unit: create/hype supplements match targets, ignore others, clean on off', () => {
  const env = environment('content.js');
  const upload = controlFake({ upload: true });
  const named = controlFake({ text: '+Create' });
  const hype = controlFake({ text: 'Hype' });
  const plain = controlFake({ text: 'Share' });
  env.document.querySelectorAll = (sel) => (
    String(sel).includes('control-hidden') ? [upload, named, hype].filter((el) => el.getAttribute('data-lym-control-hidden')) : [upload, named, hype, plain]
  );
  env.run('cachedSettings.hide_create_button = true; hideCreateButtonSupplement()');
  assert.equal(upload.getAttribute('data-lym-control-hidden'), 'create');
  assert.equal(named.getAttribute('data-lym-control-hidden'), 'create');
  assert.equal(plain.getAttribute('data-lym-control-hidden'), null);
  env.run('cachedSettings.hide_hype_button = true; hideHypeButton()');
  assert.equal(hype.getAttribute('data-lym-control-hidden'), 'hype');
  assert.equal(plain.getAttribute('data-lym-control-hidden'), null);
  env.run('cachedSettings.hide_create_button = false; cachedSettings.hide_hype_button = false; hideCreateButtonSupplement(); hideHypeButton()');
  assert.equal(upload.getAttribute('data-lym-control-hidden'), null);
  assert.equal(hype.getAttribute('data-lym-control-hidden'), null);
});

test('unit: control text regexes cover locales without matching plain actions', () => {
  const env = environment('content.js');
  for (const label of ['+Create', 'Oluştur', 'Créer', 'Utwórz']) {
    assert.ok(env.run(`CREATE_TEXT_RE.test(${JSON.stringify(label)})`), label);
  }
  for (const label of ['Hype', 'Thanks', 'Teşekkürler', 'Super Thanks']) {
    assert.ok(env.run(`HYPE_TEXT_RE.test(${JSON.stringify(label)})`), label);
  }
  assert.equal(env.run(`CREATE_TEXT_RE.test('Share')`), false);
  assert.equal(env.run(`HYPE_TEXT_RE.test('Share')`), false);
  const el = controlFake({ labelled: 'Thanks', text: 'ignored' });
  env.context.ctrl = el;
  assert.ok(env.run(`getControlText(ctrl).includes('Thanks')`));
});

test('unit: autoplay persists localStorage and clicks an active toggle', () => {
  const env = environment('content.js');
  const writes = [];
  env.context.localStorage = { setItem: (k, v) => writes.push([k, v]) };
  let clicked = 0;
  const toggle = { click: () => { clicked++; } };
  env.document.querySelector = (sel) => (sel.includes('autonav') ? toggle : null);
  env.run('cachedSettings.hide_autoplay = true; applyAutoplay()');
  assert.ok(writes.some(([k, v]) => k === 'yt-autoplay' && v === '0'));
  assert.equal(clicked, 1);
  env.run('cachedSettings.hide_autoplay = false; applyAutoplay()');
  assert.equal(clicked, 1);
});

test('unit: premium promo signal requires premium text or link', () => {
  const env = environment('content.js');
  env.context.p1 = { textContent: 'Try YouTube Premium free', querySelector: () => null };
  env.context.p2 = { textContent: 'Share this video', querySelector: () => null };
  env.context.p3 = { textContent: 'Offer', querySelector: (sel) => (sel.includes('/premium') ? {} : null) };
  assert.equal(env.run('hasPremiumPromoSignal(p1)'), true);
  assert.equal(env.run('hasPremiumPromoSignal(p2)'), false);
  assert.equal(env.run('hasPremiumPromoSignal(p3)'), true);
});

test('unit: thumbnail playback supplement pauses, marks, and cleans on off', () => {
  const env = environment('content.js');
  let paused = 0;
  const video = {
    pause: () => { paused++; }, muted: false,
    style: {
      _props: new Map(),
      setProperty: function (k, v) { this._props.set(k, v); },
      removeProperty: function (k) { this._props.delete(k); },
      getPropertyValue: function (k) { return this._props.get(k) || ''; },
      getPropertyPriority: () => 'important',
    },
    setAttribute: (k, v) => video.attrs.set(k, v),
    getAttribute: (k) => video.attrs.get(k) ?? null,
    removeAttribute: (k) => video.attrs.delete(k),
    attrs: new Map(),
  };
  env.document.querySelectorAll = () => [video];
  env.document.documentElement.setAttribute('disable_thumbnail_playback', 'true');
  env.run('cachedSettings.disable_thumbnail_playback = true; disableThumbnailPlayback()');
  assert.equal(paused, 1);
  assert.equal(video.attrs.get('data-lym-thumbnail-playback-disabled'), 'true');
  env.run('cachedSettings.disable_thumbnail_playback = false; disableThumbnailPlayback()');
  assert.equal(video.attrs.get('data-lym-thumbnail-playback-disabled'), undefined);
  assert.equal(video.style.getPropertyValue('display'), '');
});
