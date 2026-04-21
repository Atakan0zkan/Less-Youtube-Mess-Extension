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
    'hide_create_button'
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
    hide_create_button: false
};

// Centralized DOM selectors — used by content.js.
// Tag/attribute selectors (yt-lockup-view-model, h3 > a) are resilient to YouTube's
// frequent class name changes. Class selectors are fallbacks.
// When YouTube renames classes, update ONLY this section.
self.SELECTORS = {
    // Video title link: id → tag-structure → class
    TITLE_LINK: 'a#video-title-link, yt-lockup-metadata-view-model h3 > a, a.ytLockupMetadataViewModelTitle',
    // Lockup container div (class-based, may change)
    LOCKUP_HOST: '.ytLockupViewModelHost',
    // Lockup custom element tag (stable fallback for LOCKUP_HOST)
    LOCKUP_TAG: 'yt-lockup-view-model',
    // Channel avatar wrapper div
    AVATAR: '.ytLockupMetadataViewModelAvatar',
    // Content metadata element (tag-based, stable)
    CONTENT_METADATA: 'yt-content-metadata-view-model',
};
