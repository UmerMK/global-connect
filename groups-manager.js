const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configurable storage directory (e.g. for Render Persistent Disk: DATA_DIR=/var/data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORAGE_FILE = path.join(DATA_DIR, 'groups.json');

// In-memory cache: pin -> group object
let groupsMap = new Map();

function ensureStorageDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (err) {
        console.error('Failed to create storage directory:', err);
    }
}

function loadGroups() {
    ensureStorageDir();
    try {
        if (fs.existsSync(STORAGE_FILE)) {
            const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                groupsMap.clear();
                data.forEach(g => {
                    const pinKey = normalizePin(g.pin || g.key || g.code);
                    if (pinKey) {
                        groupsMap.set(pinKey, { ...g, pin: pinKey });
                    }
                });
                console.log(`[Storage] Loaded ${groupsMap.size} persistent rooms from ${STORAGE_FILE}`);
            }
        } else {
            console.log(`[Storage] No existing groups file found. Starting fresh at ${STORAGE_FILE}`);
        }
    } catch (err) {
        console.error('[Storage] Error loading groups from disk:', err);
    }
}

function saveGroups() {
    ensureStorageDir();
    try {
        const groupsArray = Array.from(groupsMap.values());
        const tempFile = `${STORAGE_FILE}.tmp.${Date.now()}`;
        fs.writeFileSync(tempFile, JSON.stringify(groupsArray, null, 2), 'utf8');
        fs.renameSync(tempFile, STORAGE_FILE);
    } catch (err) {
        console.error('[Storage] Error saving groups to disk:', err);
    }
}

function normalizePin(pin) {
    if (!pin) return '';
    return String(pin).trim().toLowerCase();
}

// Create or access group by PIN
function createGroup(pin, name) {
    const cleanPin = normalizePin(pin);
    if (!cleanPin || cleanPin.length < 3) {
        throw new Error('PIN must be at least 3-4 digits or characters.');
    }

    const cleanName = (name && typeof name === 'string' && name.trim().slice(0, 40)) || `Room ${cleanPin}`;

    // If room already exists with this PIN, return it with owner status
    if (groupsMap.has(cleanPin)) {
        const existing = groupsMap.get(cleanPin);
        if (name && name.trim()) existing.name = cleanName;
        saveGroups();
        return {
            pin: existing.pin,
            name: existing.name,
            ownerToken: existing.ownerToken,
            createdAt: existing.createdAt
        };
    }

    const ownerToken = crypto.randomBytes(32).toString('hex');
    const group = {
        id: `grp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        pin: cleanPin,
        name: cleanName,
        ownerToken: ownerToken,
        createdAt: new Date().toISOString()
    };

    groupsMap.set(cleanPin, group);
    saveGroups();

    return {
        pin: group.pin,
        name: group.name,
        ownerToken: ownerToken,
        createdAt: group.createdAt
    };
}

// Verify & find group by PIN only
function verifyGroup(pin) {
    const cleanPin = normalizePin(pin);
    if (!cleanPin) {
        return { success: false, error: 'Please enter your 4-digit PIN.' };
    }

    const group = groupsMap.get(cleanPin);
    if (!group) {
        return {
            success: false,
            error: `Room with PIN "${cleanPin}" not found. Create it first!`
        };
    }

    return {
        success: true,
        group: {
            pin: group.pin,
            name: group.name,
            createdAt: group.createdAt
        }
    };
}

// Delete group (owner only)
function deleteGroup(pin, ownerToken) {
    const cleanPin = normalizePin(pin);
    if (!cleanPin || !ownerToken) return { success: false, error: 'Missing PIN or owner token.' };
    const group = groupsMap.get(cleanPin);
    if (!group) return { success: false, error: 'Room not found.' };

    const tokenBuf = Buffer.from(ownerToken);
    const expectedBuf = Buffer.from(group.ownerToken);
    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
        return { success: false, error: 'Unauthorized: only the room owner can delete this group.' };
    }

    groupsMap.delete(cleanPin);
    saveGroups();
    return { success: true };
}

function getGroupPublic(pin) {
    const cleanPin = normalizePin(pin);
    if (!cleanPin) return null;
    const group = groupsMap.get(cleanPin);
    if (!group) return null;
    return {
        pin: group.pin,
        name: group.name,
        createdAt: group.createdAt
    };
}

function isOwner(pin, ownerToken) {
    const cleanPin = normalizePin(pin);
    if (!cleanPin || !ownerToken) return false;
    const group = groupsMap.get(cleanPin);
    if (!group) return false;
    const tokenBuf = Buffer.from(ownerToken);
    const expectedBuf = Buffer.from(group.ownerToken);
    if (tokenBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}

// Initialize on require
loadGroups();

module.exports = {
    createGroup,
    verifyGroup,
    deleteGroup,
    getGroupPublic,
    isOwner,
    DATA_DIR,
    STORAGE_FILE
};
