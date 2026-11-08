const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { displayFeatures, specialFeatures } = require('./helpers/feature-matrix.cjs');
const budgets = require('./helpers/budgets.cjs');

module.exports = async function releaseChecks({ page, popup, settings, navigate, content, until, report, network, syncBudget }) {
    async function check(name, action) {
        const started = performance.now();
        try {
            await action();
            report.checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) });
            console.log(`PASS: release ${name}`);
        } catch (error) {
            report.checks.push({ name, status: 'failed', error: error.message });
            try { report.failureState = await content('({settings:cachedSettings,enabled:extensionEnabled,scheduled:_runFeaturesScheduled,hidden:document.hidden})'); } catch {}
            throw new Error(`${name}: ${error.message}`, { cause: error });
        }
    }
    const keys = await popup.evaluate('Array.from(SETTINGS_KEYS)');
    const defaults = Object.fromEntries(keys.map(key => [key, false]));
    const display = selector => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).display`);
    const prop = (selector, name) => page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(name)})`);
    const popupReady = () => until(() => popup.evaluate("document.querySelector('#version-display')?.textContent === 'v' + chrome.runtime.getManifest().version"), 'popup initialized');
    const reloadPopup = async () => { await popup.send('Page.reload'); await popupReady(); };
    const stored = key => popup.evaluate(`new Promise(resolve => chrome.storage.sync.get(${JSON.stringify(key)}, value => resolve(value[${JSON.stringify(key)}])))`);
    const clickSetting = async (key, enabled) => {
        await syncBudget.reserve(key === 'list_view' && !enabled ? 2 : 1);
        const started = performance.now();
        await popup.evaluate(`(() => {
            const input = document.getElementById(${JSON.stringify(key)});
            if (input.disabled) throw new Error('Disabled input: ' + input.id);
            input.scrollIntoView({block:'center'});
            input.click();
        })()`);
        await until(async () => await stored(key) === enabled && await page.evaluate(`document.documentElement.getAttribute(${JSON.stringify(key)}) === '${enabled}'`), `${key} popup -> storage -> content`);
        const duration = performance.now() - started;
        report.metrics.settingPropagationMs.push(Math.round(duration));
        assert.ok(duration <= budgets.settingPropagationMs, `${key} propagation took ${Math.round(duration)}ms`);
    };
    report.metrics.settingPropagationMs = [];
    const covered = [...new Set([...displayFeatures.map(([key]) => key), ...specialFeatures])].sort();
    assert.deepEqual(covered, keys.toSorted());

    await popup.evaluate('chrome.storage.local.set({extension_enabled:true})');
    await settings(defaults);
    await reloadPopup();
    await popup.evaluate("document.querySelectorAll('.settings-group').forEach(group => { if(group.classList.contains('collapsed')) group.querySelector('.group-header').click(); })");

    for (const key of keys) {
        await check(`popup round-trip ${key}`, async () => {
            if (key === 'compact_list_view') await clickSetting('list_view', true);
            await clickSetting(key, true);
            await clickSetting(key, false);
            if (key === 'compact_list_view') await clickSetting('list_view', false);
        });
    }

    await check('popup persistence, compact dependency and keyboard accordion', async () => {
        await clickSetting('list_view', true);
        await clickSetting('compact_list_view', true);
        await reloadPopup();
        assert.equal(await popup.evaluate("document.querySelector('#compact_list_view').checked && !document.querySelector('#compact_list_view').disabled"), true);
        await clickSetting('list_view', false);
        await until(async () => await stored('compact_list_view') === false, 'compact automatically cleared');
        assert.equal(await popup.evaluate("document.querySelector('#compact_list_view').disabled && !document.querySelector('#compact_list_view').checked"), true);
        await popup.send('Page.bringToFront');
        await popup.evaluate("document.querySelector('.group-header').scrollIntoView(); document.querySelector('.group-header').focus()");
        const before = await popup.evaluate("document.activeElement.getAttribute('aria-expanded')");
        await popup.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
        await popup.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await until(async () => await popup.evaluate("document.activeElement.getAttribute('aria-expanded')") !== before, 'Enter toggles accordion');
        const collapsed = await popup.evaluate("document.querySelector('.settings-group').classList.contains('collapsed')");
        await reloadPopup();
        assert.equal(await popup.evaluate("document.querySelector('.settings-group').classList.contains('collapsed')"), collapsed);
    });

    await check('theme, language and all-setting power persistence without sync pollution', async () => {
        await settings(Object.fromEntries(keys.map(key => [key, true])));
        await reloadPopup();
        const before = await popup.evaluate("document.body.getAttribute('data-theme')");
        await popup.evaluate("document.querySelector('#theme-toggle').click()");
        await reloadPopup();
        assert.notEqual(await popup.evaluate("document.body.getAttribute('data-theme')"), before);
        await popup.evaluate("document.querySelector('#language-toggle').click()");
        await until(() => popup.evaluate("document.querySelector('#language-toggle').getAttribute('aria-pressed') === 'false'"), 'browser language');
        await popup.evaluate("document.querySelector('#language-toggle').click()");
        await until(() => popup.evaluate("document.querySelector('#language-toggle').getAttribute('aria-pressed') === 'true'"), 'English language');
        await reloadPopup();
        assert.equal(await popup.evaluate('activeLanguageOverride'), 'en');
        await popup.evaluate("document.querySelector('#power-toggle').click()");
        await until(() => page.evaluate(`!${JSON.stringify(keys)}.some(key => document.documentElement.hasAttribute(key))`), 'power off strips all settings');
        assert.equal(await popup.evaluate("[...document.querySelectorAll('input')].every(input => input.disabled)"), true);
        assert.equal(await content('_originalAudioTrackTimers.length + activeControllers.size + fetchQueue.length'), 0);
        assert.equal(await page.evaluate("document.querySelectorAll('[data-lym-control-hidden],[data-lym-likes-applied],[data-lym-premium-hidden],[data-lym-premium-backdrop-hidden],[data-lym-premium-promo-hidden],[data-lym-thumbnail-playback-disabled]').length"), 0);
        await reloadPopup();
        assert.equal(await popup.evaluate("document.body.hasAttribute('data-extension-disabled')"), true);
        await popup.evaluate("document.querySelector('#power-toggle').click()");
        await until(() => page.evaluate(`${JSON.stringify(keys)}.every(key => document.documentElement.getAttribute(key) === 'true')`), 'power on restores all settings');
        const synced = await popup.evaluate('new Promise(resolve => chrome.storage.sync.get(null, resolve))');
        assert.deepEqual(Object.keys(synced).sort(), keys.toSorted());
        assert.ok(Object.values(synced).every(value => value === true));
        await settings(defaults);
        await reloadPopup();
    });

    for (const [key, selector] of displayFeatures) {
        await check(`independent on/off ${key} ${selector}`, async () => {
            await settings(defaults);
            assert.notEqual(await display(selector), 'none', `${selector} baseline`);
            await settings({ [key]: true });
            await until(async () => await display(selector) === 'none', `${key} effect`);
            for (const [otherKey, otherSelector] of displayFeatures) {
                if (otherKey !== key) assert.notEqual(await display(otherSelector), 'none', `${key} must not hide ${otherSelector}`);
            }
            assert.notEqual(await display('#primary'), 'none');
            await settings({ [key]: false });
            await until(async () => await display(selector) !== 'none', `${key} cleanup`);
        });
    }

    await check('late DOM insertions are handled without hiding unrelated controls', async () => {
        await settings({ hide_premium_popups: true, hide_create_button: true, hide_hype_button: true });
        await page.evaluate(`(() => {
            const promo = document.createElement('yt-mealbar-promo-view-model');
            promo.id = 'late-promo'; promo.textContent = 'Premium'; document.querySelector('ytd-app').append(promo);
            for (const [id, text] of [['late-generic','Share video'],['late-premium','Try Premium']]) {
                const banner = document.createElement('ytd-upsell-banner-renderer');
                banner.id = id; banner.textContent = text; document.querySelector('ytd-app').append(banner);
            }
            const create = document.createElement('yt-button-view-model');
            create.id = 'late-create'; create.textContent = 'Create'; document.querySelector('ytd-masthead #buttons').append(create);
            const share = document.createElement('button');
            share.id = 'late-share'; share.textContent = 'Share'; document.querySelector('#actions').append(share);
        })()`);
        for (const selector of ['#late-promo', '#late-premium', '#late-create']) await until(async () => await display(selector) === 'none', selector);
        for (const selector of ['#late-generic', '#late-share']) assert.notEqual(await display(selector), 'none');
        await settings(defaults);
        for (const selector of ['#late-promo', '#late-premium', '#late-create']) assert.notEqual(await display(selector), 'none');
    });

    await check('transcript click escape and native states preserve the panel, not recommendations', async () => {
        await settings({ hide_sidebar: true });
        await page.evaluate(`(() => {
            const trigger = document.createElement('button'); trigger.id = 'transcript-trigger';
            trigger.setAttribute('aria-label', 'Show transcript'); trigger.textContent = 'Show transcript';
            document.querySelector('#primary').append(trigger); trigger.click();
        })()`);
        assert.equal(await page.evaluate("document.documentElement.getAttribute('data-lym-transcript-active')"), 'true');
        assert.notEqual(await display('#secondary'), 'none');
        assert.equal(await display('#related'), 'none');
        await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        await until(async () => await display('#secondary') === 'none', 'Escape clears transcript grace');
        for (const state of ['EXPANDED', 'VISIBLE']) {
            await page.evaluate(`document.querySelector('ytd-engagement-panel-section-list-renderer').setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_${state}')`);
            assert.notEqual(await display('#secondary'), 'none');
            assert.equal(await display('#related'), 'none');
            await settings({ hide_sidebar: false });
            assert.notEqual(await display('#secondary'), 'none');
            assert.notEqual(await display('#related'), 'none');
            await settings({ hide_sidebar: true });
        }
        await page.evaluate("document.querySelector('ytd-engagement-panel-section-list-renderer').setAttribute('visibility','ENGAGEMENT_PANEL_VISIBILITY_HIDDEN')");
        await until(async () => await display('#secondary') === 'none', 'closed transcript');
        await settings(defaults);
    });

    await check('autoplay actually turns off while like and audio-menu controls remain usable', async () => {
        await page.evaluate(`(() => {
            const toggle = document.createElement('button'); toggle.className = 'ytp-autonav-toggle-button';
            toggle.id = 'native-autoplay'; toggle.setAttribute('aria-checked','true');
            toggle.addEventListener('click', () => toggle.setAttribute('aria-checked','false'));
            document.querySelector('#primary').append(toggle);
        })()`);
        await settings({ hide_autoplay: true, hide_likes: true });
        await until(() => page.evaluate("document.querySelector('#native-autoplay').getAttribute('aria-checked') === 'false'"), 'native autoplay off');
        assert.equal(await page.evaluate("localStorage.getItem('yt-autoplay')"), '0');
        assert.notEqual(await display('#like-button'), 'none');
        assert.notEqual(await display('#audio-menu'), 'none');
        await settings(defaults);
    });

    await check('thumbnail preview uses real playing media and never pauses the watch video', async () => {
        await page.evaluate(`(async () => {
            const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
            canvas.getContext('2d').fillRect(0,0,4,4);
            window.releaseStream = canvas.captureStream(2);
            for (const video of [document.querySelector('#main-video'), document.querySelector('#thumb-preview video')]) {
                video.srcObject = window.releaseStream; video.muted = true; await video.play();
            }
        })()`);
        assert.equal(await page.evaluate("document.querySelector('#thumb-preview video').paused"), false);
        await settings({ disable_thumbnail_playback: true });
        await until(() => page.evaluate("document.querySelector('#thumb-preview video').paused"), 'preview paused');
        assert.equal(await page.evaluate("document.querySelector('#main-video').paused"), false);
        assert.notEqual(await display('#main-video'), 'none');
        await settings(defaults);
        assert.notEqual(await display('#thumb-preview'), 'none');
        await page.evaluate('window.releaseStream.getTracks().forEach(track => track.stop())');
    });

    await check('thumbnail blur reveals on real mouse hover and cleans up on disable', async () => {
        await page.send('Page.bringToFront');
        await page.evaluate("document.querySelector('#blur-thumb').scrollIntoView({block:'center'})");
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
        await settings({ blur_thumbnails: true });
        // Occluded headed windows can pause animation frames; finish, not disable, transitions.
        const finishTransitions = () => page.evaluate("getComputedStyle(document.querySelector('#blur-thumb')).filter; document.querySelector('#blur-thumb').getAnimations().forEach(animation => animation.finish())");
        await finishTransitions();
        const blurNear = async expected => {
            const filter = await prop('#blur-thumb', 'filter');
            const match = filter.match(/^blur\(([\d.]+)px\)$/);
            return Boolean(match) && Math.abs(Number(match[1]) - expected) < 0.1;
        };
        try { await until(() => blurNear(8), 'blur before hover'); }
        catch (error) {
            const state = await page.evaluate("({filter:getComputedStyle(document.querySelector('#blur-thumb')).filter,hover:document.querySelector('#blur-thumb').matches(':hover'),enabled:document.documentElement.getAttribute('blur_thumbnails'),hidden:document.hidden,focused:document.hasFocus(),animations:document.querySelector('#blur-thumb').getAnimations().map(animation=>({state:animation.playState,time:animation.currentTime}))})");
            throw new Error(error.message + ': ' + JSON.stringify(state));
        }
        const point = await page.evaluate("(() => {const r=document.querySelector('#blur-thumb').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        assert.equal(await page.evaluate("document.querySelector('#blur-thumb').matches(':hover')"), true);
        await finishTransitions();
        await until(() => blurNear(0), 'hover reveal');
        await settings(defaults);
        assert.equal(await prop('#blur-thumb', 'filter'), 'none');
    });

    await check('audio bridge selects the original track once and preserves the native audio menu', async () => {
        await page.evaluate(`(() => {
            window.releaseAudio = { calls:0, original:{name:'Original audio'}, dubbed:{name:'English (dubbed)'} };
            const state = window.releaseAudio; state.current = state.dubbed;
            const player = document.querySelector('#movie_player');
            player.getAvailableAudioTracks = () => [state.dubbed,state.original];
            player.getAudioTrack = () => state.current;
            player.setAudioTrack = track => { state.current = track; state.calls++; };
        })()`);
        await settings({ disable_auto_dubbing: true });
        await until(() => page.evaluate('window.releaseAudio.current === window.releaseAudio.original'), 'original audio selected');
        await delay(700);
        assert.equal(await page.evaluate('window.releaseAudio.calls'), 1);
        assert.notEqual(await display('#audio-menu'), 'none');
        await settings(defaults);
        assert.equal(await content('_originalAudioTrackTimers.length'), 0);
    });

    await navigate('https://www.youtube.com/feed/subscriptions');
    await check('list and compact preserve native preview layers, progress and channel metadata', async () => {
        await page.evaluate(`(() => {
            const preview = document.createElement('ytd-video-preview'); preview.id = 'list-preview';
            preview.append(document.createElement('video')); document.querySelector('#list-link').append(preview);
            const progress = document.createElement('yt-thumbnail-overlay-progress-bar-view-model');
            progress.id = 'watched-progress'; progress.textContent = 'Watched'; document.querySelector('#list-link').append(progress);
        })()`);
        await settings({ list_view: true });
        for (const [compact, width] of [[false, '260px'], [true, '180px']]) {
            await settings({ compact_list_view: compact });
            await until(async () => await prop('#list-img', 'width') === width, 'list image width');
            assert.equal(await prop('#list-preview', 'width'), width);
            assert.notEqual(await display('#watched-progress'), 'none');
            assert.notEqual(await display('#list-row yt-content-metadata-view-model'), 'none');
        }
        await settings({ disable_thumbnail_playback: true });
        assert.equal(await display('#list-preview'), 'none');
        assert.notEqual(await display('#watched-progress'), 'none');
        await settings(defaults);
    });

    await check('live and premiere text signals do not hide normal uploads and reset recycled cards', async () => {
        await page.evaluate(`(() => {
            for (const [id,text] of [['regular','Uploaded yesterday'],['premiere','İLK GÖSTERİM'],['live-local','CANLI']]) {
                const item = document.createElement('ytd-rich-item-renderer'); item.id = id;
                const link = document.createElement('a'); link.id = 'video-title-link'; link.href='/watch?v=12345678901'; link.textContent = id;
                const badge = document.createElement('span'); badge.className = 'badge-shape-wiz__text'; badge.textContent = text;
                item.append(link,badge); document.querySelector('ytd-rich-grid-renderer > #contents').append(item);
            }
        })()`);
        await settings({ hide_live_premiere: true });
        for (const selector of ['#premiere', '#live-local']) await until(async () => await display(selector) === 'none', selector);
        assert.notEqual(await display('#regular'), 'none');
        await page.evaluate("document.querySelector('#premiere a').href='/watch?v=ABCDEFGHIJK'; document.querySelector('#premiere span').remove()");
        await until(async () => await display('#premiere') !== 'none', 'recycled normal upload');
        await settings(defaults);
    });

    await check('descriptions fetch lazily, cache canonical URLs and render hostile HTML as text', async () => {
        await page.evaluate("const descriptionLink=document.querySelector('#list-link'); descriptionLink.href='/watch?v=zzzzzzzzzzz'; descriptionLink.id='video-title-link'; document.querySelector('#list-item').scrollIntoView()");
        const before = network.descriptions;
        await settings({ list_view: true });
        await until(() => page.evaluate("document.querySelector('#list-item .custom-description')?.textContent.includes('<img')"), 'description appended safely');
        assert.equal(await page.evaluate("document.querySelector('#list-item .custom-description').children.length"), 0);
        assert.equal(await page.evaluate("window.releaseXss || false"), false);
        assert.equal(network.descriptions - before, 1);
        await content("fetchVideoDescription('/watch?v=zzzzzzzzzzz&t=5')");
        assert.equal(network.descriptions - before, 1);
        await settings({ list_view: false });
        assert.equal(await page.evaluate("document.querySelectorAll('.custom-description').length"), 0);
        assert.equal(await content('activeControllers.size + activeFetches + fetchQueue.length'), 0);
    });

    await check('SPA routes preserve preferences without leaking subscription layout or work', async () => {
        await settings({ list_view: true, compact_list_view: true, hide_comments: true });
        for (const route of ['/results?search_query=test', '/watch?v=abcdefghijk', '/feed/subscriptions', '/']) {
            await page.evaluate(`history.pushState({},'',${JSON.stringify(route)}); document.dispatchEvent(new Event('yt-navigate-finish'))`);
            await until(() => content(`lastUrl === location.href && ${JSON.stringify(route === '/feed/subscriptions')} === isSubscriptionsPage()`), `SPA ${route}`);
            if (route !== '/feed/subscriptions') {
                assert.notEqual(await page.evaluate("document.querySelector('ytd-browse').getAttribute('page-subtype')"), 'subscriptions');
                assert.equal(await content('activeControllers.size + fetchQueue.length'), 0);
            }
            assert.equal(await page.evaluate("document.documentElement.getAttribute('hide_comments')"), 'true');
        }
        await settings({ default_subscriptions: true });
        await page.evaluate("history.pushState({},'','/watch?v=abcdefghijk'); document.dispatchEvent(new Event('yt-navigate-finish'))");
        await until(() => content('lastUrl === location.href'), 'watch route');
        await page.evaluate("history.pushState({},'','/'); document.dispatchEvent(new Event('yt-navigate-finish'))");
        await until(() => page.evaluate("location.pathname === '/feed/subscriptions'"), 'SPA homepage redirects');
        await navigate('https://www.youtube.com/watch?v=abcdefghijk');
        await settings(defaults);
    });

    await check('1000-node mutation burst settles without observer loops or unsolicited fetches', async () => {
        await content(`window.releaseOriginalRunner = runFeatures; window.releaseRuns = 0;
            runFeatures = function() { window.releaseRuns++; return window.releaseOriginalRunner(); };`);
        const beforeRequests = network.descriptions;
        try {
            await page.evaluate(`(() => {const app=document.querySelector('ytd-app');for(let i=0;i<${budgets.mutationBurstNodes};i++){const node=document.createElement('i');node.className='release-burst';app.append(node);}})()`);
            await until(() => content('window.releaseRuns > 0'), 'mutation feature pass');
            await delay(600);
            const count = await content('window.releaseRuns');
            assert.ok(count <= budgets.mutationBurstRuns, `${count} feature passes for one mutation burst`);
            await delay(400);
            assert.equal(await content('window.releaseRuns'), count, 'observer must become idle');
            assert.equal(network.descriptions, beforeRequests);
            report.metrics.mutationBurstRuns = count;
        } finally {
            await content('runFeatures = window.releaseOriginalRunner');
            await page.evaluate("document.querySelectorAll('.release-burst').forEach(node => node.remove())");
        }
    });

    await check('large subscription fixture stays within feature-pass CPU and resource budgets', async () => {
        await navigate('https://www.youtube.com/feed/subscriptions');
        await settings({ list_view: true, hide_live_premiere: true, hide_likes: true, hide_create_button: true, hide_premium_popups: true });
        await page.evaluate(`(() => {
            const contents = document.querySelector('ytd-rich-grid-renderer > #contents');
            for(let index=0;index<300;index++) {
                const item=document.createElement('ytd-rich-item-renderer');
                const link=document.createElement('a');link.id='video-title-link';link.href='/watch?v='+String(index).padStart(11,'0');link.textContent='Video '+index;
                item.append(link,document.createElement('yt-content-metadata-view-model'));contents.append(item);
            }
        })()`);
        await until(() => content('getSubscriptionItems().length >= 300'), 'large feed');
        const timing = await content(`(() => {
            const durations=[]; for(let index=0;index<20;index++){const start=performance.now();runFeatures();durations.push(performance.now()-start);}
            durations.sort((a,b)=>a-b);
            return {p95:durations[Math.ceil(durations.length*.95)-1],max:durations.at(-1),cache:descriptionCache.size,queue:fetchQueue.length,active:activeFetches,timers:_originalAudioTrackTimers.length};
        })()`);
        report.metrics.largeFeed = timing;
        assert.ok(timing.p95 <= budgets.featurePassP95Ms, `p95 ${timing.p95}ms`);
        assert.ok(timing.max <= budgets.featurePassMaxMs, `max ${timing.max}ms`);
        assert.ok(timing.cache <= 250 && timing.queue <= 100 && timing.active <= 3 && timing.timers <= 5);
        await settings(defaults);
        await navigate('https://www.youtube.com/watch?v=abcdefghijk');
    });

    await check('non-YouTube origins receive no content scripts or setting attributes', async () => {
        await page.send('Page.navigate', { url: 'https://example.test/' });
        await until(() => page.evaluate("location.hostname === 'example.test' && document.readyState === 'complete'"), 'foreign fixture');
        assert.equal(await page.evaluate(`Boolean(window.SETTINGS_KEYS) || ${JSON.stringify(keys)}.some(key => document.documentElement.hasAttribute(key))`), false);
        await navigate('https://www.youtube.com/watch?v=abcdefghijk');
    });

    await check('popup structure has named keyboard controls, valid regions and no duplicate IDs', async () => {
        const errors = await popup.evaluate(`(() => {
            const errors=[]; const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);
            if(new Set(ids).size!==ids.length) errors.push('Duplicate IDs');
            for(const input of document.querySelectorAll('input')) {
                if(input.type!=='checkbox' || input.getAttribute('role')!=='switch') errors.push(input.id+' semantics');
                if(![...input.labels].some(label=>label.getAttribute('aria-label')?.trim() || label.textContent.trim())) errors.push(input.id+' name');
            }
            for(const button of document.querySelectorAll('button')) {
                if(!(button.getAttribute('aria-label') || button.textContent).trim()) errors.push('Unnamed button');
                const target=button.getAttribute('aria-controls');
                if(target && !document.getElementById(target)) errors.push('Missing region '+target);
            }
            return errors;
        })()`);
        assert.deepEqual(errors, []);
    });
    console.log('LYM_METRICS:' + JSON.stringify(report.metrics));
};
