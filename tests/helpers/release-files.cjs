// SPDX-FileCopyrightText: 2026 Atakan Özkan
// SPDX-License-Identifier: AGPL-3.0-only
// See COPYRIGHT and LICENSE in the project root.

const fs = require('node:fs');
const path = require('node:path');

const runtimeEntries = Object.freeze([
    'manifest.json', 'content.js', 'styles.css', 'page-audio-bridge.js',
    'popup.html', 'popup.js', 'popup.css', 'shared', 'icons', '_locales',
    'LICENSE', 'COPYRIGHT'
]);

function runtimeFiles(root) {
    const files = [];
    function visit(relative) {
        const fullPath = path.join(root, relative);
        const stat = fs.lstatSync(fullPath);
        if (stat.isSymbolicLink()) throw new Error(`Runtime symlink is not allowed: ${relative}`);
        if (stat.isDirectory()) {
            for (const child of fs.readdirSync(fullPath).sort()) visit(`${relative}/${child}`);
        } else if (stat.isFile()) files.push(relative);
        else throw new Error(`Unsupported runtime entry: ${relative}`);
    }
    for (const entry of runtimeEntries) visit(entry);
    return files.sort();
}

module.exports = { runtimeEntries, runtimeFiles };
