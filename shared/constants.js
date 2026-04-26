// Less Youtube Mess - Shared Constants
// Single source of truth for settings keys and defaults.
// Used by both content.js and popup.js to avoid duplication.
// Assigned to 'self' explicitly to guarantee global accessibility across Chrome content script files.

// RISK-02 NOTE: chrome.storage.sync stores each key individually (8KB/key limit, 100KB total).
// Current usage is well within quota. If the feature count grows past ~25 keys, consolidate
// all settings under a single 'lym_settings' object key to be safe.
self.SETTINGS_KEYS = [
    'hide_left_nav',
    'list_view',
    'compact_list_view',
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
    'hide_autoplay',
    'hide_explore',
    'hide_more_from_youtube',
    'hide_subscriptions_section',
    'hide_you_section',
    'hide_premium_popups',
    'hide_create_button',
    'blur_thumbnails'
];

self.DEFAULTS = {
    hide_left_nav: false,
    list_view: true,
    compact_list_view: false,
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
    hide_autoplay: false,
    hide_explore: false,
    hide_more_from_youtube: false,
    hide_subscriptions_section: false,
    hide_you_section: false,
    hide_premium_popups: false,
    hide_create_button: false,
    blur_thumbnails: false
};

// Centralized DOM selectors — used by content.js.
// Selectors are ordered from more stable tag/structure/attribute forms to class fallbacks.
// When YouTube renames classes, update ONLY this section.
self.SELECTORS = {
    TITLE_LINK: [
        'yt-lockup-metadata-view-model h3 > a[href*="/watch"]',
        'a#video-title-link[href*="/watch"]',
        'a[href^="/watch"][id="video-title-link"]',
        'a.ytLockupMetadataViewModelTitle[href*="/watch"]'
    ],
    LOCKUP: [
        'yt-lockup-view-model',
        '.ytLockupViewModelHost'
    ],
    AVATAR: [
        'yt-decorated-avatar-view-model',
        'yt-avatar-shape',
        '.ytLockupMetadataViewModelAvatar'
    ],
    CONTENT_METADATA: [
        'yt-content-metadata-view-model',
        '#metadata'
    ],
};
