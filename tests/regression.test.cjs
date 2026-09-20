const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const source = file => readFileSync(join(root, file), 'utf8');

function element() {
    const attrs = new Map();
    const styles = new Map();
    return {
        nodeType: 1, isConnected: true, checked: false, disabled: false,
        children: [], textContent: '',
        setAttribute: (key, value) => attrs.set(key, value),
        getAttribute: key => attrs.get(key) ?? null,
        hasAttribute: key => attrs.has(key),
        removeAttribute: key => attrs.delete(key),
        querySelector: () => null, querySelectorAll: () => [],
        appendChild() {}, remove() {}, addEventListener() {},
        getClientRects: () => [{}],
        getBoundingClientRect: () => ({ width: 100, height: 100 }),
        style: {
            setProperty: (key, value) => styles.set(key, value),
            removeProperty: key => styles.delete(key),
            getPropertyValue: key => styles.get(key) || '',
            getPropertyPriority: () => ''
        }
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
        getElementById: id => nodes.get(id) || null,
        querySelector: () => null, querySelectorAll: () => [],
        createElement: () => element(), addEventListener() {}
    };
    const context = vm.createContext({
        console, URL, Set, Map, AbortController, TextDecoder, Uint8Array,
        Node: { ELEMENT_NODE: 1 }, document,
        location: new URL('https://www.youtube.com/watch?v=abcdefghijk'),
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
        clearTimeout: id => timers.delete(id), queueMicrotask: () => {},
        addEventListener: (name, fn) => listeners.set(name, fn),
        dispatchEvent: event => listeners.get(event.type)?.(event),
        CustomEvent: class { constructor(type) { this.type = type; } },
        getComputedStyle: el => ({ display: el.style.getPropertyValue('display') || 'block', visibility: 'visible', opacity: '1' }),
        MutationObserver: class { observe() {} disconnect() {} },
        IntersectionObserver: class { observe() {} disconnect() {} },
        localStorage: { setItem() {} },
        chrome: {
            runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}` },
            storage: {
                local: { get: (keys, cb) => pending.local.push(cb), set() {} },
                sync: { get: (keys, cb) => pending.sync.push(cb), set() {} },
                onChanged: { addListener() {} }
            }
        }
    });
    context.window = context;
    context.self = context;
    vm.runInContext(source('shared/constants.js'), context);
    vm.runInContext(source(file), context);
    return { context, document, nodes, timers, pending, run: code => vm.runInContext(code, context) };
}

test('popup keeps compact locked when local disabled state arrives before sync', () => {
    const env = environment('popup.js');
    for (const id of ['power-toggle', 'list_view', 'compact_list_view', 'compact_list_view_item']) env.nodes.set(id, element());
    env.run('loadSettings()');
    env.pending.local[0]({ extension_enabled: false });
    env.pending.sync[0]({ list_view: true, compact_list_view: true });
    assert.equal(env.nodes.get('compact_list_view').disabled, true);
    env.run('applyExtensionDisabledState(true)');
    assert.equal(env.nodes.get('compact_list_view').disabled, false);
});

test('audio bridge performs one request synchronously without uncancellable retries', () => {
    const env = environment('page-audio-bridge.js');
    const tracks = [{ name: 'English (dubbed)' }, { name: 'Original audio' }];
    const selected = [];
    env.document.getElementById = () => ({ getAvailableAudioTracks: () => tracks, setAudioTrack: track => selected.push(track) });
    env.run("dispatchEvent(new CustomEvent('less-youtube-mess:force-original-audio'))");
    assert.equal(selected.length, 1);
    assert.equal(selected[0], tracks[1]);
    assert.equal(env.timers.size, 0);
});

test('explicit original audio wins over a default dubbed track', () => {
    const env = environment('page-audio-bridge.js');
    const dubbed = { name: 'English (dubbed)', getLanguageInfo: () => ({ isDefault: true }) };
    const original = { name: 'Turkish (original)' };
    let selected;
    env.document.getElementById = () => ({ getAvailableAudioTracks: () => [dubbed, original], setAudioTrack: track => { selected = track; } });
    env.run("dispatchEvent(new CustomEvent('less-youtube-mess:force-original-audio'))");
    for (const callback of env.timers.values()) callback();
    assert.equal(selected, original);
});

test('audio requests are discarded when the URL changes before a timer fires', () => {
    const env = environment('content.js');
    let requests = 0;
    env.context.dispatchEvent = () => { requests++; };
    env.run('cachedSettings.disable_auto_dubbing = true; scheduleOriginalAudioTrackSelection()');
    env.context.location = new URL('https://www.youtube.com/watch?v=12345678901');
    for (const callback of env.timers.values()) callback();
    assert.equal(requests, 0);
});

test('audio timers cancel on power-off and restart on the same video after power-on', () => {
    const env = environment('content.js');
    env.run('cachedSettings.disable_auto_dubbing = true; scheduleOriginalAudioTrackSelection()');
    assert.equal(env.timers.size, 5);
    env.run('extensionEnabled = false; applySettings(cachedSettings)');
    assert.equal(env.timers.size, 0);
    env.run('extensionEnabled = true; scheduleOriginalAudioTrackSelection()');
    assert.equal(env.timers.size, 5);
});

test('late initial settings schedule JS features even without a DOM mutation', () => {
    const env = environment('content.js');
    // The observer's initial microtask has finished before storage responds.
    env.run('_runFeaturesScheduled = false');
    let scheduled = 0;
    env.context.queueMicrotask = () => { scheduled++; };
    env.pending.local[0]({ extension_enabled: true });
    env.pending.sync[0]({ hide_premium_popups: true });
    assert.equal(scheduled, 1);
});

test('description completion rejects a recycled video even before the next DOM scan', async () => {
    const env = environment('content.js');
    env.context.location = new URL('https://www.youtube.com/feed/subscriptions');
    const item = element();
    const metadata = element();
    const link = { href: 'https://www.youtube.com/watch?v=abcdefghijk' };
    let appended = 0;
    metadata.appendChild = () => { appended++; };
    item.querySelector = selector => selector === 'yt-content-metadata-view-model' ? metadata : link;
    item.setAttribute('data-desc-done', link.href);
    env.context.item = item;
    let complete;
    env.context.fetchVideoDescription = () => new Promise(resolve => { complete = resolve; });
    env.run('cachedSettings.list_view = true; fetchQueue.push(item); processQueue()');
    link.href = 'https://www.youtube.com/watch?v=12345678901';
    complete('Previous video description');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(appended, 0);
    assert.equal(env.run('activeFetches'), 0);
});

test('description generation reset cannot decrement a new queue or append old content', async () => {
    const env = environment('content.js');
    env.context.location = new URL('https://www.youtube.com/feed/subscriptions');
    const item = element();
    const metadata = element();
    const href = 'https://www.youtube.com/watch?v=abcdefghijk';
    let appended = 0;
    metadata.appendChild = () => { appended++; };
    item.querySelector = selector => selector === 'yt-content-metadata-view-model' ? metadata : { href };
    item.setAttribute('data-desc-done', href);
    env.context.item = item;
    let complete;
    env.context.fetchVideoDescription = () => new Promise(resolve => { complete = resolve; });
    env.run('cachedSettings.list_view = true; fetchQueue.push(item); processQueue(); resetDescriptionPipeline(); activeFetches = 2');
    complete('Stale description');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(appended, 0);
    assert.equal(env.run('activeFetches'), 2);
});

test('description fetch restricts redirects/referrer and caps decoded bytes', async () => {
    const env = environment('content.js');
    let options;
    let parsedLength = 0;
    let cancelled = false;
    env.context.fetch = async (url, init) => {
        options = init;
        return { ok: true, body: { getReader: () => ({
            read: async () => ({ done: false, value: new Uint8Array(100000).fill(65) }),
            cancel: async () => { cancelled = true; }
        }) } };
    };
    env.context.DOMParser = class { parseFromString(html) { parsedLength = html.length; return { querySelector: () => null }; } };
    await env.run("fetchVideoDescription('/watch?v=abcdefghijk')");
    assert.equal(options.credentials, 'omit');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(parsedLength <= 15000);
    assert.equal(cancelled, true);
    assert.equal(env.timers.size, 0);
});

test('description URL validation rejects other origins, routes, and invalid IDs', () => {
    const env = environment('content.js');
    for (const href of ['https://evil.test/watch?v=abcdefghijk', 'http://www.youtube.com/watch?v=abcdefghijk', '/shorts/abcdefghijk', '/watch?v=bad']) {
        assert.equal(env.context.getCanonicalWatchUrl(href), null);
    }
    assert.equal(env.context.getCanonicalWatchUrl('/watch?v=abcdefghijk&list=private'), 'https://www.youtube.com/watch?v=abcdefghijk');
});

test('Premium cleanup restores a reused functional dialog and its shared backdrop', () => {
    const env = environment('content.js');
    const dialog = element();
    const backdrop = element();
    const premium = element();
    dialog.setAttribute('opened', '');
    backdrop.setAttribute('opened', '');
    let isPremium = true;
    dialog.querySelector = selector => isPremium && selector === 'yt-upsell-dialog-renderer' ? premium : null;
    env.document.querySelectorAll = selector => {
        if (selector === 'tp-yt-paper-dialog') return [dialog];
        if (selector.startsWith('tp-yt-paper-dialog:not')) return dialog.hasAttribute('data-lym-premium-hidden') ? [] : [dialog];
        if (selector === 'tp-yt-iron-overlay-backdrop[opened]') return [backdrop];
        if (selector === '[data-lym-premium-backdrop-hidden]') return backdrop.hasAttribute('data-lym-premium-backdrop-hidden') ? [backdrop] : [];
        return [];
    };
    env.run('cachedSettings.hide_premium_popups = true; dismissPremiumPopups()');
    assert.equal(dialog.style.getPropertyValue('display'), 'none');
    assert.equal(backdrop.style.getPropertyValue('display'), 'none');
    isPremium = false;
    env.run('dismissPremiumPopups()');
    assert.equal(dialog.style.getPropertyValue('display'), '');
    assert.equal(backdrop.style.getPropertyValue('display'), '');
});

test('Premium backdrop is restored when a separate functional dialog opens later', () => {
    const env = environment('content.js');
    const premiumDialog = element();
    const functionalDialog = element();
    const backdrop = element();
    premiumDialog.setAttribute('opened', '');
    premiumDialog.setAttribute('data-lym-premium-hidden', 'true');
    premiumDialog.style.setProperty('display', 'none');
    premiumDialog.querySelector = selector => selector === 'yt-upsell-dialog-renderer' ? element() : null;
    backdrop.setAttribute('opened', '');
    backdrop.setAttribute('data-lym-premium-backdrop-hidden', 'true');
    backdrop.style.setProperty('display', 'none');
    env.document.querySelectorAll = selector => {
        if (selector === 'tp-yt-paper-dialog') return [premiumDialog, functionalDialog];
        if (selector === 'tp-yt-iron-overlay-backdrop[opened]' || selector === '[data-lym-premium-backdrop-hidden]') return [backdrop];
        return [];
    };
    env.run('cachedSettings.hide_premium_popups = true; dismissPremiumPopups()');
    assert.equal(backdrop.style.getPropertyValue('display'), '');
    assert.equal(premiumDialog.style.getPropertyValue('display'), 'none');
});

test('manifest, settings, popup and locale contracts stay aligned', () => {
    const env = environment('popup.js');
    const manifest = JSON.parse(source('manifest.json'));
    assert.deepEqual(manifest.permissions, ['storage']);
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.youtube.com/*']);
    assert.deepEqual(manifest.web_accessible_resources[0].resources, ['page-audio-bridge.js']);
    const inputs = [...source('popup.html').matchAll(/<input[^>]*id="([^"]+)"/g)].map(match => match[1]).sort();
    assert.deepEqual(inputs, Array.from(env.context.SETTINGS_KEYS).sort());
    assert.ok(Object.values(env.context.DEFAULTS).every(value => value === false));
    const keys = Object.keys(JSON.parse(source('_locales/en/messages.json'))).sort();
    for (const locale of readdirSync(join(root, '_locales'))) {
        assert.deepEqual(Object.keys(JSON.parse(source(`_locales/${locale}/messages.json`))).sort(), keys);
    }
    assert.doesNotMatch(source('styles.css'), /html\[disable_auto_dubbing/);
});
