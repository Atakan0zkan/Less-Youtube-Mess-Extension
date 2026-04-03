// Less Youtube Mess - Content Script
// Settings are cached in memory; CSS attribute-selectors on <html> handle visibility toggling.

'use strict';

// ===================== SETTINGS =====================

const SETTINGS_KEYS = [
    'hide_left_nav',
    'list_view',
    'hide_live_premiere',
    'hide_shorts',
    'hide_sidebar',
    'hide_comments',
    'hide_search_suggestions',
    'hide_end_suggestions',
    'hide_notif_bell',
    'hide_voice_search',
    'hide_youtube_logo',
    'default_subscriptions',
    'hide_likes',
    'hide_explore',
    'hide_more_from_youtube',
    'hide_subscriptions_section',
    'hide_you_section',
    'hide_premium_popups'
];

const DEFAULTS = {
    hide_left_nav: false,
    list_view: true,
    hide_live_premiere: true,
    hide_shorts: false,
    hide_sidebar: false,
    hide_comments: false,
    hide_search_suggestions: false,
    hide_end_suggestions: false,
    hide_notif_bell: false,
    hide_voice_search: false,
    hide_youtube_logo: false,
    default_subscriptions: false,
    hide_likes: false,
    hide_explore: false,
    hide_more_from_youtube: false,
    hide_subscriptions_section: false,
    hide_you_section: false,
    hide_premium_popups: false
};

// Cached settings — updated via storage listener
let cachedSettings = { ...DEFAULTS };

// ===================== EXTENSION CONTEXT GUARD =====================

function isExtensionValid() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

// ===================== APPLY SETTINGS TO HTML =====================

function applySettings(settings) {
    cachedSettings = { ...DEFAULTS, ...settings };
    const html = document.documentElement;
    for (const key of SETTINGS_KEYS) {
        html.setAttribute(key, String(cachedSettings[key]));
    }
}

// ===================== INITIAL LOAD =====================

if (isExtensionValid()) {
    try {
        chrome.storage.sync.get(DEFAULTS, (settings) => {
            if (chrome.runtime.lastError) return;
            applySettings(settings);
            
            if (settings.default_subscriptions) {
                if (window.location.pathname === '/' && !window.location.search) {
                    window.location.replace('https://www.youtube.com/feed/subscriptions');
                }
            }
        });
    } catch (e) {}
}

// ===================== STORAGE CHANGE LISTENER =====================

if (isExtensionValid()) {
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync') return;
            let needsUpdate = false;
            for (const key of SETTINGS_KEYS) {
                if (key in changes) {
                    cachedSettings[key] = changes[key].newValue;
                    needsUpdate = true;
                }
            }
            if (needsUpdate) {
                applySettings(cachedSettings);
                runFeatures();
            }
        });
    } catch (e) {}
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
function markLiveAndPremieres() {
    if (!window.location.href.includes('/feed/subscriptions')) return;

    const items = document.querySelectorAll('ytd-rich-item-renderer');

    items.forEach(item => {
        const titleLink = item.querySelector('a#video-title-link, a.yt-lockup-metadata-view-model__title');
        if (!titleLink || !titleLink.href) return;

        const videoId = titleLink.href.split('&')[0];

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
                if (/(remind me|notify me|bana hatırlat)/i.test(text)) {
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
                if (/(yakında|canlı|live|premiere|upcoming|ilk gösterim|i̇lk gösterim)/i.test(text)) {
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
                if (/(planlandı|scheduled for)/i.test(text)) {
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
function forceLikesVisibility() {
    const shouldHide = cachedSettings.hide_likes;
    const selectors = [
        'like-button-view-model .yt-core-attributed-string',
        'like-button-view-model .yt-spec-button-shape-next__button-text-content',
        'segmented-like-dislike-button-view-model .yt-spec-button-shape-next__button-text-content'
    ];

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
            if (shouldHide) {
                el.style.setProperty('display', 'none', 'important');
            } else {
                el.style.removeProperty('display');
            }
        }
    }
}

// --- Dismiss Premium Popups ---
// CSS hides premium dialogs; JS cleans up the shared backdrop (tp-yt-iron-overlay-backdrop)
// that would otherwise remain and block the page.
function dismissPremiumPopups() {
    if (!cachedSettings.hide_premium_popups) return;

    const dialogs = document.querySelectorAll('tp-yt-paper-dialog');
    for (const dialog of dialogs) {
        if (dialog.hasAttribute('data-premium-hidden')) continue;

        const isUpsell = dialog.querySelector('yt-upsell-dialog-renderer');
        if (isUpsell) {
            dialog.setAttribute('data-premium-hidden', 'true');
            dialog.style.setProperty('display', 'none', 'important');

            const backdrop = dialog.previousElementSibling;
            if (backdrop && backdrop.tagName.toLowerCase() === 'tp-yt-iron-overlay-backdrop') {
                backdrop.style.setProperty('display', 'none', 'important');
            }
        }
    }
}

// --- Subscriptions Header ---
// Clones channel name and wraps avatar in a channel link for list view.
function processSubscriptionsHeader() {
    if (!window.location.href.includes('/feed/subscriptions')) return;

    const items = document.querySelectorAll('ytd-rich-item-renderer');

    items.forEach(item => {
        const titleLink = item.querySelector('a#video-title-link, a.yt-lockup-metadata-view-model__title');
        if (!titleLink || !titleLink.href) return;

        const videoId = titleLink.href.split('&')[0];

        const lockup = item.querySelector('.yt-lockup-view-model');
        const metadataModel = item.querySelector('yt-content-metadata-view-model');
        if (!lockup || !metadataModel) return;

        if (item.getAttribute('data-header-done') === videoId) return;

        item.setAttribute('data-header-done', videoId);

        // Clean up recycled clones
        const oldAvatars = item.querySelectorAll('.custom-avatar-link');
        oldAvatars.forEach(el => {
            const parent = el.parentElement;
            while(el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            el.remove();
        });
        
        const oldClones = item.querySelectorAll('.cloned-channel-name');
        oldClones.forEach(el => el.remove());

        // Clone channel name
        if (!item.querySelector('.cloned-channel-name')) {
            const originalRow = metadataModel.querySelector(
                '.yt-content-metadata-view-model__metadata-row'
            );
            if (originalRow) {
                const clone = originalRow.cloneNode(true);
                clone.classList.add('cloned-channel-name');
                lockup.appendChild(clone);
            }
        }

        const avatarContainer = item.querySelector('.yt-lockup-metadata-view-model__avatar');
        const channelLinkEl =
            item.querySelector('.cloned-channel-name a') ||
            item.querySelector('yt-content-metadata-view-model a');

        if (avatarContainer && channelLinkEl &&
            !avatarContainer.querySelector('.custom-avatar-link')) {
            const anchor = document.createElement('a');
            anchor.href = channelLinkEl.href;
            anchor.classList.add('custom-avatar-link');
            while (avatarContainer.firstChild) {
                anchor.appendChild(avatarContainer.firstChild);
            }
            avatarContainer.appendChild(anchor);
        }
    });
}

// --- Video Descriptions ---
// Lazily fetches meta descriptions via IntersectionObserver to limit network requests.
const MAX_CONCURRENT_FETCHES = 3;
let activeFetches = 0;
const fetchQueue = [];

function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function processQueue() {
    if (activeFetches >= MAX_CONCURRENT_FETCHES || fetchQueue.length === 0) return;

    const item = fetchQueue.shift();
    const linkEl = item.querySelector('a#video-title-link') || item.querySelector('a.yt-lockup-metadata-view-model__title');
    const metadataContainer = item.querySelector('yt-content-metadata-view-model');

    if (!linkEl || !linkEl.href || !metadataContainer) {
        processQueue();
        return;
    }

    activeFetches++;
    fetch(linkEl.href)
        .then(r => r.text())
        .then(html => {
            const match = html.match(/<meta name="description" content="([^"]*)"/);
            if (match && match[1] && match[1] !== 'null') {
                const descDiv = document.createElement('div');
                descDiv.className = 'custom-description';
                descDiv.textContent = decodeHtmlEntities(match[1]);
                metadataContainer.appendChild(descDiv);
            }
        })
        .catch(() => {})
        .finally(() => {
            activeFetches--;
            processQueue();
        });
}

const descriptionObserver = new IntersectionObserver((entries, observer) => {
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

function processVideoDescriptions() {
    if (!window.location.href.includes('/feed/subscriptions')) return;

    const items = document.querySelectorAll('ytd-rich-item-renderer');

    items.forEach(item => {
        const metadataContainer = item.querySelector('yt-content-metadata-view-model');
        const linkEl = item.querySelector('a#video-title-link') || item.querySelector('a.yt-lockup-metadata-view-model__title');
        
        if (!metadataContainer || !linkEl || !linkEl.href) return;

        const videoId = linkEl.href.split('&')[0];
        
        if (item.getAttribute('data-desc-done') === videoId) return;

        item.setAttribute('data-desc-done', videoId);

        const oldDesc = item.querySelectorAll('.custom-description');
        oldDesc.forEach(d => d.remove());

        descriptionObserver.observe(item);
    });
}

// ===================== MAIN FEATURE RUNNER =====================

function runFeatures() {

    if (cachedSettings.hide_live_premiere) {
        markLiveAndPremieres();
    }

    const isSubscriptions = window.location.href.includes('/feed/subscriptions');

    if (cachedSettings.list_view) {
        const browse = document.querySelector('ytd-browse');
        if (isSubscriptions) {
            if (browse && browse.getAttribute('page-subtype') !== 'subscriptions') {
                browse.setAttribute('page-subtype', 'subscriptions');
            }
            processSubscriptionsHeader();
            processVideoDescriptions();
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
}

// ===================== MUTATION OBSERVER =====================

let lastUrl = window.location.href;

const debouncedRun = debounce(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;

        // Clean up resources from previous page
        fetchQueue.length = 0;
        if (!currentUrl.includes('/feed/subscriptions')) {
            descriptionObserver.disconnect();
        }

        // Redirect on SPA navigation (only fires on URL change, not every mutation)
        if (cachedSettings.default_subscriptions) {
            const url = new URL(currentUrl);
            if (url.pathname === '/' && !url.search) {
                window.location.replace('https://www.youtube.com/feed/subscriptions');
                return;
            }
        }
    }

    runFeatures();
}, 150);

const observer = new MutationObserver(debouncedRun);

function startObserver() {
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        runFeatures();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
            runFeatures();
        }, { once: true });
    }
}

startObserver();
