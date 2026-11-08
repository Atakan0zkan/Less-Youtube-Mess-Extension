const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { runtimeFiles } = require('./helpers/release-files.cjs');
const { testFiles } = require('./check.cjs');
const { validateBrowserReport } = require('./helpers/browser-contract.cjs');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function findBrowser(env = process.env, platform = process.platform, exists = file => fs.existsSync(file) && fs.statSync(file).isFile()) {
    if (env.BROWSER_PATH) {
        if (!exists(env.BROWSER_PATH)) throw new Error('BROWSER_PATH does not point to a browser executable');
        return env.BROWSER_PATH;
    }
    const candidates = platform === 'win32' ? [env.LOCALAPPDATA, env.ProgramFiles || env.PROGRAMFILES, env['ProgramFiles(x86)']].filter(Boolean).flatMap(base => [
        path.join(base, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
        path.join(base, 'Google/Chrome/Application/chrome.exe'),
        path.join(base, 'Chromium/Application/chrome.exe')
    ]) : platform === 'darwin' ? [
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ] : ['/usr/bin/brave-browser', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome'];
    const browser = candidates.find(exists);
    if (!browser) throw new Error('No compatible browser found. Set BROWSER_PATH to Brave or Chrome for Testing; browser checks are mandatory.');
    return browser;
}

function parseTestSummary(output) {
    const summary = {};
    for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
        const match = output.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'));
        if (match) summary[name] = Number(match[1]);
    }
    return summary;
}

function validTestSummary(summary) {
    return summary.tests > 0 && summary.pass === summary.tests &&
        ['fail', 'cancelled', 'skipped', 'todo'].every(name => summary[name] === 0);
}

function fingerprint() {
    const files = [...runtimeFiles(root), 'package.json', 'package-lock.json', ...testFiles().map(file => path.relative(root, file).replaceAll('\\', '/'))].sort();
    const hash = createHash('sha256');
    for (const file of files) hash.update(file + '\0').update(fs.readFileSync(path.join(root, file)));
    return hash.digest('hex');
}

async function runStage(name, args, { env = process.env, timeoutMs = 120000, log = process.stdout } = {}) {
    const start = performance.now();
    let output = '';
    let timedOut = false;
    let error;
    let code;
    await new Promise(resolve => {
        const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
        const collect = chunk => {
            log?.write(chunk);
            output = (output + chunk).slice(-5 * 1024 * 1024);
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.once('error', failure => { error = failure.message; });
        child.once('close', exitCode => { clearTimeout(timeout); code = exitCode; resolve(); });
    });
    return { name, status: code === 0 && !timedOut && !error ? 'passed' : 'failed', code, timedOut, error, durationMs: Math.round(performance.now() - start), output };
}

function gatePassed(report) {
    return report.scope !== 'offline-only' && report.stages.length === 3 && report.stages.every(stage => stage.status === 'passed') && !report.sourceChanged;
}

async function main(argv = process.argv.slice(2)) {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Release checks require Node 22 or newer');
    const unknown = argv.filter(arg => !['--offline', '--live'].includes(arg));
    if (unknown.length || (argv.includes('--offline') && argv.includes('--live'))) throw new Error('Usage: node tests/release.cjs [--offline | --live]');
    const offline = argv.includes('--offline');
    const directory = path.join(root, 'test-results', `release-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`);
    fs.mkdirSync(directory, { recursive: true });
    const report = {
        startedAt: new Date().toISOString(), version: JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version,
        scope: offline ? 'offline-only' : argv.includes('--live') ? 'full-plus-live' : 'full-fixture',
        node: process.version, platform: process.platform, stages: [], sourceHash: fingerprint(),
        limitations: [
            'Fixture success cannot prove compatibility with every future YouTube experiment or signed-in account.',
            'Native multi-audio track labels, signed-in subscription loading and store installation require live/manual verification.',
            'Performance limits measure controlled fixture work, not a guarantee of real-world page load speed or absence of all memory leaks.',
            'Source package inputs are checked; an existing extension.zip is not validated or rebuilt by this test command.'
        ]
    };
    try {
        report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        report.dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
        const env = { ...process.env, NO_COLOR: '1', LYM_RELEASE_REPORT_DIR: directory };
        delete env.FORCE_COLOR;
        report.stages.push(await runStage('syntax-and-whitespace', ['tests/check.cjs'], { env }));
        console.log('Running offline behavior, security, performance and localization tests...');
        const unit = await runStage('unit-security-performance-localization', ['--test', '--test-reporter=tap'], { env, log: null });
        unit.summary = parseTestSummary(unit.output);
        if (!validTestSummary(unit.summary)) {
            unit.status = 'failed';
            unit.error ||= 'Tests must execute without failures, skipped, cancelled or TODO cases';
        }
        console.log(`${unit.status.toUpperCase()}: offline tests ${unit.summary.pass ?? 0}/${unit.summary.tests ?? 0} (${unit.durationMs}ms)`);
        if (unit.status !== 'passed') process.stderr.write(unit.output);
        report.stages.push(unit);
        if (!offline) {
            if (report.stages.some(stage => stage.status !== 'passed')) {
                report.stages.push({ name: 'browser-all-features-and-24-locales', status: 'blocked', error: 'Offline checks must pass before executing the unpacked extension' });
            } else {
                try {
                    env.BROWSER_PATH = findBrowser(env);
                    report.browserPath = env.BROWSER_PATH;
                    const browser = await runStage('browser-all-features-and-24-locales', ['tests/browser-smoke.cjs', '--release', ...(argv.includes('--live') ? ['--live'] : [])], { env, timeoutMs: 660000 });
                    browser.passedChecks = (browser.output.match(/^PASS:/gm) || []).length;
                    report.stages.push(browser);
                    if (browser.status === 'passed') {
                        try {
                            const data = JSON.parse(fs.readFileSync(path.join(directory, 'browser.json'), 'utf8'));
                            const constants = { self: {} };
                            vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/constants.js'), 'utf8'), constants);
                            validateBrowserReport(data, Array.from(constants.self.SETTINGS_KEYS), fs.readdirSync(path.join(root, '_locales')));
                            report.browserSummary = { product: data.browser, featureScenarios: data.checks.length, localeLayouts: data.locales.length, settingRows: data.locales.reduce((count, locale) => count + locale.rows, 0), metrics: data.metrics };
                        } catch (error) { browser.status = 'failed'; browser.error = error.message; }
                    }
                } catch (error) {
                    report.stages.push({ name: 'browser-all-features-and-24-locales', status: 'failed', error: error.message });
                }
            }
        }
    } catch (error) {
        report.error = error.stack || error.message;
    } finally {
        report.finishedAt = new Date().toISOString();
        try { report.sourceChanged = report.sourceHash !== fingerprint(); }
        catch (error) { report.sourceChanged = true; report.error ||= error.message; }
        report.automatedGatePassed = !report.error && gatePassed(report);
        const failed = report.error || report.sourceChanged || report.stages.some(stage => stage.status !== 'passed');
        report.status = failed ? 'failed' : offline ? 'partial' : report.automatedGatePassed ? 'passed' : 'failed';
        for (const stage of report.stages) {
            if (stage.output !== undefined) {
                fs.writeFileSync(path.join(directory, `${stage.name}.log`), stage.output);
                delete stage.output;
            }
        }
        fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        const markdown = [
            '# Release Test', '', `Status: **${report.status.toUpperCase()}**. Version: ${report.version}. Scope: ${report.scope}.`,
            `Source SHA-256: ${report.sourceHash}. Commit: ${report.commit || 'unavailable'}.`, '',
            '| Stage | Result | Duration |', '| --- | --- | --- |',
            ...report.stages.map(stage => `| ${stage.name} | ${stage.status} | ${stage.durationMs ?? 0} ms |`), '',
            `Offline tests: ${report.stages.find(stage => stage.summary)?.summary.pass ?? 0} passed.`,
            ...(report.browserSummary ? [`Browser: ${report.browserSummary.product}. Feature scenarios: ${report.browserSummary.featureScenarios}. Locale layouts: ${report.browserSummary.localeLayouts} (${report.browserSummary.settingRows} setting rows).`] : []), '',
            ...report.stages.filter(stage => stage.error).map(stage => `${stage.name}: ${stage.error}`), '',
            '## Limits', ...report.limitations.map(text => `- ${text}`), '',
            ...(report.error ? [`Error: ${report.error}`, ''] : []),
            ...(report.sourceChanged ? ['Source files changed during this run; rerun the gate.', ''] : [])
        ].join('\n');
        fs.writeFileSync(path.join(directory, 'report.md'), markdown);
        console.log(`\nRelease test: ${report.status.toUpperCase()} (${report.scope})\nReport: ${path.join(directory, 'report.json')}`);
        if (offline) console.log('Offline checks alone do NOT pass the release gate. Run npm run test:release before packaging.');
        if (report.status === 'failed') process.exitCode = 1;
    }
    return report;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { findBrowser, parseTestSummary, validTestSummary, fingerprint, runStage, gatePassed };
