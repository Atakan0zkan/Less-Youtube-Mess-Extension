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
</style></head><body><ytd-app><ytd-watch-flexy><div id="columns"><div id="primary">Video</div>
<div id="secondary"><div id="related">Recommendations</div>
<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN">Transcript</ytd-engagement-panel-section-list-renderer>
</div></div></ytd-watch-flexy><tp-yt-paper-dialog id="premium" opened><yt-upsell-dialog-renderer>Premium</yt-upsell-dialog-renderer></tp-yt-paper-dialog>
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
    const isolated = await until(() => [...contexts.values()].find(context => context.origin.startsWith('chrome-extension://')), 'unpacked content context');
    await until(() => page.evaluate("typeof cachedSettings !== 'undefined'", isolated.id), 'content initialization');
    const extensionId = new URL(isolated.origin).hostname;
    const settings = async values => {
        await page.evaluate(`chrome.storage.sync.set(${JSON.stringify(values)})`, isolated.id);
        await delay(350);
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
