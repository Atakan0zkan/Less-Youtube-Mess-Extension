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
const FORCE_ORIGINAL_AUDIO_EVENT = 'less-youtube-mess:force-original-audio';
const ORIGINAL_AUDIO_RETRY_DELAYS_MS = [0, 600, 1500, 3500, 6000];

function coerceBooleanLike(value, fallback) {
    if (typeof value === 'boolean') return value;

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (TRUE_SETTING_VALUES.has(normalized)) return true;
        if (FALSE_SETTING_VALUES.has(normalized)) return false;
    }

    return fallback;
}

function coerceSettingValue(key, value) {
    return coerceBooleanLike(value, DEFAULTS[key]);
}

function normalizeExtensionEnabled(value) {
    return coerceBooleanLike(value, true);
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

function getSubscriptionItems(root = document) {
    const candidates = queryAll(root, SELECTORS.SUBSCRIPTION_ITEM);
    const candidateSet = new Set(candidates);

    return candidates.filter(item => {
        for (let parent = item.parentElement; parent; parent = parent.parentElement) {
            if (candidateSet.has(parent)) return false;
        }
        return true;
    });
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

let _pageAudioBridgeInjected = false;

function injectPageAudioBridge() {
    if (_pageAudioBridgeInjected || !isExtensionValid()) return;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-audio-bridge.js');
    script.async = false;
    script.onload = () => script.remove();
    script.onerror = () => {
        _pageAudioBridgeInjected = false;
        script.remove();
    };

    _pageAudioBridgeInjected = true;
    (document.head || document.documentElement).appendChild(script);
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
        clearRuntimeStyles();
        clearOriginalAudioTrackTimers();
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

injectPageAudioBridge();

// ===================== INITIAL LOAD =====================

if (isExtensionValid()) {
    try {
        // Load extension_enabled from local storage first
        chrome.storage.local.get({ extension_enabled: true }, (res) => {
            if (chrome.runtime.lastError) {
                console.warn('[Less YouTube Mess]', chrome.runtime.lastError.message);
                return;
            }
            extensionEnabled = normalizeExtensionEnabled(res.extension_enabled);

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
                extensionEnabled = normalizeExtensionEnabled(changes.extension_enabled.newValue);
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
                    if (key === 'disable_auto_dubbing') {
                        _lastOriginalAudioRequestUrl = null;
                    }
                    if (key === 'disable_thumbnail_playback' && cachedSettings[key] === false) {
                        clearThumbnailPlaybackMarkers();
                    }
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
                if (LIVE_PREMIERE_PATTERNS.reminderButton.test(text)) {
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
                if (LIVE_PREMIERE_PATTERNS.badgeText.test(text)) {
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
                if (LIVE_PREMIERE_PATTERNS.scheduledText.test(text)) {
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

let _lastHidePremiumPopups = undefined;

const LIKE_TEXT_SELECTORS = [
    'ytd-watch-metadata #segmented-like-button .yt-core-attributed-string',
    'ytd-watch-metadata #segmented-like-button .ytCoreAttributedString',
    'ytd-watch-metadata #segmented-like-button .yt-spec-button-shape-next__button-text-content',
    'ytd-watch-metadata #segmented-like-button .ytSpecButtonShapeNextButtonTextContent',
    'ytd-watch-metadata #segmented-like-button [class*="button-text-content" i]',
    'ytd-watch-metadata #segmented-like-button [class*="buttonTextContent" i]',
    'ytd-watch-metadata #segmented-like-button [class*="attributed-string" i]',
    'ytd-watch-metadata #segmented-like-button [class*="AttributedString" i]',
    'ytd-watch-metadata #segmented-like-button span[role="text"]',
    'ytd-watch-metadata like-button-view-model button .yt-core-attributed-string',
    'ytd-watch-metadata like-button-view-model button .ytCoreAttributedString',
    'ytd-watch-metadata like-button-view-model button .yt-spec-button-shape-next__button-text-content',
    'ytd-watch-metadata like-button-view-model button .ytSpecButtonShapeNextButtonTextContent',
    'ytd-watch-metadata like-button-view-model button [class*="button-text-content" i]',
    'ytd-watch-metadata like-button-view-model button [class*="buttonTextContent" i]',
    'ytd-watch-metadata like-button-view-model button [class*="attributed-string" i]',
    'ytd-watch-metadata like-button-view-model button [class*="AttributedString" i]',
    'ytd-watch-metadata like-button-view-model button span[role="text"]',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button .yt-core-attributed-string',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button .ytCoreAttributedString',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button .yt-spec-button-shape-next__button-text-content',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button .ytSpecButtonShapeNextButtonTextContent',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button [class*="button-text-content" i]',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button [class*="buttonTextContent" i]',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button [class*="attributed-string" i]',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button [class*="AttributedString" i]',
    'ytd-watch-metadata segmented-like-dislike-button-view-model button span[role="text"]',
    'like-button-view-model .yt-core-attributed-string',
    'like-button-view-model .ytCoreAttributedString',
    'document-like-button-view-model .yt-core-attributed-string',
    'document-like-button-view-model .ytCoreAttributedString',
    'like-button-view-model .yt-spec-button-shape-next__button-text-content',
    'like-button-view-model .ytSpecButtonShapeNextButtonTextContent',
    'segmented-like-dislike-button-view-model .yt-spec-button-shape-next__button-text-content',
    'segmented-like-dislike-button-view-model .ytSpecButtonShapeNextButtonTextContent'
];

const LIKE_CONTROL_SELECTORS = [
    'ytd-watch-metadata #segmented-like-button',
    'ytd-watch-metadata like-button-view-model',
    'ytd-watch-metadata segmented-like-dislike-button-view-model',
    'ytd-watch-metadata button[aria-label*="like" i]',
    'ytd-watch-metadata button[aria-label*="beğen" i]'
];

const LIKE_TEXT_FALLBACK_SELECTORS = [
    '.yt-core-attributed-string',
    '.ytCoreAttributedString',
    '.yt-spec-button-shape-next__button-text-content',
    '.ytSpecButtonShapeNextButtonTextContent',
    'span[role="text"]',
    'yt-formatted-string',
    '[class*="button-text-content" i]',
    '[class*="buttonTextContent" i]',
    '[class*="attributed-string" i]',
    '[class*="AttributedString" i]'
];

const LIKE_MUTATION_SELECTORS = [
    'like-button-view-model',
    'segmented-like-dislike-button-view-model',
    'document-like-button-view-model',
    ...LIKE_CONTROL_SELECTORS,
    ...LIKE_TEXT_SELECTORS
];

const AUTOPLAY_MUTATION_SELECTORS = [
    '.ytp-autonav-toggle-button',
    'button.ytp-button[data-tooltip-target-id="ytp-autonav-toggle-button"]',
    '.ytp-autonav-toggle-button-container'
];

const CONTROL_HIDE_MARKER = 'data-lym-control-hidden';
const THUMBNAIL_PLAYBACK_MARKER = 'data-lym-thumbnail-playback-disabled';
const PREMIUM_DIALOG_MARKER = 'data-lym-premium-hidden';
const PREMIUM_BACKDROP_MARKER = 'data-lym-premium-backdrop-hidden';

const CREATE_CONTROL_SELECTORS = [
    'ytd-masthead #buttons ytd-topbar-menu-button-renderer',
    'ytd-masthead #buttons ytd-button-renderer',
    'ytd-masthead #buttons yt-button-view-model',
    'ytd-masthead #buttons button-view-model',
    'ytd-masthead #end ytd-topbar-menu-button-renderer',
    'ytd-masthead #end ytd-button-renderer',
    'ytd-masthead #end yt-button-view-model',
    'ytd-masthead #end button-view-model'
];

const HYPE_CONTROL_SELECTORS = [
    'ytd-watch-metadata #actions ytd-button-renderer',
    'ytd-watch-metadata #actions yt-button-view-model',
    'ytd-watch-metadata #actions button-view-model',
    'ytd-watch-metadata #actions button',
    'ytd-watch-metadata #actions a',
    '#top-level-buttons-computed ytd-button-renderer',
    '#top-level-buttons-computed yt-button-view-model',
    '#top-level-buttons-computed button-view-model'
];

const THUMBNAIL_PREVIEW_CONTAINER_SELECTORS = [
    'ytd-video-preview',
    'inline-preview-player',
    'ytd-thumbnail ytd-video-preview',
    'yt-thumbnail-view-model inline-preview-player',
    'ytd-thumbnail-overlay-playing-renderer'
];

const THUMBNAIL_PREVIEW_VIDEO_SELECTORS = [
    'ytd-video-preview video',
    'inline-preview-player video',
    'ytd-thumbnail video',
    'yt-thumbnail-view-model video'
];

const CREATE_TEXT_RE = /(\+?\s*create|oluştur|créer|erstellen|crear|criar|crea|maken|maak|utwórz|создать|створити|buat|cipta|tạo|สร้าง|إنشاء|ایجاد|बनाएं|作成|만들기|创建|建立|তৈরি)/i;
const HYPE_TEXT_RE = /(hype|super thanks|thanks|teşekkür|teşekkürler|alkış|applaud)/i;

let _lastOriginalAudioRequestUrl = null;
let _originalAudioTrackTimers = [];

function getControlText(el) {
    if (!el) return '';
    const attrs = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('tooltip'),
        el.getAttribute('data-tooltip-text')
    ].filter(Boolean);
    attrs.push(el.textContent || '');
    return attrs.join(' ');
}

function controlHasCreateTarget(el) {
    if (!el || !el.querySelector) return false;
    if (el.matches?.('a[href*="/upload"], a[href*="studio.youtube.com"]')) return true;
    return !!el.querySelector('a[href*="/upload"], a[href*="studio.youtube.com"]');
}

function clearHiddenControls(markerValue) {
    document.querySelectorAll(`[${CONTROL_HIDE_MARKER}="${markerValue}"]`).forEach(el => {
        el.style.removeProperty('display');
        el.removeAttribute(CONTROL_HIDE_MARKER);
    });
}

function hideMatchedControls(enabled, selectors, markerValue, predicate) {
    if (!enabled) {
        clearHiddenControls(markerValue);
        return;
    }

    for (const el of queryAll(document, selectors)) {
        if (el.getAttribute(CONTROL_HIDE_MARKER) === markerValue) continue;
        if (!predicate(el)) continue;

        el.style.setProperty('display', 'none', 'important');
        el.setAttribute(CONTROL_HIDE_MARKER, markerValue);
    }
}

function hideCreateButtonSupplement() {
    hideMatchedControls(
        cachedSettings.hide_create_button,
        CREATE_CONTROL_SELECTORS,
        'create',
        el => controlHasCreateTarget(el) || CREATE_TEXT_RE.test(getControlText(el))
    );
}

function hideHypeButton() {
    hideMatchedControls(
        cachedSettings.hide_hype_button,
        HYPE_CONTROL_SELECTORS,
        'hype',
        el => HYPE_TEXT_RE.test(getControlText(el))
    );
}

function clearOriginalAudioTrackTimers() {
    _originalAudioTrackTimers.forEach(timer => clearTimeout(timer));
    _originalAudioTrackTimers = [];
}

function scheduleOriginalAudioTrackSelection(force = false) {
    if (!extensionEnabled || !cachedSettings.disable_auto_dubbing) {
        clearOriginalAudioTrackTimers();
        _lastOriginalAudioRequestUrl = null;
        return;
    }

    const canonicalWatchUrl = getCanonicalWatchUrl(window.location.href);
    if (!canonicalWatchUrl) {
        clearOriginalAudioTrackTimers();
        _lastOriginalAudioRequestUrl = null;
        return;
    }

    if (!force && _lastOriginalAudioRequestUrl === canonicalWatchUrl) return;

    _lastOriginalAudioRequestUrl = canonicalWatchUrl;
    clearOriginalAudioTrackTimers();

    for (const delay of ORIGINAL_AUDIO_RETRY_DELAYS_MS) {
        const timer = setTimeout(() => {
            window.dispatchEvent(new CustomEvent(FORCE_ORIGINAL_AUDIO_EVENT));
        }, delay);
        _originalAudioTrackTimers.push(timer);
    }
}

function clearThumbnailPlaybackMarkers() {
    const elementsToClean = new Set(document.querySelectorAll(`[${THUMBNAIL_PLAYBACK_MARKER}]`));
    const previewSelectors = [
        ...THUMBNAIL_PREVIEW_VIDEO_SELECTORS,
        ...THUMBNAIL_PREVIEW_CONTAINER_SELECTORS
    ];

    for (const el of queryAll(document, previewSelectors)) {
        const hasExtensionDisplayNone = el.style.getPropertyValue('display') === 'none' &&
            el.style.getPropertyPriority('display') === 'important';
        if (hasExtensionDisplayNone) {
            elementsToClean.add(el);
        }
    }

    elementsToClean.forEach(el => {
        el.style.removeProperty('display');
        el.removeAttribute(THUMBNAIL_PLAYBACK_MARKER);
    });
}

function disableThumbnailPlayback() {
    const shouldDisable = extensionEnabled &&
        cachedSettings.disable_thumbnail_playback === true &&
        document.documentElement.getAttribute('disable_thumbnail_playback') === 'true';

    if (!shouldDisable) {
        clearThumbnailPlaybackMarkers();
        return;
    }

    for (const video of queryAll(document, THUMBNAIL_PREVIEW_VIDEO_SELECTORS)) {
        try {
            video.pause();
            video.muted = true;
        } catch (e) { /* YouTube may recycle the media element during hover */ }

        video.style.setProperty('display', 'none', 'important');
        video.setAttribute(THUMBNAIL_PLAYBACK_MARKER, 'true');
    }

    for (const el of queryAll(document, THUMBNAIL_PREVIEW_CONTAINER_SELECTORS)) {
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute(THUMBNAIL_PLAYBACK_MARKER, 'true');
    }
}

function clearRuntimeStyles() {
    document.querySelectorAll('[data-lym-likes-applied="hidden"]').forEach(el => {
        el.style.removeProperty('display');
        el.removeAttribute('data-lym-likes-applied');
    });
    clearHiddenControls('create');
    clearHiddenControls('hype');
    clearThumbnailPlaybackMarkers();
    clearPremiumPopupMarkers();
}

function hideLikeTextElement(el) {
    if (!el || el.getAttribute('data-lym-likes-applied') === 'hidden') return;

    const visibleText = (el.textContent || '').trim();
    if (!visibleText && el.children.length === 0) return;

    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('data-lym-likes-applied', 'hidden');
}

function hideLikeTextFallbacks() {
    for (const control of queryAll(document, LIKE_CONTROL_SELECTORS)) {
        for (const el of queryAll(control, LIKE_TEXT_FALLBACK_SELECTORS)) {
            hideLikeTextElement(el);
        }
    }
}

function forceLikesVisibility() {
    const shouldHide = cachedSettings.hide_likes;

    if (shouldHide !== _lastHideLikes) {
        likesDirty = true;
        _lastHideLikes = shouldHide;
    }

    if (!likesDirty && !shouldHide) return;

    if (shouldHide) {
        for (const el of queryAll(document, LIKE_TEXT_SELECTORS)) {
            hideLikeTextElement(el);
        }
        hideLikeTextFallbacks();
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
function isVisibleDialog(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        el.getClientRects().length > 0;
}

function hasVisibleNonPremiumDialog(currentPremiumDialog) {
    const dialogs = document.querySelectorAll('tp-yt-paper-dialog');
    for (const dialog of dialogs) {
        if (dialog === currentPremiumDialog) continue;
        if (dialog.querySelector('yt-upsell-dialog-renderer')) continue;
        if (isVisibleDialog(dialog)) return true;
    }
    return false;
}

function clearPremiumPopupMarkers() {
    document.querySelectorAll(`[${PREMIUM_DIALOG_MARKER}], [data-premium-hidden]`).forEach(el => {
        el.style.removeProperty('display');
        el.removeAttribute(PREMIUM_DIALOG_MARKER);
        el.removeAttribute('data-premium-hidden');
    });

    document.querySelectorAll(`[${PREMIUM_BACKDROP_MARKER}]`).forEach(el => {
        el.style.removeProperty('display');
        el.removeAttribute(PREMIUM_BACKDROP_MARKER);
    });
}

function dismissPremiumPopups() {
    const shouldHide = cachedSettings.hide_premium_popups;

    if (shouldHide !== _lastHidePremiumPopups) {
        if (!shouldHide) clearPremiumPopupMarkers();
        _lastHidePremiumPopups = shouldHide;
    }

    if (!shouldHide) {
        return;
    }

    // PERF-02: Only query dialogs not yet processed, avoiding redundant work.
    const dialogs = document.querySelectorAll(`tp-yt-paper-dialog:not([${PREMIUM_DIALOG_MARKER}]):not([data-premium-hidden])`);
    for (const dialog of dialogs) {
        const isUpsell = dialog.querySelector('yt-upsell-dialog-renderer');
        if (isUpsell) {
            dialog.setAttribute(PREMIUM_DIALOG_MARKER, 'true');
            dialog.style.setProperty('display', 'none', 'important');

            // BUG-04: Use a global query for open backdrops instead of fragile
            // previousElementSibling position-based detection.
            // Hardened: do not hide the shared backdrop while a functional
            // non-premium dialog (Share, Save, playlist, etc.) is visibly open.
            if (!hasVisibleNonPremiumDialog(dialog)) {
                const openBackdrops = document.querySelectorAll('tp-yt-iron-overlay-backdrop[opened]');
                openBackdrops.forEach(backdrop => {
                    backdrop.style.setProperty('display', 'none', 'important');
                    backdrop.setAttribute(PREMIUM_BACKDROP_MARKER, 'true');
                });
            }
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
const MAX_DESCRIPTION_QUEUE = 100;
const MAX_DESCRIPTION_CACHE_ENTRIES = 250;
let activeFetches = 0;
const fetchQueue = [];
const queuedDescriptionItems = new Set();
const descriptionCache = new Map();

// PERF-04: Track all active AbortControllers so in-flight fetches can be cancelled on navigation.
const activeControllers = new Set();

function rememberDescription(canonicalHref, content) {
    if (descriptionCache.size >= MAX_DESCRIPTION_CACHE_ENTRIES) {
        const oldestKey = descriptionCache.keys().next().value;
        descriptionCache.delete(oldestKey);
    }
    descriptionCache.set(canonicalHref, content);
}

// Fetches only the <head> of a YouTube page using streaming reader.
// Returns the meta description content string, or null.
async function fetchVideoDescription(href) {
    // Security: only allow canonical YouTube watch pages with valid 11-char video IDs.
    const canonicalHref = getCanonicalWatchUrl(href);
    if (!canonicalHref) return null;
    if (descriptionCache.has(canonicalHref)) return descriptionCache.get(canonicalHref);

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
        if (content && content !== 'null') {
            rememberDescription(canonicalHref, content);
            return content;
        }
        return null;
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
    // Avoid starting new description requests while the tab is hidden.
    // Active requests are allowed to finish; visibilitychange resumes the queue.
    if (document.hidden) return;

    // Drain stale items inline, then kick off one fetch per available slot.
    while (activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length > 0) {
        const item = fetchQueue.shift();
        queuedDescriptionItems.delete(item);
        const linkEl = queryOne(item, SELECTORS.TITLE_LINK);
        const metadataContainer = queryOne(item, SELECTORS.CONTENT_METADATA);

        if (!linkEl || !linkEl.href || !metadataContainer) continue;

        // BUG-07: Verify the item hasn't been recycled since it was queued.
        // YouTube's subscription item reuse is async; the href may have changed by the time
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
                    if (queuedDescriptionItems.has(item)) return;
                    if (fetchQueue.length >= MAX_DESCRIPTION_QUEUE) {
                        item.removeAttribute('data-desc-done');
                        return;
                    }
                    queuedDescriptionItems.add(item);
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

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && extensionEnabled && isExtensionValid()) {
        processQueue();
    }
});

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
    return window.location.pathname === '/feed/subscriptions';
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

function getCanonicalSubscriptionWatchLinks(root = document) {
    return queryAll(root, [
        'ytd-browse a[href^="/watch"]',
        'ytd-browse a[href*="/watch?v="]'
    ]).filter(link => getCanonicalWatchUrl(link.href));
}

function hasSubscriptionLockupSignal(root = document) {
    return queryAll(root, SELECTORS.LOCKUP).some(el => !!el.closest?.('ytd-browse'));
}

function scheduleOuterStructureDiagnostic() {
    if (_diagnoseTimer || _outerStructureWarned || _diagnosed || !isSubscriptionsPage()) return;

    _diagnoseTimer = setTimeout(() => {
        _diagnoseTimer = null;
        if (!extensionEnabled || _outerStructureWarned || _diagnosed || !isSubscriptionsPage()) return;

        const items = getSubscriptionItems();
        if (items.length > 0 || hasSubscriptionLockupSignal()) return;

        const watchLinks = getCanonicalSubscriptionWatchLinks();
        if (watchLinks.length === 0) return;

        _outerStructureWarned = true;
        console.warn('[Less YouTube Mess] YouTube outer structure changed: watch links exist but no known subscription item or lockup containers were found.');
    }, DIAGNOSE_OUTER_DELAY_MS);
}

function selfDiagnose() {
    if (_diagnosed) return;
    if (!isSubscriptionsPage()) return;

    const items = getSubscriptionItems();
    if (items.length === 0) {
        scheduleOuterStructureDiagnostic();
        return;
    }

    clearDiagnoseTimer();

    const item = [...items].find(el => nodeMatchesOrContains(el, SELECTORS.LOCKUP)) || items[0];
    _diagnosed = true;

    const checks = [
        ['lockup', SELECTORS.LOCKUP],
        ['title link', SELECTORS.TITLE_LINK],
        ['metadata', SELECTORS.CONTENT_METADATA],
    ];
    const missing = checks.filter(([, sel]) => !nodeMatchesOrContains(item, sel));
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
            if (!items) items = getSubscriptionItems();
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
        hideCreateButtonSupplement();
        hideHypeButton();
        scheduleOriginalAudioTrackSelection();
        disableThumbnailPlayback();
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
    queuedDescriptionItems.clear();

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
    _lastOriginalAudioRequestUrl = null;
    clearOriginalAudioTrackTimers();
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
    ensureObserverConnected();
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
    ensureObserverConnected();
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

let observerTarget = null;

function getObserverTarget() {
    return document.querySelector('ytd-app') || document.body;
}

function observeMutations(target) {
    if (!target) return false;
    if (observerTarget === target && target.isConnected) return true;

    observer.disconnect();
    observer.observe(target, { childList: true, subtree: true, attributes: false });
    observerTarget = target;
    return true;
}

function ensureObserverConnected() {
    const target = getObserverTarget();
    if (!target) return false;
    if (observerTarget === target && observerTarget.isConnected) return true;
    return observeMutations(target);
}

function startObserver() {
    // PERF-03: Prefer ytd-app over document.body for a tighter subtree —
    // avoids triggering on browser-chrome or extension mutations outside the YT app root.
    if (ensureObserverConnected()) {
        // OPT-4: attributes: false is the default but stated explicitly for clarity —
        // we only need to react to DOM structure changes, not attribute mutations.
        // OPT-A: Use scheduleRunFeatures() instead of direct runFeatures() to coalesce
        // with the yt-navigate-finish event that fires shortly after page load.
        scheduleRunFeatures();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (ensureObserverConnected()) {
                scheduleRunFeatures(); // OPT-A
            }
        }, { once: true });
    }
}

startObserver();
