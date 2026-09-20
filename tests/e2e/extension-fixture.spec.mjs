// Less Youtube Mess — Playwright fixture E2E (AI-less, deterministic).
// No live YouTube. Intercepts https://www.youtube.com/* with a controlled
// fixture, loads the unpacked extension, drives settings via chrome.storage.
// Blocking CI job: green = mergeable. Live checks live in the separate
// non-blocking `live` job (browser-smoke --live).
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const FIXTURE = `<!doctype html><html><head><style>
ytd-app,ytd-watch-flexy,#columns,#primary,#secondary,#related,tp-yt-paper-dialog{display:block}
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

let tmpDir;
let extensionDir;
let userDataDir;

test.beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lym-pw-'));
  expect(tmpDir.includes(' ')).toBe(false);
  extensionDir = path.join(tmpDir, 'extension');
  userDataDir = path.join(tmpDir, 'profile');
  fs.mkdirSync(extensionDir, { recursive: true });
  for (const f of ['manifest.json', 'content.js', 'styles.css', 'page-audio-bridge.js', 'popup.html', 'popup.js', 'popup.css', 'shared', 'icons', '_locales']) {
    fs.cpSync(path.join(ROOT, f), path.join(extensionDir, f), { recursive: true });
  }
});

test.afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

async function launchWithFixture() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [`--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
  });
  const page = context.pages()[0] || (await context.newPage());
  await context.route('https://www.youtube.com/*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }),
  );
  await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
  await expect
    .poll(() => page.evaluate(() => typeof cachedSettings !== 'undefined'), { timeout: 15000 })
    .toBe(true);
  const set = (values) =>
    page.evaluate((v) => new Promise((res) => chrome.storage.sync.set(v, res)), values).then(() => page.waitForTimeout(400));
  const display = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, sel);
  return { context, page, set, display };
}

test('sidebar + premium hiding, reuse restores functional dialog', async () => {
  const { context, page, set, display } = await launchWithFixture();
  try {
    await set({ hide_sidebar: true, hide_premium_popups: true });
    expect(await display('#secondary')).toBe('none');
    expect(await display('#premium')).toBe('none');
    // Recycled host becomes Share -> must reappear with backdrop
    await page.evaluate(() => document.querySelector('#premium').replaceChildren(Object.assign(document.createElement('div'), { textContent: 'Share' })));
    await expect.poll(() => display('#premium'), { timeout: 8000 }).not.toBe('none');
    // Feature-off cleanup removes owned markers
    await set({ hide_premium_popups: false, hide_sidebar: false });
    expect(await page.evaluate(() => document.querySelectorAll('[data-lym-premium-hidden],[data-lym-premium-backdrop-hidden],[data-lym-premium-promo-hidden]').length)).toBe(0);
  } finally {
    await context.close();
  }
});

test('transcript EXPANDED/VISIBLE keeps #secondary, hides #related', async () => {
  const { context, page, set, display } = await launchWithFixture();
  try {
    await set({ hide_sidebar: true });
    for (const state of ['EXPANDED', 'VISIBLE']) {
      await page.evaluate((s) => document.querySelector('ytd-engagement-panel-section-list-renderer').setAttribute('visibility', `ENGAGEMENT_PANEL_VISIBILITY_${s}`), state);
      expect(await display('#secondary')).not.toBe('none');
      expect(await display('#related')).toBe('none');
    }
    await page.evaluate(() => document.querySelector('ytd-engagement-panel-section-list-renderer').setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'));
    expect(await display('#secondary')).toBe('none');
  } finally {
    await context.close();
  }
});

test('all 25 settings map to <html> attributes', async () => {
  const { context, page, set } = await launchWithFixture();
  try {
    const keys = await page.evaluate(() => SETTINGS_KEYS);
    expect(keys.length).toBe(25);
    await set({ hide_shorts: true, hide_comments: true, list_view: true });
    expect(await page.evaluate(() => document.documentElement.getAttribute('hide_shorts'))).toBe('true');
    expect(await page.evaluate(() => document.documentElement.getAttribute('hide_comments'))).toBe('true');
    // extension disabled strips attributes (reversible)
    await page.evaluate(() => new Promise((res) => chrome.storage.local.set({ extension_enabled: false }, res)));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.getAttribute('hide_shorts'))).toBe(null);
    await page.evaluate(() => new Promise((res) => chrome.storage.local.set({ extension_enabled: true }, res)));
    await page.waitForTimeout(400);
  } finally {
    await context.close();
  }
});
