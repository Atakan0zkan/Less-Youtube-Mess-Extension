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

    document.body.setAttribute('data-theme', settings.theme || 'dark');
  });
}

function saveSetting(key, value) {
  if (!SETTINGS_KEYS.includes(key)) return;
  chrome.storage.sync.set({ [key]: value });
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
        header.addEventListener('click', () => {
          group.classList.toggle('collapsed');
          if (id) {
            collapsed[id] = group.classList.contains('collapsed');
            chrome.storage.local.set({ collapsed_groups: collapsed });
          }
        });
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupCollapsibleGroups();

  SETTINGS_KEYS.forEach(key => {
    const el = document.getElementById(key);
    if (el) {
      el.addEventListener('change', (e) => {
        saveSetting(key, e.target.checked);
      });
    }
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    chrome.storage.sync.set({ theme: next });
  });
});
