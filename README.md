# Less YouTube Mess

Customize YouTube by hiding Shorts, recommendations, comments, Premium prompts, noisy navigation sections, and other distracting UI.

Less YouTube Mess is a lightweight Chrome extension for turning YouTube into a cleaner, more intentional experience. It uses vanilla HTML, CSS, and JavaScript with no build step and no runtime dependencies.

## Features

- Hide Shorts across navigation, homepage shelves, subscriptions, search, and video lists.
- Convert the Subscriptions feed into a clean list view, with optional compact thumbnails.
- Blur thumbnails until hover or stop thumbnail hover previews from playing.
- Hide comments, video sidebar recommendations, end-screen cards, like counts, Hype/Thanks, and autoplay UI.
- Disable autoplay by setting YouTube's autoplay state and clicking the player toggle off when needed.
- Prefer original audio on dubbed videos when possible while keeping YouTube's audio track options visible.
- Hide Premium popups, promotional mealbars, enforcement messages, and statement banners without hiding functional YouTube dialogs.
- Hide the notification bell, voice search, YouTube logo, search suggestions, and Create button.
- Hide the whole left navigation bar, or only specific sections such as Subscriptions, You, Explore, and More from YouTube.
- Redirect the YouTube homepage to the Subscriptions feed when enabled.
- Toggle the whole extension on or off from the popup.
- Localized popup UI for 24 Chrome locales: AR, BN, DE, EN, ES, FA, FR, HI, ID, IT, JA, KO, MS, NL, PL, PT_BR, PT_PT, RU, TH, TR, UK, VI, ZH_CN, and ZH_TW.

## Installation

Chrome Web Store:

https://chromewebstore.google.com/detail/less-youtube-mess/opoonnlbochomodkkaflhdfmghbbikkb

For local development:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this repository folder.

## Architecture

The extension follows a small Manifest V3 structure:

```text
manifest.json          Extension manifest, permissions, CSP, content script registration
shared/constants.js    Shared settings keys, defaults, and centralized YouTube selectors
content.js             YouTube content script: settings, DOM handling, navigation, observers
page-audio-bridge.js   Page-context bridge for best-effort original audio selection
styles.css             CSS hiding rules via html attributes and :has() selectors
popup.html             Extension popup UI
popup.css              Popup styling with dark/light themes
popup.js               Popup settings, i18n, accordion state, power toggle
_locales/              Chrome i18n messages for 24 locale folders
icons/                 Extension icons
package.bat            Release zip helper, including shared files, locales, icons, and bridge
promo_generator.html   Local Chrome Web Store promo image generator
STORE_LISTINGS.md      Chrome Web Store listing copy translations
memory-bank/           Project memory and maintenance notes
```

The main pattern is:

1. `popup.js` saves feature settings to `chrome.storage.sync`.
2. `content.js` reads those settings and writes attributes onto `<html>`, such as `hide_shorts="true"`.
3. `styles.css` uses those attributes to hide YouTube UI quickly.
4. `content.js` supplements CSS where YouTube re-renders custom elements, such as likes, topbar controls, Premium backdrops, autoplay, thumbnail previews, and lazy-loaded subscription descriptions.
5. `page-audio-bridge.js` runs in YouTube's page context only to request the original audio track through YouTube's internal player methods when automatic dubbing is disabled.

## Technical Notes

- The extension is intentionally dependency-free.
- Most hiding is CSS-first for speed and low layout churn.
- `shared/constants.js` is the source of truth for the 25 feature settings, defaults, and selector lists.
- Settings loaded from `chrome.storage.sync` are normalized to strict booleans so legacy values such as `"false"` do not behave as enabled.
- The global `extension_enabled` toggle is stored in `chrome.storage.local` and is also normalized when read by the content script.
- YouTube selectors are centralized so DOM updates can usually be fixed in one place. Critical selectors prefer tag, href, structure, and attribute selectors before class-based fallbacks.
- Subscription feed item discovery goes through `SELECTORS.SUBSCRIPTION_ITEM` and `getSubscriptionItems()` so diagnostics, List View descriptions, and live/premiere marking use the same outer-container model.
- Subscriptions list view avoids absolute positioning inside YouTube components because YouTube wrappers often use `contain`, `isolation`, and nested positioning.
- Video descriptions in list view are fetched lazily with `IntersectionObserver`, concurrency limiting, origin validation, `credentials: "omit"`, and `DOMParser`.
- Description fetches are restricted to canonical `https://www.youtube.com/watch?v=VIDEO_ID` URLs with valid 11-character YouTube IDs.
- `page-audio-bridge.js` is a minimal web-accessible resource that runs in YouTube's page context only to request original audio through YouTube's internal player methods. The audio-track/dubbing menu remains visible for manual selection.
- Popup UI localization currently covers 24 Chrome locale folders, each with the same 59 message keys.

## Maintenance Watchlist

- YouTube may rename custom element tags or classes. `selfDiagnose()` in `content.js` helps warn when critical selectors no longer match.
- Subscriptions feed outer containers can rotate between rich item, rich grid media, direct lockup, and legacy video renderer structures. Keep `SELECTORS.SUBSCRIPTION_ITEM` current before changing List View or diagnostics.
- Large `:has()` selector groups are useful but can become expensive if expanded carelessly.
- The list-view description fetch feature is the largest network/performance surface. Keep it lazy, bounded, and abortable.
- The extension-disabled state is read from async local storage, so default attributes can briefly apply during page startup before the disabled state is known.
- Likes, topbar controls, and thumbnail preview suppression use extension-owned data markers for cleanup. New JS supplements should follow the same marker-and-cleanup pattern.
- Original audio selection is best-effort because it depends on YouTube internal player methods and audio-track labels. Re-test it on videos with multiple audio tracks after YouTube player updates.
- The automatic dubbing setting should keep YouTube's audio-track/dubbing menu visible unless the product decision changes.

## License

MIT
