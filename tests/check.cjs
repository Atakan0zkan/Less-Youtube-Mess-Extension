const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { runtimeFiles } = require('./helpers/release-files.cjs');

const root = path.resolve(__dirname, '..');
function testFiles(directory = __dirname) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? testFiles(file) : file.endsWith('.cjs') ? [file] : [];
    });
}

function check() {
    const files = [...runtimeFiles(root).filter(file => file.endsWith('.js')).map(file => path.join(root, file)), ...testFiles()];
    for (const file of files) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    for (const file of ['manifest.json', 'package.json', 'package-lock.json']) JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    execFileSync('git', ['diff', '--check'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['diff', '--cached', '--check'], { cwd: root, stdio: 'pipe' });
    console.log(`PASS: syntax (${files.length} JavaScript files), JSON and staged/unstaged whitespace`);
}

if (require.main === module) {
    try { check(); } catch (error) { console.error(error.stderr?.toString() || error.stack); process.exitCode = 1; }
}
module.exports = { testFiles };
