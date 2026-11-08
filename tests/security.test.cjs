const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, source, environment, descriptionItem, settle } = require('./helpers/runtime.cjs');
const { runtimeFiles, runtimeEntries } = require('./helpers/release-files.cjs');

test('security: MV3 permissions, isolation, CSP and exposed files cannot broaden silently', () => {
    const manifest = JSON.parse(source('manifest.json'));
    assert.deepEqual(manifest.permissions, ['storage']);
    for (const field of ['host_permissions', 'optional_permissions', 'optional_host_permissions']) assert.deepEqual(manifest[field] || [], [], field);
    for (const field of ['background', 'externally_connectable', 'sandbox', 'oauth2', 'devtools_page']) assert.equal(manifest[field], undefined, field);
    assert.equal(manifest.content_scripts.length, 1);
    assert.equal(manifest.web_accessible_resources.length, 1);
    assert.equal(manifest.content_scripts[0].world || 'ISOLATED', 'ISOLATED');
    assert.equal(manifest.content_scripts[0].all_frames || false, false);
    assert.equal(manifest.content_scripts[0].match_about_blank || false, false);
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.youtube.com/*']);
    assert.deepEqual(manifest.web_accessible_resources[0].resources, ['page-audio-bridge.js']);
    assert.deepEqual(manifest.web_accessible_resources[0].matches, ['https://www.youtube.com/*']);
    assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'");
});

test('security: release file allowlist excludes credentials, profiles, maps, test code and unexpected assets', () => {
    const files = runtimeFiles(root);
    for (const file of files) {
        assert.match(file, /^(manifest\.json|content\.js|styles\.css|page-audio-bridge\.js|popup\.(html|js|css)|shared\/constants\.js|icons\/icon(16|48|128)\.png|_locales\/[a-z]{2}(?:_[A-Z]{2})?\/messages\.json)$/);
        assert.doesNotMatch(file, /(?:\.env|\.pem|\.key|\.map|Cookies|Login Data|test-results|\.codex)/i);
    }
    const manifest = JSON.parse(source('manifest.json'));
    const references = [manifest.action.default_popup, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
    for (const script of manifest.content_scripts) references.push(...script.js, ...script.css);
    for (const resource of manifest.web_accessible_resources) references.push(...resource.resources);
    for (const file of references) assert.ok(files.includes(file), `Unpackaged manifest reference: ${file}`);
    const batch = source('package.bat');
    for (const entry of runtimeEntries) assert.ok(batch.includes(`'${entry}'`), `Unpackaged entry: ${entry}`);
    assert.doesNotMatch(batch, /Compress-Archive\s+-Path\s+['"]?\*/i);
});

test('security: shipped code has no remote execution, HTML injection sinks or extra transport APIs', () => {
    for (const file of runtimeFiles(root).filter(name => /\.(js|html|css)$/.test(name))) {
        const text = source(file);
        assert.doesNotMatch(text, /\beval\s*\(|\bnew\s+Function\s*\(|\bimportScripts\s*\(/, file);
        assert.doesNotMatch(text, /\.innerHTML\s*=|\.outerHTML\s*=|\.insertAdjacentHTML\s*\(|document\.write\s*\(/, file);
        assert.doesNotMatch(text, /\bnew\s+(WebSocket|XMLHttpRequest)\s*\(|navigator\.sendBeacon\s*\(/, file);
        assert.doesNotMatch(text, /chrome\.(cookies|debugger|webRequest|history)\b/, file);
        if (file.endsWith('.html')) {
            assert.doesNotMatch(text, /<script\b(?![^>]*\bsrc=)[^>]*>|\son\w+\s*=|(?:src|href)=["'](?:https?:|\/\/)/i);
        }
        if (file.endsWith('.css')) assert.doesNotMatch(text, /@import|url\(\s*["']?https?:/i);
    }
    const bridge = source('page-audio-bridge.js');
    assert.doesNotMatch(bridge, /chrome\.|fetch\s*\(|localStorage|postMessage|event\.detail/);
});

test('security: packaged icons are actual PNGs with the declared dimensions', () => {
    for (const size of [16, 48, 128]) {
        const bytes = fs.readFileSync(path.join(root, `icons/icon${size}.png`));
        assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        assert.equal(bytes.readUInt32BE(16), size);
        assert.equal(bytes.readUInt32BE(20), size);
    }
});

const rejectedUrls = [
    'https://evil.test/watch?v=abcdefghijk', 'https://www.youtube.com.evil.test/watch?v=abcdefghijk',
    'https://www.youtube.com@evil.test/watch?v=abcdefghijk', '//evil.test/watch?v=abcdefghijk',
    'http://www.youtube.com/watch?v=abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk',
    'https://m.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com:444/watch?v=abcdefghijk',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///watch?v=abcdefghijk',
    '/shorts/abcdefghijk', '/embed/abcdefghijk', '/redirect?q=https://evil.test',
    '/watch/', '/watch', '/watch?v=', '/watch?v=short', '/watch?v=abcdefghijkl',
    '/watch?v=abc%3Cdefghij', '/watch?v=abc%00defghij', '/watch?v=abcdefghij%2F', '/watch?v=%E2%80%AEabcdefghij'
];
for (const href of rejectedUrls) {
    test(`security: description URL rejects ${href}`, async () => {
        const env = environment();
        let fetched = false;
        env.context.fetch = async () => { fetched = true; };
        assert.equal(env.context.getCanonicalWatchUrl(href), null);
        assert.equal(await env.context.fetchVideoDescription(href), null);
        assert.equal(fetched, false);
        assert.equal(env.timers.size, 0);
    });
}

test('security: canonicalization discards unrelated query parameters, fragments and credentials', () => {
    const env = environment();
    for (const href of [
        '/watch?v=abc_def-G12&list=private&tracking=secret#fragment',
        'https://name:password@www.youtube.com/watch?v=abc_def-G12&t=7',
        '/watch?v=abc_def-G12&v=bad'
    ]) assert.equal(env.context.getCanonicalWatchUrl(href), 'https://www.youtube.com/watch?v=abc_def-G12');
});

test('security: malformed settings cannot add DOM attributes or pollute prototypes', () => {
    const env = environment();
    env.context.raw = JSON.parse('{"__proto__":{"polluted":true},"constructor":true,"arbitrary":true,"hide_comments":{},"hide_likes":[]}');
    const normalized = env.run('normalizeSettings(raw)');
    assert.equal(normalized.hide_comments, false);
    assert.equal(normalized.hide_likes, false);
    assert.deepEqual(Object.keys(normalized).sort(), Array.from(env.context.SETTINGS_KEYS).sort());
    assert.equal({}.polluted, undefined);
    env.run('applySettings(raw)');
    assert.equal(env.document.documentElement.getAttribute('__proto__'), null);
    assert.equal(env.document.documentElement.getAttribute('arbitrary'), null);
});

for (const failure of ['http', 'body', 'read', 'cancel', 'parse']) {
    test(`security: description ${failure} failure releases timers and abort controllers`, async () => {
        const env = environment();
        env.context.fetch = async () => ({
            ok: failure !== 'http',
            body: failure === 'body' ? null : { getReader: () => ({
                read: async () => { if (failure === 'read') throw new Error('Network interrupted'); return { done: true }; },
                cancel: async () => { if (failure === 'cancel') throw new Error('Already closed'); }
            }) }
        });
        env.context.DOMParser = class {
            parseFromString() { if (failure === 'parse') throw new Error('Bad response'); return { querySelector: () => null }; }
        };
        assert.equal(await env.context.fetchVideoDescription('/watch?v=abcdefghijk'), null);
        await settle();
        assert.equal(env.timers.size, 0);
        assert.equal(env.run('activeControllers.size'), 0);
    });
}

test('security: description timeout aborts the request and releases resources', async () => {
    const env = environment();
    let signal;
    env.context.fetch = (url, options) => new Promise((resolve, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
    const pending = env.context.fetchVideoDescription('/watch?v=abcdefghijk');
    assert.equal([...env.timerDelays.values()][0], 10000);
    env.fireTimer([...env.timers.keys()][0]);
    assert.equal(await pending, null);
    assert.equal(signal.aborted, true);
    assert.equal(env.run('activeControllers.size'), 0);
    assert.equal(env.timers.size, 0);
});

test('security: hostile description content is appended as text, never HTML', async () => {
    const env = environment();
    const { item, metadata } = descriptionItem();
    const payload = '<img src=x onerror="alert(1)"><script>throw 1</script>&quot;';
    env.context.location = new URL('https://www.youtube.com/feed/subscriptions');
    env.context.item = item;
    env.context.fetchVideoDescription = async () => payload;
    env.run('cachedSettings.list_view = true; fetchQueue.push(item); processQueue()');
    await settle();
    assert.equal(metadata.children.length, 1);
    assert.equal(metadata.children[0].textContent, payload);
    assert.equal(metadata.children[0].innerHTML, undefined);
});
