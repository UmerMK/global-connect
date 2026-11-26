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

// Real-time GIF search endpoint across the entire motion picture/GIF web
app.get('/api/gifs/search', async (req, res) => {
    const q = req.query.q;
    if (!q || !q.trim()) {
        return res.json({ success: true, results: [] });
    }

    try {
        const queryTerm = q.trim();
        const initialRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(queryTerm + ' gif')}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = await initialRes.text();
        const match = html.match(/vqd=['"]([\d-]+)['"]/) || html.match(/vqd=([\d-]+)[&'"]/);
        if (!match) {
            return res.json({ success: true, results: [] });
        }

        const vqd = match[1];
        const apiRes = await fetch(`https://duckduckgo.com/i.js?q=${encodeURIComponent(queryTerm + ' gif')}&o=json&vqd=${vqd}&f=type:gif`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://duckduckgo.com/'
            }
        });

        const data = await apiRes.json();
        const gifUrls = (data.results || [])
            .map(r => r.image)
            .filter(u => u && (u.includes('.gif') || u.includes('tenor') || u.includes('giphy')))
            .slice(0, 24);

        res.json({ success: true, results: gifUrls });
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

    if (pin === PUBLIC_LIVE_PIN) {
        broadcastPublicLiveCount();
    }
}

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
                        isAudioMuted: !!s.isAudioMuted
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
                        isAudioMuted: !!s.isAudioMuted
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

    // Live transparent chat stream (TikTok live style messages & GIFs)
    socket.on('group_chat_message', ({ text, gifUrl }, callback) => {
        if (!socket.groupPin) return;
        const socketRoom = `group_${socket.groupPin}`;
        const payload = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            senderId: socket.id,
            senderName: socket.displayName || 'Friend',
            senderAvatar: socket.userAvatar || null,
            text: text ? String(text).slice(0, 200) : '',
            gifUrl: gifUrl || null,
            timestamp: Date.now()
        };
        io.to(socketRoom).emit('group_chat_message', payload);
        if (typeof callback === 'function') callback({ success: true, payload });
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
