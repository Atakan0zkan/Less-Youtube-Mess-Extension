// Less Youtube Mess - Content Script
// Settings are cached in memory; CSS attribute-selectors on <html> handle visibility toggling.

'use strict';

// SETTINGS_KEYS and DEFAULTS are loaded from shared/constants.js

// Cached settings — updated via storage listener
let cachedSettings = { ...DEFAULTS };

// Extension-wide enable/disable state (local storage, default: true)
let extensionEnabled = true;

const TRUE_SETTING_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_SETTING_VALUES = new Set(['false', '0', 'no', 'off']);
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function coerceSettingValue(key, value) {
    if (typeof value === 'boolean') return value;

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (TRUE_SETTING_VALUES.has(normalized)) return true;
        if (FALSE_SETTING_VALUES.has(normalized)) return false;
    }

    return DEFAULTS[key];
}

function normalizeSettings(raw = {}) {
    const normalized = {};
    for (const key of SETTINGS_KEYS) {
        normalized[key] = coerceSettingValue(key, raw[key]);
    }
    return normalized;
}

function toSelectorList(selectors) {
    return Array.isArray(selectors) ? selectors : [selectors];
}

function queryOne(root, selectors) {
    if (!root || !root.querySelector) return null;
    for (const selector of toSelectorList(selectors)) {
        const found = root.querySelector(selector);
        if (found) return found;
    }
    return null;
}

function queryAll(root, selectors) {
    if (!root || !root.querySelectorAll) return [];
    const found = [];
    const seen = new Set();
    for (const selector of toSelectorList(selectors)) {
        for (const el of root.querySelectorAll(selector)) {
            if (!seen.has(el)) {
                seen.add(el);
                found.push(el);
            }
        }
    }
    return found;
}

function matchesAny(el, selectors) {
    if (!el || !el.matches) return false;
    return toSelectorList(selectors).some(selector => el.matches(selector));
}

function getCanonicalWatchUrl(href) {
    try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== 'https://www.youtube.com') return null;
        if (url.pathname !== '/watch') return null;

        const videoId = url.searchParams.get('v');
        if (!videoId || !YOUTUBE_VIDEO_ID_RE.test(videoId)) return null;

        return `https://www.youtube.com/watch?v=${videoId}`;
    } catch (e) {
        return null;
    }
}

function shouldRedirectToSubscriptions(currentUrl = window.location.href) {
    try {
        const url = new URL(currentUrl);
        return url.pathname === '/';
    } catch (e) {
        return false;
    }
}

// ===================== APPLY SETTINGS TO HTML =====================

function applySettings(settings) {
    cachedSettings = normalizeSettings(settings);
    const html = document.documentElement;

    // If extension is disabled, strip all attributes and return early.
    // YouTube reverts to its normal appearance.
    if (!extensionEnabled) {
        for (const key of SETTINGS_KEYS) {
            html.removeAttribute(key);
        }
        return;
    }

    for (const key of SETTINGS_KEYS) {
        html.setAttribute(key, String(cachedSettings[key]));
    }
}

// IMPROVE-07: Apply DEFAULTS immediately at document_start to minimise FOUC.
// The async storage callback below will override with the real values shortly after.
applySettings(DEFAULTS);

// ===================== EXTENSION CONTEXT GUARD =====================

function isExtensionValid() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

// ===================== INITIAL LOAD =====================

if (isExtensionValid()) {
    try {
        // Load extension_enabled from local storage first
        chrome.storage.local.get({ extension_enabled: true }, (res) => {
            if (chrome.runtime.lastError) {
                console.warn('[Less YouTube Mess]', chrome.runtime.lastError.message);
                return;
            }
            extensionEnabled = res.extension_enabled !== false;

            // Now load sync settings and apply
            chrome.storage.sync.get(DEFAULTS, (settings) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Less YouTube Mess]', chrome.runtime.lastError.message);
                    return;
                }
                applySettings(settings);

                if (extensionEnabled && cachedSettings.default_subscriptions && shouldRedirectToSubscriptions()) {
                    window.location.replace('https://www.youtube.com/feed/subscriptions');
                }
            });
        });
    } catch (e) {
        console.warn('[Less YouTube Mess] Init error:', e.message);
    }
}

// ===================== STORAGE CHANGE LISTENER =====================

if (isExtensionValid()) {
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            // SEC-03: Guard against extension context invalidation mid-session
            if (!isExtensionValid()) return;

            // React to extension_enabled changes from local storage
            if (area === 'local' && 'extension_enabled' in changes) {
                extensionEnabled = changes.extension_enabled.newValue !== false;
                applySettings(cachedSettings);
                if (extensionEnabled) {
                    scheduleRunFeatures();
                }
                return;
            }

            if (area !== 'sync') return;
            let needsUpdate = false;
            for (const key of SETTINGS_KEYS) {
                if (key in changes) {
                    cachedSettings[key] = coerceSettingValue(key, changes[key].newValue);
                    needsUpdate = true;
                }
            }
            if (needsUpdate) {
                applySettings(cachedSettings);
                scheduleRunFeatures(); // BUG-E: use scheduler to coalesce with yt-navigate-finish
            }
        });
    } catch (e) {
        console.warn('[Less YouTube Mess] Storage listener error:', e.message);
    }
}

// ===================== DOM MANIPULATION =====================

// Debounce helper
function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// --- Live / Premiere Marking ---
// Marks items with data-live-premiere attribute; CSS handles the actual hiding.
function markLiveAndPremieres(items) {
    items.forEach(item => {
        const titleLink = queryOne(item, SELECTORS.TITLE_LINK);
        if (!titleLink || !titleLink.href) return;

        const videoId = getCanonicalWatchUrl(titleLink.href);
        if (!videoId) return;

        if (item.getAttribute('data-live-checked') === videoId) return;

        item.setAttribute('data-live-checked', videoId);
        item.removeAttribute('data-live-premiere'); // Reset in case of recycle

        let isLive = false;

        // Overlay style
        if (item.querySelector('[overlay-style="LIVE"]') ||
            item.querySelector('[overlay-style="UPCOMING"]')) {
            isLive = true;
        }

        // Button text (supports multiple locales)
        if (!isLive) {
            const buttons = item.querySelectorAll('button, yt-button-shape');
            for (const btn of buttons) {
                const text = (btn.textContent || '');
                if (/(remind me|notify me|bana hatırlat|recuérdame|rappelle-moi|erinnere mich|ricordami|リマインダー|알림 설정|मुझे याद दिलाएं)/i.test(text)) {
                    isLive = true;
                    break;
                }
            }
        }

        // Badge text (supports multiple locales)
        if (!isLive) {
            const badges = item.querySelectorAll('.badge-shape-wiz__text, .yt-core-attributed-string');
            for (const badge of badges) {
                const text = (badge.textContent || '');
                if (/(yakında|canlı|live|premiere|upcoming|ilk gösterim|i̇lk gösterim|estreno|première|premieren|anteprima|프리미어|プレミア公開|próximamente|em breve|bald|prossimamente)/i.test(text)) {
                    isLive = true;
                    break;
                }
            }
        }

        // Scheduled (supports multiple locales)
        if (!isLive) {
            const metadata = item.querySelector('yt-content-metadata-view-model, #metadata');
            if (metadata) {
                const text = (metadata.textContent || '');
                if (/(planlandı|scheduled for|programado|programmé|geplant|programmato|予定|예정|निर्धारित)/i.test(text)) {
                    isLive = true;
                }
            }
        }

        if (isLive) {
            item.setAttribute('data-live-premiere', 'true');
        }
    });
}

// --- Force Likes Visibility ---
// Supplements CSS: like-button-view-model re-renders after attribute changes,
// so JS forces visibility immediately without requiring a page reload.
let _lastHideLikes = undefined;
let likesDirty = true;

let _lastHideAutoplay = undefined;
let autoplayDirty = true;

const LIKE_TEXT_SELECTORS = [
    'like-button-view-model .yt-core-attributed-string',
    'document-like-button-view-model .yt-core-attributed-string',
    'like-button-view-model .yt-spec-button-shape-next__button-text-content',
    'segmented-like-dislike-button-view-model .yt-spec-button-shape-next__button-text-content'
];

const LIKE_MUTATION_SELECTORS = [
    'like-button-view-model',
    'segmented-like-dislike-button-view-model',
    'document-like-button-view-model',
    ...LIKE_TEXT_SELECTORS
];

const AUTOPLAY_MUTATION_SELECTORS = [
    '.ytp-autonav-toggle-button',
    'button.ytp-button[data-tooltip-target-id="ytp-autonav-toggle-button"]',
    '.ytp-autonav-toggle-button-container'
];

function forceLikesVisibility() {
    const shouldHide = cachedSettings.hide_likes;

    if (shouldHide !== _lastHideLikes) {
        likesDirty = true;
        _lastHideLikes = shouldHide;
    }

    if (!likesDirty) return;

    if (shouldHide) {
        for (const el of queryAll(document, LIKE_TEXT_SELECTORS)) {
            if (el.getAttribute('data-lym-likes-applied') === 'hidden') continue;
            el.style.setProperty('display', 'none', 'important');
            el.setAttribute('data-lym-likes-applied', 'hidden');
        }
    } else {
        for (const el of document.querySelectorAll('[data-lym-likes-applied="hidden"]')) {
            el.style.removeProperty('display');
            el.removeAttribute('data-lym-likes-applied');
        }
    }

    likesDirty = false;
}

// --- Dismiss Premium Popups ---
// CSS hides premium dialogs; JS cleans up the shared backdrop (tp-yt-iron-overlay-backdrop)
// that would otherwise remain and block the page.
function dismissPremiumPopups() {
    if (!cachedSettings.hide_premium_popups) return;

    // PERF-02: Only query dialogs not yet processed, avoiding redundant work.
    const dialogs = document.querySelectorAll('tp-yt-paper-dialog:not([data-premium-hidden])');
    for (const dialog of dialogs) {
        const isUpsell = dialog.querySelector('yt-upsell-dialog-renderer');
        if (isUpsell) {
            dialog.setAttribute('data-premium-hidden', 'true');
            dialog.style.setProperty('display', 'none', 'important');

            // BUG-04: Use a global query for open backdrops instead of fragile
            // previousElementSibling position-based detection.
            const openBackdrops = document.querySelectorAll('tp-yt-iron-overlay-backdrop[opened]');
            openBackdrops.forEach(b => b.style.setProperty('display', 'none', 'important'));
        }
    }
}

// --- Apply Autoplay Setting ---
// IMPROVE-01: Disables YouTube autoplay when hide_autoplay is enabled.
// CSS handles hiding the overlay panel; JS turns the toggle off if it is currently active.
function applyAutoplay() {
    const shouldHide = cachedSettings.hide_autoplay;

    if (shouldHide !== _lastHideAutoplay) {
        autoplayDirty = true;
        _lastHideAutoplay = shouldHide;
    }

    if (!shouldHide) {
        autoplayDirty = false;
        return;
    }

    // Persist preference via localStorage (YouTube reads this key for autoplay state)
    // RISK: 'yt-autoplay' is a YouTube-internal key; collision is unlikely but possible.
    try {
        localStorage.setItem('yt-autoplay', '0');
    } catch (e) { /* storage may be blocked */ }

    // Click the in-player autoplay toggle if it is currently active
    const autonavToggle = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (autonavToggle) {
        autonavToggle.click();
    }

    autoplayDirty = false;
}

// --- Subscriptions Header ---
// TOMBSTONE (v1.7.0): processSubscriptionsHeader is intentionally DISABLED.
// It previously cloned channel names and wrapped avatars in links for list view.
// This caused persistent layout conflicts because YouTube sets position:relative,
// contain:layout, and isolation:isolate on intermediate wrapper elements.
// Avatar and channel metadata now use YouTube's default layout (flow positioning).
// DO NOT re-enable without completely rethinking the positioning strategy.
// See: systemPatterns.md "Let YouTube Handle Avatar/Metadata Layout"

// --- Video Descriptions ---
// Lazily fetches meta descriptions via IntersectionObserver to limit network requests.
// Uses streaming fetch to download only the <head> portion (~10KB) instead of full page (~300KB).
const MAX_CONCURRENT_FETCHES = 3;
let activeFetches = 0;
const fetchQueue = [];

// PERF-04: Track all active AbortControllers so in-flight fetches can be cancelled on navigation.
const activeControllers = new Set();

// Fetches only the <head> of a YouTube page using streaming reader.
// Returns the meta description content string, or null.
async function fetchVideoDescription(href) {
    // Security: only allow canonical YouTube watch pages with valid 11-char video IDs.
    const canonicalHref = getCanonicalWatchUrl(href);
    if (!canonicalHref) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    activeControllers.add(controller); // PERF-04: Register for potential cancellation

    try {
        // SEC-01: credentials: 'omit' — description fetch does not need auth cookies
        const response = await fetch(canonicalHref, {
            signal: controller.signal,
            credentials: 'omit',
            mode: 'same-origin'
        });
        // BUG-08: Check response status before reading body — 4xx/5xx have no useful meta
        if (!response.ok) return null;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
            // Meta tags are in <head>; stop after </head> or 15KB to save bandwidth
            if (accumulated.includes('</head>') || accumulated.length > 15000) {
                reader.cancel().catch(() => {});
                break;
            }
        }

        // Parse safely with DOMParser (no script execution, handles all HTML entities natively)
        const doc = new DOMParser().parseFromString(accumulated, 'text/html');
        const metaDesc = doc.querySelector('meta[name="description"]');
        const content = metaDesc?.getAttribute('content');
        return (content && content !== 'null') ? content : null;
    } catch (e) {
        return null;
    } finally {
        // BUG-C FIX: clearTimeout moved to finally block so it ALWAYS runs,
        // even if reader.cancel() throws or an unexpected error occurs.
        clearTimeout(timeoutId);
        activeControllers.delete(controller); // PERF-04: Deregister when done
    }
}

// OPT-2: Iterative processQueue to avoid call stack overflow when the queue contains
// many consecutive stale items (e.g. after rapid scroll + SPA navigation).
function processQueue() {
    // Drain stale items inline, then kick off one fetch per available slot.
    while (activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length > 0) {
        const item = fetchQueue.shift();
        const linkEl = queryOne(item, SELECTORS.TITLE_LINK);
        const metadataContainer = queryOne(item, SELECTORS.CONTENT_METADATA);

        if (!linkEl || !linkEl.href || !metadataContainer) continue;

        // BUG-07: Verify the item hasn't been recycled since it was queued.
        // YouTube's ytd-rich-item-renderer reuse is async; the href may have changed by the time
        // we dequeue. If the current href no longer matches our mark, skip this stale entry.
        const currentVideoId = getCanonicalWatchUrl(linkEl.href);
        if (!currentVideoId) continue;
        if (item.getAttribute('data-desc-done') !== currentVideoId) continue; // Stale — skip

        activeFetches++;
        fetchVideoDescription(linkEl.href)
            .then(content => {
                if (content) {
                    // BUG-09: Prevent duplicate descriptions if processQueue races
                    if (metadataContainer.querySelector('.custom-description')) return;
                    const descDiv = document.createElement('div');
                    descDiv.className = 'custom-description';
                    descDiv.textContent = content; // textContent prevents XSS
                    metadataContainer.appendChild(descDiv);
                }
            })
            .finally(() => {
                activeFetches--;
                processQueue(); // Re-enter to fill the freed slot
            });
        // One fetch per loop iteration — finally() handles the rest
        break;
    }
}

// Lazy-initialized IntersectionObserver for video descriptions
let descriptionObserver = null;

function getDescriptionObserver() {
    if (!descriptionObserver) {
        descriptionObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const item = entry.target;
                    observer.unobserve(item);
                    fetchQueue.push(item);
                    processQueue();
                }
            });
        }, {
            rootMargin: '500px 0px 500px 0px'
        });
    }
    return descriptionObserver;
}

function processVideoDescriptions(items) {
    const observer = getDescriptionObserver();

    items.forEach(item => {
        const metadataContainer = queryOne(item, SELECTORS.CONTENT_METADATA);
        const linkEl = queryOne(item, SELECTORS.TITLE_LINK);

        if (!metadataContainer || !linkEl || !linkEl.href) return;

        const videoId = getCanonicalWatchUrl(linkEl.href);
        if (!videoId) return;

        if (item.getAttribute('data-desc-done') === videoId) return;

        item.setAttribute('data-desc-done', videoId);

        const oldDesc = item.querySelectorAll('.custom-description');
        oldDesc.forEach(d => d.remove());

        observer.observe(item);
    });
}

// ===================== SELF-DIAGNOSTICS =====================
// Runs once per page load on /feed/subscriptions. Warns in console if critical
// DOM selectors are missing — indicates YouTube changed its class names.
let _diagnosed = false;
let _outerStructureWarned = false;
let _diagnoseTimer = null;
const DIAGNOSE_OUTER_DELAY_MS = 4000;

function isSubscriptionsPage() {
    return window.location.href.includes('/feed/subscriptions');
}

function clearDiagnoseTimer() {
    if (_diagnoseTimer) {
        clearTimeout(_diagnoseTimer);
        _diagnoseTimer = null;
    }
}

function formatSelectors(selectors) {
    return toSelectorList(selectors).join(' | ');
}

function scheduleOuterStructureDiagnostic() {
    if (_diagnoseTimer || _outerStructureWarned || _diagnosed || !isSubscriptionsPage()) return;

    _diagnoseTimer = setTimeout(() => {
        _diagnoseTimer = null;
        if (!extensionEnabled || _outerStructureWarned || _diagnosed || !isSubscriptionsPage()) return;

        const items = document.querySelectorAll('ytd-rich-item-renderer');
        if (items.length === 0) {
            _outerStructureWarned = true;
            console.warn('[Less YouTube Mess] YouTube outer structure changed: no subscription item containers found after delay.');
        }
    }, DIAGNOSE_OUTER_DELAY_MS);
}

function selfDiagnose() {
    if (_diagnosed) return;
    if (!isSubscriptionsPage()) return;

    const items = document.querySelectorAll('ytd-rich-item-renderer');
    if (items.length === 0) {
        scheduleOuterStructureDiagnostic();
        return;
    }

    clearDiagnoseTimer();

    const item = [...items].find(el => queryOne(el, SELECTORS.LOCKUP)) || items[0];
    _diagnosed = true;

    const checks = [
        ['lockup', SELECTORS.LOCKUP],
        ['title link', SELECTORS.TITLE_LINK],
        ['metadata', SELECTORS.CONTENT_METADATA],
    ];
    const missing = checks.filter(([, sel]) => !queryOne(item, sel));
    if (missing.length === 0) {
        console.log('[Less YouTube Mess] \u2705 All selectors verified');
    } else {
        missing.forEach(([name, sel]) => {
            console.warn(`[Less YouTube Mess] \u26a0\ufe0f ${name} selector not found (${formatSelectors(sel)}). YouTube may have changed its DOM.`);
        });
    }
}

// ===================== MAIN FEATURE RUNNER =====================

// BUG-E: Coalesce rapid back-to-back runFeatures() calls (e.g. storage.onChanged
// firing at the same time as yt-navigate-finish). JS is single-threaded so these
// can't truly race, but they can cause a redundant DOM pass in the same tick.
// scheduleRunFeatures() ensures only one execution per microtask batch.
let _runFeaturesScheduled = false;
function scheduleRunFeatures() {
    if (_runFeaturesScheduled) return;
    _runFeaturesScheduled = true;
    // queueMicrotask fires after the current synchronous call stack, before the next
    // macrotask — so both callers in the same tick collapse into one runFeatures() call.
    queueMicrotask(() => {
        _runFeaturesScheduled = false;
        runFeatures();
    });
}

function runFeatures() {
    // If extension is disabled, skip all DOM manipulation
    if (!extensionEnabled) return;

    try { // IMPROVE-05: Wrap in try-catch to prevent silent crash from unexpected YouTube DOM changes
        const isSubscriptions = window.location.href.includes('/feed/subscriptions');

        // Query items once, share across functions that need them
        let items = null;
        const getItems = () => {
            if (!items) items = document.querySelectorAll('ytd-rich-item-renderer');
            return items;
        };

        if (cachedSettings.hide_live_premiere && isSubscriptions) {
            markLiveAndPremieres(getItems());
        }

        if (cachedSettings.list_view) {
            const browse = document.querySelector('ytd-browse');
            if (isSubscriptions) {
                if (browse && browse.getAttribute('page-subtype') !== 'subscriptions') {
                    browse.setAttribute('page-subtype', 'subscriptions');
                }
                // processSubscriptionsHeader disabled — avatar uses YouTube's default layout
                processVideoDescriptions(getItems());
            } else if (browse && browse.getAttribute('page-subtype') === 'subscriptions') {
                // Reset to prevent list view CSS from applying on other pages
                if (window.location.pathname === '/' || window.location.pathname === '/web') {
                    browse.setAttribute('page-subtype', 'home');
                } else {
                    browse.removeAttribute('page-subtype');
                }
            }
        }

        forceLikesVisibility();
        dismissPremiumPopups();
        applyAutoplay(); // IMPROVE-01
        selfDiagnose();
    } catch (e) {
        console.warn('[Less YouTube Mess] runFeatures error:', e.message);
    }
}

// ===================== NAVIGATION & OBSERVATION =====================

let lastUrl = window.location.href;

// Shared navigation handler — used by both yt-navigate-finish and MutationObserver.
// Returns true if a redirect was triggered (callers should skip runFeatures).
function handleNavigation(currentUrl) {
    if (currentUrl === lastUrl) return false;
    lastUrl = currentUrl;

    // PERF-04 + BUG-02: Cancel all in-flight description fetches and reset the counter.
    // Without this, completed fetches call processQueue() on a different page,
    // and activeFetches never reaches 0 so new fetches are blocked.
    activeControllers.forEach(c => c.abort());
    activeControllers.clear();
    activeFetches = 0;
    fetchQueue.length = 0;

    // BUG-01 + RISK-03 + BUG-C/OPT-5: Always disconnect and null the observer on
    // ANY navigation — not just when leaving /feed/subscriptions.
    // This prevents stale IntersectionObserver entries from accumulating when the user
    // navigates between subscription filters or internal sub-pages within subscriptions.
    // The observer is lazily re-created by getDescriptionObserver() on the next runFeatures().
    if (descriptionObserver) {
        descriptionObserver.disconnect();
        descriptionObserver = null;
    }

    // PERF-01: Reset likes-tracking so the new page re-applies the setting.
    _lastHideLikes = undefined;
    likesDirty = true;
    // OPT-1: Reset autoplay-tracking so the new page re-applies the setting.
    _lastHideAutoplay = undefined;
    autoplayDirty = true;
    _diagnosed = false; // Reset diagnostic for new page
    _outerStructureWarned = false;
    clearDiagnoseTimer();

    // Skip redirect when extension is disabled
    if (!extensionEnabled) return false;

    // Redirect on SPA navigation (only fires on URL change, not every mutation)
    if (cachedSettings.default_subscriptions && shouldRedirectToSubscriptions(currentUrl)) {
        window.location.replace('https://www.youtube.com/feed/subscriptions');
        return true;
    }

    return false;
}

// --- YouTube SPA Navigation Event ---
// More efficient than detecting URL changes via MutationObserver alone.
// Fires reliably on YouTube's internal SPA route changes.
document.addEventListener('yt-navigate-finish', () => {
    // SEC-03: Guard against extension context invalidation mid-session
    if (!isExtensionValid()) return;
    const redirected = handleNavigation(window.location.href);
    if (!redirected) scheduleRunFeatures(); // BUG-E: coalesce with storage.onChanged
});

// --- MutationObserver ---
// Still needed for lazy-loaded content (new videos appearing on scroll).
// OPT-D: Only call handleNavigation when the URL has actually changed.
function nodeMatchesOrContains(node, selectors) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return matchesAny(node, selectors) || !!queryOne(node, selectors);
}

function markFeatureDirtyFromMutations(mutations) {
    if (!mutations) return;

    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (!likesDirty && nodeMatchesOrContains(node, LIKE_MUTATION_SELECTORS)) {
                likesDirty = true;
            }
            if (!autoplayDirty && nodeMatchesOrContains(node, AUTOPLAY_MUTATION_SELECTORS)) {
                autoplayDirty = true;
            }
            if (likesDirty && autoplayDirty) return;
        }
    }
}

const debouncedRun = debounce(() => {
    // SEC-03: Guard against extension context invalidation mid-session
    if (!isExtensionValid()) return;
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
        handleNavigation(currentUrl);
    }
    // MutationObserver path: debounce already coalesces rapid DOM changes
    if (extensionEnabled) {
        runFeatures();
    }
}, 150);

const observer = new MutationObserver((mutations) => {
    markFeatureDirtyFromMutations(mutations);
    debouncedRun();
});

function startObserver() {
    // PERF-03: Prefer ytd-app over document.body for a tighter subtree —
    // avoids triggering on browser-chrome or extension mutations outside the YT app root.
    const target = document.querySelector('ytd-app') || document.body;
    if (target) {
        // OPT-4: attributes: false is the default but stated explicitly for clarity —
        // we only need to react to DOM structure changes, not attribute mutations.
        observer.observe(target, { childList: true, subtree: true, attributes: false });
        // OPT-A: Use scheduleRunFeatures() instead of direct runFeatures() to coalesce
        // with the yt-navigate-finish event that fires shortly after page load.
        scheduleRunFeatures();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            const t = document.querySelector('ytd-app') || document.body;
            observer.observe(t, { childList: true, subtree: true, attributes: false });
            scheduleRunFeatures(); // OPT-A
        }, { once: true });
    }
}

startObserver();
