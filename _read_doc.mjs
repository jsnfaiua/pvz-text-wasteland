import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const docDir = join(process.cwd(), 'docs', '统一开发文档');
const files = readdirSync(docDir);
console.log('文件列表:', files);

const docFile = join(docDir, files[0]);
const content = readFileSync(docFile, 'utf-8');
const lines = content.split('\n');
console.log('前 50 行:');
console.log(lines.slice(0, 50).join('\n'));
