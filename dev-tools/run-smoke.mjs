// Wrapper to run smoke test and capture output
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projRoot = resolve(__dirname, '..');

try {
    const result = execSync('node dev-tools/smoke-test.js', {
        cwd: projRoot,
        encoding: 'utf8',
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    writeFileSync(resolve(__dirname, 'smoke-output.txt'), result || '(no stdout)', 'utf8');
    console.log('Done. Output in smoke-output.txt');
} catch (e) {
    const output = (e.stdout || '') + '\n' + (e.stderr || '');
    writeFileSync(resolve(__dirname, 'smoke-output.txt'), output, 'utf8');
    console.log('Done (with errors). Output in smoke-output.txt');
}
