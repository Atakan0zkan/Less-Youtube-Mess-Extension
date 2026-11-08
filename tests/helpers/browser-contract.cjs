const assert = require('node:assert/strict');
const { requiredBrowserChecks } = require('./feature-matrix.cjs');

function validateBrowserReport(report, keys, locales) {
    assert.ok(report.browser, 'Browser version must be recorded');
    assert.equal(report.failure, undefined, 'Browser failure must not be masked');
    assert.deepEqual(report.errors, [], 'Browser runtime errors');
    assert.deepEqual(report.network.denied, [], 'Unexpected fixture traffic');
    assert.ok(report.checks.every(check => check.status === 'passed'), 'Every executed browser scenario must pass');
    const names = report.checks.map(check => check.name);
    assert.equal(new Set(names).size, names.length, 'Duplicate browser scenario names');
    for (const name of requiredBrowserChecks(keys)) assert.ok(names.includes(name), `Missing browser scenario: ${name}`);
    assert.deepEqual(report.locales.map(locale => locale.name).sort(), locales.toSorted(), 'Every packaged language must render');
    for (const locale of report.locales) {
        assert.equal(locale.rows, keys.length, locale.name);
        assert.deepEqual(locale.errors, [], locale.name);
        assert.equal(locale.direction, ['ar', 'fa'].includes(locale.name) ? 'rtl' : 'ltr', locale.name);
    }
}

module.exports = { validateBrowserReport };
