// 临时静态服务器: 服务 dev-tools/_qa_tmp 目录(参考图画廊用)
// 用法: node dev-tools/_serve-qa.mjs [端口]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '_qa_tmp');
const PORT = Number(process.argv[2] || 8123);
const MIME = { '.html':'text/html; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.svg':'image/svg+xml', '.css':'text/css', '.js':'text/javascript' };

const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/gallery.html';
    const fp = path.normalize(path.join(ROOT, urlPath));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
});
server.listen(PORT, () => {
    console.log(`QA 画廊服务已启动: http://localhost:${PORT}/gallery.html`);
});
