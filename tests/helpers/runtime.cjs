const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const root = resolve(__dirname, '../..');
const source = file => readFileSync(resolve(root, file), 'utf8');

function eventTarget() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(callback);
        },
        dispatchEvent(event) {
            for (const callback of listeners.get(event.type) || []) callback(event);
        }
    };
}

function element() {
    const attrs = new Map();
    const styles = new Map();
    const classes = new Set();
    return {
        ...eventTarget(), attrs,
        nodeType: 1, isConnected: true, checked: false, disabled: false,
        children: [], textContent: '',
        setAttribute: (key, value) => attrs.set(key, String(value)),
        getAttribute: key => attrs.get(key) ?? null,
        hasAttribute: key => attrs.has(key),
        removeAttribute: key => attrs.delete(key),
        querySelector: () => null, querySelectorAll: () => [], matches: () => false,
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        remove() { this.isConnected = false; },
        getClientRects: () => [{}],
        getBoundingClientRect: () => ({ width: 100, height: 100 }),
        classList: {
            add: name => classes.add(name), remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle(name) { return classes.has(name) ? (classes.delete(name), false) : (classes.add(name), true); }
        },
        style: {
            setProperty: (key, value, priority = '') => styles.set(key, { value, priority }),
            removeProperty: key => styles.delete(key),
            getPropertyValue: key => styles.get(key)?.value || '',
            getPropertyPriority: key => styles.get(key)?.priority || ''
        }
    };
}

// Fake selectors are supplied by each unit test; CSS/DOM integration uses the real browser.
function environment(file = 'content.js') {
    const nodes = new Map();
    const timers = new Map();
    const timerDelays = new Map();
    const microtasks = [];
    const pending = { local: [], sync: [] };
    const writes = { local: [], sync: [] };
    const storageListeners = [];
    const observers = { mutation: [], intersection: [] };
    const warnings = [];
    const errors = [];
    const windowEvents = eventTarget();
    const document = {
        ...eventTarget(), documentElement: element(), body: element(), head: element(), hidden: false,
        getElementById: id => nodes.get(id) || null,
        querySelector: () => null, querySelectorAll: () => [],
        createElement: () => element()
    };
    let timerId = 0;
    const context = vm.createContext({
        console: { log() {}, warn: (...args) => warnings.push(args), error: (...args) => errors.push(args) },
        URL, Set, Map, AbortController, TextDecoder, TextEncoder, Uint8Array,
        Node: { ELEMENT_NODE: 1 }, document,
        location: new URL('https://www.youtube.com/watch?v=abcdefghijk'),
        setTimeout: (fn, ms) => { timers.set(++timerId, fn); timerDelays.set(timerId, ms); return timerId; },
        clearTimeout: id => { timers.delete(id); timerDelays.delete(id); },
        queueMicrotask: fn => microtasks.push(fn),
        addEventListener: windowEvents.addEventListener,
        dispatchEvent: windowEvents.dispatchEvent,
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        getComputedStyle: el => ({ display: el.style.getPropertyValue('display') || 'block', visibility: 'visible', opacity: '1' }),
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.observations = []; this.disconnects = 0; observers.mutation.push(this); }
            observe(target, options) { this.observations.push({ target, options }); }
            disconnect() { this.disconnects++; }
        },
        IntersectionObserver: class {
            constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); observers.intersection.push(this); }
            observe(target) { this.targets.add(target); }
            unobserve(target) { this.targets.delete(target); }
            disconnect() { this.targets.clear(); }
        },
        localStorage: { setItem() {} },
        fetch: async () => { throw new Error('Unexpected network request in unit test'); },
        chrome: {
            runtime: { id: 'test', getURL: name => `chrome-extension://test/${name}` },
            storage: {
                local: { get: (keys, cb) => pending.local.push(cb), set: value => writes.local.push(value) },
                sync: { get: (keys, cb) => pending.sync.push(cb), set: value => writes.sync.push(value) },
                onChanged: { addListener: cb => storageListeners.push(cb) }
            }
        }
    });
    context.window = context;
    context.self = context;
    vm.runInContext(source('shared/constants.js'), context, { filename: 'shared/constants.js' });
    vm.runInContext(source(file), context, { filename: file });
    return {
        context, document, nodes, timers, timerDelays, microtasks, pending, writes, observers, warnings, errors,
        run: code => vm.runInContext(code, context),
        change(changes, area = 'sync') { for (const callback of storageListeners) callback(changes, area); },
        flushMicrotasks() {
            let count = 0;
            while (microtasks.length) {
                if (++count > 100) throw new Error('Unbounded microtask loop');
                microtasks.shift()();
            }
            return count;
        },
        fireTimer(id) {
            const callback = timers.get(id);
            timers.delete(id);
            timerDelays.delete(id);
            callback?.();
        }
    };
}

function descriptionItem(index = 0) {
    const item = element();
    const metadata = element();
    const link = { href: `https://www.youtube.com/watch?v=${String(index).padStart(11, '0')}` };
    item.setAttribute('data-desc-done', link.href);
    item.querySelector = selector => {
        if (selector.includes('/watch')) return link;
        if (selector === 'yt-content-metadata-view-model') return metadata;
        return null;
    };
    return { item, metadata, link };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
module.exports = { root, source, element, environment, descriptionItem, settle };
