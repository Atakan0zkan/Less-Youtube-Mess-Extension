const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const source = file => readFileSync(join(root, file), 'utf8');
const locales = readdirSync(join(root, '_locales')).sort();
const catalogs = Object.fromEntries(locales.map(locale => [
    locale, JSON.parse(source(`_locales/${locale}/messages.json`))
]));
const html = source('popup.html');

function popupContext(locale, rejectEnglish = false) {
    const writes = [];
    const warnings = [];
    let fetches = 0;
    const node = attributes => ({
        attributes: new Map(Object.entries(attributes)),
        listeners: new Map(),
        textContent: '',
        title: '',
        getAttribute(key) { return this.attributes.get(key) ?? null; },
        setAttribute(key, value) { this.attributes.set(key, value); },
        addEventListener(key, callback) { this.listeners.set(key, callback); }
    });
    const bindings = Object.fromEntries(['data-i18n', 'data-i18n-title', 'data-i18n-aria'].map(attribute => [
        attribute,
        [...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))]
            .map(match => node({ [attribute]: match[1] }))
    ]));
    const button = node({});
    const document = {
        documentElement: {},
        addEventListener() {},
        getElementById: id => id === 'language-toggle' ? button : null,
        querySelectorAll: selector => bindings[selector.slice(1, -1)] || []
    };
    const context = vm.createContext({
        document,
        console: { warn: message => warnings.push(message) },
        chrome: {
            runtime: { getURL: file => `chrome-extension://test/${file}` },
            i18n: {
                getMessage: key => catalogs[locale][key]?.message || '',
                getUILanguage: () => locale.replace('_', '-')
            },
            storage: { local: { set: value => writes.push(value) } }
        },
        fetch: async url => {
            fetches++;
            assert.equal(url, 'chrome-extension://test/_locales/en/messages.json');
            if (rejectEnglish) throw new Error('Packaged English file unavailable');
            return { ok: true, json: async () => catalogs.en };
        }
    });
    context.self = context;
    vm.runInContext(source('shared/constants.js'), context);
    vm.runInContext(source('popup.js'), context);
    const run = code => vm.runInContext(code, context);
    const checkBindings = catalog => {
        for (const [attribute, nodes] of Object.entries(bindings)) {
            for (const element of nodes) {
                const key = element.getAttribute(attribute);
                const actual = attribute === 'data-i18n' ? element.textContent
                    : attribute === 'data-i18n-title' ? element.title
                        : element.getAttribute('aria-label');
                assert.equal(actual, catalog[key].message, `${locale}/${attribute}/${key}`);
            }
        }
    };
    return { document, button, run, writes, warnings, checkBindings, fetches: () => fetches };
}

test('localization: all 24 catalogs have 63 valid messages and compatible placeholders', () => {
    assert.equal(locales.length, 24);
    const keys = Object.keys(catalogs.en).sort();
    assert.equal(keys.length, 63);
    for (const locale of locales) {
        const catalog = catalogs[locale];
        assert.deepEqual(Object.keys(catalog).sort(), keys, locale);
        assert.ok([...catalog.extDescription.message].length <= 132, `${locale} manifest description`);
        for (const key of keys) {
            const value = catalog[key].message;
            assert.equal(typeof value, 'string', `${locale}/${key}`);
            assert.ok(value.trim(), `${locale}/${key} empty`);
            assert.doesNotMatch(value, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/, `${locale}/${key}`);
            assert.deepEqual(
                (value.match(/\$[A-Za-z0-9_]+\$/g) || []).sort(),
                (catalogs.en[key].message.match(/\$[A-Za-z0-9_]+\$/g) || []).sort(),
                `${locale}/${key} placeholders`
            );
        }
    }
});

test('localization: every popup binding and language-button label round-trips in every locale', async () => {
    for (const locale of locales) {
        const env = popupContext(locale);
        const expectedDirection = ['ar', 'fa'].includes(locale) ? 'rtl' : 'ltr';
        await env.run('applyI18n()');
        env.checkBindings(catalogs[locale]);
        assert.equal(env.button.title, catalogs[locale].languageUseEnglishTitle.message, locale);
        assert.equal(env.button.getAttribute('aria-label'), catalogs[locale].languageUseEnglishAria.message, locale);
        assert.equal(env.button.getAttribute('aria-pressed'), 'false');
        assert.equal(env.document.documentElement.dir, expectedDirection, locale);

        await env.run("applyI18n('en')");
        env.run('setupLanguageToggleButton()');
        env.checkBindings(catalogs.en);
        assert.equal(env.document.documentElement.lang, 'en');
        assert.equal(env.document.documentElement.dir, 'ltr');
        assert.equal(env.button.title, catalogs.en.languageUseBrowserTitle.message, locale);
        assert.equal(env.button.getAttribute('aria-label'), catalogs.en.languageUseBrowserAria.message, locale);
        assert.equal(env.button.getAttribute('aria-pressed'), 'true');

        await env.button.listeners.get('click')();
        env.checkBindings(catalogs[locale]);
        assert.equal(env.document.documentElement.lang, locale.replace('_', '-'));
        assert.equal(env.document.documentElement.dir, expectedDirection, locale);
        assert.equal(env.button.title, catalogs[locale].languageUseEnglishTitle.message, locale);
        assert.equal(env.button.getAttribute('aria-label'), catalogs[locale].languageUseEnglishAria.message, locale);
        assert.equal(env.writes.at(-1).popup_language_override, '');
        await env.button.listeners.get('click')();
        env.checkBindings(catalogs.en);
        assert.equal(env.writes.at(-1).popup_language_override, 'en');
        assert.equal(env.fetches(), 1, `${locale} cached packaged English file`);
    }
});

test('localization: failed English load keeps the browser translation and RTL direction', async () => {
    const env = popupContext('ar', true);
    assert.equal(await env.run("applyI18n('en')"), '');
    env.checkBindings(catalogs.ar);
    assert.equal(env.document.documentElement.lang, 'ar');
    assert.equal(env.document.documentElement.dir, 'rtl');
    assert.equal(env.button.title, catalogs.ar.languageUseEnglishTitle.message);
    assert.equal(env.button.getAttribute('aria-pressed'), 'false');
    assert.equal(env.warnings.length, 1);
});

test('localization: store descriptions cover all 24 locales and retain all six features and contact links', () => {
    const listings = source('STORE_LISTINGS.md');
    const sections = [...listings.matchAll(/^## (\w+) — [^\r\n]+\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
    assert.deepEqual(sections.map(match => match[1]).sort(), locales);
    for (const [, locale, text] of sections) {
        assert.deepEqual([...text.matchAll(/^([1-6])\uFE0F?\u20E3 /gm)].map(match => match[1]), ['1', '2', '3', '4', '5', '6'], locale);
        assert.equal((text.match(/https:\/\/github\.com\/Atakan0zkan\/Less-Youtube-Mess-Extension/g) || []).length, 1, locale);
        assert.equal((text.match(/atakanozkanapps@gmail\.com/g) || []).length, 1, locale);
        assert.ok(text.includes('100'), `${locale} open-source claim`);
        assert.equal(text.trim().split(/\r?\n\s*\r?\n/).length, 11, `${locale} paragraph coverage`);
    }
});
