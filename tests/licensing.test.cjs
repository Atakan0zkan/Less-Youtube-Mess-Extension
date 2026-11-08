// SPDX-FileCopyrightText: 2026 Atakan Özkan
// SPDX-License-Identifier: AGPL-3.0-only
// See COPYRIGHT and LICENSE in the project root.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { root, source } = require('./helpers/runtime.cjs');
const { runtimeEntries, runtimeFiles } = require('./helpers/release-files.cjs');
const { testFiles } = require('./check.cjs');

const identifier = 'AGPL-3.0-only';
const repository = 'https://github.com/Atakan0zkan/Less-Youtube-Mess-Extension';

test('licensing: complete AGPL text matches the official GNU license', () => {
    // SHA-256 of https://www.gnu.org/licenses/agpl-3.0.txt, normalized to LF.
    const license = source('LICENSE').replaceAll('\r\n', '\n');
    assert.equal(createHash('sha256').update(license).digest('hex'),
        '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0');
});

test('licensing: package metadata and documentation consistently select AGPL version 3 only', () => {
    const manifest = JSON.parse(source('manifest.json'));
    const metadata = JSON.parse(source('package.json'));
    const lock = JSON.parse(source('package-lock.json'));
    assert.equal(metadata.license, identifier);
    assert.equal(lock.packages[''].license, identifier);
    assert.equal(metadata.version, manifest.version);
    assert.equal(lock.packages[''].version, manifest.version);
    assert.ok(source('README.md').includes(identifier));
    assert.doesNotMatch(source('README.md'), /^MIT\s*$/m);
});

test('licensing: distributions include the license, author notice and source instructions', () => {
    const files = runtimeFiles(root);
    const batch = source('package.bat');
    for (const file of ['LICENSE', 'COPYRIGHT']) {
        assert.ok(runtimeEntries.includes(file), `Missing release entry: ${file}`);
        assert.ok(files.includes(file), `Missing release file: ${file}`);
        assert.ok(batch.includes(`'${file}'`), `Missing ZIP input: ${file}`);
    }
    const notice = source('COPYRIGHT');
    assert.ok(notice.includes('Copyright (C) 2026 Atakan Özkan'));
    assert.ok(notice.includes(`SPDX-License-Identifier: ${identifier}`));
    assert.ok(notice.includes('WITHOUT\nANY WARRANTY'));
    assert.ok(notice.includes(repository));
    assert.ok(notice.includes('No build step is required.'));
    assert.ok(notice.includes('chrome://extensions'));
});

test('licensing: project source files retain author and AGPL notices', () => {
    const files = new Set([
        ...runtimeFiles(root).filter(file => /\.(js|css|html)$/.test(file)),
        ...testFiles().map(file => path.relative(root, file)),
        'package.bat', '.github/workflows/daily-test.yml', '.github/workflows/keepalive.yml'
    ]);
    for (const file of files) {
        const header = source(file).slice(0, 400);
        assert.ok(header.includes('SPDX-FileCopyrightText: 2026 Atakan Özkan'), file);
        assert.ok(header.includes(`SPDX-License-Identifier: ${identifier}`), file);
        assert.ok(header.includes('See COPYRIGHT and LICENSE in the project root.'), file);
    }
});
