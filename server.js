const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const groupsManager = require('./groups-manager');

const app = express();
const server = http.createServer(app);

// SERVER VERSION 3.2 — PIN-ONLY ROOM JOIN + DISAPPEARING IMAGE/GIF SHARING
console.log("GLOBAL_CONNECT_SERVER: v3.2 Starting...");

// Initialize Socket.IO with CORS and 10MB payload limit for image/GIF sharing
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e7 // 10 MB
});

// Force HTTPS Redirection for Render
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Multi-provider real-time GIF search engine + Live Tenor Categories
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TENOR_EMOJI_MAP = {
    trending: '🔥', all: '🌐', memes: '🎭', sports: '⚽', music: '🎵',
    movies: '🎬', tv: '📺', animals: '🐾', holidays: '🎉', gaming: '🎮',
    anime: '⚡', love: '❤️', laugh: '😂', clapping: '👏', awesome: '🤩',
    wow: '🤯', sad: '😭', why: '🤔', 'thumbs-up': '👍', 'high-five': '🙌',
    oops: '😬', ouch: '😣', dancing: '💃', kiss: '😘', nervous: '😅',
    aww: '🥹', confused: '😵', sigh: '😮‍💨', bored: '🥱', scared: '😱'
};

const FALLBACK_CATEGORIES = [
    { tag: 'all', query: 'trending', label: '🌐 All' },
    { tag: 'trending', query: 'trending', label: '🔥 Trending' },
    { tag: 'memes', query: 'memes', label: '🎭 Memes' },
    { tag: 'reactions', query: 'reactions', label: '⚡ Reactions' },
    { tag: 'funny', query: 'funny', label: '😂 Funny' },
    { tag: 'sports', query: 'sports', label: '⚽ Sports' },
    { tag: 'music', query: 'music', label: '🎵 Music' },
    { tag: 'movies', query: 'movies', label: '🎬 Movies' },
    { tag: 'animals', query: 'animals', label: '🐾 Animals' },
    { tag: 'tv', query: 'tv', label: '📺 TV Shows' },
    { tag: 'clapping', query: 'clapping', label: '👏 Clapping' },
    { tag: 'wow', query: 'wow', label: '🤯 Wow' },
    { tag: 'love', query: 'love', label: '❤️ Love' },
    { tag: 'sad', query: 'sad', label: '😭 Sad' }
];

let cachedGifCategories = null;
let cachedGifCategoriesAt = 0;
const GIF_CATS_TTL_MS = 30 * 60 * 1000;

async function fetchLiveTenorCategories() {
    if (cachedGifCategories && Date.now() - cachedGifCategoriesAt < GIF_CATS_TTL_MS) {
        return cachedGifCategories;
    }

    const extractTenorLinks = async (pageUrl) => {
        try {
            const r = await fetch(pageUrl, {
                headers: { 'User-Agent': UA_DESKTOP, 'Accept-Language': 'en-US,en;q=0.9' },
                signal: AbortSignal.timeout(4500)
            });
            if (!r.ok) return [];
            const html = await r.text();
            const results = [];
            for (const m of html.matchAll(/href="\/search\/([a-z0-9-]+)-gifs"[^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
                const slug = m[1].toLowerCase();
                const rawLabel = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/^#/, '').trim();
                if (!slug || slug.includes('tenor') || slug.length < 2) continue;
                results.push({ slug, rawLabel });
            }
            return results;
        } catch {
            return [];
        }
    };

    try {
        const [exploreRes, reactionsRes] = await Promise.allSettled([
            extractTenorLinks('https://tenor.com/explore'),
            extractTenorLinks('https://tenor.com/reactions')
        ]);

        const seen = new Set(['all', 'trending']);
        const cats = [
            { tag: 'all', query: 'trending', label: '🌐 All' },
            { tag: 'trending', query: 'trending', label: '🔥 Trending' }
        ];

        const pushCat = (slug, rawLabel) => {
            if (seen.has(slug) || cats.length >= 20) return;
            seen.add(slug);
            const cleanWords = (rawLabel && rawLabel.length <= 24)
                ? rawLabel
                : slug.replace(/-/g, ' ');
            const title = cleanWords.replace(/\b\w/g, c => c.toUpperCase());
            const emoji = TENOR_EMOJI_MAP[slug] || '✨';
            cats.push({
                tag: slug,
                query: slug.replace(/-/g, ' '),
                label: `${emoji} ${title}`
            });
        };

        if (exploreRes.status === 'fulfilled') {
            const priorityOrder = ['memes', 'sports', 'music', 'animals', 'movies', 'tv', 'holidays'];
            const sortedExplore = [...exploreRes.value].sort((a, b) => {
                const ia = priorityOrder.indexOf(a.slug);
                const ib = priorityOrder.indexOf(b.slug);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            });
            // Put top everyday social categories first, mix in top Tenor Reactions right after Memes/Sports/Music
            for (const item of sortedExplore.slice(0, 4)) pushCat(item.slug, item.rawLabel);
            if (reactionsRes.status === 'fulfilled') {
                for (const rItem of reactionsRes.value.slice(0, 6)) pushCat(rItem.slug, rItem.rawLabel);
            }
            for (const item of sortedExplore.slice(4)) pushCat(item.slug, item.rawLabel);
        }
        if (reactionsRes.status === 'fulfilled') {
            for (const item of reactionsRes.value.slice(0, 14)) pushCat(item.slug, item.rawLabel);
        }

        if (cats.length > 4) {
            cachedGifCategories = cats;
            cachedGifCategoriesAt = Date.now();
            return cats;
        }
    } catch (e) {
        console.warn('[GIF Categories] Live fetch fallback:', e.message);
    }
    return FALLBACK_CATEGORIES;
}

async function fetchTenorGifs(queryTerm) {
    try {
        const lower = queryTerm.toLowerCase().trim();
        const slug = encodeURIComponent(lower.replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'));
        const url = (!slug || lower === 'trending' || lower === 'all')
            ? 'https://tenor.com/searches/trending-gifs'
            : `https://tenor.com/search/${slug}-gifs`;
        const res = await fetch(url, {
            headers: { 'User-Agent': UA_DESKTOP },
            signal: AbortSignal.timeout(4500)
        });
        if (!res.ok) return [];
        const html = await res.text();
        const matches = [...html.matchAll(/https:\/\/media\.tenor\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.gif/g)].map(m => m[0]);
        return [...new Set(matches)].slice(0, 32);
    } catch (e) {
        return [];
    }
}

async function fetchDdgGifs(queryTerm) {
    try {
        const initialRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(queryTerm + ' gif')}`, {
            headers: { 'User-Agent': UA_DESKTOP },
            signal: AbortSignal.timeout(4500)
        });
        const html = await initialRes.text();
        const match = html.match(/vqd=['"]([\d-]+)['"]/) || html.match(/vqd=([\d-]+)[&'"]/);
        if (!match) return [];
        const apiRes = await fetch(`https://duckduckgo.com/i.js?q=${encodeURIComponent(queryTerm + ' gif')}&o=json&vqd=${match[1]}&f=type:gif`, {
            headers: { 'User-Agent': UA_DESKTOP, 'Referer': 'https://duckduckgo.com/' },
            signal: AbortSignal.timeout(4500)
        });
        const data = await apiRes.json();
        return (data.results || [])
            .map(r => r.image)
            .filter(u => u && /^https?:\/\//i.test(u) && (u.includes('.gif') || u.includes('tenor') || u.includes('giphy')))
            .slice(0, 24);
    } catch (e) {
        return [];
    }
}

async function fetchBingGifs(queryTerm, firstOffset = 0) {
    try {
        const res = await fetch(`https://www.bing.com/images/async?q=${encodeURIComponent(queryTerm)}&qft=+filterui:photo-animatedgif&first=${firstOffset}&count=35`, {
            headers: { 'User-Agent': UA_DESKTOP, 'Accept-Language': 'en-US,en;q=0.9' },
            signal: AbortSignal.timeout(4500)
        });
        if (!res.ok) return [];
        const html = await res.text();
        const matches = [...html.matchAll(/murl(?:&quot;|"):\s*(?:&quot;|")(https?:\/\/[^"&]+)(?:&quot;|")/g)].map(m => m[1]);
        return [...new Set(matches)]
            .filter(u => u && !u.includes('bing.com') && (u.includes('.gif') || u.includes('tenor') || u.includes('giphy')))
            .slice(0, 24);
    } catch (e) {
        return [];
    }
}

app.get('/api/gifs/categories', async (req, res) => {
    const categories = await fetchLiveTenorCategories();
    res.json({ success: true, categories });
});

app.get('/api/gifs/search', async (req, res) => {
    const rawQ = (req.query.q || '').trim();
    const page = Math.max(0, parseInt(req.query.page, 10) || 0);
    const isAllOrTrending = !rawQ || rawQ.toLowerCase() === 'all' || rawQ.toLowerCase() === 'trending';
    const queryTerm = isAllOrTrending ? 'trending' : rawQ;
    const secondaryTerm = isAllOrTrending ? 'trending memes reactions' : rawQ;
    const bingOffset = page * 35;

    try {
        const pageVariants = page % 2 === 1
            ? [`${secondaryTerm} reaction`, `${secondaryTerm} meme`]
            : [`${secondaryTerm} celebration`, `${secondaryTerm} funny`];
        const tasks = page === 0
            ? [fetchTenorGifs(queryTerm), fetchDdgGifs(secondaryTerm), fetchBingGifs(secondaryTerm, 0)]
            : [fetchTenorGifs(pageVariants[0]), fetchTenorGifs(pageVariants[1]), fetchBingGifs(secondaryTerm, bingOffset)];

        const resultsList = await Promise.allSettled(tasks);
        const seen = new Set();
        const combined = [];
        for (const r of resultsList) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                for (const u of r.value) {
                    if (!seen.has(u)) {
                        seen.add(u);
                        combined.push(u);
                    }
                }
            }
        }

        res.json({ success: true, page, results: combined.slice(0, 48) });
    } catch (err) {
        console.warn('[GIF Search API error]:', err.message);
        res.json({ success: false, results: [] });
    }
});

let waitingUsers = [];
let onlineCount = 0;
const PUBLIC_LIVE_PIN = '__public_live__';

const broadcastOnlineCount = () => {
    io.emit('online_count', onlineCount);
};

const getPublicLiveStatus = () => {
    const publicRoom = io.sockets.adapter.rooms.get(`group_${PUBLIC_LIVE_PIN}`);
    let count = 0;
    let cameraCount = 0;
    let talkingCount = 0;
    if (publicRoom) {
        for (const sId of publicRoom) {
            const s = io.sockets.sockets.get(sId);
            if (s && s.groupPin === PUBLIC_LIVE_PIN) {
                count++;
                if (s.isCameraOn) cameraCount++;
                if (!s.isAudioMuted) talkingCount++;
            }
        }
    }
    return { count, cameraCount, talkingCount };
};

const broadcastPublicLiveCount = () => {
    const status = getPublicLiveStatus();
    io.emit('public_live_count', status.count);
    io.emit('public_live_status', status);
};

// Helper to safely remove a socket from a group and notify peers
function handleLeaveGroup(socket) {
    if (!socket.groupPin) return;
    const pin = socket.groupPin;
    const socketRoom = `group_${pin}`;
    socket.leave(socketRoom);
    const remainingRoom = io.sockets.adapter.rooms.get(socketRoom);
    const roomCount = remainingRoom ? remainingRoom.size : 0;
    socket.to(socketRoom).emit('group_member_left', { memberId: socket.id, roomCount });
    console.log(`[Group] Member ${socket.id} left room PIN ${pin} (remaining: ${roomCount})`);
    socket.groupPin = null;
    socket.groupName = null;
    socket.memberId = null;
    socket.displayName = null;
    socket.isGroupOwner = null;
    socket.isCameraOn = null;
    socket.isAudioMuted = null;
    socket.requestedQuality = null;

    if (pin === PUBLIC_LIVE_PIN) {
        broadcastPublicLiveCount();
    }
}

// ==========================================
// ICE / STUN / TURN CONFIGURATION API
// ==========================================
const DEFAULT_PUBLIC_STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

let cachedIceResult = null;
let cachedIceExpiresAt = 0;

function httpsJsonRequest(urlString, { method = 'GET', headers = {}, body = null, timeoutMs = 4500 } = {}) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const req = https.request(urlString, { method, headers, timeout: timeoutMs }, (res) => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch (e) {}
                resolve({ status: res.statusCode, parsed, raw });
            });
        });
        req.on('timeout', () => req.destroy(new Error('Request timeout')));
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function resolveServerIceConfig() {
    const now = Date.now();
    if (cachedIceResult && now < cachedIceExpiresAt) {
        return cachedIceResult;
    }

    // 1. Explicit full JSON override (ICE_SERVERS_JSON)
    if (process.env.ICE_SERVERS_JSON) {
        try {
            const parsed = JSON.parse(process.env.ICE_SERVERS_JSON);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const hasTurn = parsed.some(s => String(Array.isArray(s.urls) ? s.urls.join(',') : s.urls || '').includes('turn'));
                cachedIceResult = { iceServers: parsed, turnConfigured: hasTurn, providers: ['custom_json'] };
                cachedIceExpiresAt = now + 5 * 60 * 1000;
                return cachedIceResult;
            }
        } catch (err) {
            console.warn('[ICE] Invalid ICE_SERVERS_JSON:', err.message);
        }
    }

    const iceServers = [
        ...DEFAULT_PUBLIC_STUN_SERVERS,
        // Open-relay Metered TURN — free, no auth, confirmed reachable
        {
            urls: [
                'turn:global.relay.metered.ca:80',
                'turn:global.relay.metered.ca:80?transport=tcp',
                'turn:global.relay.metered.ca:443',
                'turns:global.relay.metered.ca:443?transport=tcp'
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ];
    const providers = ['public_stun', 'openrelay_turn'];
    let turnConfigured = true;  // openrelayproject is always included
    let cacheTtlMs = 2 * 60 * 1000;

    // 2. Cloudflare Realtime TURN (1 TB/month free tier; TLS 443 ready)
    const cfKeyId = (process.env.CLOUDFLARE_TURN_KEY_ID || process.env.CF_TURN_KEY_ID || '').trim();
    const cfToken = (process.env.CLOUDFLARE_TURN_API_TOKEN || process.env.CF_TURN_API_TOKEN || '').trim();
    if (cfKeyId && cfToken) {
        try {
            const ttlSec = Math.min(172800, Math.max(300, Number(process.env.CLOUDFLARE_TURN_TTL) || 86400));
            const cfUrl = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfKeyId)}/credentials/generate-ice-servers`;
            const res = await httpsJsonRequest(cfUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${cfToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ttl: ttlSec })
            });
            const cfList = res.parsed && (Array.isArray(res.parsed.iceServers) ? res.parsed.iceServers : (Array.isArray(res.parsed) ? res.parsed : null));
            if (res.status >= 200 && res.status < 300 && cfList && cfList.length > 0) {
                for (const entry of cfList) {
                    iceServers.push(entry);
                }
                turnConfigured = true;
                providers.push('cloudflare_turn');
                cacheTtlMs = Math.min(cacheTtlMs, Math.floor((ttlSec * 1000) / 3));
            } else {
                console.warn('[ICE] Cloudflare TURN API returned status:', res.status);
            }
        } catch (err) {
            console.warn('[ICE] Cloudflare TURN fetch failed:', err.message);
        }
    }

    // 3. Dynamic Metered TURN credentials via environment variables
    const meteredApp = (process.env.METERED_APP_NAME || '').trim();
    const meteredKey = (process.env.METERED_API_KEY || '').trim();
    if (meteredApp && meteredKey) {
        try {
            const region = (process.env.METERED_REGION || '').trim();
            const q = region ? `&region=${encodeURIComponent(region)}` : '';
            const mUrl = `https://${encodeURIComponent(meteredApp)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredKey)}${q}`;
            const res = await httpsJsonRequest(mUrl);
            if (res.status >= 200 && res.status < 300 && Array.isArray(res.parsed) && res.parsed.length > 0) {
                for (const entry of res.parsed) {
                    const u = String(Array.isArray(entry.urls) ? entry.urls.join(',') : entry.urls || '');
                    if (u.includes('turn:') || u.includes('turns:')) {
                        iceServers.push(entry);
                        turnConfigured = true;
                    }
                }
                if (turnConfigured) {
                    providers.push('metered_turn');
                    cacheTtlMs = 5 * 60 * 1000;
                }
            } else {
                console.warn('[ICE] Metered TURN API returned status:', res.status);
            }
        } catch (err) {
            console.warn('[ICE] Metered TURN fetch failed:', err.message);
        }
    }

    // 4. Static / Self-hosted Coturn / ExpressTURN via environment variables
    const staticTurnUrls = (process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (staticTurnUrls.length > 0 && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
        iceServers.push({
            urls: staticTurnUrls.length === 1 ? staticTurnUrls[0] : staticTurnUrls,
            username: process.env.TURN_USERNAME,
            credential: process.env.TURN_CREDENTIAL
        });
        turnConfigured = true;
        providers.push('static_turn');
    }

    cachedIceResult = { iceServers, turnConfigured, providers };
    cachedIceExpiresAt = now + cacheTtlMs;
    return cachedIceResult;
}

app.get('/api/ice-servers', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
        const config = await resolveServerIceConfig();
        res.json(config);
    } catch (err) {
        console.warn('[ICE] /api/ice-servers error:', err.message);
        res.json({
            iceServers: DEFAULT_PUBLIC_STUN_SERVERS,
            turnConfigured: false,
            providers: ['public_stun_fallback']
        });
    }
});

io.on('connection', (socket) => {
    onlineCount++;
    console.log(`User ${socket.id} connected. Total online: ${onlineCount}`);
    broadcastOnlineCount();
    const initPublicStatus = getPublicLiveStatus();
    socket.emit('public_live_count', initPublicStatus.count);
    socket.emit('public_live_status', initPublicStatus);

    // ==========================================
    // 1. RANDOM VOICE / PRIVATE CHAT (PRESERVED)
    // ==========================================
    socket.on('find_match', () => {
        if (socket.roomId || socket.peerId) return;
        if (socket.groupPin) handleLeaveGroup(socket);

        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);

        let partner = null;
        while (waitingUsers.length > 0) {
            const potentialPartner = waitingUsers.shift();
            if (io.sockets.sockets.has(potentialPartner.id)) {
                partner = potentialPartner;
                break;
            }
        }

        if (partner) {
            const roomId = `room_${socket.id}_${partner.id}`;
            socket.join(roomId);
            partner.join(roomId);
            socket.peerId = partner.id;
            partner.peerId = socket.id;
            socket.roomId = roomId;
            partner.roomId = roomId;
            socket.emit('match_found', { roomId, isInitiator: true });
            partner.emit('match_found', { roomId, isInitiator: false });
        } else {
            waitingUsers.push(socket);
            socket.emit('waiting', 'Looking for a partner...');
        }
    });

    socket.on('message', (msg) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('message', { text: msg, sender: 'partner' });
        }
    });

    socket.on('private_gif', ({ gifUrl }) => {
        if (socket.roomId && gifUrl) {
            socket.to(socket.roomId).emit('private_gif', { gifUrl: String(gifUrl).slice(0, 500) });
        }
    });

    socket.on('private_voice_note', ({ audioData, duration, mimeType } = {}) => {
        if (!socket.roomId || !audioData || typeof audioData !== 'string') return;
        if (!audioData.startsWith('data:audio/') || audioData.length > 1_500_000) return;
        socket.to(socket.roomId).emit('private_voice_note', {
            audioData,
            mimeType: String(mimeType || 'audio/webm').slice(0, 50),
            duration: Math.min(60, Math.max(1, Math.round(Number(duration) || 1)))
        });
    });

    socket.on('typing', () => {
        if (socket.roomId) socket.to(socket.roomId).emit('typing');
    });

    socket.on('stop_typing', () => {
        if (socket.roomId) socket.to(socket.roomId).emit('stop_typing');
    });

    socket.on('signal', (data) => {
        if (socket.peerId) {
            io.to(socket.peerId).emit('signal', data);
        }
    });

    socket.on('private_camera_toggle', (data) => {
        if (socket.peerId) {
            io.to(socket.peerId).emit('private_camera_toggle', data);
        }
    });

    socket.on('private_quality_pref', (data) => {
        if (socket.peerId && data) {
            io.to(socket.peerId).emit('private_quality_pref', {
                preset: String(data.preset || 'auto').slice(0, 20),
                maxWidth: Number(data.maxWidth) || 0,
                maxHeight: Number(data.maxHeight) || 0,
                maxBitrate: Number(data.maxBitrate) || 0,
                maxFramerate: Number(data.maxFramerate) || 0
            });
        }
    });

    socket.on('private_reaction', (data) => {
        if (socket.roomId && data && data.emoji) {
            const safeEmoji = String(data.emoji).slice(0, 8);
            socket.to(socket.roomId).emit('private_reaction', { emoji: safeEmoji });
        }
    });

    socket.on('manual_disconnect', () => {
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
        if (socket.peerId) {
            const partnerSocket = io.sockets.sockets.get(socket.peerId);
            if (partnerSocket) {
                partnerSocket.emit('partner_disconnected');
                if (socket.roomId) partnerSocket.leave(socket.roomId);
                partnerSocket.peerId = null;
                partnerSocket.roomId = null;
            }
        }
        if (socket.roomId) socket.leave(socket.roomId);
        socket.peerId = null;
        socket.roomId = null;
        socket.emit('disconnected_local');
    });

    // ==========================================
    // 2. GROUP CHAT & VOICE/VIDEO (PIN-BASED)
    // ==========================================

    // Create group with PIN and optional Name
    socket.on('group_create', ({ pin, name }, callback) => {
        try {
            if (pin && String(pin).trim().toLowerCase() === PUBLIC_LIVE_PIN) {
                throw new Error('Reserved PIN.');
            }
            const newGroup = groupsManager.createGroup(pin, name);
            console.log(`[Group] Created/Accessed room PIN "${newGroup.pin}" (${newGroup.name})`);
            if (typeof callback === 'function') {
                callback({ success: true, group: newGroup });
            }
        } catch (err) {
            if (typeof callback === 'function') {
                callback({ success: false, error: err.message });
            }
        }
    });

    // Public Video Call (Open Live — No password, no username required)
    socket.on('public_live_join', ({ avatarUrl, displayName, isAudioMuted } = {}, callback) => {
        const socketRoom = `group_${PUBLIC_LIVE_PIN}`;

        // Leave random 1-on-1 waiting or active room
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        if (socket.roomId || socket.peerId) {
            if (socket.peerId) {
                const partner = io.sockets.sockets.get(socket.peerId);
                if (partner) {
                    partner.emit('partner_disconnected');
                    partner.peerId = null;
                    partner.roomId = null;
                }
            }
            if (socket.roomId) socket.leave(socket.roomId);
            socket.peerId = null;
            socket.roomId = null;
        }

        // Leave any previous group room
        if (socket.groupPin && socket.groupPin !== PUBLIC_LIVE_PIN) {
            handleLeaveGroup(socket);
        }

        const memberId = socket.id;
        const cleanName = (displayName && String(displayName).trim().slice(0, 30)) || `Live #${socket.id.slice(0, 4).toUpperCase()}`;
        const cleanAvatar = avatarUrl || null;

        socket.groupPin = PUBLIC_LIVE_PIN;
        socket.groupName = 'Public Video Call';
        socket.memberId = memberId;
        socket.displayName = cleanName;
        socket.userAvatar = cleanAvatar;
        socket.isGroupOwner = false;
        socket.isCameraOn = false;
        socket.isAudioMuted = !!isAudioMuted;

        socket.join(socketRoom);
        console.log(`[PublicLive] User ${socket.id} (${cleanName}) joined Public Video Call`);

        // Gather existing members in the public live room
        const roomSockets = io.sockets.adapter.rooms.get(socketRoom) || new Set();
        const existingMembers = [];
        for (const sId of roomSockets) {
            if (sId !== socket.id) {
                const s = io.sockets.sockets.get(sId);
                if (s && s.groupPin === PUBLIC_LIVE_PIN) {
                    existingMembers.push({
                        memberId: s.memberId,
                        displayName: s.displayName,
                        avatarUrl: s.userAvatar,
                        isOwner: false,
                        isCameraOn: !!s.isCameraOn,
                        isAudioMuted: !!s.isAudioMuted,
                        requestedQuality: s.requestedQuality || null
                    });
                }
            }
        }

        if (typeof callback === 'function') {
            callback({
                success: true,
                isPublic: true,
                group: { pin: PUBLIC_LIVE_PIN, name: 'Public Video Call' },
                isOwner: false,
                memberId: memberId,
                displayName: cleanName,
                avatarUrl: cleanAvatar,
                existingMembers: existingMembers,
                roomCount: existingMembers.length + 1
            });
        }

        socket.to(socketRoom).emit('group_member_joined', {
            memberId: memberId,
            displayName: cleanName,
            avatarUrl: cleanAvatar,
            isOwner: false,
            isCameraOn: false,
            isAudioMuted: !!isAudioMuted,
            roomCount: existingMembers.length + 1
        });

        broadcastPublicLiveCount();
    });

    // Join room with PIN and Display Name (no group name needed!)
    socket.on('group_join', ({ pin, displayName, ownerToken, avatarUrl }, callback) => {
        const verification = groupsManager.verifyGroup(pin);

        if (!verification.success) {
            if (typeof callback === 'function') {
                callback({ success: false, error: verification.error });
            }
            return;
        }

        const groupPin = verification.group.pin;
        const groupName = verification.group.name;
        const socketRoom = `group_${groupPin}`;

        // Leave random 1-on-1 waiting or active room
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        if (socket.roomId || socket.peerId) {
            if (socket.peerId) {
                const partner = io.sockets.sockets.get(socket.peerId);
                if (partner) {
                    partner.emit('partner_disconnected');
                    partner.peerId = null;
                    partner.roomId = null;
                }
            }
            if (socket.roomId) socket.leave(socket.roomId);
            socket.peerId = null;
            socket.roomId = null;
        }

        // Leave existing group if different
        if (socket.groupPin && socket.groupPin !== groupPin) {
            handleLeaveGroup(socket);
        }

        const isOwner = groupsManager.isOwner(groupPin, ownerToken);
        const memberId = socket.id;
        const cleanName = (displayName && displayName.trim().slice(0, 30)) || `Friend ${socket.id.slice(0, 4)}`;
        const cleanAvatar = avatarUrl || null;

        socket.groupPin = groupPin;
        socket.groupName = groupName;
        socket.memberId = memberId;
        socket.displayName = cleanName;
        socket.userAvatar = cleanAvatar;
        socket.isGroupOwner = isOwner;
        socket.isCameraOn = false;
        socket.isAudioMuted = false;

        socket.join(socketRoom);
        console.log(`[Group] User ${socket.id} (${cleanName}) joined room PIN ${groupPin}`);

        // Gather existing members in the group room
        const roomSockets = io.sockets.adapter.rooms.get(socketRoom) || new Set();
        const existingMembers = [];
        for (const sId of roomSockets) {
            if (sId !== socket.id) {
                const s = io.sockets.sockets.get(sId);
                if (s && s.groupPin === groupPin) {
                    existingMembers.push({
                        memberId: s.memberId,
                        displayName: s.displayName,
                        avatarUrl: s.userAvatar,
                        isOwner: s.isGroupOwner,
                        isCameraOn: !!s.isCameraOn,
                        isAudioMuted: !!s.isAudioMuted,
                        requestedQuality: s.requestedQuality || null
                    });
                }
            }
        }

        // Send confirmation and peer list to joining user
        if (typeof callback === 'function') {
            callback({
                success: true,
                group: verification.group,
                isOwner: isOwner,
                memberId: memberId,
                displayName: cleanName,
                avatarUrl: cleanAvatar,
                existingMembers: existingMembers,
                roomCount: existingMembers.length + 1
            });
        }

        // Broadcast to existing room members that a new participant joined
        socket.to(socketRoom).emit('group_member_joined', {
            memberId: memberId,
            displayName: cleanName,
            avatarUrl: cleanAvatar,
            isOwner: isOwner,
            isCameraOn: false,
            isAudioMuted: false,
            roomCount: existingMembers.length + 1
        });
    });

    // Targeted WebRTC signaling between two members in a group
    socket.on('group_signal', ({ to, data }) => {
        if (!socket.groupPin || !to || !data) return;
        const targetSocket = io.sockets.sockets.get(to);
        if (targetSocket && targetSocket.groupPin === socket.groupPin) {
            targetSocket.emit('group_signal', {
                from: socket.id,
                data: data
            });
        }
    });

    // Media state update (microphone mute, camera on/off)
    socket.on('group_media_state', ({ isAudioMuted, isCameraOn }) => {
        if (!socket.groupPin) return;
        if (typeof isAudioMuted === 'boolean') socket.isAudioMuted = isAudioMuted;
        if (typeof isCameraOn === 'boolean') socket.isCameraOn = isCameraOn;

        const socketRoom = `group_${socket.groupPin}`;
        socket.to(socketRoom).emit('group_media_state', {
            memberId: socket.id,
            isAudioMuted: socket.isAudioMuted,
            isCameraOn: socket.isCameraOn
        });

        if (socket.groupPin === PUBLIC_LIVE_PIN) {
            broadcastPublicLiveCount();
        }
    });

    // Speaking activity indicator
    socket.on('group_speaking', ({ isSpeaking }) => {
        if (!socket.groupPin) return;
        const socketRoom = `group_${socket.groupPin}`;
        socket.to(socketRoom).emit('group_speaking', {
            memberId: socket.id,
            isSpeaking: !!isSpeaking
        });
    });

    // Live transparent chat stream (TikTok live style messages, GIFs & voice notes)
    socket.on('group_chat_message', ({ text, gifUrl, voiceData, voiceDuration, voiceMime }, callback) => {
        if (!socket.groupPin) return;
        const hasValidVoice = typeof voiceData === 'string' && voiceData.startsWith('data:audio/') && voiceData.length <= 1_500_000;
        const socketRoom = `group_${socket.groupPin}`;
        const payload = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            senderId: socket.id,
            senderName: socket.displayName || 'Friend',
            senderAvatar: socket.userAvatar || null,
            text: text ? String(text).slice(0, 200) : '',
            gifUrl: gifUrl || null,
            voiceData: hasValidVoice ? voiceData : null,
            voiceDuration: hasValidVoice ? Math.min(60, Math.max(1, Math.round(Number(voiceDuration) || 1))) : null,
            voiceMime: hasValidVoice ? String(voiceMime || 'audio/webm').slice(0, 50) : null,
            timestamp: Date.now()
        };
        io.to(socketRoom).emit('group_chat_message', payload);
        if (typeof callback === 'function') callback({ success: true, payload });
    });

    // Per-viewer requested receive quality (Data Saver / 480p / 720p / 1080p)
    socket.on('group_quality_pref', (data = {}) => {
        if (!socket.groupPin) return;
        const payload = {
            memberId: socket.id,
            preset: String(data.preset || 'auto').slice(0, 20),
            maxWidth: Number(data.maxWidth) || 0,
            maxHeight: Number(data.maxHeight) || 0,
            maxBitrate: Number(data.maxBitrate) || 0,
            maxFramerate: Number(data.maxFramerate) || 0
        };
        socket.requestedQuality = payload;
        if (data.to) {
            const target = io.sockets.sockets.get(data.to);
            if (target && target.groupPin === socket.groupPin) {
                target.emit('group_quality_pref', payload);
            }
        } else {
            socket.to(`group_${socket.groupPin}`).emit('group_quality_pref', payload);
        }
    });

    // Floating live emoji reactions in Public & Group calls
    socket.on('group_reaction', ({ emoji } = {}) => {
        if (!socket.groupPin || !emoji) return;
        socket.to(`group_${socket.groupPin}`).emit('group_reaction', {
            memberId: socket.id,
            senderName: socket.displayName || 'Friend',
            emoji: String(emoji).slice(0, 8)
        });
    });

    // ==========================================
    // 3. DISAPPEARING IMAGE & GIF SHARING
    // ==========================================
    socket.on('group_share_media', ({ mediaUrl, duration }, callback) => {
        if (!socket.groupPin || !mediaUrl) {
            if (typeof callback === 'function') callback({ success: false, error: 'No media provided' });
            return;
        }

        const safeDuration = Math.min(30, Math.max(5, Number(duration) || 10)); // 5 to 30s, default 10s
        const socketRoom = `group_${socket.groupPin}`;

        const payload = {
            id: `media_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            mediaUrl: mediaUrl,
            senderName: socket.displayName || 'Friend',
            duration: safeDuration
        };

        // Broadcast to everyone in the room (including sender)
        io.to(socketRoom).emit('group_media_shared', payload);

        if (typeof callback === 'function') {
            callback({ success: true, payload });
        }
    });

    // Voluntarily leave group
    socket.on('group_leave', () => {
        handleLeaveGroup(socket);
        socket.emit('group_left_confirmed');
    });

    // Delete group (owner only)
    socket.on('group_delete', ({ pin, name, ownerToken }, callback) => {
        const targetPin = pin || socket.groupPin;
        if (targetPin === PUBLIC_LIVE_PIN) {
            if (typeof callback === 'function') callback({ success: false, error: 'Public live room cannot be deleted.' });
            return;
        }
        const result = groupsManager.deleteGroup(targetPin, ownerToken);
        if (result.success) {
            console.log(`[Group] Room PIN "${targetPin}" permanently deleted by owner.`);
            const socketRoom = `group_${targetPin}`;
            io.to(socketRoom).emit('group_deleted', {
                message: `The group room has been deleted by its owner.`
            });

            const roomSockets = io.sockets.adapter.rooms.get(socketRoom) || new Set();
            for (const sId of roomSockets) {
                const s = io.sockets.sockets.get(sId);
                if (s) {
                    s.leave(socketRoom);
                    s.groupPin = null;
                    s.groupName = null;
                }
            }
        }
        if (typeof callback === 'function') callback(result);
    });

    // ==========================================
    // DISCONNECT CLEANUP
    // ==========================================
    socket.on('disconnect', () => {
        if (socket.groupPin) {
            handleLeaveGroup(socket);
        }

        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
        if (socket.peerId) {
            const partnerSocket = io.sockets.sockets.get(socket.peerId);
            if (partnerSocket) {
                partnerSocket.emit('partner_disconnected');
                partnerSocket.leave(socket.roomId);
                partnerSocket.peerId = null;
                partnerSocket.roomId = null;
            }
        }

        onlineCount = Math.max(0, onlineCount - 1);
        broadcastOnlineCount();
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server v3.2 running on ${PORT}`);
});
