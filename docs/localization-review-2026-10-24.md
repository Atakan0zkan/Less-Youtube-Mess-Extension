# Localization Review

Date: 2026-10-24. English is the meaning reference. Reviewed changes are prepared for version 1.8.4; Chrome Web Store publication is not part of this audit.

## Coverage

All 24 catalogs were reviewed sequentially, starting with the English reference and then ar, bn, de, es, fa, fr, hi, id, it, ja, ko, ms, nl, pl, pt_BR, pt_PT, ru, th, tr, uk, vi, zh_CN and zh_TW.

- Every original message was read against its English meaning and popup context: 59 entries per catalog, 1,416 original entries in total.
- 395 existing translated entries were revised for meaning, natural phrasing, grammar, naming or local capitalization. Unchanged entries were reviewed too.
- Four language-button tooltip/accessibility messages were added and reviewed per locale: 96 new entries.
- Final total: 63 entries per catalog, 1,512 entries across 24 catalogs. No locale or key was skipped.
- The original 59 English messages were left unchanged; the four added English messages preserve the language button's previous wording.
- Store listing coverage grew from 15 locale sections to all 24. New sections: de, es, fr, hi, it, ja, ko, pt_BR and tr.
- Every store section was checked against the English introduction, lightweight/menu paragraph, six feature items, open-source/privacy statement, repository link and contact sentence. The English store body was preserved.
- The visible brand name, ENG language code and release version are deliberately not translated. YouTube-provided video descriptions are page content, not extension translation strings; debug logs and source comments are not user-interface copy.

No external translation API or automatic bulk translation service was used. Translated messages and store paragraphs were edited individually for context and idiomatic wording.

## Locale Checklist

Hashes identify the reviewed messages.json files; the table shows the first 12 SHA-256 digits. A later text change requires another review.

| Locale | Language | Messages Reviewed | Existing Entries Revised | Added Entries | Store Reviewed | SHA-256 Prefix |
| --- | --- | --- | --- | --- | --- | --- |
| en | English Source | 63 / 63 | 0 | 4 | Yes | 0b61d4f0a1ee |
| ar | العربية | 63 / 63 | 11 | 4 | Yes | 9b1d023d2994 |
| bn | বাংলা | 63 / 63 | 16 | 4 | Yes | cb70a3dcd6ad |
| de | Deutsch | 63 / 63 | 17 | 4 | Yes | f38060ca9c21 |
| es | Español | 63 / 63 | 29 | 4 | Yes | 08a1691fab5b |
| fa | فارسی | 63 / 63 | 13 | 4 | Yes | 0cb4de7258c1 |
| fr | Français | 63 / 63 | 27 | 4 | Yes | c1945079cc73 |
| hi | हिन्दी | 63 / 63 | 19 | 4 | Yes | a463ee04db66 |
| id | Bahasa Indonesia | 63 / 63 | 20 | 4 | Yes | 2476a56d0b1b |
| it | Italiano | 63 / 63 | 28 | 4 | Yes | 8ab40ce926ff |
| ja | 日本語 | 63 / 63 | 10 | 4 | Yes | 2a79e8837450 |
| ko | 한국어 | 63 / 63 | 9 | 4 | Yes | 4aff72765cb2 |
| ms | Bahasa Melayu | 63 / 63 | 13 | 4 | Yes | 088fe070a0dc |
| nl | Nederlands | 63 / 63 | 11 | 4 | Yes | cfb6f5fac384 |
| pl | Polski | 63 / 63 | 14 | 4 | Yes | 8efeb231fed3 |
| pt_BR | Português (Brasil) | 63 / 63 | 28 | 4 | Yes | 3e8270276399 |
| pt_PT | Português (Portugal) | 63 / 63 | 13 | 4 | Yes | 85f36b36a7b9 |
| ru | Русский | 63 / 63 | 15 | 4 | Yes | bcf03d72052a |
| th | ไทย | 63 / 63 | 8 | 4 | Yes | 89256010153e |
| tr | Türkçe | 63 / 63 | 39 | 4 | Yes | bbb89ab86c47 |
| uk | Українська | 63 / 63 | 12 | 4 | Yes | 4e44f5110e50 |
| vi | Tiếng Việt | 63 / 63 | 10 | 4 | Yes | 2e102f4418a3 |
| zh_CN | 简体中文 | 63 / 63 | 14 | 4 | Yes | 68d9863a8c78 |
| zh_TW | 繁體中文 | 63 / 63 | 19 | 4 | Yes | 3a1d3400f79a |

## Meaning And Terminology Decisions

- Keep hiding, disabling and switching meanings distinct. The autoplay text must not describe only hiding a button; the theme button switches light/dark modes rather than enabling/disabling a theme.
- Preserve conditional wording such as original audio "when possible" and Compact List View's dependency on List View.
- Do not restrict the upcoming/live-stream description to the subscriptions page when the English description does not impose that restriction.
- Distinguish static thumbnails, thumbnail blur and moving video previews. Hover descriptions explain the mouse action naturally instead of relying on borrowed technical jargon.
- End-screen cards overlay the ending of a video; descriptions must not imply that they only appear after playback has already ended.
- Keep regional Portuguese terminology separate, including mouse/rato, curtidas/gostos, inscrições/subscrições and dublagem/dobragem.
- Use the localized name of the You section rather than translating the pronoun mechanically. Examples verified in YouTube's help: Mein YouTube, 我, 個人中心 and 내 페이지.
- Correct Persian Premieres terminology; the previous wording meant "top shows" rather than premieres.
- Preserve product names and feature intent; do not introduce ad-blocking, tracking guarantees, new settings or claims absent from the English source.

Terminology references were used for names only, not as a bulk translation source:

- [German You section](https://support.google.com/youtube/answer/9209643?hl=de)
- [Simplified Chinese You section](https://support.google.com/youtube/answer/9209643?hl=zh-Hans)
- [Traditional Chinese You section](https://support.google.com/youtube/answer/9209643?hl=zh-Hant)
- [Korean You section](https://support.google.com/youtube/answer/9209643?hl=ko)
- [Japanese You section](https://support.google.com/youtube/answer/9209643?hl=ja)
- [French You section](https://support.google.com/youtube/answer/9209643?hl=fr)
- [Portuguese You section](https://support.google.com/youtube/answer/9209643?hl=pt-PT&co=GENIE.Platform%3DDesktop)
- [Persian Premieres](https://support.google.com/youtube/answer/9080341?hl=fa)

## Runtime And Layout

- Language-button titles and aria-labels now use catalog messages and follow the active UI language. English override and return-to-browser-language are both covered.
- Arabic and Persian set right-to-left document direction; switching to English restores left-to-right direction.
- Branding/header controls keep left-to-right order. Logical spacing and safe text wrapping prevent long labels from colliding with toggle controls.
- No content-script behavior, settings keys, permissions, audio bridge or YouTube selector logic was changed. Release metadata was subsequently updated from 1.8.3 to 1.8.4.

## Verification

- npm test: 41/41 passed, including 4 new localization tests.
- Catalog parity, nonempty values, manifest-description length, placeholder compatibility and invalid-character checks passed for all 24 locales.
- Every popup text/title/aria binding, language-button state, English override, return transition and cached packaged-English read passed in all 24 locale unit scenarios.
- Failed-English-file fallback retained the browser translation and Arabic RTL direction.
- Store descriptions passed 24-locale coverage, all six feature markers, paragraph coverage, source-repository link and contact-address checks.
- npm run check and Node syntax checks passed.
- Disposable-profile Brave (Chromium 156.0.8078.48) browser smoke checks passed, including existing sidebar/transcript, Premium cleanup, list/compact layout, autoplay-related controls, redirect and English override behavior.
- The optional localization layout matrix passed for all 24 languages and all 25 rows per language: 600 rows, with no text/toggle overlap or horizontal text clipping.
- Browser layout QA injects the packaged translations into the real popup. It tests fonts and layout, not Chrome's operating-system locale selection; language routing/round trips are tested separately in the unit suite.
- Six screenshot samples were visually inspected: ar, bn, de, ja, tr and zh_TW. They are in .codex/qa/localization-2026-10-24/. Capture-only max-height removal shows every expanded group; the normal popup still scrolls at its existing height.
- Test profiles were disposable and closed/cleaned by the harness. Existing user browser profiles and loaded extensions were not modified.

Automated checks establish structural completeness and behavior, not linguistic correctness. The language review is the editorial assessment recorded above; no independent native-speaker sign-off or certified translation is claimed.

## Reproduction

```sh
npm test
npm run check
npm run test:localization
```

With BROWSER_PATH set to Brave/Chromium:

```sh
npm run test:e2e:localization
```

LOCALIZATION_SCREENSHOT_DIR optionally saves the six layout samples. No screenshot output is required for a normal test run.
