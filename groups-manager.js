const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configurable storage directory (e.g. for Render Persistent Disk: DATA_DIR=/var/data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORAGE_FILE = path.join(DATA_DIR, 'groups.json');

// In-memory cache: groupKey (lowercase name) -> group object
let groupsMap = new Map();

// Rate limiting: key -> { attempts, lockedUntil }
const rateLimitMap = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

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
                    if (g && g.key) {
                        groupsMap.set(g.key, g);
                    } else if (g && g.name) {
                        groupsMap.set(g.name.trim().toLowerCase(), g);
                    }
                });
                console.log(`[Storage] Loaded ${groupsMap.size} persistent groups from ${STORAGE_FILE}`);
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

function normalizeKey(name) {
    if (!name || typeof name !== 'string') return '';
    return name.trim().toLowerCase();
}

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyHash(password, salt, expectedHash) {
    const hash = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (hash.length !== expected.length) return false;
    return crypto.timingSafeEqual(hash, expected);
}

function checkRateLimit(key) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry) return { allowed: true };

    if (entry.lockedUntil && now < entry.lockedUntil) {
        const remainingSec = Math.ceil((entry.lockedUntil - now) / 1000);
        return {
            allowed: false,
            error: `Too many failed attempts. Locked for ${remainingSec} seconds.`
        };
    }

    if (entry.lockedUntil && now >= entry.lockedUntil) {
        rateLimitMap.delete(key);
        return { allowed: true };
    }

    return { allowed: true };
}

function recordAttempt(key, success) {
    const now = Date.now();
    if (success) {
        rateLimitMap.delete(key);
        return;
    }

    const entry = rateLimitMap.get(key) || { attempts: 0, lockedUntil: 0 };
    entry.attempts++;
    if (entry.attempts >= MAX_ATTEMPTS) {
        entry.lockedUntil = now + LOCKOUT_MS;
    }
    rateLimitMap.set(key, entry);
}

// Create new group by Name + 4-digit Password
function createGroup(name, password) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('Please enter a group name.');
    }
    const cleanName = name.trim().slice(0, 50);
    const key = normalizeKey(cleanName);

    if (key.length < 2) {
        throw new Error('Group name must be at least 2 characters.');
    }

    if (groupsMap.has(key)) {
        throw new Error(`Group "${cleanName}" already exists. Please pick another name or join it.`);
    }

    if (!password || typeof password !== 'string' || password.length < 4) {
        throw new Error('Password must be at least 4 digits/characters.');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const ownerToken = crypto.randomBytes(32).toString('hex');

    const group = {
        id: `grp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        key: key,
        name: cleanName,
        salt: salt,
        passwordHash: passwordHash,
        ownerToken: ownerToken,
        createdAt: new Date().toISOString()
    };

    groupsMap.set(key, group);
    saveGroups();

    return {
        key: group.key,
        name: group.name,
        ownerToken: ownerToken,
        createdAt: group.createdAt
    };
}

// Verify group by Name + Password
function verifyGroup(name, password, clientIp) {
    if (!name || typeof name !== 'string') {
        return { success: false, error: 'Group name is required.' };
    }
    const key = normalizeKey(name);

    const rateKey = `${clientIp || 'client'}_${key}`;
    const rateCheck = checkRateLimit(rateKey);
    if (!rateCheck.allowed) {
        return { success: false, error: rateCheck.error };
    }

    const group = groupsMap.get(key);
    if (!group) {
        recordAttempt(rateKey, false);
        return { success: false, error: `Group "${name.trim()}" not found. Please check the name.` };
    }

    if (!password || typeof password !== 'string') {
        return { success: false, error: 'Password is required.' };
    }

    const matches = verifyHash(password, group.salt, group.passwordHash);
    if (!matches) {
        recordAttempt(rateKey, false);
        return { success: false, error: 'Incorrect 4-digit password.' };
    }

    recordAttempt(rateKey, true);
    return {
        success: true,
        group: {
            key: group.key,
            name: group.name,
            createdAt: group.createdAt
        }
    };
}

// Delete group (owner only)
function deleteGroup(name, ownerToken) {
    if (!name || !ownerToken) return { success: false, error: 'Missing group name or owner token.' };
    const key = normalizeKey(name);
    const group = groupsMap.get(key);
    if (!group) return { success: false, error: 'Group not found.' };

    const tokenBuf = Buffer.from(ownerToken);
    const expectedBuf = Buffer.from(group.ownerToken);
    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
        return { success: false, error: 'Unauthorized: only the group owner can delete this group.' };
    }

    groupsMap.delete(key);
    saveGroups();
    return { success: true };
}

function getGroupPublic(name) {
    if (!name) return null;
    const group = groupsMap.get(normalizeKey(name));
    if (!group) return null;
    return {
        key: group.key,
        name: group.name,
        createdAt: group.createdAt
    };
}

function isOwner(name, ownerToken) {
    if (!name || !ownerToken) return false;
    const group = groupsMap.get(normalizeKey(name));
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
