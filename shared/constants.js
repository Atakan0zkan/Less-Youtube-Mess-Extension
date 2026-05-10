// Less Youtube Mess - Shared Constants
// Single source of truth for settings keys and defaults.
// Used by both content.js and popup.js to avoid duplication.
// Assigned to 'self' explicitly to guarantee global accessibility across Chrome content script files.

// RISK-02 NOTE: chrome.storage.sync stores each key individually (8KB/key limit, 100KB total).
// Current usage is well within quota. If the feature count grows past ~30 keys, consolidate
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
    'hide_hype_button',
    'hide_autoplay',
    'disable_auto_dubbing',
    'hide_explore',
    'hide_more_from_youtube',
    'hide_subscriptions_section',
    'hide_you_section',
    'hide_premium_popups',
    'hide_create_button',
    'blur_thumbnails',
    'disable_thumbnail_playback'
];

self.DEFAULTS = {
    hide_left_nav: false,
    list_view: false,
    compact_list_view: false,
    hide_live_premiere: false,
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
    hide_hype_button: false,
    hide_autoplay: false,
    disable_auto_dubbing: false,
    hide_explore: false,
    hide_more_from_youtube: false,
    hide_subscriptions_section: false,
    hide_you_section: false,
    hide_premium_popups: false,
    hide_create_button: false,
    blur_thumbnails: false,
    disable_thumbnail_playback: false
};

// Centralized DOM selectors — used by content.js.
// Selectors are ordered from more stable tag/structure/attribute forms to class fallbacks.
// When YouTube renames classes, update ONLY this section.
self.SELECTORS = {
    SUBSCRIPTION_ITEM: [
        'ytd-browse ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer',
        'ytd-browse ytd-rich-grid-renderer > #contents > ytd-rich-grid-media',
        'ytd-browse ytd-rich-grid-renderer > #contents > yt-lockup-view-model',
        'ytd-browse #contents > yt-lockup-view-model',
        'ytd-browse ytd-grid-video-renderer',
        'ytd-browse ytd-video-renderer',
        'ytd-browse ytd-rich-grid-renderer yt-lockup-view-model',
        'ytd-browse #contents yt-lockup-view-model',
        'ytd-browse yt-lockup-view-model'
    ],
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

// Locale/text fallbacks for live and premiere detection.
// Structural signals in content.js must run before these regexes because YouTube
// can change localized badge wording without changing the underlying component.
self.LIVE_PREMIERE_PATTERNS = {
    reminderButton: /(remind me|notify me|bana hatırlat|recuérdame|rappelle-moi|erinnere mich|ricordami|リマインダー|알림 설정|मुझे याद दिलाएं)/i,
    badgeText: /(yakında|canlı|live|premiere|upcoming|ilk gösterim|i̇lk gösterim|estreno|première|premieren|anteprima|프리미어|プレミア公開|próximamente|em breve|estreia|ao vivo|bald|prossimamente|прямой эфир|в эфире|премьера|скоро|siaran langsung|tayang perdana|مباشر|بث مباشر|العرض الأول|قريبًا|直播|首播|即将开始|即將開始|na żywo|wkrótce|trực tiếp|công chiếu|sắp diễn ra|สด|พรีเมียร์|เร็วๆ นี้|binnenkort|наживо|прем'єра|незабаром|زنده|پخش زنده|نمایش برتر|به‌زودی|লাইভ|প্রিমিয়ার|শীঘ্রই|langsung|tayangan perdana|akan datang)/i,
    scheduledText: /(planlandı|scheduled for|programado|programmé|geplant|programmato|予定|예정|निर्धारित)/i
};
