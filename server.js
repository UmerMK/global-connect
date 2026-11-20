const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const groupsManager = require('./groups-manager');

const app = express();
const server = http.createServer(app);

// SERVER VERSION 3.0 — GLOBAL CONNECT WITH GROUP CHAT & VOICE/VIDEO
console.log("GLOBAL_CONNECT_SERVER: v3.0 Starting...");

// Initialize Socket.IO with CORS
const io = new Server(server, {
    cors: { origin: "*" }
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

let waitingUsers = [];
let onlineCount = 0;

const broadcastOnlineCount = () => {
    io.emit('online_count', onlineCount);
};

// Helper to safely remove a socket from a group and notify peers
function handleLeaveGroup(socket) {
    if (!socket.groupCode) return;
    const code = socket.groupCode;
    const socketRoom = `group_${code}`;
    socket.leave(socketRoom);
    socket.to(socketRoom).emit('group_member_left', { memberId: socket.id });
    console.log(`[Group] Member ${socket.id} left group ${code}`);
    socket.groupCode = null;
    socket.memberId = null;
    socket.displayName = null;
    socket.isGroupOwner = null;
    socket.isCameraOn = null;
    socket.isAudioMuted = null;
}

io.on('connection', (socket) => {
    onlineCount++;
    console.log(`User ${socket.id} connected. Total online: ${onlineCount}`);
    broadcastOnlineCount();

    // ==========================================
    // 1. RANDOM VOICE / PRIVATE CHAT (PRESERVED)
    // ==========================================
    socket.on('find_match', () => {
        if (socket.roomId || socket.peerId) return;
        // Also ensure not in group when finding random match
        if (socket.groupCode) handleLeaveGroup(socket);

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
    // 2. GROUP CHAT & VOICE/VIDEO (NEW FEATURE)
    // ==========================================

    // Create a new permanent private group
    socket.on('group_create', ({ name, password }, callback) => {
        try {
            const newGroup = groupsManager.createGroup(name, password);
            console.log(`[Group] Created new group ${newGroup.code} (${newGroup.name})`);
            if (typeof callback === 'function') {
                callback({ success: true, group: newGroup });
            }
        } catch (err) {
            if (typeof callback === 'function') {
                callback({ success: false, error: err.message });
            }
        }
    });

    // Join an existing group room
    socket.on('group_join', ({ code, password, displayName, ownerToken }, callback) => {
        const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        const verification = groupsManager.verifyGroup(code, password, clientIp);

        if (!verification.success) {
            if (typeof callback === 'function') {
                callback({ success: false, error: verification.error });
            }
            return;
        }

        const groupCode = verification.group.code;
        const socketRoom = `group_${groupCode}`;

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
        if (socket.groupCode && socket.groupCode !== groupCode) {
            handleLeaveGroup(socket);
        }

        const isOwner = groupsManager.isOwner(groupCode, ownerToken);
        const memberId = socket.id;
        const cleanName = (displayName && displayName.trim().slice(0, 30)) || `Friend ${socket.id.slice(0, 4)}`;

        socket.groupCode = groupCode;
        socket.memberId = memberId;
        socket.displayName = cleanName;
        socket.isGroupOwner = isOwner;
        socket.isCameraOn = false;
        socket.isAudioMuted = false;

        socket.join(socketRoom);
        console.log(`[Group] User ${socket.id} (${cleanName}) joined group ${groupCode}`);

        // Gather existing members in the group room
        const roomSockets = io.sockets.adapter.rooms.get(socketRoom) || new Set();
        const existingMembers = [];
        for (const sId of roomSockets) {
            if (sId !== socket.id) {
                const s = io.sockets.sockets.get(sId);
                if (s && s.groupCode === groupCode) {
                    existingMembers.push({
                        memberId: s.memberId,
                        displayName: s.displayName,
                        isOwner: s.isGroupOwner,
                        isCameraOn: !!s.isCameraOn,
                        isAudioMuted: !!s.isAudioMuted
                    });
                }
            }
        }

        // Send confirmation and peer list to the joining user
        if (typeof callback === 'function') {
            callback({
                success: true,
                group: verification.group,
                isOwner: isOwner,
                memberId: memberId,
                displayName: cleanName,
                existingMembers: existingMembers
            });
        }

        // Broadcast to existing room members that a new participant joined
        socket.to(socketRoom).emit('group_member_joined', {
            memberId: memberId,
            displayName: cleanName,
            isOwner: isOwner,
            isCameraOn: false,
            isAudioMuted: false
        });
    });

    // Targeted WebRTC signaling between two members in a group
    socket.on('group_signal', ({ to, data }) => {
        if (!socket.groupCode || !to || !data) return;
        const targetSocket = io.sockets.sockets.get(to);
        if (targetSocket && targetSocket.groupCode === socket.groupCode) {
            targetSocket.emit('group_signal', {
                from: socket.id,
                data: data
            });
        }
    });

    // Media state update (microphone mute, camera on/off)
    socket.on('group_media_state', ({ isAudioMuted, isCameraOn }) => {
        if (!socket.groupCode) return;
        if (typeof isAudioMuted === 'boolean') socket.isAudioMuted = isAudioMuted;
        if (typeof isCameraOn === 'boolean') socket.isCameraOn = isCameraOn;

        const socketRoom = `group_${socket.groupCode}`;
        socket.to(socketRoom).emit('group_media_state', {
            memberId: socket.id,
            isAudioMuted: socket.isAudioMuted,
            isCameraOn: socket.isCameraOn
        });
    });

    // Speaking activity indicator
    socket.on('group_speaking', ({ isSpeaking }) => {
        if (!socket.groupCode) return;
        const socketRoom = `group_${socket.groupCode}`;
        socket.to(socketRoom).emit('group_speaking', {
            memberId: socket.id,
            isSpeaking: !!isSpeaking
        });
    });

    // Voluntarily leave group
    socket.on('group_leave', () => {
        handleLeaveGroup(socket);
        socket.emit('group_left_confirmed');
    });

    // Delete group (owner only)
    socket.on('group_delete', ({ code, ownerToken }, callback) => {
        const result = groupsManager.deleteGroup(code, ownerToken);
        if (result.success) {
            console.log(`[Group] Group ${code} permanently deleted by owner.`);
            const socketRoom = `group_${code}`;
            io.to(socketRoom).emit('group_deleted', {
                message: 'This group has been permanently deleted by its owner.'
            });

            // Evict all sockets from room
            const roomSockets = io.sockets.adapter.rooms.get(socketRoom) || new Set();
            for (const sId of roomSockets) {
                const s = io.sockets.sockets.get(sId);
                if (s) {
                    s.leave(socketRoom);
                    s.groupCode = null;
                }
            }
        }
        if (typeof callback === 'function') callback(result);
    });

    // ==========================================
    // DISCONNECT CLEANUP (ALL SESSIONS)
    // ==========================================
    socket.on('disconnect', () => {
        // 1. Group cleanup
        if (socket.groupCode) {
            handleLeaveGroup(socket);
        }

        // 2. 1-on-1 Random Match cleanup
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
    console.log(`Server v3.0 running on ${PORT}`);
});
