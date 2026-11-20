const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configurable storage directory (e.g. for Render Persistent Disk: DATA_DIR=/var/data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORAGE_FILE = path.join(DATA_DIR, 'groups.json');

// In-memory cache backed by atomic file persistence
let groupsMap = new Map(); // code -> group object

// In-memory rate limiting: key -> { attempts, lockedUntil }
const rateLimitMap = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

// Ensure data directory exists
function ensureStorageDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (err) {
        console.error('Failed to create storage directory:', err);
    }
}

// Load groups from disk on startup
function loadGroups() {
    ensureStorageDir();
    try {
        if (fs.existsSync(STORAGE_FILE)) {
            const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                groupsMap.clear();
                data.forEach(g => {
                    if (g && g.code) {
                        groupsMap.set(g.code, g);
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

// Atomic save to disk
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

// Generate unambiguous, secure group code (e.g. GC-7X9K2M)
function generateGroupCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    do {
        code = 'GC-';
        for (let i = 0; i < 6; i++) {
            const randomIndex = crypto.randomInt(0, chars.length);
            code += chars[randomIndex];
        }
    } while (groupsMap.has(code));
    return code;
}

// Secure password hashing with scrypt
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Verify password with constant-time equality check
function verifyHash(password, salt, expectedHash) {
    const hash = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (hash.length !== expected.length) return false;
    return crypto.timingSafeEqual(hash, expected);
}

// Rate limiting check
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

// Create new group
function createGroup(name, password) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('Group name is required.');
    }
    const cleanName = name.trim().slice(0, 50);

    if (!password || typeof password !== 'string' || password.length < 4) {
        throw new Error('Password must be at least 4 characters long.');
    }

    const code = generateGroupCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const ownerToken = crypto.randomBytes(32).toString('hex');

    const group = {
        id: `grp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        code: code,
        name: cleanName,
        salt: salt,
        passwordHash: passwordHash,
        ownerToken: ownerToken,
        createdAt: new Date().toISOString()
    };

    groupsMap.set(code, group);
    saveGroups();

    return {
        code: group.code,
        name: group.name,
        ownerToken: ownerToken,
        createdAt: group.createdAt
    };
}

// Verify group credentials and return safe group object
function verifyGroup(code, password, clientIp) {
    if (!code || typeof code !== 'string') {
        return { success: false, error: 'Group code is required.' };
    }
    const formattedCode = code.trim().toUpperCase();

    const rateKey = `${clientIp || 'client'}_${formattedCode}`;
    const rateCheck = checkRateLimit(rateKey);
    if (!rateCheck.allowed) {
        return { success: false, error: rateCheck.error };
    }

    const group = groupsMap.get(formattedCode);
    if (!group) {
        recordAttempt(rateKey, false);
        return { success: false, error: 'Group not found. Please verify the code.' };
    }

    if (!password || typeof password !== 'string') {
        return { success: false, error: 'Password is required.' };
    }

    const matches = verifyHash(password, group.salt, group.passwordHash);
    if (!matches) {
        recordAttempt(rateKey, false);
        return { success: false, error: 'Incorrect group password.' };
    }

    recordAttempt(rateKey, true);
    return {
        success: true,
        group: {
            code: group.code,
            name: group.name,
            createdAt: group.createdAt
        }
    };
}

// Delete group (owner only)
function deleteGroup(code, ownerToken) {
    if (!code || !ownerToken) return { success: false, error: 'Missing code or owner token.' };
    const formattedCode = code.trim().toUpperCase();
    const group = groupsMap.get(formattedCode);
    if (!group) return { success: false, error: 'Group not found.' };

    const tokenBuf = Buffer.from(ownerToken);
    const expectedBuf = Buffer.from(group.ownerToken);
    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
        return { success: false, error: 'Unauthorized: only the group owner can delete this group.' };
    }

    groupsMap.delete(formattedCode);
    saveGroups();
    return { success: true };
}

// Get group public details
function getGroupPublic(code) {
    if (!code) return null;
    const group = groupsMap.get(code.trim().toUpperCase());
    if (!group) return null;
    return {
        code: group.code,
        name: group.name,
        createdAt: group.createdAt
    };
}

// Verify if a token is the owner of a group
function isOwner(code, ownerToken) {
    if (!code || !ownerToken) return false;
    const group = groupsMap.get(code.trim().toUpperCase());
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
