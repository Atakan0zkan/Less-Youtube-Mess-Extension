# Less YouTube Mess

Customize YouTube by hiding Shorts, recommendations, comments, Premium prompts, noisy navigation sections, and other distracting UI.

Less YouTube Mess is a lightweight Chrome extension for turning YouTube into a cleaner, more intentional experience. It uses vanilla HTML, CSS, and JavaScript with no build step and no runtime dependencies.

## Features

- Hide Shorts across navigation, homepage shelves, subscriptions, search, and video lists.
- Convert the Subscriptions feed into a clean list view, with optional compact thumbnails.
- Blur thumbnails until hover to reduce clickbait and visual noise.
- Hide comments, video sidebar recommendations, end-screen cards, like counts, and autoplay UI.
- Disable autoplay by setting YouTube's autoplay state and clicking the player toggle off when needed.
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
styles.css             CSS hiding rules via html attributes and :has() selectors
popup.html             Extension popup UI
popup.css              Popup styling with dark/light themes
popup.js               Popup settings, i18n, accordion state, power toggle
_locales/              Chrome i18n messages for 24 locale folders
icons/                 Extension icons
package.bat            Release zip helper
promo_generator.html   Local Chrome Web Store promo image generator
STORE_LISTINGS.md      Chrome Web Store listing copy translations
memory-bank/           Project memory and maintenance notes
```

The main pattern is:

1. `popup.js` saves feature settings to `chrome.storage.sync`.
2. `content.js` reads those settings and writes attributes onto `<html>`, such as `hide_shorts="true"`.
3. `styles.css` uses those attributes to hide YouTube UI quickly.
4. `content.js` supplements CSS where YouTube re-renders custom elements, such as likes, Premium backdrops, autoplay, and lazy-loaded subscription descriptions.

## Technical Notes

- The extension is intentionally dependency-free.
- Most hiding is CSS-first for speed and low layout churn.
- `shared/constants.js` is the source of truth for the 22 feature settings.
- YouTube selectors are centralized so DOM updates can usually be fixed in one place.
- Critical selectors prefer YouTube custom element tag names when possible, with class-based fallbacks.
- Subscriptions list view avoids absolute positioning inside YouTube components because YouTube wrappers often use `contain`, `isolation`, and nested positioning.
- Video descriptions in list view are fetched lazily with `IntersectionObserver`, concurrency limiting, origin validation, `credentials: "omit"`, and `DOMParser`.

## Maintenance Watchlist

- YouTube may rename custom element tags or classes. `selfDiagnose()` in `content.js` helps warn when critical selectors no longer match.
- Large `:has()` selector groups are useful but can become expensive if expanded carelessly.
- The list-view description fetch feature is the largest network/performance surface. Keep it lazy, bounded, and abortable.
- The extension-disabled state is read from async local storage, so default attributes can briefly apply during page startup before the disabled state is known.
- Some JS supplements use cache guards for performance; if YouTube renders matching controls late on the same URL, those guards may need a mutation-aware refresh path.
- Popup saves settings as booleans, but content-side storage reads should be kept hardened against legacy or manually corrupted values.

## License

MIT
