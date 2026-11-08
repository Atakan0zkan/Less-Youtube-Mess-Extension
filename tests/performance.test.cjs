const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, environment, element, descriptionItem, settle } = require('./helpers/runtime.cjs');
const { runtimeFiles } = require('./helpers/release-files.cjs');
const budgets = require('./helpers/budgets.cjs');

test('performance: runtime payload and expensive content files stay within reviewed budgets', () => {
    const files = runtimeFiles(root);
    const total = files.reduce((bytes, file) => bytes + fs.statSync(path.join(root, file)).size, 0);
    assert.ok(total <= budgets.runtimeBytes, `${total} runtime bytes exceeds ${budgets.runtimeBytes}`);
    assert.ok(fs.statSync(path.join(root, 'content.js')).size <= budgets.contentScriptBytes);
    assert.ok(fs.statSync(path.join(root, 'styles.css')).size <= budgets.contentCssBytes);
});

test('performance: 1000 simultaneous scheduling requests produce one feature pass', () => {
    const env = environment();
    env.flushMicrotasks();
    let runs = 0;
    env.context.runFeatures = () => runs++;
    env.run('for (let i = 0; i < 1000; i++) scheduleRunFeatures()');
    assert.equal(env.microtasks.length, 1);
    env.flushMicrotasks();
    assert.equal(runs, 1);
});

test('performance: 1000 DOM observer deliveries debounce to one 150ms timer', () => {
    const env = environment();
    env.flushMicrotasks();
    let runs = 0;
    env.context.runFeatures = () => runs++;
    for (let i = 0; i < 1000; i++) env.observers.mutation[0].callback([{ addedNodes: [element()] }]);
    assert.equal(env.timers.size, 1);
    assert.deepEqual([...env.timerDelays.values()], [150]);
    env.fireTimer([...env.timers.keys()][0]);
    assert.equal(runs, 1);
    assert.equal(env.timers.size, 0);
});

test('performance: mutation observation excludes own style, class and marker writes', () => {
    const env = environment();
    const config = env.observers.mutation[0].observations[0].options;
    assert.deepEqual(Array.from(config.attributeFilter), ['opened']);
    assert.equal(config.childList, true);
    assert.equal(config.subtree, true);
    assert.equal(config.characterData, undefined);
    const count = env.observers.mutation[0].observations.length;
    env.run('for (let i = 0; i < 1000; i++) ensureObserverConnected()');
    assert.equal(env.observers.mutation[0].observations.length, count);
});

test('performance: list and live features share one subscription item discovery per pass', () => {
    const env = environment();
    env.context.location = new URL('https://www.youtube.com/feed/subscriptions');
    let scans = 0;
    env.context.getSubscriptionItems = () => { scans++; return []; };
    env.context.selfDiagnose = () => {};
    env.run('cachedSettings.list_view = true; cachedSettings.hide_live_premiere = true; runFeatures()');
    assert.equal(scans, 1);
});

test('performance: disabled feature runner performs no DOM queries, network or storage writes', () => {
    const env = environment();
    let queries = 0;
    let requests = 0;
    env.document.querySelector = env.document.querySelectorAll = () => { queries++; return []; };
    env.context.fetch = async () => requests++;
    env.run('extensionEnabled = false; for (let i = 0; i < 1000; i++) runFeatures()');
    assert.equal(queries, 0);
    assert.equal(requests, 0);
    assert.equal(env.writes.sync.length + env.writes.local.length, 0);
});

test('performance: description concurrency never exceeds three while draining a large queue', async () => {
    const env = environment();
    env.context.location = new URL('https://www.youtube.com/feed/subscriptions');
    const resolvers = [];
    let pending = 0;
    let maximum = 0;
    env.context.fetchVideoDescription = () => new Promise(resolve => {
        pending++;
        maximum = Math.max(maximum, pending);
        resolvers.push(() => { pending--; resolve('Description'); });
    });
    env.context.items = Array.from({ length: 60 }, (_, index) => descriptionItem(index).item);
    env.run('cachedSettings.list_view = true; fetchQueue.push(...items); for (let i = 0; i < 60; i++) processQueue()');
    assert.equal(pending, 3);
    while (resolvers.length) { resolvers.shift()(); await settle(); }
    assert.equal(maximum, 3);
    assert.equal(env.run('activeFetches'), 0);
    assert.equal(env.run('fetchQueue.length'), 0);
});

test('performance: intersection queue caps at 100, deduplicates entries and pauses in hidden tabs', () => {
    const env = environment();
    env.context.location = new URL('https://www.youtube.com/feed/subscriptions');
    env.document.hidden = true;
    env.context.items = Array.from({ length: 150 }, (_, index) => descriptionItem(index).item);
    env.run('cachedSettings.list_view = true; processVideoDescriptions(items)');
    const observer = env.observers.intersection[0];
    assert.equal(observer.options.rootMargin, '500px 0px 500px 0px');
    const entries = env.context.items.map(target => ({ target, isIntersecting: true }));
    observer.callback(entries, observer);
    observer.callback(entries.slice(0, 5), observer);
    assert.equal(env.run('fetchQueue.length'), 100);
    assert.equal(env.run('queuedDescriptionItems.size'), 100);
    assert.equal(env.run('activeFetches'), 0);
    assert.equal(env.context.items[149].getAttribute('data-desc-done'), null);
    env.document.hidden = false;
    let resumed = 0;
    env.context.processQueue = () => resumed++;
    env.document.dispatchEvent({ type: 'visibilitychange' });
    assert.equal(resumed, 1);
    env.run('resetDescriptionPipeline()');
    assert.equal(observer.targets.size, 0);
});

test('performance: stale queues drain iteratively without fetches or stack growth', () => {
    const env = environment();
    env.context.location = new URL('https://www.youtube.com/feed/subscriptions');
    env.context.items = Array.from({ length: 10000 }, () => element());
    env.run('cachedSettings.list_view = true; fetchQueue.push(...items); processQueue()');
    assert.equal(env.run('fetchQueue.length'), 0);
    assert.equal(env.run('activeFetches'), 0);
});

test('performance: description cache stays bounded at 250 and reuses canonical hits without fetching', async () => {
    const env = environment();
    env.run('for (let i = 0; i < 1000; i++) rememberDescription("https://www.youtube.com/watch?v=" + String(i).padStart(11, "0"), "Description " + i)');
    assert.equal(env.run('descriptionCache.size'), 250);
    assert.equal(env.run('descriptionCache.has("https://www.youtube.com/watch?v=00000000000")'), false);
    let requests = 0;
    env.context.fetch = async () => requests++;
    assert.equal(await env.context.fetchVideoDescription('/watch?v=00000000999&t=4'), 'Description 999');
    assert.equal(requests, 0);
    assert.equal(env.timers.size, 0);
});

test('performance: streaming stops at head end and never decodes past 15000 bytes', async () => {
    for (const mode of ['head', 'budget']) {
        const env = environment();
        let reads = 0;
        let cancels = 0;
        let parsed = '';
        env.context.fetch = async () => ({ ok: true, body: { getReader: () => ({
            read: async () => { reads++; return { done: false, value: new TextEncoder().encode(mode === 'head' ? '<head><meta></head>' : 'x'.repeat(50000)) }; },
            cancel: async () => cancels++
        }) } });
        env.context.DOMParser = class { parseFromString(text) { parsed = text; return { querySelector: () => null }; } };
        await env.context.fetchVideoDescription('/watch?v=abcdefghijk');
        assert.equal(reads, 1);
        assert.equal(cancels, 1);
        assert.ok(Buffer.byteLength(parsed) <= 15000);
        assert.equal(env.timers.size, 0);
        assert.equal(env.run('activeControllers.size'), 0);
    }
});

test('performance: 100 SPA route changes cancel requests, queues and audio timers without accumulation', () => {
    const env = environment();
    for (let index = 0; index < 100; index++) {
        env.context.location = new URL(`https://www.youtube.com/watch?v=${String(index).padStart(11, '0')}`);
        env.run('cachedSettings.disable_auto_dubbing = true; scheduleOriginalAudioTrackSelection()');
        const controller = new AbortController();
        env.context.controller = controller;
        env.run('activeControllers.add(controller); fetchQueue.push({}); handleNavigation(location.href)');
        assert.equal(controller.signal.aborted, true);
        assert.equal(env.run('activeControllers.size'), 0);
        assert.equal(env.run('activeFetches'), 0);
        assert.equal(env.run('fetchQueue.length'), 0);
        assert.equal(env.timers.size, 0);
        assert.equal(env.observers.mutation.length, 1);
    }
});
