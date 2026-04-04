// Less Youtube Mess - Shared Constants
// Single source of truth for settings keys and defaults.
// Used by both content.js and popup.js to avoid duplication.
// Assigned to 'self' explicitly to guarantee global accessibility across Chrome content script files.

self.SETTINGS_KEYS = [
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

self.DEFAULTS = {
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
