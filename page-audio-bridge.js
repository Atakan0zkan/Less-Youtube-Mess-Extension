// Less Youtube Mess - Page-context audio bridge
// Runs in YouTube's page context so it can access the internal player object.

(function () {
    'use strict';

    if (window.__lessYoutubeMessAudioBridge) return;
    window.__lessYoutubeMessAudioBridge = true;

    const FORCE_ORIGINAL_AUDIO_EVENT = 'less-youtube-mess:force-original-audio';
    const RETRY_DELAYS_MS = [0, 400, 1200, 2500];

    const ORIGINAL_AUDIO_RE = /(original|original audio|orijinal|audio original|áudio original|son original|audio originale|ton original|originalton|originele audio|oryginal|oryginalny|оригинал|оригінал|原始|原文|原聲|原声|オリジナル|원본|मूल|اصلي|اصلی|الأصلي|ต้นฉบับ|gốc|asal|প্রধান)/i;
    const DUBBED_AUDIO_RE = /(dubbed|auto.?dubbed|dubbing|automatic dubbing|dublaj|seslendirme|doblaje|doublage|synchronisation|doppiaggio|dublagem|dobragem|дубляж|дубльовано|配音|吹き替え|더빙|डब|مدبلج|พากย์|lồng tiếng|alih suara|ডাব)/i;

    function getPlayer() {
        const ytdPlayer = document.querySelector('ytd-player');
        if (ytdPlayer && ytdPlayer.player_) return ytdPlayer.player_;

        const moviePlayer = document.getElementById('movie_player');
        if (moviePlayer && typeof moviePlayer.getAvailableAudioTracks === 'function') return moviePlayer;

        const html5Player = document.querySelector('.html5-video-player');
        if (html5Player && typeof html5Player.getAvailableAudioTracks === 'function') return html5Player;

        return null;
    }

    function readLanguageInfo(track) {
        if (!track) return null;
        try {
            if (typeof track.getLanguageInfo === 'function') return track.getLanguageInfo();
        } catch (e) {
            return null;
        }
        return null;
    }

    function pushText(parts, value) {
        if (!value) return;
        if (typeof value === 'string') {
            parts.push(value);
            return;
        }
        if (typeof value.simpleText === 'string') {
            parts.push(value.simpleText);
            return;
        }
        if (Array.isArray(value.runs)) {
            parts.push(value.runs.map(run => run.text || '').join(' '));
        }
    }

    function getTrackText(track) {
        const parts = [];
        const info = readLanguageInfo(track);
        const keys = [
            'id',
            'name',
            'displayName',
            'languageName',
            'languageCode',
            'label',
            'audioTrackName',
            'kind'
        ];

        for (const key of keys) {
            pushText(parts, info && info[key]);
            pushText(parts, track && track[key]);
        }

        try {
            if (track && typeof track.toString === 'function') {
                const text = track.toString();
                if (text && text !== '[object Object]') parts.push(text);
            }
        } catch (e) {
            // Ignore hostile or transient player objects.
        }

        return parts.join(' ');
    }

    function isExplicitOriginal(track) {
        const info = readLanguageInfo(track);
        if (info && (info.isOriginal === true || info.original === true || info.isDefault === true)) {
            return true;
        }
        return ORIGINAL_AUDIO_RE.test(getTrackText(track));
    }

    function getDefaultAudioTrackIndex(player) {
        try {
            const response = typeof player.getPlayerResponse === 'function'
                ? player.getPlayerResponse()
                : window.ytInitialPlayerResponse;
            const index = response?.captions?.playerCaptionsTracklistRenderer?.defaultAudioTrackIndex;
            return Number.isInteger(index) ? index : -1;
        } catch (e) {
            return -1;
        }
    }

    function chooseOriginalTrack(player, tracks) {
        const explicit = tracks.find(isExplicitOriginal);
        if (explicit) return explicit;

        const defaultIndex = getDefaultAudioTrackIndex(player);
        if (defaultIndex >= 0 && defaultIndex < tracks.length) {
            const candidate = tracks[defaultIndex];
            if (!DUBBED_AUDIO_RE.test(getTrackText(candidate))) return candidate;
        }

        return null;
    }

    function isSameTrack(currentTrack, targetTrack) {
        if (!currentTrack || !targetTrack) return false;
        if (currentTrack === targetTrack) return true;

        const currentText = getTrackText(currentTrack);
        const targetText = getTrackText(targetTrack);
        return !!currentText && currentText === targetText;
    }

    function forceOriginalAudioTrack() {
        const player = getPlayer();
        if (!player) return false;
        if (typeof player.getAvailableAudioTracks !== 'function') return false;
        if (typeof player.setAudioTrack !== 'function') return false;

        let tracks;
        try {
            tracks = player.getAvailableAudioTracks() || [];
        } catch (e) {
            return false;
        }

        if (!Array.isArray(tracks) || tracks.length < 2) return false;

        const targetTrack = chooseOriginalTrack(player, tracks);
        if (!targetTrack) return false;

        try {
            const currentTrack = typeof player.getAudioTrack === 'function'
                ? player.getAudioTrack()
                : null;
            if (isSameTrack(currentTrack, targetTrack)) return true;
            player.setAudioTrack(targetTrack);
            return true;
        } catch (e) {
            return false;
        }
    }

    function forceOriginalAudioTrackWithRetries() {
        for (const delay of RETRY_DELAYS_MS) {
            window.setTimeout(forceOriginalAudioTrack, delay);
        }
    }

    window.addEventListener(FORCE_ORIGINAL_AUDIO_EVENT, forceOriginalAudioTrackWithRetries);
})();
