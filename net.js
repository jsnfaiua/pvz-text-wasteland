// ============================================================
// net.js — 账户 & 联机就绪层
//   目的：
//     1. 提供本地账户系统（注册/登录/登出/会话）
//     2. 把游戏所有 localStorage key 命名空间化到当前用户下
//     3. 预留 cloud pull/push 接口，未来把 _transport 换成 fetch 到
//        真实后端即可无缝联机，无需改上层代码
// ============================================================
(function (global) {
    'use strict';

    // 全局关闭联机的开关：为兼容旧代码保留
    global.__NET_ENABLED__ = false;

    // ---------- 存储键 ----------
    const USERS_KEY   = 'pvz_txt_users_v1';     // { user_name: { salt, hash, created } }
    const SESSION_KEY = 'pvz_txt_session_v1';   // { username, token, since }

    // ---------- 工具 ----------
    function safeParse(raw, def) {
        try { return JSON.parse(raw) || def; } catch { return def; }
    }
    function readUsers()   { return safeParse(localStorage.getItem(USERS_KEY),   {}); }
    function writeUsers(o) { localStorage.setItem(USERS_KEY, JSON.stringify(o)); }
    function readSession() { return safeParse(localStorage.getItem(SESSION_KEY), null); }
    function writeSession(s) {
        if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        else   localStorage.removeItem(SESSION_KEY);
    }
    function randHex(bytes) {
        const a = new Uint8Array(bytes);
        crypto.getRandomValues(a);
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }
    async function sha256(str) {
        // 安全上下文（localhost / https）用原生实现
        if (window.isSecureContext && crypto.subtle) {
            const buf = new TextEncoder().encode(str);
            const hash = await crypto.subtle.digest('SHA-256', buf);
            return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
        }
        // 降级：好友通过 http://局域网IP 访问时页面是非安全上下文，crypto.subtle 不可用
        return sha256Fallback(str);
    }
    // 纯 JS SHA-256（与原生结果一致，public domain 实现）
    function sha256Fallback(input) {
        function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
        var mathPow = Math.pow, maxWord = mathPow(2, 32), i, j, result = '';
        var words = [], ascii = unescape(encodeURIComponent(input)), asciiBitLength = ascii.length * 8;
        var hash = sha256Fallback.h = sha256Fallback.h || [], k = sha256Fallback.k = sha256Fallback.k || [];
        var primeCounter = k.length, isComposite = {};
        for (var candidate = 2; primeCounter < 64; candidate++) {
            if (!isComposite[candidate]) {
                for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
                hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
                k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
            }
        }
        ascii += '\x80';
        while (ascii.length % 64 - 56) ascii += '\x00';
        for (i = 0; i < ascii.length; i++) {
            j = ascii.charCodeAt(i);
            words[i >> 2] |= j << ((3 - i) % 4) * 8;
        }
        words[words.length] = (asciiBitLength / maxWord) | 0;
        words[words.length] = asciiBitLength;
        for (j = 0; j < words.length;) {
            var w = words.slice(j, j += 16), oldHash = hash;
            hash = hash.slice(0, 8);
            for (i = 0; i < 64; i++) {
                var w15 = w[i - 15], w2 = w[i - 2];
                var a = hash[0], e = hash[4];
                var temp1 = hash[7]
                    + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
                    + ((e & hash[5]) ^ ((~e) & hash[6]))
                    + k[i]
                    + (w[i] = (i < 16) ? w[i] : (
                        w[i - 16]
                        + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
                        + w[i - 7]
                        + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
                    ) | 0);
                var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
                    + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
                hash = [(temp1 + temp2) | 0].concat(hash);
                hash[4] = (hash[4] + temp1) | 0;
            }
            for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
        }
        for (i = 0; i < 8; i++) {
            for (j = 3; j + 1; j--) {
                var b = (hash[i] >> (j * 8)) & 255;
                result += ((b < 16) ? 0 : '') + b.toString(16);
            }
        }
        return result;
    }
    function validName(u) {
        return typeof u === 'string'
            && /^[A-Za-z0-9_\u4e00-\u9fa5]{2,12}$/.test(u);
    }
    function validPass(p) {
        return typeof p === 'string' && p.length >= 4 && p.length <= 32;
    }

    // ---------- 会话状态（内存镜像）----------
    let _session = readSession();

    // ---------- 服务器账户 API（跨电脑通用；服务器无此 API 时回退本地）----------
    async function serverApi(path, body) {
        const headers = {};
        if (body) headers['Content-Type'] = 'application/json';
        if (_session && _session.token) headers.Authorization = 'Bearer ' + _session.token;
        const r = await fetch(path, {
            method: body ? 'POST' : 'GET',
            headers: Object.keys(headers).length ? headers : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        if (r.status === 401) {
            // 会话令牌失效/过期：清除无效会话，下次操作需重新登录
            if (_session) {
                _session = null;
                localStorage.removeItem(SESSION_KEY);
            }
            throw new Error('http 401');
        }
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
    }

    // ---------- Auth API ----------
    const auth = {
        // 当前会话（同步）；未登录返回 null
        current() { return _session; },

        // 是否已登录
        isLoggedIn() { return !!_session; },

        // 列出所有本地账户名（便于登录页下拉）
        listAccounts() { return Object.keys(readUsers()); },

        // 拉取服务器账户列表（跨电脑）；服务器无 API 返回 []
        async fetchServerAccounts() {
            try {
                const res = await serverApi('/api/accounts');
                return (res && res.accounts) || [];
            } catch { return []; }
        },

        // 注册：成功返回 { ok:true, user }，失败返回 { ok:false, error }
        async register(username, password) {
            username = (username || '').trim();
            if (!validName(username)) {
                return { ok: false, error: '用户名需 2-12 位（中英文/数字/下划线）' };
            }
            if (!validPass(password)) {
                return { ok: false, error: '密码需 4-32 位' };
            }
            // 优先服务器注册（账号存主机，任何电脑可登录）
            try {
                const res = await serverApi('/api/register', { username, password });
                if (res.ok) {
                    // 本地镜像一份，离线时仍可登录
                    const users = readUsers();
                    if (!users[username]) {
                        const salt = randHex(8);
                        users[username] = { salt, hash: await sha256(salt + password), created: Date.now() };
                        writeUsers(users);
                    }
                }
                return res;
            } catch { /* 服务器无账户 API，回退本地 */ }
            const users = readUsers();
            if (users[username]) {
                return { ok: false, error: '该用户名已存在' };
            }
            const salt = randHex(8);
            const hash = await sha256(salt + password);
            users[username] = { salt, hash, created: Date.now() };
            writeUsers(users);
            return { ok: true, user: { username } };
        },

        // 登录：成功建立会话
        async login(username, password) {
            username = (username || '').trim();
            // 优先服务器验证（账号跨电脑通用）
            try {
                const res = await serverApi('/api/login', { username, password });
                if (res.ok) {
                    _session = { username, token: res.token, since: Date.now(), server: true };
                    writeSession(_session);
                    return { ok: true, user: { username } };
                }
                return res; // 用户不存在 / 密码错误
            } catch { /* 服务器无账户 API，回退本地 */ }
            const users = readUsers();
            const rec = users[username];
            if (!rec) return { ok: false, error: '用户不存在' };
            const hash = await sha256(rec.salt + (password || ''));
            if (hash !== rec.hash) return { ok: false, error: '密码错误' };
            _session = { username, token: randHex(16), since: Date.now() };
            writeSession(_session);
            return { ok: true, user: { username } };
        },

        // 登出
        logout() {
            _session = null;
            writeSession(null);
        },

        // 删除账户（连同该账户下所有游戏数据）
        deleteAccount(username, password) {
            return (async () => {
                const users = readUsers();
                const rec = users[username];
                if (!rec) return { ok: false, error: '用户不存在' };
                const hash = await sha256(rec.salt + (password || ''));
                if (hash !== rec.hash) return { ok: false, error: '密码错误' };
                // 清掉该用户所有命名空间下的存档
                const prefix = `u:${username}:`;
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(prefix)) localStorage.removeItem(k);
                }
                delete users[username];
                writeUsers(users);
                if (_session && _session.username === username) auth.logout();
                return { ok: true };
            })();
        },
    };

    // ---------- 存储命名空间 ----------
    // 让游戏侧的存档 key 自动挂到当前用户名下；未登录时用 guest 空间
    function storeKey(baseKey) {
        const u = _session ? _session.username : '__guest__';
        return `u:${u}:${baseKey}`;
    }

    // ---------- Cloud：服务器存档同步（跨电脑）；服务器不可用时仅本地 ----------
    function snapshotUserKeys(username) {
        const prefix = `u:${username}:`;
        const snap = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) snap[k.slice(prefix.length)] = localStorage.getItem(k);
        }
        return snap;
    }
    const cloud = {
        _pushTimer: null,
        // 拉取服务器存档（登录后调用，覆盖本地对应命名空间）
        async pull() {
            if (!_session) return { ok: false, error: '未登录' };
            try {
                const res = await serverApi('/api/save/pull?u=' + encodeURIComponent(_session.username));
                return { ok: true, data: (res && res.data) || {}, at: (res && res.at) || 0 };
            } catch {
                return { ok: true, data: snapshotUserKeys(_session.username), at: Date.now(), local: true };
            }
        },
        // 推送指定快照到服务器
        async push(snap) {
            if (!_session) return { ok: false, error: '未登录' };
            try {
                await serverApi('/api/save/push', { username: _session.username, data: snap });
                return { ok: true, at: Date.now() };
            } catch {
                return { ok: false, error: '服务器不可用，仅保存在本地' };
            }
        },
        // 防抖全量推送（每次写存档自动调用）
        pushAllDebounced(ms = 2000) {
            if (!_session) return;
            const username = _session.username;
            clearTimeout(this._pushTimer);
            this._pushTimer = setTimeout(() => {
                // 防抖窗口内可能已登出/切换账户：快照 username 并校验，避免引用已清空的 _session
                if (!_session || _session.username !== username) return;
                const snap = snapshotUserKeys(username);
                serverApi('/api/save/push', { username, data: snap }).catch(() => {});
            }, ms);
        },
    };

    // ---------- 多人联机（PeerJS）----------
    // 房主开一个 PeerJS 节点，拿到 peer.id 就是"房间码"；
    // 客人用房间码作为目标 id 直连房主。数据全部走 P2P。
    const mp = {
        MAX_PLAYERS: 4,      // 默认房间容量（1 房主 + 3 客人，荒原多人）；本体联机建房前可置 2（dave2 单客人槽）
        maxPlayers: 4,       // 当前会话生效容量（host() 时锁定，close() 恢复默认）
        role: null,          // 'host' | 'guest' | null
        roomCode: null,      // 6 位大写房间码（简化）
        peer: null,          // Peer 实例
        conn: null,          // DataConnection（客人：与房主的唯一连接）
        conns: null,         // Map<connPeer, DataConnection>（房主：多客人连接，3+ 人房间层）
        status: 'idle',      // 'idle' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error'
        error: null,
        _handlers: {},       // topic → [fn]
        _manualClose: false, // close() 主动关闭：不触发自动重连
        _reconnTimer: null,  // 客人断线自动重连定时器
        _reconnAttempts: 0,  // 已重试次数

        on(topic, fn) {
            (this._handlers[topic] = this._handlers[topic] || []).push(fn);
        },
        off(topic, fn) {
            const arr = this._handlers[topic];
            if (!arr) return;
            const i = arr.indexOf(fn);
            if (i >= 0) arr.splice(i, 1);
        },
        _emit(topic, payload, meta) {
            (this._handlers[topic] || []).forEach(fn => {
                try { fn(payload, meta); } catch (e) { console.error(e); }
            });
        },

        // 6 位大写房间码（避免歧义字符 0/O/1/I）
        _genCode() {
            const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let s = '';
            for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
            return s;
        },
        // PeerJS 的 id 必须唯一。用固定前缀 + 房间码
        _peerId(code) { return 'pvztext-' + code; },

        // Peer 连接配置：
        // - localhost / 裸 IPv4（局域网或公网 IP 直连）→ 连本机 server.js 内置的本地 PeerServer
        //   （监听 0.0.0.0:9000，同一局域网可达；不依赖外网，稳定且快）
        // - 域名（云部署等）→ PeerJS 公共云回退
        _peerOpts() {
            const h = location.hostname || '';
            // 裸 IPv4（127.0.0.1 / 192.168.x.x / 10.x.x.x / 172.16-31.x.x / 公网 IP）也走本地 PeerServer
            const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(h);
            const isLocal = h === 'localhost' || h === '0.0.0.0' || isIp;
            const common = {
                debug: 1,
                config: {
                    iceServers: [
                        // 国内可达 STUN 优先（Google STUN 在大陆网络常不通 → 公共云 P2P 打洞失败）
                        { urls: 'stun:stun.qq.com:3478' },
                        { urls: 'stun:stun.miwifi.com:3478' },
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                    ],
                },
            };
            return isLocal
                ? Object.assign(common, { host: h, port: 9000, path: '/peerjs', secure: false })
                : common;
        },

        // 房主：创建房间
        async host() {
            if (typeof window.Peer !== 'function') {
                return { ok: false, error: 'PeerJS 未加载（检查网络）' };
            }
            const cap = Math.min(Math.max(2, this.MAX_PLAYERS | 0), 4);   // 先取容量：close() 会把 MAX_PLAYERS 恢复默认
            this.close(true);
            this._manualClose = false;   // 复位：本次会话内的意外断线应触发自动重连
            this.role = 'host';
            this.status = 'connecting';
            this.maxPlayers = cap;   // 建房时锁定容量
            const code = this._genCode();
            this.roomCode = code;
            const peer = new Peer(this._peerId(code), this._peerOpts());
            this.peer = peer;
            return new Promise((resolve) => {
                let resolved = false;
                peer.on('open', () => {
                    this.status = 'waiting';
                    this._emit('status', { status: 'waiting', code });
                    if (!resolved) { resolved = true; resolve({ ok: true, code }); }
                });
                peer.on('connection', (conn) => {
                    // 3+ 人房间层：房主维护多客人连接（conns Map）；旧单 conn 逻辑保留在 guest 侧
                    if (!this.conns) this.conns = new Map();
                    // 满员拒绝：先告知原因再关连接（guest 据此停止重连，避免死循环敲门）
                    // 同 peerId 的旧连接仍在：视为重连替换，先放行不占新名额（防满员检查误拒重连）
                    const oldConn = this.conns.get(conn.peer);
                    const isReplace = !!(oldConn && oldConn !== conn && oldConn.open);
                    let openCount = 0;
                    for (const c of this.conns.values()) if (c.open) openCount++;
                    if (openCount >= this.maxPlayers - 1 && !isReplace) {
                        const reject = () => { try { conn.close(); } catch {} };
                        conn.on('open', () => {
                            try { conn.send({ t: '__reject', d: { reason: 'full' } }); } catch {}
                            setTimeout(reject, 300);
                        });
                        setTimeout(reject, 2000);   // 兜底：open 一直不触发也强制关
                        this._emit('status', { status: 'full' });
                        return;
                    }
                    // 客人重连（同 peer id）替换旧连接；新客人直接加入
                    this.conns.set(conn.peer, conn);
                    if (oldConn && oldConn !== conn) { try { oldConn.close(); } catch {} }   // 旧连接退役（其 close 回调有守卫，不会误删新连接）
                    this._bindConn(conn);
                });
                peer.on('error', (err) => {
                    this.status = 'error';
                    this.error = String(err && err.type || err);
                    this._emit('status', { status: 'error', error: this.error });
                    if (!resolved) { resolved = true; resolve({ ok: false, error: this.error }); }
                });
            });
        },

        // 客人：加入房间
        async join(code) {
            if (typeof window.Peer !== 'function') {
                return { ok: false, error: 'PeerJS 未加载（检查网络）' };
            }
            code = String(code || '').toUpperCase().trim();
            if (!/^[A-Z0-9]{6}$/.test(code)) {
                return { ok: false, error: '房间码格式：6 位字母数字' };
            }
            // 已连接同一房间：直接返回成功，不重复连接（避免误报"连接已断开"）
            if (this.status === 'connected' && this.roomCode === code) {
                return { ok: true, code, already: true };
            }
            this.close(true);
            this._manualClose = false;   // 复位：本次会话内的意外断线应触发自动重连
            this.role = 'guest';
            this.status = 'connecting';
            this.roomCode = code;
            // 客人也需要一个 peer 节点才能发起 connect
            const peer = new Peer(undefined, this._peerOpts());
            this.peer = peer;
            return new Promise((resolve) => {
                let resolved = false;
                peer.on('open', () => {
                    const conn = peer.connect(this._peerId(code), { reliable: true });
                    this.conn = conn;
                    this._bindConn(conn);
                    conn.on('open', () => {
                        if (!resolved) { resolved = true; resolve({ ok: true, code }); }
                    });
                });
                peer.on('error', (err) => {
                    this.status = 'error';
                    this.error = String(err && err.type || err);
                    this._emit('status', { status: 'error', error: this.error });
                    if (!resolved) { resolved = true; resolve({ ok: false, error: this.error }); }
                });
                // 兜底：超时
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        resolve({ ok: false, error: '连接超时（房主未开房或房间码错误）' });
                    }
                }, 12000);
            });
        },

        _bindConn(conn) {
            conn.on('open', () => {
                // 房主侧：客人连入（含重连）→ 房间就绪；客人侧：自己的连接打开
                // meta.conn：房主据此定位新连入的客人（中途加入单发握手用）
                this.status = 'connected';
                this._emit('status', { status: 'connected', conn });
            });
            conn.on('data', (msg) => {
                if (msg && typeof msg === 'object' && msg.t) {
                    // 房主满员拒连：客人收到后立即放弃（停止重连），不进入自动重连死循环
                    if (msg.t === '__reject' && this.role === 'guest') {
                        this._manualClose = true;
                        if (this._reconnTimer) { clearTimeout(this._reconnTimer); this._reconnTimer = null; }
                        this._reconnAttempts = 0;
                        this.status = 'error';
                        this.error = '房间已满员';
                        this._emit('status', { status: 'error', error: '房间已满员', rejected: true });
                        try { conn.close(); } catch {}
                        return;
                    }
                    // meta.conn：房主端据此区分消息来自哪个客人（3+ 人协议层用）
                    this._emit(msg.t, msg.d, { conn });
                    this._emit('*', msg, { conn });
                } else if (msg instanceof ArrayBuffer || (msg && typeof msg.byteLength === 'number' && !msg.t)) {
                    // 裸二进制帧兜底：协议中仅 wpos 为二进制话题（旧客户端/直发二进制不丢失）
                    this._emit('wpos', msg, { conn });
                }
            });
            conn.on('close', () => {
                // 房主多连接：按 conn 从 conns 移除（只删自己，防重连替换后旧 close 误删新连接）
                if (this.role === 'host') {
                    // 只删自己，防重连替换后旧 close 误删新连接；被替换的旧连接不报 peer-left
                    if (this.conns && this.conns.get(conn.peer) === conn) {
                        this.conns.delete(conn.peer);
                        this._emit('peer-left', { peer: conn.peer });   // 客人离开（协议层延迟清理队友槽，给重连窗口）
                    }
                    let anyOpen = false;
                    if (this.conns) for (const c of this.conns.values()) if (c.open) { anyOpen = true; break; }
                    // 还有其他客人在：静默；全部掉线：回 waiting 等重连（已在等待则不重复播报）
                    if (!anyOpen && !this._manualClose && this.peer && !this.peer.destroyed && this.status !== 'waiting') {
                        this.status = 'waiting';
                        this._emit('status', { status: 'guest-disconnected' });
                    }
                    return;
                }
                // 只响应"当前连接"的断开；被 close() 主动销毁的旧连接不报
                if (this.conn !== conn) return;
                // 客人意外断线（非主动关闭）：自动重连，最多 8 次指数退避（约 38s 窗口）
                if (this.role === 'guest' && !this._manualClose && this.roomCode) {
                    this._scheduleReconnect();
                    return;
                }
                this.status = 'idle';
                this._emit('status', { status: 'closed' });
            });
            conn.on('error', (err) => {
                if (this.conn !== conn && !(this.role === 'host' && this.conns && this.conns.has(conn.peer))) return;
                this.status = 'error';
                this.error = String(err && err.type || err);
                this._emit('status', { status: 'error', error: this.error });
            });
        },

        // ---------- 断线重连（客人侧） ----------
        // peer 节点保持存活，只重建到房主固定 peerId 的 DataConnection；
        // 成功后 _reconnected 标记随 'connected' 状态下发，游戏层据此请求状态重同步。
        _scheduleReconnect() {
            if (this._reconnTimer || this._manualClose) return;
            if (this._reconnAttempts >= 8) {
                this._reconnAttempts = 0;
                this.status = 'idle';
                this._emit('status', { status: 'closed', reason: 'reconnect-failed' });
                return;
            }
            this.status = 'reconnecting';
            const delay = Math.min(800 * Math.pow(1.6, this._reconnAttempts), 6000);
            this._emit('status', { status: 'reconnecting', attempt: this._reconnAttempts + 1 });
            this._reconnTimer = setTimeout(() => {
                this._reconnTimer = null;
                if (this._manualClose || this.role !== 'guest' || !this.roomCode) return;
                this._reconnAttempts++;
                try {
                    if (this.conn) { try { this.conn.close(); } catch {} this.conn = null; }
                    if (!this.peer || this.peer.destroyed) {
                        // peer 节点也没了：重建一个（新 peerId，不影响房主侧固定 id）
                        this.peer = new Peer(undefined, this._peerOpts());
                    }
                    const peer = this.peer;
                    peer.off('error');
                    peer.on('error', (err) => {
                        if (this.peer !== peer) return;
                        // 重连中的错误（peer-unavailable 等）：继续下一轮退避重试
                        this._scheduleReconnect();
                    });
                    const doConnect = () => {
                        if (this._manualClose || this.peer !== peer) return;
                        const conn = peer.connect(this._peerId(this.roomCode), { reliable: true });
                        this.conn = conn;
                        conn.on('open', () => {
                            if (this.conn !== conn) return;
                            this._reconnAttempts = 0;
                            this.status = 'connected';
                            this._bindConn(conn);
                            this._emit('status', { status: 'connected', reconnected: true });
                        });
                        conn.on('error', () => { if (this.conn === conn) this._scheduleReconnect(); });
                    };
                    if (peer.destroyed) { this._scheduleReconnect(); return; }
                    if (peer.id != null) doConnect();
                    else peer.once('open', doConnect);
                } catch {
                    this._scheduleReconnect();
                }
            }, delay);
        },

        // 发送消息：{ t: topic, d: payload }
        // 房主：广播到所有客人（opts.to=connPeer 单发 / opts.exclude=connPeer 排除）；
        // 客人：发给房主（单连接，保持 1v1 行为）
        send(topic, payload, opts) {
            opts = opts || {};
            if (this.role === 'host') {
                if (!this.conns) return false;
                let sent = false;
                for (const [id, c] of this.conns) {
                    if (!c.open) continue;
                    if (opts.to && opts.to !== id) continue;
                    if (opts.exclude && opts.exclude === id) continue;
                    try { c.send({ t: topic, d: payload }); sent = true; } catch {}
                }
                return sent;
            }
            if (!this.conn || !this.conn.open) return false;
            try { this.conn.send({ t: topic, d: payload }); return true; }
            catch { return false; }
        },

        isHost()      { return this.role === 'host'; },
        isGuest()     { return this.role === 'guest'; },
        isConnected() { return this.status === 'connected'; },

        close(silent) {
            this._manualClose = true;
            if (this._reconnTimer) { clearTimeout(this._reconnTimer); this._reconnTimer = null; }
            this._reconnAttempts = 0;
            try { if (this.conn) this.conn.close(); } catch {}
            if (this.conns) {
                for (const c of this.conns.values()) { try { c.close(); } catch {} }
                this.conns = null;
            }
            try { if (this.peer) this.peer.destroy(); } catch {}
            this.conn = null;
            this.peer = null;
            this.role = null;
            this.roomCode = null;
            this.error = null;
            this.status = 'idle';
            this.MAX_PLAYERS = 4;   // 容量恢复默认（上次会话可能置过 2）
            if (!silent) this._emit('status', { status: 'closed' });
        },
    };

    // ---------- 暴露 ----------
    global.Net = {
        auth,
        cloud,
        mp,
        storeKey,
        // 便利别名
        currentUser() { return _session ? _session.username : null; },
    };
})(window);
