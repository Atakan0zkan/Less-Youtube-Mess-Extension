const displayFeatures = [
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
    ['hide_live_premiere', '#live-item']
];
const specialScenarios = {
    hide_sidebar: 'transcript click escape and native states preserve the panel, not recommendations',
    list_view: 'list and compact preserve native preview layers, progress and channel metadata',
    compact_list_view: 'list and compact preserve native preview layers, progress and channel metadata',
    blur_thumbnails: 'thumbnail blur reveals on real mouse hover and cleans up on disable',
    disable_auto_dubbing: 'audio bridge selects the original track once and preserves the native audio menu',
    default_subscriptions: 'SPA routes preserve preferences without leaking subscription layout or work'
};
const specialFeatures = Object.keys(specialScenarios);

function requiredBrowserChecks(keys) {
    return [...new Set([
        ...keys.map(key => `popup round-trip ${key}`),
        ...displayFeatures.map(([key, selector]) => `independent on/off ${key} ${selector}`),
        ...Object.values(specialScenarios)
    ])];
}

module.exports = { displayFeatures, specialFeatures, requiredBrowserChecks };
