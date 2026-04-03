// Less Youtube Mess - Popup Settings Manager
// Saves settings to chrome.storage.sync; content script picks up changes via storage.onChanged.

'use strict';

const SETTINGS_KEYS = [
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

const DEFAULTS = {
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
  hide_premium_popups: false,
  theme: 'dark'
};

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    if (chrome.runtime.lastError) return;

    SETTINGS_KEYS.forEach(key => {
      const el = document.getElementById(key);
      if (el) el.checked = settings[key];
    });

    document.body.setAttribute('data-theme', settings.theme || 'dark');
  });
}

function saveSetting(key, value) {
  chrome.storage.sync.set({ [key]: value });
}

function setupCollapsibleGroups() {
  chrome.storage.local.get('collapsed_groups', (res) => {
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
