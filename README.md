# Less YouTube Mess

A Chrome extension that gives you granular control over the YouTube interface — hide distracting elements, clean up the subscriptions feed, and browse without the noise.

## Features

| Feature | Description |
|---|---|
| **List View** | Converts the subscriptions grid into a clean, scrollable list with descriptions |
| **Hide Shorts** | Removes Shorts from all pages (navigation, homepage, subscriptions, search) |
| **Hide Live / Premieres** | Hides upcoming streams and premieres from the subscriptions feed |
| **Hide Sidebar** | Removes the suggested videos panel; expands the player to fill the space |
| **Hide Comments** | Hides the comments section on video pages |
| **Hide Likes** | Hides like counts on videos (real-time, no page refresh needed) |
| **Hide End Screen Suggestions** | Removes overlay cards at the end of videos |
| **Hide Search Suggestions** | Disables the search bar autocomplete dropdown |
| **Hide Premium Popups** | Dismisses YouTube Premium banners, upsell dialogs, and enforcement messages |
| **Left Nav sections** | Individually hide Subscriptions list, You, Explore, or More from YouTube |
| **Hide Entire Left Nav** | Collapses the entire left navigation drawer |
| **Hide Notification Bell** | Removes the notification bell from the top bar |
| **Hide Voice Search** | Removes the microphone button from the search bar |
| **Hide YouTube Logo** | Removes the top-left YouTube logo |
| **Default Subscriptions** | Auto-redirects the homepage to `/feed/subscriptions` |

## How It Works

- Settings are saved to `chrome.storage.sync` and applied immediately — no page refresh needed.
- A content script sets attributes on the `<html>` element; CSS handles the hiding via attribute selectors (fast and layout-thrash-free).
- JS supplements CSS only where necessary (like-button re-renders, premium popup backdrop cleanup).
- Shorts hiding is zero-JS, handled entirely via CSS `:has()` selectors.
- Video descriptions in list view are lazy-loaded via `IntersectionObserver` to minimize network requests.

## Installation

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository folder.

## File Structure

```
manifest.json          Extension manifest (Manifest V3)
content.js             Content script — settings, DOM manipulation, MutationObserver
styles.css             CSS hiding rules via attribute selectors and :has()
popup.html             Settings popup UI
popup.css              Popup styling (dark / light theme)
popup.js               Popup settings manager
icons/                 Extension icons (16, 48, 128px)
```

## Version

**v1.4** — See [active changes](memory-bank/activeContext.md) for recent fixes and additions.

## License

MIT
# Less-Youtube-Mess-Extension
