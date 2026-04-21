// Less Youtube Mess - Popup Settings Manager
// Saves settings to chrome.storage.sync; content script picks up changes via storage.onChanged.

'use strict';

// SETTINGS_KEYS and DEFAULTS are loaded from shared/constants.js

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    if (chrome.runtime.lastError) {
      console.warn('[Less YouTube Mess]', chrome.runtime.lastError.message);
      return;
    }

    SETTINGS_KEYS.forEach(key => {
      const el = document.getElementById(key);
      if (el) el.checked = settings[key];
    });

    // Initialise the compact toggle's enabled/disabled state based on loaded list_view
    updateCompactRowState(settings.list_view);
  });

  // BUG-05: Theme is a UI preference — store in local storage, not sync.
  // Previously it was written to sync but never read back (not in DEFAULTS), so
  // it always fell back to 'dark'. Now it is properly persisted locally.
  // extension_enabled is also a local preference (default: true).
  chrome.storage.local.get({ theme: 'dark', extension_enabled: true }, (res) => {
    if (chrome.runtime.lastError) {
      console.warn('[Less YouTube Mess]', chrome.runtime.lastError.message);
      return;
    }
    document.body.setAttribute('data-theme', res.theme || 'dark');

    // Power toggle state — apply both button state and disabled UI
    const enabled = res.extension_enabled !== false; // default true
    applyExtensionDisabledState(enabled);
  });
}

function saveSetting(key, value) {
  if (!SETTINGS_KEYS.includes(key)) return;
  chrome.storage.sync.set({ [key]: Boolean(value) }); // SEC-02: enforce boolean type
}

function setupCollapsibleGroups() {
  chrome.storage.local.get('collapsed_groups', (res) => {
    if (chrome.runtime.lastError) {
      console.warn('[Less YouTube Mess]', chrome.runtime.lastError.message);
      return;
    }

    const collapsed = res.collapsed_groups || {};
    
    document.querySelectorAll('.settings-group').forEach(group => {
      const id = group.getAttribute('data-group');
      if (id && collapsed[id]) {
        group.classList.add('collapsed');
      }
      
      const header = group.querySelector('.group-header');
      if (header) {
        // IMPROVE-04: Keep aria-expanded in sync with collapsed state (accessibility)
        header.setAttribute('aria-expanded', collapsed[id] ? 'false' : 'true');
        header.addEventListener('click', () => {
          group.classList.toggle('collapsed');
          const isCollapsed = group.classList.contains('collapsed');
          header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
          if (id) {
            collapsed[id] = isCollapsed;
            chrome.storage.local.set({ collapsed_groups: collapsed });
          }
        });
      }
    });
  });
}

// i18n: Apply translations from _locales/ to all elements with data-i18n attributes.
// data-i18n="key"       → sets textContent
// data-i18n-title="key" → sets title attribute
// data-i18n-aria="key"  → sets aria-label attribute
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
    if (msg) el.title = msg;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-aria'));
    if (msg) el.setAttribute('aria-label', msg);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  loadSettings();
  setupCollapsibleGroups();

  // IMPROVE-08: Read version from manifest so only manifest.json needs updating per release.
  const versionEl = document.getElementById('version-display');
  if (versionEl) {
    versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  SETTINGS_KEYS.forEach(key => {
    const el = document.getElementById(key);
    if (el) {
      el.addEventListener('change', (e) => {
        saveSetting(key, e.target.checked);
        // Compact list view depends on list_view being enabled.
        // Update the compact row's visual state whenever list_view changes.
        if (key === 'list_view') {
          updateCompactRowState(e.target.checked);
          // OPT-3: If list_view is turned off, also clear compact_list_view in storage
          // so it doesn't silently remain true while the CSS guard (html[list_view="true"])
          // prevents it from taking effect. Keeps storage consistent with UI state.
          if (!e.target.checked) {
            const compactEl = document.getElementById('compact_list_view');
            if (compactEl && compactEl.checked) {
              compactEl.checked = false;
              saveSetting('compact_list_view', false);
            }
          }
        }
      });
    }
  });

  // --- Power toggle: enable/disable the entire extension ---
  document.getElementById('power-toggle').addEventListener('click', () => {
    const powerBtn = document.getElementById('power-toggle');
    const currentlyEnabled = powerBtn.getAttribute('aria-pressed') === 'true';
    const newState = !currentlyEnabled;
    applyExtensionDisabledState(newState);
    // Persist to local storage — content script reacts via storage.onChanged
    chrome.storage.local.set({ extension_enabled: newState });
  });

  // --- Theme toggle ---
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    // BUG-05: Theme stored in local storage (UI preference, not a sync setting)
    chrome.storage.local.set({ theme: next });
  });
});

// Compact list view only works when list_view is also enabled.
// Visually disable the compact row when list_view is off.
function updateCompactRowState(listViewEnabled) {
  const compactItem = document.getElementById('compact_list_view_item');
  const compactInput = document.getElementById('compact_list_view');
  if (!compactItem || !compactInput) return;
  if (listViewEnabled) {
    compactItem.removeAttribute('data-disabled');
    compactInput.disabled = false;
  } else {
    compactItem.setAttribute('data-disabled', 'true');
    compactInput.disabled = true;
  }
}

// Apply extension enabled/disabled visual state to the popup.
// When disabled: body gets data-extension-disabled (CSS greys out text),
// all setting toggle inputs are locked (disabled), power button stays functional.
function applyExtensionDisabledState(enabled) {
  const powerBtn = document.getElementById('power-toggle');
  if (powerBtn) {
    powerBtn.setAttribute('aria-pressed', String(enabled));
  }

  if (enabled) {
    document.body.removeAttribute('data-extension-disabled');
  } else {
    document.body.setAttribute('data-extension-disabled', '');
  }

  // Lock/unlock all setting toggles (but NOT the power button)
  SETTINGS_KEYS.forEach(key => {
    const el = document.getElementById(key);
    if (el) {
      el.disabled = !enabled;
    }
  });

  // Re-apply compact dependency state when enabling
  if (enabled) {
    const listViewEl = document.getElementById('list_view');
    if (listViewEl) updateCompactRowState(listViewEl.checked);
  }
}
