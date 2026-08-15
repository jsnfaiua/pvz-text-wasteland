// ============================================================
// PvZ Text Edition - Node 静态服务器
// 优势：绑定 0.0.0.0 无需管理员权限 / URL ACL，局域网联机更可靠
// 用法：node server.js   （RUN.bat 会自动优先使用本脚本）
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 8000;
const USERS_FILE = path.join(ROOT, 'users.json');
const SAVES_DIR = path.join(ROOT, 'saves');
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_ROOT_FILES = new Set(['index.html', 'style.css', 'game-init.js', 'net.js']);
const PUBLIC_DIRS = new Set(['assets', 'source-code']);
if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });
function saveFile(u) { return path.join(SAVES_DIR, String(u).replace(/[^\w一-龥-]/g, '_') + '.json'); }

// ---------- 账户存储（服务器侧，跨电脑通用）----------
function readUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) || {}; } catch { return {}; }
}
function writeUsers(u) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
}
function validName(u) { return typeof u === 'string' && /^[A-Za-z0-9_一-龥]{2,12}$/.test(u); }
function validPass(p) { return typeof p === 'string' && p.length >= 4 && p.length <= 32; }
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}
function safeEqual(a, b) {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function passwordMatches(rec, password) {
    if (!rec || typeof password !== 'string') return false;
    const actual = rec.algo === 'scrypt'
        ? hashPassword(password, rec.salt)
        : crypto.createHash('sha256').update(rec.salt + password, 'utf8').digest('hex');
    return safeEqual(actual, rec.hash);
}
function issueToken(username, rec) {
    const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
    const sig = crypto.createHmac('sha256', rec.hash).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}
function authorize(req, username) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const rec = readUsers()[username];
        if (!rec || claims.u !== username || !Number.isFinite(claims.exp) || claims.exp < Date.now()) return false;
        const expected = crypto.createHmac('sha256', rec.hash).update(payload).digest('base64url');
        return safeEqual(signature, expected);
    } catch {
        return false;
    }
}

function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        let done = false;
        const settle = (value) => { if (!done) { done = true; resolve(value); } };
        req.on('data', (c) => {
            data += c;
            if (data.length > 512 * 1024) { req.destroy(); settle({}); }
        });
        req.on('end', () => { try { settle(JSON.parse(data || '{}')); } catch { settle({}); } });
        req.on('error', () => settle({}));
        req.on('close', () => settle({}));
    });
}
function sendJson(res, obj, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}

async function handleApi(req, res, p) {
    if (p === '/api/accounts' && req.method === 'GET') {
        sendJson(res, { ok: true, accounts: Object.keys(readUsers()) });
        return true;
    }
    if (p === '/api/register' && req.method === 'POST') {
        const { username, password } = await readBody(req);
        if (!validName(username)) return sendJson(res, { ok: false, error: '用户名需 2-12 位（中英文/数字/下划线）' }), true;
        if (!validPass(password)) return sendJson(res, { ok: false, error: '密码需 4-32 位' }), true;
        const users = readUsers();
        if (users[username]) return sendJson(res, { ok: false, error: '该用户名已存在' }), true;
        const salt = crypto.randomBytes(16).toString('hex');
        users[username] = { algo: 'scrypt', salt, hash: hashPassword(password, salt), created: Date.now() };
        writeUsers(users);
        sendJson(res, { ok: true, user: { username } });
        return true;
    }
    if (p === '/api/login' && req.method === 'POST') {
        const { username, password } = await readBody(req);
        const users = readUsers();
        let rec = users[username];
        if (!rec) return sendJson(res, { ok: false, error: '用户不存在' }), true;
        if (!passwordMatches(rec, password || '')) return sendJson(res, { ok: false, error: '密码错误' }), true;
        // 兼容旧存档：首次成功登录后把快速 SHA-256 哈希升级为 scrypt。
        if (rec.algo !== 'scrypt') {
            const salt = crypto.randomBytes(16).toString('hex');
            rec = { ...rec, algo: 'scrypt', salt, hash: hashPassword(password, salt) };
            users[username] = rec;
            writeUsers(users);
        }
        sendJson(res, { ok: true, user: { username }, token: issueToken(username, rec) });
        return true;
    }
    // 存档同步：按用户名存 saves/用户名.json
    if (p === '/api/save/pull' && req.method === 'GET') {
        const u = new URL(req.url, 'http://localhost').searchParams.get('u') || '';
        if (!validName(u)) { sendJson(res, { ok: false, error: 'bad user' }); return true; }
        if (!authorize(req, u)) { sendJson(res, { ok: false, error: 'unauthorized' }, 401); return true; }
        try {
            const data = JSON.parse(fs.readFileSync(saveFile(u), 'utf8'));
            sendJson(res, { ok: true, data: data.data || {}, at: data.at || 0 });
        } catch {
            sendJson(res, { ok: true, data: {}, at: 0 });
        }
        return true;
    }
    if (p === '/api/save/push' && req.method === 'POST') {
        const { username, data } = await readBody(req);
        if (!validName(username)) { sendJson(res, { ok: false, error: 'bad user' }); return true; }
        if (!authorize(req, username)) { sendJson(res, { ok: false, error: 'unauthorized' }, 401); return true; }
        fs.writeFileSync(saveFile(username), JSON.stringify({ data: data || {}, at: Date.now() }));
        sendJson(res, { ok: true });
        return true;
    }
    return false;
}

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon', '.txt': 'text/plain', '.mp3': 'audio/mpeg',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function lanIP() {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const it of ifs[name]) {
            if (it.family === 'IPv4' && !it.internal && !it.address.startsWith('169.254.')) return it.address;
        }
    }
    return null;
}

const ip = lanIP();

const httpServer = http.createServer(async (req, res) => {
    let p;
    try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); res.end(); return; }

    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }

    // 账户 API（跨电脑通用）
    if (p.startsWith('/api/')) {
        if (await handleApi(req, res, p)) return;
        res.writeHead(404); res.end();
        return;
    }

    // 局域网 IP 端点：前端建房时用它生成好友可访问的邀请链接
    if (p === '/__localip') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(ip || '');
        return;
    }

    if (p === '/') p = '/index.html';
    const file = path.resolve(ROOT, '.' + p);
    const relative = path.relative(ROOT, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return; }
    const parts = relative.split(path.sep);
    const isPublic = parts.length === 1 ? PUBLIC_ROOT_FILES.has(parts[0]) : PUBLIC_DIRS.has(parts[0]);
    if (!isPublic) { res.writeHead(404); res.end(); return; }

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found: ' + p);
            return;
        }
        // v3.79 开发期禁用缓存：修复"改了代码但浏览器一直跑旧版"（ESM/HTML 都被缓存）。
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
        });
        res.end(data);
    });
});
httpServer.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
        console.log('');
        console.log('⚠️  端口 ' + PORT + ' 已被占用——似乎已有一个游戏服务器在运行？');
        console.log('    · 无需重复启动：直接用浏览器打开 http://localhost:' + PORT + ' 即可');
        console.log('    · 若需重启：先关闭旧服务器进程（任务管理器找 node.exe / 或关掉之前的窗口）');
        console.log('    · 也可换端口启动：PORT=8080 node server.js');
        console.log('');
        process.exit(1);
    }
    throw e;
});
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('========================================');
    console.log('  SERVER RUNNING (Node)');
    console.log('  Play at:  http://localhost:' + PORT);
    if (ip) {
        console.log('  LAN play: http://' + ip + ':' + PORT + '  <- send this to friends');
    }
    console.log('========================================');
    console.log('');
});

// ---------- 本地 PeerServer（联机房间中继；本机双开/局域网更稳，不依赖公共云）----------
// 客户端 net.js 在 localhost 下自动连 127.0.0.1:9000/peerjs，LAN IP 访问时回退公共云
// 端口冲突（EADDRINUSE）优雅降级：不崩溃、静态服务器继续服务，联机回退公共云
try {
    const { PeerServer } = require('peer');
    const PEER_PORT = process.env.PEER_PORT ? Number(process.env.PEER_PORT) : 9000;
    const peerServer = PeerServer({
        port: PEER_PORT,
        path: '/peerjs',
        allow_discovery: true,
    });
    peerServer.on('error', (e) => {
        if (e && e.code === 'EADDRINUSE') {
            console.log('  ⚠️  PeerServer :' + PEER_PORT + ' 已被占用（可能是旧服务器进程）——');
            console.log('     本机游戏服务器继续运行，联机将回退公共云（可正常使用，仅连接稍慢）');
        } else {
            console.log('  PeerServer 错误:', e && e.message || e);
        }
    });
    peerServer.on('connection', (id) => {
        console.log('[peer] 连接:', String(id).slice(0, 30));
    });
    peerServer.on('disconnect', (id) => {
        console.log('[peer] 断开:', String(id).slice(0, 30));
    });
    peerServer.on('message', (client, msg) => {
        console.log('[peer] 消息:', msg && msg.type, 'dst=' + String(msg && msg.dst).slice(0, 30), 'src=' + String(msg && msg.src).slice(0, 20));
    });
    console.log('  PeerServer (联机中继): http://127.0.0.1:' + PEER_PORT + '/peerjs');
    if (ip) {
        console.log('  LAN peer relay: http://' + ip + ':' + PEER_PORT + '/peerjs');
        console.log('  ⚠️  好友连不上房间时：请确认 Windows 防火墙已放行 ' + PORT + '/' + PEER_PORT + ' 端口入站，');
        console.log('      并让好友用上面的 LAN play 地址（http://' + ip + ':' + PORT + '）访问，不要用 localhost。');
    }
} catch (e) {
    console.log('  PeerServer 未启动（联机回退公共云）:', e.message);
}
