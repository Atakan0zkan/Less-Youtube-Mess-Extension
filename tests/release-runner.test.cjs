const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findBrowser, parseTestSummary, validTestSummary, runStage, gatePassed, fingerprint } = require('./release.cjs');
const { writeBudget } = require('./helpers/write-budget.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { source } = require('./helpers/runtime.cjs');
const { requiredBrowserChecks } = require('./helpers/feature-matrix.cjs');
const { validateBrowserReport } = require('./helpers/browser-contract.cjs');

test('release runner: browser detection honors an explicit path and never masks a bad override', () => {
    assert.equal(findBrowser({ BROWSER_PATH: '/test/browser' }, 'linux', file => file === '/test/browser'), '/test/browser');
    assert.throws(() => findBrowser({ BROWSER_PATH: '/missing' }, 'linux', () => false), /BROWSER_PATH/);
    assert.throws(() => findBrowser({}, 'linux', () => false), /mandatory/);
    assert.equal(findBrowser({}, 'linux', file => file === '/usr/bin/chromium'), '/usr/bin/chromium');
    const chrome = path.join('C:/Apps', 'Google/Chrome/Application/chrome.exe');
    assert.equal(findBrowser({ ProgramFiles: 'C:/Apps' }, 'win32', file => file === chrome), chrome);
});

test('release runner: test counts are parsed, including skips and cancellations', () => {
    assert.deepEqual(parseTestSummary('# tests 12\n# pass 9\n# fail 1\n# cancelled 1\n# skipped 1\n# todo 0\n'), {
        tests: 12, pass: 9, fail: 1, cancelled: 1, skipped: 1, todo: 0
    });
    assert.deepEqual(parseTestSummary('No tests actually ran'), {});
    const complete = { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
    assert.equal(validTestSummary(complete), true);
    assert.equal(validTestSummary({}), false);
    for (const field of Object.keys(complete)) {
        const incomplete = { ...complete }; delete incomplete[field];
        assert.equal(validTestSummary(incomplete), false, field);
    }
    assert.equal(validTestSummary({ ...complete, skipped: 1 }), false);
});

test('release runner: offline, incomplete, changed or failed stages cannot pass a release', () => {
    const stages = Array.from({ length: 3 }, () => ({ status: 'passed' }));
    assert.equal(gatePassed({ scope: 'full-fixture', stages }), true);
    assert.equal(gatePassed({ scope: 'offline-only', stages }), false);
    assert.equal(gatePassed({ scope: 'full-fixture', stages: stages.slice(0, 2) }), false);
    assert.equal(gatePassed({ scope: 'full-fixture', stages, sourceChanged: true }), false);
    assert.equal(gatePassed({ scope: 'full-fixture', stages: [...stages.slice(0, 2), { status: 'failed' }] }), false);
});

test('release runner: failed child exits are not reported as success', async () => {
    const result = await runStage('intentional failure', ['-e', 'console.error("Expected failure probe");process.exitCode=7'], { log: null });
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 7);
    assert.match(result.output, /Expected failure probe/);
});

test('release runner: hung children time out instead of silently passing', async () => {
    const result = await runStage('timeout probe', ['-e', 'setInterval(()=>{},1000)'], { log: null, timeoutMs: 200 });
    assert.equal(result.status, 'failed');
    assert.equal(result.timedOut, true);
});

test('release runner: source fingerprint is stable and identifies runtime plus test inputs', () => {
    assert.match(fingerprint(), /^[a-f0-9]{64}$/);
    assert.equal(fingerprint(), fingerprint());
});

test('release runner: sync pacing respects a rolling window without bypassing browser quotas', async () => {
    let clock = 0;
    const waits = [];
    const budget = writeBudget({ limit: 3, windowMs: 100, now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; } });
    await budget.reserve(2);
    await budget.reserve();
    assert.equal(waits.length, 0);
    await budget.reserve(2);
    assert.equal(waits.length, 1);
    assert.ok(clock > 100);
    await assert.rejects(() => budget.reserve(4), /Invalid/);
});

test('release runner: packaging runs the full gate and exits before compression on failure', () => {
    const batch = source('package.bat');
    const gate = batch.indexOf('call npm run test:release');
    const archive = batch.indexOf('Compress-Archive');
    assert.ok(gate >= 0 && archive > gate);
    assert.match(batch.slice(gate, archive), /if errorlevel 1\s*\([\s\S]*exit \/b 1/);
    assert.match(batch, /powershell\.exe -NoProfile -NonInteractive -Command "\$ErrorActionPreference = 'Stop'; Import-Module \(Join-Path \$PSHOME /);
    assert.ok(batch.includes("'Modules\\Microsoft.PowerShell.Archive\\Microsoft.PowerShell.Archive.psd1') -ErrorAction Stop; Compress-Archive"));
});

test('release runner: empty or incomplete browser reports cannot masquerade as full coverage', () => {
    const keys = ['hide_sidebar'];
    const complete = {
        browser: 'Test browser', errors: [], network: { denied: [] },
        checks: requiredBrowserChecks(keys).map(name => ({ name, status: 'passed' })),
        locales: [{ name: 'en', rows: 1, direction: 'ltr', errors: [] }]
    };
    assert.doesNotThrow(() => validateBrowserReport(complete, keys, ['en']));
    assert.throws(() => validateBrowserReport({ ...complete, checks: [] }, keys, ['en']), /Missing/);
    assert.throws(() => validateBrowserReport({ ...complete, locales: [] }, keys, ['en']), /language/);
    assert.throws(() => validateBrowserReport({ ...complete, errors: ['Unexpected error'] }, keys, ['en']), /runtime errors/);
    assert.throws(() => validateBrowserReport({ ...complete, locales: [{ ...complete.locales[0], rows: 0 }] }, keys, ['en']));
});

if (process.platform === 'win32') {
    for (const failAt of ['tests', 'compression']) test(`release runner: Windows ${failAt} failure creates no ZIP and returns a failure exit code`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lym-package-test-'));
        try {
            let batch = source('package.bat');
            // A .cmd mock needs CALL to return, unlike the real PowerShell executable.
            if (failAt === 'compression') batch = batch.replace(/^powershell\.exe /m, 'call powershell ');
            fs.writeFileSync(path.join(directory, 'package.bat'), batch);
            fs.writeFileSync(path.join(directory, 'npm.cmd'), `@exit /b ${failAt === 'tests' ? 7 : 0}\r\n`);
            fs.writeFileSync(path.join(directory, 'powershell.cmd'), '@exit /b 9\r\n');
            const env = { ...process.env };
            for (const name of Object.keys(env)) if (name.toLowerCase() === 'path') delete env[name];
            env.PATH = directory + path.delimiter + process.env.PATH;
            assert.throws(() => execFileSync('cmd.exe', ['/d', '/c', 'package.bat'], {
                cwd: directory, env, windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe']
            }), error => {
                assert.equal(error.status, 1);
                if (failAt === 'tests') {
                    assert.match(error.stdout.toString(), /Release checks failed/);
                    assert.doesNotMatch(error.stdout.toString(), /Packaging extension/);
                } else {
                    assert.match(error.stdout.toString(), /An error occurred while creating the package/);
                }
                return true;
            });
            assert.equal(fs.existsSync(path.join(directory, 'extension.zip')), false);
        } finally {
            const resolved = path.resolve(directory);
            assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
            assert.ok(path.basename(resolved).startsWith('lym-package-test-'));
            fs.rmSync(resolved, { recursive: true, force: true });
        }
    });
}
