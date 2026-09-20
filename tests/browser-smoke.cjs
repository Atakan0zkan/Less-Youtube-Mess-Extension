// Node 22+; set BROWSER_PATH to Brave/Chromium. Uses only a disposable profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const browserPath = process.env.BROWSER_PATH;
assert.ok(browserPath && fs.existsSync(browserPath), 'Set BROWSER_PATH to Brave/Chromium');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lym-smoke-'));
assert.ok(!temporary.includes(' '), 'Use a TEMP path without spaces');
const extension = path.join(temporary, 'extension');
const profile = path.join(temporary, 'profile');
fs.mkdirSync(extension);
for (const file of ['manifest.json', 'content.js', 'styles.css', 'page-audio-bridge.js', 'popup.html', 'popup.js', 'popup.css', 'shared', 'icons', '_locales']) {
    fs.cpSync(path.join(root, file), path.join(extension, file), { recursive: true });
}

class CDP {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.pending = new Map();
        this.handlers = new Map();
        this.nextId = 0;
        this.ready = new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                clearTimeout(pending.timer);
                message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
            } else {
                for (const handler of this.handlers.get(message.method) || []) handler(message.params);
            }
        });
    }
    on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event).push(handler);
    }
    async send(method, params = {}) {
        await this.ready;
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async evaluate(expression, contextId) {
        const result = await this.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    }
    close() { this.socket.close(); }
}

async function until(check, message, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await check();
        if (value) return value;
        await delay(100);
    }
    throw new Error(`Timed out: ${message}`);
}

const fixture = `<!doctype html><html><head><style>
ytd-app,ytd-watch-flexy,#columns,#primary,#secondary,#related,tp-yt-paper-dialog {display:block}
tp-yt-paper-dialog:not([opened]),tp-yt-iron-overlay-backdrop:not([opened]){display:none}
tp-yt-paper-dialog{width:320px;height:80px}
tp-yt-iron-overlay-backdrop[opened]{display:block;width:40px;height:40px}
[visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"]{display:none}
ytd-engagement-panel-section-list-renderer{display:block;width:320px;height:120px}
ytd-masthead,ytd-topbar-menu-button-renderer,ytd-button-renderer,yt-button-view-model {display:block}
ytd-topbar-logo-renderer,yt-icon-button,ytd-notification-topbar-button-renderer {display:block;width:40px;height:40px}
ytd-watch-metadata,#actions,#segmented-like-button {display:block}
ytd-thumbnail{display:block;width:120px;height:68px}
ytd-video-preview{display:block;width:120px;height:68px}
ytd-guide-section-renderer{display:block}
ytd-browse,ytd-rich-grid-renderer,#contents,ytd-rich-item-renderer,yt-lockup-view-model {display:block}
</style></head><body><ytd-app>
<ytd-masthead><div id="buttons">
<ytd-topbar-menu-button-renderer id="create-btn"><a href="/upload">Create</a></ytd-topbar-menu-button-renderer>
</div><div id="end"></div></ytd-masthead>
<ytd-topbar-logo-renderer id="logo">Logo</ytd-topbar-logo-renderer>
<yt-icon-button id="voice-search-button">Mic</yt-icon-button>
<ytd-notification-topbar-button-renderer id="bell">Bell</ytd-notification-topbar-button-renderer>
<tp-yt-app-drawer id="guide">Nav</tp-yt-app-drawer>
<ytd-guide-section-renderer id="guide-subs"><a href="/feed/channels">All subscriptions</a></ytd-guide-section-renderer>
<ytd-guide-section-renderer id="guide-you"><a href="/feed/history">History</a></ytd-guide-section-renderer>
<ytd-guide-section-renderer id="guide-explore"><a href="/trending">Trending</a></ytd-guide-section-renderer>
<ytd-guide-section-renderer id="guide-more"><a href="/premium">Premium</a></ytd-guide-section-renderer>
<a title="Shorts" id="shorts-link" href="/shorts/abc">Shorts</a>
<ytd-reel-shelf-renderer id="shorts-shelf">Shorts shelf</ytd-reel-shelf-renderer>
<div class="sbdd_a" id="search-sugg">Suggestions</div>
<ytd-watch-flexy><div id="columns"><div id="primary">Video
<div id="comments">Comments</div>
<div class="html5-endscreen" id="endscreen">End</div>
<div class="ytp-autonav-toggle-button-container" id="autoplay-toggle">Autoplay</div>
<ytd-watch-metadata><div id="actions">
<div id="segmented-like-button"><span class="yt-core-attributed-string" id="like-text">12K</span></div>
<ytd-button-renderer id="hype-btn"><button aria-label="Hype">Hype</button></ytd-button-renderer>
</div></ytd-watch-metadata>
<ytd-mealbar-promo-renderer id="mealbar">Premium promo</ytd-mealbar-promo-renderer>
<ytd-thumbnail id="blur-thumb"><img src="about:blank"></ytd-thumbnail>
<ytd-video-preview id="thumb-preview"><video></video></ytd-video-preview>
</div>
<div id="secondary"><div id="related">Recommendations</div>
<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN">Transcript</ytd-engagement-panel-section-list-renderer>
</div></div></ytd-watch-flexy>
<ytd-browse page-subtype="subscriptions"><ytd-rich-grid-renderer><div id="contents">
<ytd-rich-item-renderer id="list-item"><yt-lockup-view-model><div id="list-row"><a href="/watch?v=bad" id="list-link"><yt-thumbnail-view-model><img id="list-img" src="about:blank"></yt-thumbnail-view-model></a><yt-content-metadata-view-model>Meta</yt-content-metadata-view-model></div></yt-lockup-view-model></ytd-rich-item-renderer>
<ytd-rich-item-renderer id="live-item"><div overlay-style="LIVE">LIVE</div><a href="/watch?v=bad2">Live video</a></ytd-rich-item-renderer>
</div></ytd-rich-grid-renderer></ytd-browse>
<tp-yt-paper-dialog id="premium" opened><yt-upsell-dialog-renderer>Premium</yt-upsell-dialog-renderer></tp-yt-paper-dialog>
<tp-yt-iron-overlay-backdrop opened></tp-yt-iron-overlay-backdrop>
</ytd-app></body></html>`;

const clients = [];
let browser;
let browserClient;
let browserClosed = false;
async function main() {
    // CI containers (GitHub ubuntu runners) have tiny /dev/shm and restricted
    // sandboxing: allow opt-in via BROWSER_NO_SANDBOX=1. Local runs unaffected.
    const ciArgs = process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-dev-shm-usage']
        : [];
    browser = spawn(browserPath, [
        `--user-data-dir=${profile}`, '--remote-debugging-port=0',
        `--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
        '--no-first-run', '--no-default-browser-check', '--disable-sync',
        '--window-size=1280,900', ...ciArgs, 'about:blank'
    ], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', error => console.error(error));
    const activePort = path.join(profile, 'DevToolsActivePort');
    await until(() => fs.existsSync(activePort), 'Brave DevTools endpoint', 60000);
    const [port, endpoint] = fs.readFileSync(activePort, 'utf8').trim().split(/\r?\n/);
    browserClient = new CDP(`ws://127.0.0.1:${port}${endpoint}`);
    console.log('Browser:', (await browserClient.send('Browser.getVersion')).product);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = new CDP(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    clients.push(page);
    const contexts = new Map();
    page.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
    page.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
    page.on('Runtime.executionContextsCleared', () => contexts.clear());
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.youtube.com/*', resourceType: 'Document' }] });
    page.on('Fetch.requestPaused', event => {
        page.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(fixture).toString('base64') }).catch(console.error);
    });
    await page.send('Page.navigate', { url: 'https://www.youtube.com/watch?v=abcdefghijk' });
    let isolated = await until(() => [...contexts.values()].find(context => context.origin.startsWith('chrome-extension://')), 'unpacked content context');
    await until(() => page.evaluate("typeof cachedSettings !== 'undefined'", isolated.id), 'content initialization');
    const extensionId = new URL(isolated.origin).hostname;
    const settings = async values => {
        await page.evaluate(`chrome.storage.sync.set(${JSON.stringify(values)})`, isolated.id);
        await delay(350);
    };
    // SPA navigations destroy the isolated world: snapshot ids BEFORE navigating,
    // then wait for a fresh live context (dead redirect-chain candidates are
    // dropped as they fail evaluation).
    const navigateAndRefresh = async (url, label) => {
        const known = new Set(contexts.keys());
        await page.send('Page.navigate', { url });
        await until(async () => {
            const entry = [...contexts.entries()].find(([id, context]) => !known.has(id) && context.origin.startsWith('chrome-extension://'));
            if (!entry) return false;
            try {
                const ready = await page.evaluate("typeof cachedSettings !== 'undefined'", entry[0]);
                if (ready) {
                    isolated = entry[1];
                    return true;
                }
                return false;
            } catch {
                contexts.delete(entry[0]);
                return false;
            }
        }, label || `content context for ${url}`);
    };
    const display = selector => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).display`);

    await settings({ hide_sidebar: true, hide_premium_popups: true });
    assert.equal(await display('#secondary'), 'none');
    assert.equal(await display('#premium'), 'none');
    assert.equal(await display('tp-yt-iron-overlay-backdrop'), 'none');
    console.log('PASS: sidebar and Premium hiding');
    await page.evaluate(`document.querySelector('#premium').replaceChildren(Object.assign(document.createElement('div'), {textContent:'Share'}))`);
    await until(async () => await display('#premium') !== 'none', 'reused Share dialog');
    assert.notEqual(await display('tp-yt-iron-overlay-backdrop'), 'none');
    console.log('PASS: reused functional dialog and backdrop restored');

    await page.evaluate(`document.querySelector('#premium').replaceChildren(document.createElement('yt-upsell-dialog-renderer'))`);
    await until(async () => await display('#premium') === 'none', 'Premium reuse');
    await page.evaluate(`const dialog = document.createElement('tp-yt-paper-dialog'); dialog.id='share'; dialog.textContent='Share'; document.querySelector('ytd-app').append(dialog)`);
    // Background/occluded Brave windows may throttle the observer's debounce.
    await until(async () => await display('tp-yt-iron-overlay-backdrop') === 'none', 'closed Share baseline');
    await page.evaluate(`document.querySelector('#share').setAttribute('opened','')`);
    await until(async () => await display('tp-yt-iron-overlay-backdrop') !== 'none', 'attribute-only Share open');
    await page.evaluate(`document.querySelector('#share').removeAttribute('opened')`);
    await until(async () => await display('tp-yt-iron-overlay-backdrop') === 'none', 'attribute-only Share close');
    console.log('PASS: separate dialog open/close restores shared backdrop');

    for (const state of ['EXPANDED', 'VISIBLE']) {
        await page.evaluate(`document.querySelector('ytd-engagement-panel-section-list-renderer').setAttribute('visibility','ENGAGEMENT_PANEL_VISIBILITY_${state}')`);
        assert.notEqual(await display('#secondary'), 'none');
        assert.equal(await display('#related'), 'none');
    }
    console.log('PASS: transcript CSS EXPANDED and VISIBLE');
    await page.evaluate(`document.querySelector('ytd-engagement-panel-section-list-renderer').setAttribute('visibility','ENGAGEMENT_PANEL_VISIBILITY_HIDDEN')`);
    assert.equal(await display('#secondary'), 'none');
    await settings({ hide_premium_popups: false, hide_sidebar: false });
    assert.notEqual(await display('#secondary'), 'none');
    assert.equal(await page.evaluate(`document.querySelectorAll('[data-lym-premium-hidden],[data-lym-premium-backdrop-hidden],[data-lym-premium-promo-hidden]').length`), 0);
    console.log('PASS: feature-off cleanup');

    // ---- 25-toggle display matrix: every CSS-driven setting must hide its
    // representative element, and reveal it again when turned off ----
    const cssProp = (selector, prop) => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(prop)})`);
    const hidden = async (setting, selector) => {
        await settings({ [setting]: true });
        await until(async () => await display(selector) === 'none', `${setting} hides ${selector}`);
    };
    const matrix = [
        ['hide_left_nav', 'tp-yt-app-drawer#guide'],
        ['hide_subscriptions_section', '#guide-subs'],
        ['hide_you_section', '#guide-you'],
        ['hide_explore', '#guide-explore'],
        ['hide_more_from_youtube', '#guide-more'],
        ['hide_comments', '#comments'],
        ['hide_likes', '#like-text'],
        ['hide_hype_button', '#hype-btn'],
        ['hide_end_suggestions', '#endscreen'],
        ['hide_autoplay', '#autoplay-toggle'],
        ['hide_premium_popups', '#mealbar'],
        ['hide_shorts', '#shorts-link'],
        ['hide_shorts', '#shorts-shelf'],
        ['hide_search_suggestions', '#search-sugg'],
        ['hide_voice_search', '#voice-search-button'],
        ['hide_notif_bell', '#bell'],
        ['hide_youtube_logo', '#logo'],
        ['hide_create_button', '#create-btn'],
        ['disable_thumbnail_playback', '#thumb-preview'],
        ['hide_live_premiere', '#live-item'],
    ];
    for (const [setting, selector] of matrix) await hidden(setting, selector);
    console.log('PASS: display matrix hides (20 checks)');
    // Blur asserts filter instead of display.
    await settings({ blur_thumbnails: true });
    await until(async () => (await cssProp('#blur-thumb', 'filter')) !== 'none', 'blur filter');
    console.log('PASS: thumbnail blur filter');
    // Turning everything off restores all matrix elements.
    await settings({
        hide_left_nav: false, hide_subscriptions_section: false, hide_you_section: false,
        hide_explore: false, hide_more_from_youtube: false, hide_comments: false,
        hide_likes: false, hide_hype_button: false, hide_end_suggestions: false,
        hide_autoplay: false, hide_premium_popups: false, hide_shorts: false,
        hide_search_suggestions: false, hide_voice_search: false, hide_notif_bell: false,
        hide_youtube_logo: false, hide_create_button: false, blur_thumbnails: false,
        disable_thumbnail_playback: false, hide_live_premiere: false,
    });
    for (const [, selector] of matrix) {
        assert.notEqual(await display(selector), 'none', `${selector} restored`);
    }
    assert.equal(await cssProp('#blur-thumb', 'filter'), 'none');
    assert.equal(await page.evaluate(`document.querySelectorAll('[data-lym-control-hidden],[data-lym-likes-applied]').length`), 0);
    console.log('PASS: matrix off-state restores all elements');

    // ---- List View runs on the subscriptions page: content.js strips the
    // page-subtype marker elsewhere by design, so navigate there first ----
    await navigateAndRefresh('https://www.youtube.com/feed/subscriptions', 'subscriptions page context');
    await settings({ list_view: true });
    await until(async () => (await cssProp('#list-img', 'width')) === '260px', 'list thumbnail 260px');
    assert.equal(await cssProp('#list-row', 'display'), 'flex');
    assert.equal(await cssProp('#list-row', 'flex-direction'), 'row');
    console.log('PASS: list view layout');
    // Compact asserts 180px alongside list view.
    await settings({ compact_list_view: true });
    await until(async () => (await cssProp('#list-img', 'width')) === '180px', 'compact thumbnail 180px');
    console.log('PASS: compact list view layout');
    await settings({ list_view: false, compact_list_view: false });
    await navigateAndRefresh('https://www.youtube.com/watch?v=abcdefghijk', 'watch page context');
    // Dubbing preference only sets the html attribute (menu stays visible by design).
    await settings({ disable_auto_dubbing: true });
    assert.equal(await page.evaluate(`document.documentElement.getAttribute('disable_auto_dubbing')`), 'true');
    assert.notEqual(await display('#primary'), 'none');
    console.log('PASS: auto-dubbing attribute without hiding content');
    await settings({ disable_auto_dubbing: false });

    // ---- Homepage redirect: default_subscriptions=true sends / to the feed ----
    await settings({ default_subscriptions: true });
    await navigateAndRefresh('https://www.youtube.com/', 'redirect landing context');
    await until(async () => (await page.evaluate(`location.pathname`)) === '/feed/subscriptions', 'homepage redirect', 15000);
    console.log('PASS: homepage redirects to subscriptions');
    await settings({ default_subscriptions: false });
    await navigateAndRefresh('https://www.youtube.com/watch?v=abcdefghijk', 'watch page context');
    await until(() => page.evaluate(`location.pathname.includes('/watch')`), 'back on watch page');

    const { targetId } = await browserClient.send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup.html` });
    const popupTarget = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(target => target.id === targetId), 'popup target');
    const popup = new CDP(popupTarget.webSocketDebuggerUrl);
    clients.push(popup);
    await until(() => popup.evaluate("document.querySelector('#version-display')?.textContent === 'v' + chrome.runtime.getManifest().version"), 'popup ready');
    await popup.evaluate("chrome.storage.sync.set({list_view:true,compact_list_view:true})");
    await popup.evaluate("chrome.storage.local.set({extension_enabled:false})");
    await popup.send('Page.reload');
    await until(() => popup.evaluate("document.body?.hasAttribute('data-extension-disabled')"), 'popup disabled startup');
    assert.equal(await popup.evaluate("[...document.querySelectorAll('input[type=checkbox]')].every(input=>input.disabled)"), true);
    await popup.evaluate("document.querySelector('#power-toggle').click()");
    assert.equal(await popup.evaluate("document.querySelector('#compact_list_view').disabled"), false);
    await popup.evaluate("document.querySelector('#language-toggle').click()");
    await until(() => popup.evaluate("document.documentElement.lang === 'en'"), 'English override');
    console.log('PASS: popup power, compact dependency and English');

    await page.send('Fetch.disable');
    await page.send('Page.navigate', { url: 'chrome://version/' });
    await until(() => page.evaluate("location.protocol === 'chrome:'"), 'restricted page');
    await delay(200);
    assert.equal([...contexts.values()].some(context => context.origin.startsWith('chrome-extension://')), false);
    console.log('PASS: no content injection on browser-owned page');

    if (process.argv.includes('--live')) {
        await popup.evaluate("chrome.storage.sync.set({list_view:false,compact_list_view:false,hide_sidebar:true,hide_premium_popups:true})");
        await page.send('Page.navigate', { url: 'https://www.youtube.com/watch?v=aircAruvnKk&hl=en&gl=US' });
        await until(() => page.evaluate("!!document.querySelector('ytd-watch-flexy #secondary')"), 'live watch page', 45000);
        await until(() => page.evaluate("document.documentElement.getAttribute('hide_sidebar') === 'true'"), 'live sidebar setting');
        await page.evaluate("document.querySelector('ytd-text-inline-expander #expand, #description-inline-expander #expand')?.click()");
        const trigger = "document.querySelector('ytd-video-description-transcript-section-renderer button, yt-video-description-transcript-section-renderer button')";
        await until(() => page.evaluate(`!!${trigger}`), 'live transcript trigger', 30000);
        await page.evaluate(`${trigger}.click()`);
        await until(() => page.evaluate("[...document.querySelectorAll('#secondary [target-id*=transcript]')].some(el=>el.getBoundingClientRect().height>0 && getComputedStyle(el).display!=='none')"), 'live transcript', 30000);
        assert.equal(await display('#related'), 'none');
        assert.notEqual(await display('#secondary'), 'none');
        console.log('PASS: LIVE YouTube transcript opened with sidebar already hidden');
        const liveContext = [...contexts.values()].find(context => context.origin.startsWith('chrome-extension://'));
        const description = await page.evaluate(`(async () => {
            const current = await fetchVideoDescription(location.href);
            const response = await fetch(getCanonicalWatchUrl(location.href), {credentials:'omit', mode:'same-origin'});
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let head = '';
            try {
                while (true) {
                    const {done,value} = await reader.read();
                    if (done) break;
                    head += decoder.decode(value,{stream:true});
                    if (head.includes('</head>') || head.length > 15000) break;
                }
            } finally { await reader.cancel(); }
            const previous = new DOMParser().parseFromString(head,'text/html').querySelector('meta[name="description"]')?.content;
            return {currentLength:current?.length || 0, previousLength:previous?.length || 0};
        })()`, liveContext.id);
        assert.ok(!description.previousLength || description.currentLength > 0, 'Description available under old limit must remain available');
        console.log('LIVE description comparison:', JSON.stringify(description));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const client of clients) client.close();
    if (browserClient) {
        try { await browserClient.send('Browser.close'); browserClosed = true; } catch {}
        browserClient.close();
    }
    if (!browserClosed && browser && !browser.killed) browser.kill();
    await delay(1500);
    // Delete only the exact mkdtemp directory owned by this run.
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('lym-smoke-')) {
        try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 }); }
        catch (error) { console.warn(`Temporary profile retained: ${resolved}: ${error.message}`); }
    }
});
