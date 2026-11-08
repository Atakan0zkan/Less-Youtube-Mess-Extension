const { setTimeout: delay } = require('node:timers/promises');

// Keep test-generated writes below chrome.storage.sync's real per-minute quota.
function writeBudget({ limit = 90, windowMs = 61000, now = () => performance.now(), sleep = delay, onWait = () => {} } = {}) {
    const timestamps = [];
    return {
        async reserve(count = 1) {
            if (!Number.isInteger(count) || count < 1 || count > limit) throw new Error('Invalid write reservation');
            while (true) {
                const current = now();
                while (timestamps.length && timestamps[0] <= current - windowMs) timestamps.shift();
                if (timestamps.length + count <= limit) {
                    for (let index = 0; index < count; index++) timestamps.push(current);
                    return;
                }
                const wait = Math.ceil(timestamps[0] + windowMs - current) + 1;
                onWait(wait);
                await sleep(wait);
            }
        }
    };
}

module.exports = { writeBudget };
