const { test } = require('node:test');
const assert = require('node:assert/strict');
const { environment, element, descriptionItem, settle } = require('./helpers/runtime.cjs');
const { displayFeatures, specialFeatures } = require('./helpers/feature-matrix.cjs');

const keys = Array.from(environment().context.SETTINGS_KEYS);

test('coverage: every setting has an explicit browser scenario', () => {
    const covered = [...new Set([...displayFeatures.map(([key]) => key), ...specialFeatures])].sort();
    assert.deepEqual(covered, keys.toSorted(), 'Add a real browser scenario whenever a setting is added');
});

for (const key of keys) {
    test(`lifecycle: ${key} handles enable, legacy false, removal, power off/on`, () => {
        const env = environment();
        env.flushMicrotasks();
        env.change({ [key]: { newValue: true } });
        assert.equal(env.document.documentElement.getAttribute(key), 'true');
        env.change({ extension_enabled: { newValue: false } }, 'local');
        for (const setting of keys) assert.equal(env.document.documentElement.getAttribute(setting), null);
        env.change({ extension_enabled: { newValue: true } }, 'local');
        assert.equal(env.document.documentElement.getAttribute(key), 'true');
        env.change({ [key]: { newValue: ' FALSE ' } });
        assert.equal(env.document.documentElement.getAttribute(key), 'false');
        env.change({ [key]: { newValue: true } });
        env.change({ [key]: { oldValue: true } });
        assert.equal(env.document.documentElement.getAttribute(key), 'false');
        assert.equal(env.errors.length, 0);
    });
}

test('lifecycle: unknown sync keys and UI-only local preferences cannot alter page settings', () => {
    const env = environment();
    env.flushMicrotasks();
    env.change({ hide_comments: { newValue: true } }, 'local');
    env.change({ hide_comments: { newValue: true } }, 'session');
    env.change({ theme: { newValue: 'light' }, arbitrary: { newValue: true } });
    assert.equal(env.document.documentElement.getAttribute('hide_comments'), 'false');
    assert.equal(env.document.documentElement.getAttribute('arbitrary'), null);
    assert.equal(env.microtasks.length, 0);
    assert.equal(env.writes.sync.length + env.writes.local.length, 0);
});

test('lifecycle: settings arriving while powered off stay cached and apply only after power on', () => {
    const env = environment();
    env.change({ extension_enabled: { newValue: false } }, 'local');
    env.change({ hide_comments: { newValue: true }, hide_sidebar: { newValue: true } });
    env.flushMicrotasks();
    assert.equal(env.document.documentElement.getAttribute('hide_comments'), null);
    env.change({ extension_enabled: { newValue: true } }, 'local');
    assert.equal(env.document.documentElement.getAttribute('hide_comments'), 'true');
    assert.equal(env.document.documentElement.getAttribute('hide_sidebar'), 'true');
});

for (const phase of ['local', 'sync']) {
    test(`lifecycle: initial ${phase} storage error is reported without enabling settings`, () => {
        const env = environment();
        if (phase === 'sync') env.pending.local[0]({ extension_enabled: true });
        env.context.chrome.runtime.lastError = { message: 'Storage unavailable' };
        env.pending[phase][0]({ hide_comments: true, extension_enabled: true });
        assert.equal(env.document.documentElement.getAttribute('hide_comments'), 'false');
        assert.equal(env.warnings.length, 1);
    });
}

test('lifecycle: invalidated extension ignores storage, navigation and pending audio requests', () => {
    const env = environment();
    env.run('cachedSettings.disable_auto_dubbing = true; scheduleOriginalAudioTrackSelection()');
    let audioRequests = 0;
    env.context.dispatchEvent = () => audioRequests++;
    env.context.chrome.runtime.id = undefined;
    env.change({ hide_comments: { newValue: true } });
    env.document.dispatchEvent({ type: 'yt-navigate-finish' });
    for (const id of [...env.timers.keys()]) env.fireTimer(id);
    assert.equal(env.document.documentElement.getAttribute('hide_comments'), 'false');
    assert.equal(audioRequests, 0);
});

test('lifecycle: bridge injection is once-only, with a retry after a load failure', () => {
    const env = environment();
    assert.equal(env.document.head.children.length, 1);
    env.run('injectPageAudioBridge(); injectPageAudioBridge()');
    assert.equal(env.document.head.children.length, 1);
    env.document.head.children[0].onerror();
    env.run('injectPageAudioBridge()');
    assert.equal(env.document.head.children.length, 2);
    assert.equal(env.document.head.children[1].src, 'chrome-extension://test/page-audio-bridge.js');
    env.document.head.children[1].onload();
    assert.equal(env.document.head.children[1].isConnected, false);
});

test('lifecycle: transcript grace is bounded and cleared on expiry, navigation and power off', () => {
    const env = environment();
    env.run('cachedSettings.hide_sidebar = true; beginTranscriptSidebarOverride(); beginTranscriptSidebarOverride()');
    assert.equal(env.timers.size, 1);
    assert.equal(env.document.documentElement.getAttribute('data-lym-transcript-active'), 'true');
    env.fireTimer([...env.timers.keys()][0]);
    assert.equal(env.document.documentElement.getAttribute('data-lym-transcript-active'), null);
    env.run('beginTranscriptSidebarOverride(); handleNavigation("https://www.youtube.com/watch?v=12345678901")');
    assert.equal(env.timers.size, 0);
    assert.equal(env.document.documentElement.getAttribute('data-lym-transcript-active'), null);
    env.run('beginTranscriptSidebarOverride()');
    env.change({ extension_enabled: { newValue: false } }, 'local');
    assert.equal(env.timers.size, 0);
    assert.equal(env.document.documentElement.getAttribute('data-lym-transcript-active'), null);
});

test('lifecycle: DOM root replacement reconnects the observer once without duplicating it', () => {
    const env = environment();
    const observer = env.observers.mutation[0];
    const app = element();
    env.document.querySelector = selector => selector === 'ytd-app' ? app : null;
    env.run('ensureObserverConnected(); ensureObserverConnected()');
    assert.equal(env.observers.mutation.length, 1);
    assert.equal(observer.observations.length, 2);
    assert.equal(observer.observations.at(-1).target, app);
});

test('lifecycle: pending descriptions cannot append after disable, disconnect or list off', async () => {
    for (const action of ['power', 'disconnect', 'list']) {
        const env = environment();
        const { item, metadata } = descriptionItem();
        env.context.location = new URL('https://www.youtube.com/feed/subscriptions');
        env.context.item = item;
        let complete;
        env.context.fetchVideoDescription = () => new Promise(resolve => { complete = resolve; });
        env.run('cachedSettings.list_view = true; fetchQueue.push(item); processQueue()');
        if (action === 'power') env.change({ extension_enabled: { newValue: false } }, 'local');
        if (action === 'list') env.change({ list_view: { newValue: false } });
        if (action === 'disconnect') item.isConnected = false;
        complete('Must never be appended');
        await settle();
        assert.equal(metadata.children.length, 0, action);
        assert.equal(env.run('activeFetches'), 0, action);
    }
});

test('lifecycle: audio bridge tolerates missing, changing and throwing private player APIs', () => {
    for (const player of [null, {}, { getAvailableAudioTracks() { throw new Error('Player changed'); } }, {
        getAvailableAudioTracks: () => [{ name: 'Dubbed' }, { name: 'Original' }],
        setAudioTrack() { throw new Error('Player recycled'); }
    }]) {
        const env = environment('page-audio-bridge.js');
        env.document.getElementById = () => player;
        assert.doesNotThrow(() => env.run("dispatchEvent(new CustomEvent('less-youtube-mess:force-original-audio'))"));
        assert.equal(env.timers.size, 0);
    }
});

test('lifecycle: original-audio event ignores untrusted payload, already selected tracks and unknown originals', () => {
    const env = environment('page-audio-bridge.js');
    const original = { name: 'Original audio' };
    const dubbed = { name: 'Dubbed' };
    let selected = 0;
    const player = { getAvailableAudioTracks: () => [dubbed, original], getAudioTrack: () => original, setAudioTrack: () => selected++ };
    env.document.getElementById = () => player;
    env.run("dispatchEvent(new CustomEvent('less-youtube-mess:force-original-audio', {detail:{url:'https://evil.test',track:0}}))");
    assert.equal(selected, 0);
    player.getAvailableAudioTracks = () => [{ name: 'English' }, { name: 'Spanish' }];
    env.run("dispatchEvent(new CustomEvent('less-youtube-mess:force-original-audio'))");
    assert.equal(selected, 0);
});

test('lifecycle: autoplay handles blocked localStorage and does not repeatedly enable a native toggle', () => {
    const env = environment();
    let clicks = 0;
    env.context.localStorage.setItem = () => { throw new Error('Access denied'); };
    const toggle = { click: () => clicks++ };
    env.document.querySelector = selector => selector.includes('autonav') && !clicks ? toggle : null;
    env.run('cachedSettings.hide_autoplay = true; applyAutoplay(); applyAutoplay()');
    assert.equal(clicks, 1);
});

test('lifecycle: Turkish uppercase live and premiere badges are detected without hiding normal uploads', () => {
    const env = environment();
    for (const [label, live] of [['CANLI', true], ['Canlı', true], ['İLK GÖSTERİM', true], ['LIVE', true], ['PREMIERE', true], ['HD', false], ['Uploaded yesterday', false]]) {
        const { item } = descriptionItem();
        item.querySelectorAll = selector => selector.includes('badge-shape') ? [{ textContent: label }] : [];
        env.context.item = item;
        env.run('markLiveAndPremieres([item])');
        assert.equal(item.getAttribute('data-live-premiere') === 'true', live, label);
    }
});

test('lifecycle: popup repairs inconsistent compact storage regardless of startup callback order', () => {
    for (const localFirst of [true, false]) {
        const env = environment('popup.js');
        for (const id of ['power-toggle', 'list_view', 'compact_list_view', 'compact_list_view_item']) env.nodes.set(id, element());
        env.run('loadSettings()');
        const local = () => env.pending.local[0]({ extension_enabled: false, theme: 'light' });
        const sync = () => env.pending.sync[0]({ list_view: false, compact_list_view: true });
        if (localFirst) { local(); sync(); } else { sync(); local(); }
        assert.equal(env.nodes.get('compact_list_view').disabled, true);
        assert.equal(env.nodes.get('compact_list_view').checked, false);
        assert.deepEqual(JSON.parse(JSON.stringify(env.writes.sync)), [{ compact_list_view: false }]);
        assert.equal(env.document.body.getAttribute('data-theme'), 'light');
    }
});
