console.log("CONNECTED_JS_VERSION: 8.2 - Voice Notes, Live MB Meter, PWA & Organized Phone UI");
if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    alert("CRITICAL: You are using HTTP. WebRTC (Voice) requires HTTPS to work. Redirecting to Secure Site...");
    window.location.href = window.location.href.replace('http:', 'https:');
}
if (!window.isSecureContext) {
    alert("SECURITY BLOCK: Your browser is blocking microphone access because this connection is not secure (HTTPS). Please use the secure link.");
}
const socket = io();

// UI Elements
const startScreen = document.getElementById('start-screen');
const waitingScreen = document.getElementById('waiting-screen');
const chatScreen = document.getElementById('chat-screen');
const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn'); // Renamed from disconnectBtn
const howItWorksBtn = document.getElementById('how-it-works-btn');
const howItWorksSection = document.getElementById('how-it-works');
const sendBtn = document.getElementById('send-btn');
const messageInput = document.getElementById('message-input');
const messagesContainer = document.getElementById('messages');
const remoteAudio = document.getElementById('remote-audio');
const muteBtn = document.getElementById('mute-btn');
const callStatus = document.getElementById('call-status');
const callTimer = document.getElementById('call-timer');
const topicBanner = document.getElementById('topic-banner');
const topicText = document.getElementById('topic-text');
const partnerAvatar = document.getElementById('partner-avatar');
const charCounter = document.getElementById('char-counter');
const reportBtn = document.getElementById('report-btn');
const stopBtn = document.getElementById('stop-btn');
const cancelWaitingBtn = document.getElementById('cancel-waiting-btn');
const userCountDisplay = document.getElementById('user-count');

// 1-on-1 Private Video Elements & State
const privateCamBtn = document.getElementById('private-cam-btn');
const privateFlipCamBtn = document.getElementById('private-flip-cam-btn');
const privateGifBtn = document.getElementById('private-gif-btn');
const privateToggleChatBtn = document.getElementById('private-toggle-chat-btn');
const privateChatUnreadBadge = document.getElementById('private-chat-unread');
const privateToastPreview = document.getElementById('private-toast-preview');
const privateVideoStage = document.getElementById('private-video-stage');
const privateRemotePane = document.getElementById('private-remote-pane');
const privateLocalPane = document.getElementById('private-local-pane');
const privateRemoteVideo = document.getElementById('private-remote-video');
const privateLocalVideo = document.getElementById('private-local-video');
let privateLocalVideoStream = null;
let privateRemoteVideoStream = null;
let isPrivateCameraOn = false;
let isPartnerCameraOn = false;
let privateFacingMode = 'user';
let isPrivateChatHidden = false;
let privateUnreadCount = 0;
let privateToastTimer = null;
let needsPrivateRenegotiation = false;
let privateQualityMode = localStorage.getItem('gc_video_quality') || 'auto';
let partnerRequestedQuality = null;
let isPrivateScreenSharing = false;
let isGroupScreenSharing = false;
const peerRequestedQualities = new Map();
const privateShareScreenBtn = document.getElementById('private-share-screen-btn');
const groupShareScreenBtn = document.getElementById('group-share-screen-btn');
let isPrivateInitiator = false;

async function syncPrivateTracksToPeer(pc) {
    if (!pc) return;
    const localAudioTrack = (localStream && localStream.getAudioTracks()[0]) || null;
    const localVideoTrack = (privateLocalVideoStream && isPrivateCameraOn && privateLocalVideoStream.getVideoTracks()[0]) || null;

    let audioTransceiver = getTransceiverByKind(pc, 'audio');
    try {
        if (localAudioTrack) {
            if (audioTransceiver) {
                audioTransceiver.direction = 'sendrecv';
                await audioTransceiver.sender.replaceTrack(localAudioTrack);
                if (typeof audioTransceiver.sender.setStreams === 'function' && localStream) {
                    audioTransceiver.sender.setStreams(localStream);
                }
            } else {
                pc.addTransceiver(localAudioTrack, { direction: 'sendrecv', streams: [localStream] });
            }
        } else if (audioTransceiver) {
            audioTransceiver.direction = 'recvonly';
            await audioTransceiver.sender.replaceTrack(null);
        } else {
            pc.addTransceiver('audio', { direction: 'recvonly' });
        }
    } catch (e) {
        console.warn('[1-on-1] sync audio note:', e);
    }

    let videoTransceiver = getTransceiverByKind(pc, 'video');
    try {
        if (localVideoTrack) {
            if (videoTransceiver) {
                videoTransceiver.direction = 'sendrecv';
                await videoTransceiver.sender.replaceTrack(localVideoTrack);
                if (typeof videoTransceiver.sender.setStreams === 'function' && privateLocalVideoStream) {
                    videoTransceiver.sender.setStreams(privateLocalVideoStream);
                }
            } else {
                pc.addTransceiver(localVideoTrack, { direction: 'sendrecv', streams: [privateLocalVideoStream] });
            }
            await applySenderVideoQuality(pc, partnerRequestedQuality);
        } else if (videoTransceiver) {
            videoTransceiver.direction = 'recvonly';
            await videoTransceiver.sender.replaceTrack(null);
        } else {
            pc.addTransceiver('video', { direction: 'recvonly' });
        }
    } catch (e) {
        console.warn('[1-on-1] sync video note:', e);
    }
}

async function renegotiatePrivatePeer() {
    if (!peerConnection) return;
    if (peerConnection.signalingState !== 'stable') {
        needsPrivateRenegotiation = true;
        return;
    }
    try {
        needsPrivateRenegotiation = false;
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { offer });
        console.log('[1-on-1] Renegotiation offer sent to partner');
    } catch (renegErr) {
        console.warn('[1-on-1] Renegotiation offer error:', renegErr);
    }
}
const groupMemberNames = new Map();
const groupMemberMediaStates = new Map();

// Helper to cleanly find the exact transceiver for audio or video without crossing media types
function getTransceiverByKind(pc, kind) {
    if (!pc || typeof pc.getTransceivers !== 'function') return null;
    return pc.getTransceivers().find(t =>
        (t.receiver && t.receiver.track && t.receiver.track.kind === kind) ||
        (t.sender && t.sender.track && t.sender.track.kind === kind)
    ) || null;
}

// Wildly Unpredictable & Funny Auto-Generated Avatar Generator
function getRandomFunnyAvatar() {
    const collections = [
        'fun-emoji',
        'bottts-neutral',
        'bottts',
        'adventurer',
        'big-smile',
        'pixel-art',
        'lorelei',
        'croodles'
    ];
    const quirkyNames = [
        'CrazyLlama', 'DancingTaco', 'GigglyPanda', 'AtomicSloth',
        'DiscoDoughnut', 'CrazyAvocado', 'SleepyPenguin', 'NinjaLlama',
        'FunkyMonkey', 'CosmicDuck', 'CheekyHamster', 'ZippyKoala',
        'WobblyFrog', 'SpicyPickle', 'MagicTaco', 'BouncingOtter',
        'GummyBear', 'SuperBanana', 'TurboRabbit', 'HappyCookie'
    ];
    const collection = collections[Math.floor(Math.random() * collections.length)];
    const name = quirkyNames[Math.floor(Math.random() * quirkyNames.length)];
    const num = Math.floor(Math.random() * 9999);
    const bgColors = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'd5f5e3', 'fdebd0'];
    const bg = bgColors[Math.floor(Math.random() * bgColors.length)];
    return `https://api.dicebear.com/7.x/${collection}/svg?seed=${name}-${num}&backgroundColor=${bg}`;
}

// Basic Profanity Filter (English)
const badWords = ['badword1', 'badword2', 'spam', 'scam']; // Extend as needed
function containsProfanity(text) {
    const lower = text.toLowerCase();
    return badWords.some(word => lower.includes(word));
}

// Sound System
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSystemSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (type === 'connect') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
    } else if (type === 'message') {
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'disconnect') {
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    }
}

const topics = [
    "Travel & Fun ✈️", "Favorite Movies 🎬", "Your Dreams 🚀",
    "Food & Cooking 🍕", "Music Taste 🎵", "Holidays 🎄",
    "Computers & Tech 🤖", "Books & Reading 📚", "Sports & Fitness ⚽",
    "Dream Jobs 💼", "Video Games 🎮", "When you were a child 🧸",
    "Outer Space 🌌", "Art & Creativity 🎨", "Coffee or Tea? ☕",
    "Pets & Animals 🐾", "Old History 🏺", "Clothes & Fashion 👗",
    "Taking Photos 📸", "Superpowers 🦸", "Perfect Weekend 🏖️",
    "Hidden Talents 🌟", "First Concert 🎙️", "Things you want to do 📝"
];

let currentRoomId = null;
let localStream = null;
let peerConnection = null;
let isMuted = false;
let startTime = null;
let timerInterval = null;
let isInitializing = false;
let audioContext = null;
let audioAnalyser = null;
let animationId = null;

// ICE/TURN server configuration — simple and proven working
let cachedTurnCredentials = null;
let turnCredentialsPromise = null;
let privateIceMonitor = null;

function getFallbackIceServers() {
    return [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
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
}

async function getTurnCredentials() {
    if (cachedTurnCredentials) return cachedTurnCredentials;
    if (turnCredentialsPromise) return turnCredentialsPromise;

    turnCredentialsPromise = (async () => {
        try {
            const response = await fetch('/api/ice-servers', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const servers = Array.isArray(data && data.iceServers) ? data.iceServers : getFallbackIceServers();
            console.log('%c✅ ICE servers loaded (' + servers.length + ' entries)', 'color: green; font-weight: bold');
            cachedTurnCredentials = servers;
            return servers;
        } catch (error) {
            console.warn('[ICE] Using fallback TURN servers:', error && error.message);
            cachedTurnCredentials = getFallbackIceServers();
            return cachedTurnCredentials;
        } finally {
            turnCredentialsPromise = null;
        }
    })();
    return turnCredentialsPromise;
}

function showTapSoundPill() {
    if (document.getElementById('tap-sound-pill')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'tap-sound-pill';
    btn.className = 'tap-sound-pill';
    btn.innerHTML = '<i class="fas fa-volume-up"></i> Tap for Sound';
    btn.addEventListener('click', () => {
        unlockMobileMedia();
        hideTapSoundPill();
    });
    document.body.appendChild(btn);
}

function hideTapSoundPill() {
    const btn = document.getElementById('tap-sound-pill');
    if (btn) btn.remove();
}

function safePlayMedia(mediaEl, label, promptSoundOnBlock = false) {
    if (!mediaEl || !mediaEl.srcObject) return;
    if (!mediaEl.paused || mediaEl._playPending) return;
    try {
        const playPromise = mediaEl.play();
        if (playPromise && typeof playPromise.then === 'function') {
            mediaEl._playPending = true;
            playPromise.then(() => {
                mediaEl._playPending = false;
                if (mediaEl.tagName === 'AUDIO') {
                    hideTapSoundPill();
                }
            }).catch((err) => {
                mediaEl._playPending = false;
                if (!err || err.name === 'AbortError') return;
                console.warn(label || 'Media playback deferred:', err.name || err.message);
                if (promptSoundOnBlock && err.name === 'NotAllowedError') {
                    showTapSoundPill();
                }
            });
        }
    } catch (e) {
        mediaEl._playPending = false;
    }
}

function unlockMobileMedia() {
    try {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
        if (groupAudioContext && groupAudioContext.state === 'suspended') {
            groupAudioContext.resume().catch(() => {});
        }
        if (remoteAudio && remoteAudio.srcObject && remoteAudio.paused) {
            safePlayMedia(remoteAudio, 'Remote audio unlock');
        }
        document.querySelectorAll('audio[id^="remote-audio-"]').forEach(el => {
            if (el.srcObject && el.paused) safePlayMedia(el, 'Group audio unlock');
        });
        document.querySelectorAll('video.participant-video:not(.hidden), video.split-video-feed:not(.hidden)').forEach(el => {
            if (el.srcObject && el.paused) safePlayMedia(el, 'Video unlock');
        });
    } catch (e) {}
}

document.addEventListener('pointerdown', unlockMobileMedia, { passive: true });

// Simple no-op ICE monitor stub — keeps API compatibility without false-positive "no-turn" errors
function createIceDiagnosticsMonitor({ pc, isInitiator, onStateChange, onRequestRestart, onBlocked }) {
    let restartCount = 0;
    let cleanedUp = false;
    let disconnectedTimer = null;

    const tryRestart = (reason) => {
        if (cleanedUp || restartCount >= 2) return false;
        restartCount++;
        console.warn(`[ICE] Restart #${restartCount} (${reason})`);
        if (typeof onRequestRestart === 'function') onRequestRestart(reason, restartCount);
        return true;
    };

    return {
        startWatch() {},
        noteLocalCandidate() {},
        noteRemoteCandidate() {},
        noteCandidateError() {},
        handleConnectionStateChange() {
            if (cleanedUp || !pc) return;
            const state = pc.iceConnectionState;
            if (typeof onStateChange === 'function') onStateChange(state);
            if (disconnectedTimer) { clearTimeout(disconnectedTimer); disconnectedTimer = null; }
            if (state === 'disconnected') {
                disconnectedTimer = setTimeout(() => {
                    if (!cleanedUp && pc && pc.iceConnectionState === 'disconnected') tryRestart('disconnected');
                }, 4000);
            } else if (state === 'failed') {
                tryRestart('ice-failed');
            }
        },
        getSummary() { return { isInitiator }; },
        cleanup() { cleanedUp = true; if (disconnectedTimer) clearTimeout(disconnectedTimer); }
    };
}

// Helpers
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.remove('hidden');
        screen.classList.add('active');
    }

    const mainContainer = document.getElementById('main-container');
    const appHeader = document.getElementById('app-header');

    if (screenId === 'group-room-screen' || screenId === 'group-lobby-screen') {
        if (mainContainer) mainContainer.classList.add('wide-mode');
        if (appHeader && screenId === 'group-room-screen') appHeader.classList.add('hidden');
        else if (appHeader) appHeader.classList.remove('hidden');
    } else {
        if (mainContainer) mainContainer.classList.remove('wide-mode');
        if (appHeader) {
            if (screenId === 'chat-screen') appHeader.classList.add('hidden');
            else appHeader.classList.remove('hidden');
        }
    }

    if (screenId === 'chat-screen') {
        topicBanner.classList.remove('hidden');
        setRandomTopic();
    } else {
        topicBanner.classList.add('hidden');
    }
}

// Rotate topics frequently to keep it fresh
function setRandomTopic() {
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];
    topicText.innerText = randomTopic;
}

// Auto-rotate topic every 7 minutes
setInterval(setRandomTopic, 420000);

function updatePrivateUnreadUi() {
    if (privateChatUnreadBadge) {
        if (privateUnreadCount > 0 && isPrivateChatHidden) {
            privateChatUnreadBadge.innerText = privateUnreadCount > 99 ? '99+' : String(privateUnreadCount);
            privateChatUnreadBadge.classList.remove('hidden');
        } else {
            privateChatUnreadBadge.classList.add('hidden');
        }
    }
}

function showPrivateToast(previewText) {
    if (!privateToastPreview || !isPrivateChatHidden) return;
    privateToastPreview.innerText = previewText;
    privateToastPreview.classList.remove('hidden');
    clearTimeout(privateToastTimer);
    privateToastTimer = setTimeout(() => {
        if (privateToastPreview) privateToastPreview.classList.add('hidden');
    }, 3600);
}

function togglePrivateChatVisibility(forceOpen) {
    isPrivateChatHidden = forceOpen === true ? false : !isPrivateChatHidden;
    if (messagesContainer) {
        messagesContainer.classList.toggle('chat-hidden', isPrivateChatHidden);
    }
    if (privateToggleChatBtn) {
        privateToggleChatBtn.classList.toggle('active', !isPrivateChatHidden);
        const icon = privateToggleChatBtn.querySelector('i');
        if (icon) {
            icon.className = isPrivateChatHidden ? 'fas fa-comment-dots' : 'fas fa-comment-slash';
        }
        privateToggleChatBtn.title = isPrivateChatHidden ? 'Show Messages' : 'Hide Messages';
    }
    if (!isPrivateChatHidden) {
        privateUnreadCount = 0;
        clearTimeout(privateToastTimer);
        if (privateToastPreview) privateToastPreview.classList.add('hidden');
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    updatePrivateUnreadUi();
}

function addMessage(text, type) {
    const div = document.createElement('div');
    if (type === 'system') {
        div.className = 'system-msg';
        div.innerText = text;
    } else {
        div.className = `msg ${type}`;
        div.innerText = text;
    }
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (type === 'received' && isPrivateChatHidden) {
        privateUnreadCount++;
        updatePrivateUnreadUi();
        showPrivateToast(`Partner: ${text}`);
    }
}

function addPrivateGifMessage(gifUrl, type) {
    if (!messagesContainer || !gifUrl) return;
    const div = document.createElement('div');
    div.className = `msg ${type} msg-gif-bubble`;
    const img = document.createElement('img');
    img.src = gifUrl;
    img.alt = 'GIF';
    img.className = 'msg-gif-img';
    img.loading = 'lazy';
    div.appendChild(img);
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (type === 'received' && isPrivateChatHidden) {
        privateUnreadCount++;
        updatePrivateUnreadUi();
        showPrivateToast('Partner sent a GIF');
    }
}

// Event Listeners
startBtn.addEventListener('click', () => {
    showScreen('waiting-screen');
    socket.emit('find_match');
});

if (howItWorksBtn) {
    howItWorksBtn.addEventListener('click', () => {
        howItWorksSection.classList.toggle('hidden');
        howItWorksSection.scrollIntoView({ behavior: 'smooth' });
    });
}

nextBtn.addEventListener('click', () => {
    // "Next Partner" flow: Disconnect -> Cleanup -> Find New
    socket.emit('manual_disconnect');
    endSession();

    // Immediate rematch
    showScreen('waiting-screen');
    socket.emit('find_match');
});

if (reportBtn) {
    reportBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to report and skip this person?')) {
            addMessage('User reported. Finding someone new...', 'system');
            socket.emit('manual_disconnect');
            setTimeout(() => {
                endSession();
                showScreen('waiting-screen');
                socket.emit('find_match');
            }, 1000);
        }
    });
}

if (stopBtn) {
    stopBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to stop the live session and leave?')) {
            socket.emit('manual_disconnect');
            endSession();
            playSystemSound('disconnect');
        }
    });
}

if (cancelWaitingBtn) {
    cancelWaitingBtn.addEventListener('click', () => {
        socket.emit('manual_disconnect');
        endSession();
    });
}

// Character Counter Logic
messageInput.addEventListener('input', () => {
    const len = messageInput.value.length;
    charCounter.innerText = `${len}/200`;
    charCounter.classList.toggle('limit', len >= 190);
});

muteBtn.addEventListener('click', toggleMute);
if (privateCamBtn) {
    privateCamBtn.addEventListener('click', togglePrivateCamera);
}
if (privateFlipCamBtn) {
    privateFlipCamBtn.addEventListener('click', togglePrivateFlipCamera);
}
if (privateToggleChatBtn) {
    privateToggleChatBtn.addEventListener('click', () => {
        togglePrivateChatVisibility();
    });
}
if (privateToastPreview) {
    privateToastPreview.addEventListener('click', () => {
        togglePrivateChatVisibility(true);
    });
}
if (privateLocalPane) {
    privateLocalPane.addEventListener('click', (e) => {
        if (!privateVideoStage || privateVideoStage.classList.contains('swapped-pip')) return;
        e.stopPropagation();
        privateVideoStage.classList.toggle('swapped-pip');
    });
}
if (privateRemotePane) {
    privateRemotePane.addEventListener('click', (e) => {
        if (!privateVideoStage || !privateVideoStage.classList.contains('swapped-pip')) return;
        e.stopPropagation();
        privateVideoStage.classList.toggle('swapped-pip');
    });
}
if (privateGifBtn) {
    privateGifBtn.addEventListener('click', () => {
        if (!gifKeyboardDrawer) return;
        gifDrawerTarget = 'private';
        const isOpen = gifKeyboardDrawer.classList.toggle('is-open');
        privateGifBtn.classList.toggle('active', isOpen);
        if (gifDrawerBackdrop) gifDrawerBackdrop.classList.toggle('hidden', !isOpen);
        if (isOpen) {
            loadLiveGifCategories();
            if (!gifSheetGrid.children.length || gifSheetGrid.querySelector('.gif-loading-state')) {
                loadGifsForCategory(currentGifCategory, currentGifQuery);
            }
        }
    });
}
if (chatScreen) {
    chatScreen.addEventListener('click', () => {
        if (remoteAudio && remoteAudio.paused && remoteAudio.srcObject) {
            remoteAudio.play().catch(() => {});
        }
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
    }, { passive: true });
}

function updatePrivateVideoStage() {
    if (!privateVideoStage) return;
    const chatScreenEl = document.getElementById('chat-screen');
    const remoteVideo = document.getElementById('private-remote-video');
    const remotePlaceholder = document.getElementById('private-remote-placeholder');
    const localVideo = document.getElementById('private-local-video');
    const localPlaceholder = document.getElementById('private-local-placeholder');
    const partnerAvatarImg = document.getElementById('split-partner-avatar');
    const partnerAvatarMain = document.getElementById('partner-avatar');
    const localAvatarImgSplit = document.getElementById('split-local-avatar');

    if (partnerAvatarImg && partnerAvatarMain && partnerAvatarMain.src) {
        partnerAvatarImg.src = partnerAvatarMain.src;
    }
    if (localAvatarImgSplit && myLocalFunnyAvatar) {
        localAvatarImgSplit.src = myLocalFunnyAvatar;
    }

    const isAnyVideoActive = isPrivateCameraOn || isPartnerCameraOn;

    if (isAnyVideoActive) {
        if (chatScreenEl) chatScreenEl.classList.add('video-active');
        if (topicBanner) topicBanner.classList.add('hidden');
        privateVideoStage.classList.remove('hidden');

        // Hide empty local cam-off box whenever partner's cam is streaming so it never blocks their face
        const hideSoloLocal = isPartnerCameraOn && !isPrivateCameraOn;
        if (privateLocalPane) {
            privateLocalPane.classList.toggle('hidden-when-solo-remote', hideSoloLocal);
        }
        if (hideSoloLocal) {
            privateVideoStage.classList.remove('swapped-pip');
        }

        // Local Split Pane
        if (isPrivateCameraOn && privateLocalVideoStream) {
            if (localVideo) {
                if (localVideo.srcObject !== privateLocalVideoStream) {
                    localVideo.srcObject = privateLocalVideoStream;
                }
                localVideo.style.transform = (!isPrivateScreenSharing && privateFacingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
                localVideo.classList.remove('hidden');
                if (localVideo.paused) localVideo.play().catch(() => {});
            }
            if (localPlaceholder) localPlaceholder.classList.add('hidden');
        } else {
            if (localVideo) {
                localVideo.classList.add('hidden');
                localVideo.srcObject = null;
            }
            if (localPlaceholder) localPlaceholder.classList.remove('hidden');
        }

        // Remote Split Pane
        if (isPartnerCameraOn && privateRemoteVideoStream) {
            if (remoteVideo) {
                remoteVideo.muted = true;
                if (remoteVideo.srcObject !== privateRemoteVideoStream) {
                    remoteVideo.srcObject = privateRemoteVideoStream;
                }
                remoteVideo.classList.remove('hidden');
                safePlayMedia(remoteVideo, 'Remote video play');
            }
            if (remotePlaceholder) remotePlaceholder.classList.add('hidden');
        } else {
            if (remoteVideo) {
                remoteVideo.classList.add('hidden');
            }
            if (remotePlaceholder) remotePlaceholder.classList.remove('hidden');
        }
    } else {
        if (chatScreenEl) chatScreenEl.classList.remove('video-active');
        if (topicBanner && chatScreenEl && chatScreenEl.classList.contains('active')) {
            topicBanner.classList.remove('hidden');
        }
        privateVideoStage.classList.add('hidden');
    }
}

async function togglePrivateCamera() {
    if (!peerConnection && (isInitializing || currentRoomId)) {
        const waitStart = Date.now();
        while (!peerConnection && Date.now() - waitStart < 6000) {
            await new Promise(r => setTimeout(r, 100));
        }
    }
    if (!peerConnection) {
        alert('Please wait until connected to a partner before starting video.');
        return;
    }

    if (!isPrivateCameraOn) {
        // TURN 1-ON-1 CAMERA ON
        try {
            console.log('[1-on-1] Requesting camera for private call...');
            privateLocalVideoStream = await requestCameraStreamForQuality(privateFacingMode, false);

            isPrivateCameraOn = true;
            if (privateCamBtn) {
                privateCamBtn.classList.add('active');
                const camIcon = privateCamBtn.querySelector('i');
                if (camIcon) camIcon.className = 'fas fa-video';
            }
            if (privateFlipCamBtn) {
                privateFlipCamBtn.classList.remove('hidden');
            }

            // Attach video track cleanly to 1-on-1 RTCPeerConnection
            const videoTrack = privateLocalVideoStream.getVideoTracks()[0];
            const transceiver = getTransceiverByKind(peerConnection, 'video');
            if (transceiver) {
                transceiver.direction = 'sendrecv';
                await transceiver.sender.replaceTrack(videoTrack);
                if (typeof transceiver.sender.setStreams === 'function' && privateLocalVideoStream) {
                    transceiver.sender.setStreams(privateLocalVideoStream);
                }
            } else {
                peerConnection.addTransceiver(videoTrack, {
                    direction: 'sendrecv',
                    streams: [privateLocalVideoStream]
                });
            }
            await applySenderVideoQuality(peerConnection, partnerRequestedQuality);

            // Renegotiate with partner (queued cleanly if initial offer/answer is still settling)
            await renegotiatePrivatePeer();

            socket.emit('private_camera_toggle', { isCameraOn: true });
            updatePrivateVideoStage();
            console.log('[1-on-1] Camera activated successfully');
        } catch (err) {
            console.error('[1-on-1] Camera error:', err);
            alert('Could not start camera. Please verify camera permissions in your browser.');
        }
    } else {
        // TURN 1-ON-1 CAMERA OFF
        console.log('[1-on-1] Turning camera OFF and releasing webcam hardware...');
        isPrivateCameraOn = false;
        isPrivateScreenSharing = false;
        if (privateShareScreenBtn) privateShareScreenBtn.classList.remove('screen-active');

        // Stop hardware track immediately
        if (privateLocalVideoStream) {
            privateLocalVideoStream.getTracks().forEach(t => t.stop());
            privateLocalVideoStream = null;
        }

        if (privateCamBtn) {
            privateCamBtn.classList.remove('active');
            const camIcon = privateCamBtn.querySelector('i');
            if (camIcon) camIcon.className = 'fas fa-video-slash';
        }
        if (privateFlipCamBtn) {
            privateFlipCamBtn.classList.add('hidden');
        }

        const transceiver = getTransceiverByKind(peerConnection, 'video');
        if (transceiver) {
            transceiver.direction = 'recvonly';
            try {
                await transceiver.sender.replaceTrack(null);
            } catch (e) {}
        }

        await renegotiatePrivatePeer();

        socket.emit('private_camera_toggle', { isCameraOn: false });
        updatePrivateVideoStage();
        console.log('[1-on-1] Camera deactivated. Voice continues uninterrupted.');
    }
}

async function togglePrivateFlipCamera() {
    if (!peerConnection || !isPrivateCameraOn) return;
    const nextMode = privateFacingMode === 'user' ? 'environment' : 'user';
    const oldStream = privateLocalVideoStream;

    try {
        const newStream = await requestCameraStreamForQuality(nextMode, true);
        const newTrack = newStream.getVideoTracks()[0];
        if (!newTrack) throw new Error('No replacement video track found');

        const transceiver = getTransceiverByKind(peerConnection, 'video');
        if (transceiver && transceiver.sender) {
            await transceiver.sender.replaceTrack(newTrack);
            await applySenderVideoQuality(peerConnection, partnerRequestedQuality);
        }

        if (oldStream) {
            oldStream.getTracks().forEach(t => t.stop());
        }

        privateLocalVideoStream = newStream;
        privateFacingMode = nextMode;
        updatePrivateVideoStage();
    } catch (err) {
        console.warn('[1-on-1] Could not switch camera:', err);
    }
}

socket.on('private_camera_toggle', ({ isCameraOn }) => {
    console.log('[1-on-1] Partner camera status:', isCameraOn);
    isPartnerCameraOn = !!isCameraOn;
    if (isPartnerCameraOn && !privateRemoteVideoStream && peerConnection && typeof peerConnection.getReceivers === 'function') {
        const videoReceiver = peerConnection.getReceivers().find(r => r.track && r.track.kind === 'video');
        if (videoReceiver && videoReceiver.track) {
            privateRemoteVideoStream = new MediaStream([videoReceiver.track]);
        }
    }
    updatePrivateVideoStage();
});

function endSession() {
    console.log('Ending session and cleaning up resources...');
    stopTimer();
    stopVisualizers(); // Renamed from stopVisualizer
    hideTapSoundPill();
    if (privateIceMonitor) {
        privateIceMonitor.cleanup();
        privateIceMonitor = null;
    }
    signalQueue = [];
    isInitializing = false;
    needsPrivateRenegotiation = false;
    isPrivateInitiator = false;
    if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Stop 1-on-1 private camera if active
    if (privateLocalVideoStream) {
        privateLocalVideoStream.getTracks().forEach(track => track.stop());
        privateLocalVideoStream = null;
    }
    privateRemoteVideoStream = null;
    isPrivateCameraOn = false;
    isPartnerCameraOn = false;
    privateFacingMode = 'user';
    partnerRequestedQuality = null;
    isPrivateScreenSharing = false;
    if (privateShareScreenBtn) privateShareScreenBtn.classList.remove('screen-active');
    const privateToolsTrayEl = document.getElementById('private-tools-tray');
    if (privateToolsTrayEl) privateToolsTrayEl.classList.add('hidden');
    const privatePlusBtnEl = document.getElementById('private-plus-btn');
    if (privatePlusBtnEl) privatePlusBtnEl.classList.remove('open');
    cancelActiveVoiceRecording('private');
    hideNetworkReconnectBanner();
    isPrivateChatHidden = false;
    privateUnreadCount = 0;
    clearTimeout(privateToastTimer);
    if (messagesContainer) messagesContainer.classList.remove('chat-hidden');
    if (privateToastPreview) privateToastPreview.classList.add('hidden');
    if (privateToggleChatBtn) {
        privateToggleChatBtn.classList.add('active');
        const msgIcon = privateToggleChatBtn.querySelector('i');
        if (msgIcon) msgIcon.className = 'fas fa-comment-slash';
        privateToggleChatBtn.title = 'Hide Messages';
    }
    updatePrivateUnreadUi();
    closeGifDrawer();
    if (privateFlipCamBtn) {
        privateFlipCamBtn.classList.add('hidden');
    }
    if (privateVideoStage) {
        privateVideoStage.classList.remove('swapped-pip');
    }
    if (privateLocalVideo) {
        privateLocalVideo.classList.add('hidden');
        privateLocalVideo.srcObject = null;
    }
    if (privateRemoteVideo) {
        privateRemoteVideo.classList.add('hidden');
        privateRemoteVideo.srcObject = null;
    }
    if (privateCamBtn) {
        privateCamBtn.classList.remove('active');
        const camIcon = privateCamBtn.querySelector('i');
        if (camIcon) camIcon.className = 'fas fa-video-slash';
    }
    if (privateVideoStage) {
        privateVideoStage.classList.add('hidden');
    }
    const chatScreenEl = document.getElementById('chat-screen');
    if (chatScreenEl) {
        chatScreenEl.classList.remove('video-active');
    }

    showScreen('start-screen');
    messagesContainer.innerHTML = '';
    currentRoomId = null;
    callStatus.innerText = 'Connecting...';
    callTimer.innerText = '00:00';
    muteBtn.classList.remove('muted');
    const icon = muteBtn.querySelector('i');
    if (icon) {
        icon.classList.remove('fa-microphone-slash');
        icon.classList.add('fa-microphone');
    }
    isMuted = false;
}

function toggleMute() {
    isMuted = !isMuted;
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
    }
    muteBtn.classList.toggle('muted', isMuted);

    // Update icon
    const icon = muteBtn.querySelector('i');
    if (icon) {
        if (isMuted) {
            icon.classList.remove('fa-microphone');
            icon.classList.add('fa-microphone-slash');
        } else {
            icon.classList.remove('fa-microphone-slash');
            icon.classList.add('fa-microphone');
        }
    }
}

function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        callTimer.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

function initVisualizers(localStreamArg, remoteStream) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

        // Local Visualizer (Your Mic)
        let localAnalyser = null;
        if (localStreamArg && localStreamArg.getAudioTracks && localStreamArg.getAudioTracks().length > 0) {
            const localSource = audioContext.createMediaStreamSource(localStreamArg);
            localAnalyser = audioContext.createAnalyser();
            localAnalyser.fftSize = 32;
            localSource.connect(localAnalyser);
        }

        // Remote Visualizer (Partner Mic)
        let remoteAnalyser = null;
        if (remoteStream && remoteStream.getAudioTracks && remoteStream.getAudioTracks().length > 0) {
            const remoteSource = audioContext.createMediaStreamSource(remoteStream);
            remoteAnalyser = audioContext.createAnalyser();
            remoteAnalyser.fftSize = 32;
            remoteSource.connect(remoteAnalyser);
        }

        drawVisualizers(localAnalyser, remoteAnalyser);
    } catch (e) {
        console.warn('Visualizer setup skipped:', e.message);
    }
}

function drawVisualizers(localAn, remoteAn) {
    const dataArray = new Uint8Array(16);
    const localBars = document.querySelectorAll('.local-bar'); // We need these in HTML
    const remoteBars = document.querySelectorAll('.bar');

    function animate() {
        if (!localAn && !remoteAn) return;
        animationId = requestAnimationFrame(animate);

        // Update Local Bars
        if (localAn && localBars.length) {
            localAn.getByteFrequencyData(dataArray);
            localBars.forEach((bar, i) => {
                const val = (dataArray[i % 8] / 255) * 100;
                bar.style.height = `${Math.max(15, val)}%`;
            });
        }

        // Update Remote Bars
        if (remoteAn && remoteBars.length) {
            remoteAn.getByteFrequencyData(dataArray);
            remoteBars.forEach((bar, i) => {
                const val = (dataArray[i % 8] / 255) * 100;
                bar.style.height = `${Math.max(15, val)}%`;
            });
        }
    }
    animate();
}

function stopVisualizers() {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().then(() => { audioContext = null; });
    }
    document.querySelectorAll('.bar, .local-bar').forEach(bar => {
        bar.style.height = '20%';
        bar.style.opacity = '0.5';
    });
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const text = messageInput.value.trim();
    if (text) {
        if (containsProfanity(text)) {
            addMessage('Please be respectful. Avoid offensive language.', 'system');
            return;
        }
        socket.emit('message', text);
        addMessage(text, 'sent');
        messageInput.value = '';
        charCounter.innerText = '0/200';
        syncPrivateInputActionButton();
        messageInput.focus();
    }
}

// Mobile helper: Scroll to input on focus
messageInput.addEventListener('focus', () => {
    setTimeout(() => {
        messageInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 300);
});

// Socket Events
socket.on('connect', () => {
    console.log('Connected to server. Waiting for count...');
});

socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
    if (userCountDisplay) userCountDisplay.innerText = 'Offline';
});

socket.on('online_count', (count) => {
    console.log('Live Online Count Received:', count);
    if (userCountDisplay) {
        userCountDisplay.innerText = `${count} People Online`;
    }
});

socket.on('waiting', (msg) => {
    console.log(msg);
    // Already on waiting screen
});

let signalQueue = [];

socket.on('match_found', async (data) => {
    console.log('Match found! Initiator:', data.isInitiator);
    currentRoomId = data.roomId;

    // Set wildly random and funny profile avatar per session
    if (partnerAvatar) {
        partnerAvatar.src = getRandomFunnyAvatar();
    }

    showScreen('chat-screen');
    addMessage('Connected! Say hello.', 'system');
    setTimeout(() => {
        addMessage('Tip: Be polite and keep it friendly! 🌍', 'system');
    }, 1500);

    // Initialize WebRTC
    await initWebRTC(data.isInitiator);
});

async function initWebRTC(isCaller) {
    if (isInitializing) return;
    isInitializing = true;
    isPrivateInitiator = !!isCaller;
    partnerRequestedQuality = null;
    isPrivateScreenSharing = false;
    if (privateShareScreenBtn) privateShareScreenBtn.classList.remove('screen-active');

    try {
        console.log('Requesting microphone...');
        callStatus.innerText = 'Please allow microphone...';

        // Try microphone access, but fall back cleanly to listen/chat if blocked or unavailable
        const mediaDevices = navigator.mediaDevices || {};
        const getUserMedia = mediaDevices.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia ||
            navigator.msGetUserMedia;

        if (getUserMedia) {
            try {
                if (mediaDevices.getUserMedia) {
                    try {
                        localStream = await navigator.mediaDevices.getUserMedia({
                            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                        });
                    } catch (audioConstraintErr) {
                        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    }
                } else {
                    localStream = await new Promise((res, rej) => getUserMedia.call(navigator, { audio: true }, res, rej));
                }
                console.log('Mic access granted.');
                initVisualizers(localStream, null);
            } catch (micErr) {
                console.warn('Mic access skipped (listen-only 1-on-1 fallback):', micErr && micErr.message);
                localStream = null;
                isMuted = true;
                if (muteBtn) muteBtn.classList.add('muted');
                addMessage('Microphone disabled/unavailable — you can still hear partner, text, and use video.', 'system');
            }
        } else {
            localStream = null;
        }

        callStatus.innerText = 'Connecting...';

        // Fetch fresh STUN + TURN credentials for this connection
        console.log('Fetching ICE server credentials...');
        const iceServers = await getTurnCredentials();

        const rtcConfig = {
            iceServers: iceServers,
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all' // Allow all connection types (host, srflx, relay)
        };

        console.log("Initializing RTCPeerConnection with config:", JSON.stringify(rtcConfig, null, 2));
        peerConnection = new RTCPeerConnection(rtcConfig);

        // Offerer initializes audio+video transceivers upfront; Answerer binds tracks after setRemoteDescription(offer)
        if (isCaller) {
            await syncPrivateTracksToPeer(peerConnection);
        }

        let privateRelayNotified = false;
        let privateBlockedNotified = false;
        if (privateIceMonitor) privateIceMonitor.cleanup();
        privateIceMonitor = createIceDiagnosticsMonitor({
            pc: peerConnection,
            isInitiator: isPrivateInitiator,
            onStateChange: (state) => {
                if (!peerConnection) return;
                console.log('ICE Connection State Change:', state);
                if (state === 'checking') {
                    callStatus.innerText = 'Connecting audio & video...';
                } else if (state === 'connected' || state === 'completed') {
                    hideNetworkReconnectBanner();
                    callStatus.innerText = localStream ? 'Connected - Speaking' : 'Connected - Listening';
                    if (isPartnerCameraOn && privateRemoteVideoStream) {
                        updatePrivateVideoStage();
                    }
                } else if (state === 'failed' || state === 'disconnected') {
                    callStatus.innerText = 'Reconnecting...';
                    showNetworkReconnectBanner('Network hiccup — reconnecting call...');
                } else {
                    callStatus.innerText = 'Status: ' + state;
                }
            },
            onRequestRestart: async () => {
                if (!peerConnection) return;
                if (isPrivateInitiator) {
                    if (peerConnection.signalingState === 'stable') {
                        try {
                            if (typeof peerConnection.restartIce === 'function') {
                                peerConnection.restartIce();
                            }
                            const offer = await peerConnection.createOffer({ iceRestart: true });
                            await peerConnection.setLocalDescription(offer);
                            socket.emit('signal', { offer });
                        } catch (e) {
                            console.warn('[1-on-1] ICE restart offer failed:', e);
                        }
                    }
                } else {
                    socket.emit('signal', { requestIceRestart: true });
                }
            },
            onBlocked: (reason) => {
                if (!peerConnection || privateBlockedNotified) return;
                privateBlockedNotified = true;
                if (reason === 'no-turn') {
                    callStatus.innerText = 'NAT Blocked — Needs TURN Relay';
                    addMessage('Direct P2P audio/video was blocked between these networks because no active TURN relay server is configured on the server.', 'system');
                } else {
                    callStatus.innerText = 'Connection Blocked — Retrying';
                    addMessage('Network firewall blocked direct audio/video between devices.', 'system');
                }
            }
        });

        // Monitor connection state - Detailed UI updates + resilient ICE restart
        peerConnection.oniceconnectionstatechange = () => {
            if (privateIceMonitor) privateIceMonitor.handleConnectionStateChange();
        };

        peerConnection.onicegatheringstatechange = () => {
            console.log("ICE Gathering State:", peerConnection.iceGatheringState);
        };

        peerConnection.ontrack = (event) => {
            console.log('Got remote track in 1-on-1:', event.track.kind);
            if (event.track.kind === 'audio') {
                const audioStream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
                if (remoteAudio.srcObject !== audioStream) {
                    remoteAudio.srcObject = audioStream;
                }
                safePlayMedia(remoteAudio, 'Remote audio play', true);

                callStatus.innerText = localStream ? 'Connected - Speaking' : 'Connected - Listening';
                startTimer();
                initVisualizers(localStream, audioStream);
            } else if (event.track.kind === 'video') {
                const stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
                privateRemoteVideoStream = stream;
                if (privateRemoteVideo) {
                    privateRemoteVideo.muted = true;
                    if (privateRemoteVideo.srcObject !== stream) {
                        privateRemoteVideo.srcObject = stream;
                    }
                }
                if (!event.track.muted || isPartnerCameraOn) {
                    isPartnerCameraOn = true;
                    safePlayMedia(privateRemoteVideo, 'Remote video play');
                }
                updatePrivateVideoStage();

                event.track.onunmute = () => {
                    console.log('[1-on-1] Partner video track unmuted');
                    privateRemoteVideoStream = stream;
                    isPartnerCameraOn = true;
                    if (privateRemoteVideo) {
                        privateRemoteVideo.muted = true;
                        if (privateRemoteVideo.srcObject !== stream) {
                            privateRemoteVideo.srcObject = stream;
                        }
                        safePlayMedia(privateRemoteVideo, 'Remote video unmute play');
                    }
                    updatePrivateVideoStage();
                };

                event.track.onmute = () => {
                    console.log('[1-on-1] Partner video track muted');
                    if (!isPartnerCameraOn) {
                        updatePrivateVideoStage();
                    }
                };

                event.track.onended = () => {
                    console.log('[1-on-1] Partner video track ended');
                    isPartnerCameraOn = false;
                    privateRemoteVideoStream = null;
                    updatePrivateVideoStage();
                };
            }
        };

        peerConnection.onicecandidateerror = (event) => {
            if (privateIceMonitor) privateIceMonitor.noteCandidateError(event);
            console.warn("ICE Candidate Error:", event.errorCode, event.errorText);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                if (privateIceMonitor) privateIceMonitor.noteLocalCandidate(event.candidate);
                const candidateStr = event.candidate.candidate;
                console.log(`[ICE] Candidate (${event.candidate.type}):`, candidateStr);

                if (candidateStr.includes('typ relay') && !privateRelayNotified) {
                    privateRelayNotified = true;
                    addMessage('🌐 Cross-network relay ready!', 'system');
                }

                socket.emit('signal', { candidate: event.candidate });
            } else {
                console.log("🏁 ICE Gathering Complete", privateIceMonitor ? privateIceMonitor.getSummary() : {});
            }
        };

        // Process signals that arrived while getting mic
        console.log(`Processing ${signalQueue.length} queued signals`);
        while (signalQueue.length > 0) {
            const data = signalQueue.shift();
            await handleSignal(data);
        }

        if (isCaller) {
            console.log('Creating offer...');
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { offer });
            if (privateIceMonitor) privateIceMonitor.startWatch();
        }
        emitCurrentQualityPref('private');
        playSystemSound('connect');
    } catch (err) {
        console.error('WebRTC Error:', err);
        let errorMsg = err.message;
        if (err.name === 'NotAllowedError') {
            errorMsg = 'Microphone access denied. Please allow it in browser settings.';
        } else if (err.name === 'NotFoundError') {
            errorMsg = 'No microphone found on your device.';
        } else if (err.name === 'NotReadableError') {
            errorMsg = 'Microphone is already in use by another app.';
        }
        callStatus.innerText = 'Error: ' + errorMsg;
        addMessage(`Call setup failed: ${errorMsg}`, 'system');
    } finally {
        isInitializing = false;
    }
}

socket.on('signal', async (data) => {
    if (!peerConnection || isInitializing) {
        console.log('Queueing signal');
        signalQueue.push(data);
    } else {
        await handleSignal(data);
    }
});

async function handleSignal(data) {
    console.log('Handling signal:', Object.keys(data));
    if (data.offer) {
        // Perfect Negotiation glare handling so simultaneous camera activation never drops tracks
        if (peerConnection.signalingState !== 'stable') {
            if (peerConnection.signalingState === 'have-local-offer') {
                const isPolite = !isPrivateInitiator;
                if (isPolite) {
                    console.log('[1-on-1] Polite peer rolling back offer for glare');
                    await peerConnection.setLocalDescription({ type: 'rollback' });
                } else {
                    console.log('[1-on-1] Impolite peer ignoring collision offer');
                    return;
                }
            }
        }
        console.log('Setting remote description (offer)...');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        while (signalQueue.length > 0 && signalQueue[0].candidate) {
            const c = signalQueue.shift();
            try { await peerConnection.addIceCandidate(new RTCIceCandidate(c.candidate)); } catch (e) {}
        }
        // Always bind local mic & camera onto the Offer's exact transceivers before answering
        await syncPrivateTracksToPeer(peerConnection);
        console.log('Creating answer...');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('Sending answer...');
        socket.emit('signal', { answer });
        if (privateIceMonitor) privateIceMonitor.startWatch();
        if (needsPrivateRenegotiation && peerConnection.signalingState === 'stable') {
            await renegotiatePrivatePeer();
        }
    } else if (data.answer) {
        console.log('Setting remote description (answer)...');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        while (signalQueue.length > 0 && signalQueue[0].candidate) {
            const c = signalQueue.shift();
            if (privateIceMonitor) privateIceMonitor.noteRemoteCandidate(c.candidate);
            try { await peerConnection.addIceCandidate(new RTCIceCandidate(c.candidate)); } catch (e) {}
        }
        if (needsPrivateRenegotiation && peerConnection.signalingState === 'stable') {
            await renegotiatePrivatePeer();
        }
    } else if (data.requestIceRestart && isPrivateInitiator && peerConnection && peerConnection.signalingState === 'stable') {
        try {
            if (typeof peerConnection.restartIce === 'function') peerConnection.restartIce();
            const offer = await peerConnection.createOffer({ iceRestart: true });
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { offer });
        } catch (e) {
            console.warn('[1-on-1] Remote requested ICE restart failed:', e);
        }
    } else if (data.candidate) {
        if (privateIceMonitor) privateIceMonitor.noteRemoteCandidate(data.candidate);
        console.log("ICE [Remote Candidate Received]:", data.candidate.candidate);
        if (peerConnection && peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                console.error('Error adding candidate', e);
            }
        } else {
            console.log('Queueing candidate (no remote desc yet)');
            signalQueue.push(data);
        }
    }
}

socket.on('message', (data) => {
    addMessage(data.text, 'received');
    playSystemSound('message');
});

socket.on('private_gif', (data) => {
    if (data && data.gifUrl) {
        addPrivateGifMessage(data.gifUrl, 'received');
        playSystemSound('message');
    }
});

socket.on('typing', () => {
    let typingIndicator = document.getElementById('typing-indicator');
    if (!typingIndicator) {
        typingIndicator = document.createElement('div');
        typingIndicator.id = 'typing-indicator';
        typingIndicator.className = 'system-msg';
        typingIndicator.innerText = 'your partner is typing...';
        typingIndicator.style.opacity = '0.7';
        messagesContainer.appendChild(typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});

socket.on('stop_typing', () => {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) typingIndicator.remove();
});

let typingTimeout;
messageInput.addEventListener('input', () => {
    socket.emit('typing');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing');
    }, 1000);
});

socket.on('partner_disconnected', () => {
    addMessage('your partner left. Finding someone new...', 'system');
    setTimeout(() => {
        endSession();
        // Optional: Auto-search?
        // showScreen('waiting-screen');
        // socket.emit('find_match');
    }, 2000);
});

socket.on('disconnected_local', () => {
    // Confirmed disconnect from server
});


// ==========================================================================
// GROUP CHAT & VOICE/VIDEO CLIENT ENGINE (NEW FEATURE)
// ==========================================================================

// Group State Variables
let groupPeers = new Map(); // memberId -> { pc, displayName, audioElement, videoStream, ... }
let groupPendingConnections = new Map(); // memberId -> Promise<peerData>
let groupQueuedCandidates = new Map(); // memberId -> Array of candidate objects
let groupAudioStream = null;
let groupVideoStream = null;
let isGroupAudioMuted = false;
let isLocalCameraOn = false;
let groupFacingMode = 'user';
let isPublicRoomMode = false;
let currentGroupPin = null;
let currentGroupName = null;
let myGroupMemberId = null;
let isCurrentGroupOwner = false;
let groupSpeechInterval = null;
let isSpeakingState = false;
let groupAudioContext = null;
let selectedMediaDataUrl = null;
let mediaCountdownTimer = null;

// DOM Elements - Public Live & Group Lobby
const publicLiveBtn = document.getElementById('public-live-btn');
const publicLiveBadge = document.getElementById('public-live-badge');
const groupLobbyBtn = document.getElementById('group-lobby-btn');
const roomPinChip = document.getElementById('room-pin-chip');
const btnCopyLiveLink = document.getElementById('btn-copy-live-link');
const groupOnlineText = document.getElementById('group-online-text');
const btnToggleLiveChat = document.getElementById('btn-toggle-live-chat');
const publicPreviewModal = document.getElementById('public-preview-modal');
const closePublicPreviewBtn = document.getElementById('close-public-preview-btn');
const previewLiveCountNum = document.getElementById('preview-live-count-num');
const previewLiveCountRing = document.getElementById('preview-live-count-ring');
const previewLiveHeadline = document.getElementById('preview-live-headline');
const previewLiveSubtext = document.getElementById('preview-live-subtext');
const previewCamCount = document.getElementById('preview-cam-count');
const previewMicCount = document.getElementById('preview-mic-count');
const btnPublicEnterVoice = document.getElementById('btn-public-enter-voice');
const btnPublicEnterVideo = document.getElementById('btn-public-enter-video');
const btnPublicEnterListen = document.getElementById('btn-public-enter-listen');
const groupBackHomeBtn = document.getElementById('group-back-home-btn');
const panelCreateGroup = document.getElementById('panel-create-group');
const panelJoinGroup = document.getElementById('panel-join-group');
const linkShowCreate = document.getElementById('link-show-create');
const linkShowJoin = document.getElementById('link-show-join');

// Form Elements - Create
const createGroupNameInput = document.getElementById('create-group-name');
const createGroupPassInput = document.getElementById('create-group-password');
const createGroupUserInput = document.getElementById('create-group-username');
const btnSubmitCreateGroup = document.getElementById('btn-submit-create-group');
const createGroupError = document.getElementById('create-group-error');

// Form Elements - Join (Default View)
const joinGroupPassInput = document.getElementById('join-group-password');
const joinGroupUserInput = document.getElementById('join-group-username');
const btnSubmitJoinGroup = document.getElementById('btn-submit-join-group');
const joinGroupError = document.getElementById('join-group-error');

// Room Elements
const roomGroupName = document.getElementById('room-group-name');
const roomPinDisplay = document.getElementById('room-pin-display');
const btnDeleteGroup = document.getElementById('btn-delete-group');
const btnLeaveGroup = document.getElementById('btn-leave-group');
const groupLeaveControlBtn = document.getElementById('group-leave-control-btn');
const groupParticipantsGrid = document.getElementById('group-participants-grid');
const localCard = document.getElementById('card-local');
const localAvatarBox = document.getElementById('local-avatar-box');
const localAvatarImg = document.getElementById('local-avatar-img');
const localVideoPreview = document.getElementById('local-video-preview');
const localDisplayName = document.getElementById('local-display-name');
const localMicIndicator = document.getElementById('local-mic-indicator');
const localCamIndicator = document.getElementById('local-cam-indicator');
const groupMicBtn = document.getElementById('group-mic-btn');
const groupCamBtn = document.getElementById('group-cam-btn');
const groupFlipCamBtn = document.getElementById('group-flip-cam-btn');
const groupOnlineCount = document.getElementById('group-online-count');

// Live Stream & Chat Elements
const liveOverlayStream = document.getElementById('live-overlay-stream');
const liveChatForm = document.getElementById('live-chat-form');
const liveChatInput = document.getElementById('live-chat-input');
const btnToggleGifDrawer = document.getElementById('btn-toggle-gif-drawer');
const gifKeyboardDrawer = document.getElementById('gif-keyboard-drawer');
const gifDrawerBackdrop = document.getElementById('gif-drawer-backdrop');
const btnCloseGifDrawer = document.getElementById('btn-close-gif-drawer');
const gifSearchForm = document.getElementById('gif-search-form');
const gifSheetSearch = document.getElementById('gif-sheet-search');
const btnClearGifSearch = document.getElementById('btn-clear-gif-search');
const btnRunGifSearch = document.getElementById('btn-run-gif-search');
const gifSheetGrid = document.getElementById('gif-sheet-grid');
const gifTagsContainer = document.getElementById('gif-tags-container');
let gifDrawerTarget = 'group';
let myLocalFunnyAvatar = getRandomFunnyAvatar();

// Stable Identity Map: memberId -> avatarUrl (prevents random avatar re-generation)
const userAvatarsMap = new Map();

function getStableAvatarForUser(userId, explicitAvatar) {
    if (explicitAvatar) {
        if (userId) userAvatarsMap.set(userId, explicitAvatar);
        return explicitAvatar;
    }
    if (userId && userAvatarsMap.has(userId)) {
        return userAvatarsMap.get(userId);
    }
    // Stable seed per user ID so their profile never changes
    const seed = userId ? encodeURIComponent(userId) : 'Friend';
    const stableUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
    if (userId) userAvatarsMap.set(userId, stableUrl);
    return stableUrl;
}

// Disappearing Media Elements
const groupShareMediaBtn = document.getElementById('group-share-media-btn');
const shareMediaModal = document.getElementById('share-media-modal');
const closeShareModalBtn = document.getElementById('close-share-modal-btn');
const mediaFileInput = document.getElementById('media-file-input');
const mediaUrlInput = document.getElementById('media-url-input');
const fileNamePreview = document.getElementById('file-name-preview');
const btnSendMedia = document.getElementById('btn-send-media');
const disappearingMediaOverlay = document.getElementById('disappearing-media-overlay');
const mediaPopupSender = document.getElementById('media-popup-sender');
const mediaCountdownSec = document.getElementById('media-countdown-sec');
const mediaPopupImg = document.getElementById('media-popup-img');
const mediaProgressFill = document.getElementById('media-progress-fill');
const closeMediaPopupBtn = document.getElementById('close-media-popup-btn');

// ==========================================
// 1. NAVIGATION & SWITCHING (PUBLIC LIVE & PIN JOIN)
// ==========================================
let latestPublicStatus = { count: 0, cameraCount: 0, talkingCount: 0 };
let serverRoomCount = null;
let isLiveChatHidden = false;

function renderPublicLiveStatus(status) {
    latestPublicStatus = status || { count: 0, cameraCount: 0, talkingCount: 0 };
    const { count, cameraCount, talkingCount } = latestPublicStatus;

    const badge = document.getElementById('public-live-badge');
    if (badge) {
        if (count > 0) {
            badge.classList.add('is-live');
            badge.innerText = count === 1
                ? `1 person in Public Call${cameraCount ? ' • Cam On' : ''}`
                : `${count} people in Public Call${cameraCount ? ` • ${cameraCount} Cam` : ''}`;
        } else {
            badge.classList.remove('is-live');
            badge.innerText = '0 in Public Call • Tap to Start';
        }
    }

    // Also update Pre-Join Public Live Modal live in real-time
    if (previewLiveCountNum) previewLiveCountNum.innerText = String(count);
    if (previewLiveCountRing) previewLiveCountRing.classList.toggle('has-people', count > 0);
    if (previewLiveHeadline) {
        previewLiveHeadline.innerText = count === 0
            ? 'Public Video Call Is Empty'
            : count === 1
                ? '1 Person Is in Public Video Call'
                : `${count} People Are in Public Video Call`;
    }
    if (previewLiveSubtext) {
        previewLiveSubtext.innerText = count === 0
            ? 'Be the first to start Live! Others who open this site can join immediately.'
            : 'No password or username needed. Pick how you want to join below:';
    }
    if (previewCamCount) previewCamCount.innerText = String(cameraCount || 0);
    if (previewMicCount) previewMicCount.innerText = String(talkingCount || 0);
}

socket.on('public_live_status', (status) => {
    renderPublicLiveStatus(status);
});

socket.on('public_live_count', (count) => {
    renderPublicLiveStatus({ ...latestPublicStatus, count });
});

function openPublicPreviewModal() {
    renderPublicLiveStatus(latestPublicStatus);
    if (publicPreviewModal) {
        publicPreviewModal.classList.remove('hidden');
    } else {
        handleJoinPublicLive('voice');
    }
}

function closePublicPreviewModal() {
    if (publicPreviewModal) publicPreviewModal.classList.add('hidden');
}

if (publicLiveBtn) {
    publicLiveBtn.addEventListener('click', openPublicPreviewModal);
}
if (closePublicPreviewBtn) {
    closePublicPreviewBtn.addEventListener('click', closePublicPreviewModal);
}
if (btnPublicEnterVoice) {
    btnPublicEnterVoice.addEventListener('click', () => handleJoinPublicLive('voice'));
}
if (btnPublicEnterVideo) {
    btnPublicEnterVideo.addEventListener('click', () => handleJoinPublicLive('video'));
}
if (btnPublicEnterListen) {
    btnPublicEnterListen.addEventListener('click', () => handleJoinPublicLive('listen'));
}

if (btnToggleLiveChat) {
    btnToggleLiveChat.addEventListener('click', () => {
        isLiveChatHidden = !isLiveChatHidden;
        if (liveOverlayStream) liveOverlayStream.classList.toggle('chat-hidden', isLiveChatHidden);
        btnToggleLiveChat.classList.toggle('active', !isLiveChatHidden);
    });
}

if (btnCopyLiveLink) {
    btnCopyLiveLink.addEventListener('click', async () => {
        const shareUrl = `${window.location.origin}/?live=public`;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(shareUrl);
            } else {
                const tempInput = document.createElement('input');
                tempInput.value = shareUrl;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                tempInput.remove();
            }
            btnCopyLiveLink.innerHTML = '<i class="fas fa-check"></i> <span class="hide-xs">Copied!</span>';
            setTimeout(() => {
                if (btnCopyLiveLink) btnCopyLiveLink.innerHTML = '<i class="fas fa-share-alt"></i> <span class="hide-xs">Share</span>';
            }, 2000);
        } catch (e) {
            prompt('Copy this Public Video Call link:', shareUrl);
        }
    });
}

function handleJoinPublicLive(mode = 'voice') {
    closePublicPreviewModal();
    if (!myLocalFunnyAvatar) {
        myLocalFunnyAvatar = getRandomFunnyAvatar();
    }

    if (publicLiveBtn) {
        publicLiveBtn.disabled = true;
    }

    const startMuted = mode === 'listen';
    socket.emit('public_live_join', { avatarUrl: myLocalFunnyAvatar, isAudioMuted: startMuted }, async (response) => {
        if (publicLiveBtn) {
            publicLiveBtn.disabled = false;
        }

        if (!response || !response.success) {
            alert((response && response.error) || 'Could not enter Public Video Call. Please try again.');
            return;
        }

        isPublicRoomMode = true;
        currentGroupPin = response.group.pin;
        currentGroupName = response.group.name || 'Public Video Call';
        myGroupMemberId = response.memberId;
        isCurrentGroupOwner = false;
        serverRoomCount = typeof response.roomCount === 'number' ? response.roomCount : (response.existingMembers ? response.existingMembers.length + 1 : 1);

        userAvatarsMap.set(myGroupMemberId, myLocalFunnyAvatar);

        // Update Top Live Header cleanly for Public Mode
        if (roomGroupName) roomGroupName.innerText = 'Public Video Call';
        if (roomPinChip) {
            roomPinChip.innerHTML = '<i class="fas fa-globe"></i> Open to All';
        }
        if (groupOnlineText) groupOnlineText.innerText = window.innerWidth <= 440 ? 'live' : 'in Public Call';
        if (btnCopyLiveLink) btnCopyLiveLink.classList.remove('hidden');
        if (btnDeleteGroup) btnDeleteGroup.classList.add('hidden');

        isLiveChatHidden = false;
        if (liveOverlayStream) liveOverlayStream.classList.remove('chat-hidden');
        if (btnToggleLiveChat) btnToggleLiveChat.classList.add('active');

        localDisplayName.innerText = `${response.displayName} (You)`;
        localAvatarImg.src = myLocalFunnyAvatar;

        const othersCount = Math.max(0, serverRoomCount - 1);
        const peopleMsg = othersCount === 0
            ? 'You are the first one in Public Call! Tap Share to invite friends.'
            : `${serverRoomCount} people in Public Call right now. Talk, turn on camera, or chat below!`;

        if (liveOverlayStream) {
            liveOverlayStream.innerHTML = `
                <div class="live-stream-welcome-bubble">
                    <i class="fas fa-globe"></i> ${peopleMsg}
                </div>
            `;
        }

        showScreen('group-room-screen');
        await initGroupVoiceRoom(response.existingMembers, {
            allowListenOnly: true,
            skipMicRequest: mode === 'listen',
            autoEnableCamera: mode === 'video'
        });
    });
}

if (groupLobbyBtn) {
    groupLobbyBtn.addEventListener('click', () => {
        // Show Join Panel by default every time!
        if (panelJoinGroup) panelJoinGroup.classList.remove('hidden');
        if (panelCreateGroup) panelCreateGroup.classList.add('hidden');
        if (joinGroupError) joinGroupError.classList.add('hidden');
        if (createGroupError) createGroupError.classList.add('hidden');
        try {
            const savedName = localStorage.getItem('gc_last_display_name');
            if (savedName) {
                if (joinGroupUserInput && !joinGroupUserInput.value.trim()) joinGroupUserInput.value = savedName;
                if (createGroupUserInput && !createGroupUserInput.value.trim()) createGroupUserInput.value = savedName;
            }
        } catch (e) {}
        showScreen('group-lobby-screen');
    });
}

if (groupBackHomeBtn) {
    groupBackHomeBtn.addEventListener('click', () => {
        showScreen('start-screen');
    });
}

// Switch to Create View
if (linkShowCreate) {
    linkShowCreate.addEventListener('click', () => {
        panelJoinGroup.classList.add('hidden');
        panelCreateGroup.classList.remove('hidden');
        if (createGroupError) createGroupError.classList.add('hidden');
    });
}

// Switch back to Join View
if (linkShowJoin) {
    linkShowJoin.addEventListener('click', () => {
        panelCreateGroup.classList.add('hidden');
        panelJoinGroup.classList.remove('hidden');
        if (joinGroupError) joinGroupError.classList.add('hidden');
    });
}

// ==========================================
// 2. JOIN GROUP (DEFAULT PRIMARY ACTION)
// ==========================================
if (btnSubmitJoinGroup) {
    btnSubmitJoinGroup.addEventListener('click', handleJoinGroup);
}

function handleJoinGroup() {
    const pin = joinGroupPassInput.value.trim();
    const rawName = joinGroupUserInput.value.trim();
    const displayName = rawName || 'Friend';

    if (!pin) {
        showFormError(joinGroupError, 'Please enter the 4-digit PIN.');
        return;
    }

    if (rawName) {
        try { localStorage.setItem('gc_last_display_name', rawName); } catch (e) {}
    }

    joinGroupError.classList.add('hidden');
    btnSubmitJoinGroup.disabled = true;
    btnSubmitJoinGroup.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';

    // Check if this browser has an ownerToken saved for this PIN
    let ownerToken = null;
    try {
        ownerToken = localStorage.getItem(`gc_owner_${pin.toLowerCase()}`);
    } catch (e) {}

    enterGroupRoom(pin, displayName, ownerToken, () => {
        btnSubmitJoinGroup.disabled = false;
        btnSubmitJoinGroup.innerHTML = '<i class="fas fa-sign-in-alt"></i> Join Room Now';
    });
}

// ==========================================
// 3. CREATE GROUP (SECONDARY ACTION)
// ==========================================
if (btnSubmitCreateGroup) {
    btnSubmitCreateGroup.addEventListener('click', handleCreateGroup);
}

function handleCreateGroup() {
    const pin = createGroupPassInput.value.trim();
    const name = createGroupNameInput.value.trim();
    const rawName = createGroupUserInput.value.trim();
    const displayName = rawName || 'Host';

    if (!pin || pin.length < 3) {
        showFormError(createGroupError, 'Please enter a 4-digit PIN.');
        return;
    }

    if (rawName) {
        try { localStorage.setItem('gc_last_display_name', rawName); } catch (e) {}
    }

    createGroupError.classList.add('hidden');
    btnSubmitCreateGroup.disabled = true;
    btnSubmitCreateGroup.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Room...';

    socket.emit('group_create', { pin, name }, (res) => {
        btnSubmitCreateGroup.disabled = false;
        btnSubmitCreateGroup.innerHTML = '<i class="fas fa-sparkles"></i> Create & Enter Room';

        if (!res || !res.success) {
            showFormError(createGroupError, (res && res.error) || 'Failed to create room.');
            return;
        }

        const group = res.group;
        try {
            localStorage.setItem(`gc_owner_${group.pin}`, group.ownerToken);
        } catch (e) {
            console.warn('localStorage not accessible:', e);
        }

        // Enter the room immediately
        enterGroupRoom(group.pin, displayName, group.ownerToken);
    });
}

// Helper: Enter group room
function enterGroupRoom(pin, displayName, ownerToken, onComplete) {
    if (!myLocalFunnyAvatar) {
        myLocalFunnyAvatar = getRandomFunnyAvatar();
    }

    socket.emit('group_join', { pin, displayName, ownerToken, avatarUrl: myLocalFunnyAvatar }, async (response) => {
        if (typeof onComplete === 'function') onComplete();

        if (!response || !response.success) {
            const errEl = (panelJoinGroup.classList.contains('hidden')) ? createGroupError : joinGroupError;
            showFormError(errEl, (response && response.error) || 'Failed to join room.');
            return;
        }

        // Successfully joined group on server
        isPublicRoomMode = false;
        currentGroupPin = response.group.pin;
        currentGroupName = response.group.name;
        myGroupMemberId = response.memberId;
        isCurrentGroupOwner = response.isOwner;
        serverRoomCount = typeof response.roomCount === 'number' ? response.roomCount : (response.existingMembers ? response.existingMembers.length + 1 : 1);

        // Register local avatar in stable identity map
        userAvatarsMap.set(myGroupMemberId, myLocalFunnyAvatar);

        // Update UI Header
        if (roomGroupName) roomGroupName.innerText = currentGroupName;
        if (roomPinChip) {
            roomPinChip.innerHTML = `<i class="fas fa-lock"></i> PIN: <strong id="room-pin-display">${escapeHtml(currentGroupPin)}</strong>`;
        }
        if (groupOnlineText) groupOnlineText.innerText = 'in room';
        if (btnCopyLiveLink) btnCopyLiveLink.classList.add('hidden');
        isLiveChatHidden = false;
        if (liveOverlayStream) liveOverlayStream.classList.remove('chat-hidden');
        if (btnToggleLiveChat) btnToggleLiveChat.classList.add('active');
        localDisplayName.innerText = `${response.displayName}${response.isOwner ? ' (Host)' : ''}`;
        localAvatarImg.src = myLocalFunnyAvatar;

        // Owner controls
        if (btnDeleteGroup) {
            if (response.isOwner) {
                btnDeleteGroup.classList.remove('hidden');
            } else {
                btnDeleteGroup.classList.add('hidden');
            }
        }

        // Reset live stream overlay with welcome banner
        if (liveOverlayStream) {
            liveOverlayStream.innerHTML = `
                <div class="live-stream-welcome-bubble">
                    <i class="fas fa-sparkles"></i> Welcome to the live room! Tap the GIF button or chat below.
                </div>
            `;
        }

        // Switch to Room screen
        showScreen('group-room-screen');

        // Start Group Voice Engine & WebRTC Mesh
        await initGroupVoiceRoom(response.existingMembers);
    });
}

// Helper: Form Error Display
function showFormError(element, message) {
    if (!element) return;
    element.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    element.classList.remove('hidden');
}

// ==========================================
// 4. GROUP VOICE & MULTI-PEER WEBRTC ENGINE
// ==========================================
async function initGroupVoiceRoom(existingMembers, options = {}) {
    console.log('[Group] Initializing Voice Room with existing members:', existingMembers);
    cleanupGroupMedia();

    const applyListenOnlyUI = (showHintBanner) => {
        groupAudioStream = null;
        isGroupAudioMuted = true;
        if (groupMicBtn) {
            groupMicBtn.classList.add('muted');
            const micIcon = groupMicBtn.querySelector('i');
            if (micIcon) micIcon.className = 'fas fa-microphone-slash';
        }
        if (localMicIndicator) {
            localMicIndicator.className = 'media-badge mic-muted';
            localMicIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        }
        socket.emit('group_media_state', { isAudioMuted: true, isCameraOn: false });
        if (showHintBanner && liveOverlayStream) {
            const note = document.createElement('div');
            note.className = 'live-stream-welcome-bubble';
            note.innerHTML = '<i class="fas fa-headphones"></i> Listen & Chat active. Tap the mic button anytime to speak!';
            liveOverlayStream.appendChild(note);
        }
    };

    // 1. Request microphone access unless user explicitly selected Listen & Chat Only
    if (options.skipMicRequest) {
        applyListenOnlyUI(true);
    } else {
        try {
            groupAudioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            console.log('[Group] Microphone access granted.');
            setupLocalSpeechDetection(groupAudioStream);
        } catch (err) {
            console.warn('[Group] Microphone not active (Listen-Only fallback):', err);
            applyListenOnlyUI(options.allowListenOnly);
            if (!options.allowListenOnly) {
                alert('Could not access microphone. You can still listen and chat, or tap mic to retry.');
            }
        }
    }

    // 2. Establish WebRTC connection with all existing members in room
    if (Array.isArray(existingMembers)) {
        for (const member of existingMembers) {
            groupMemberNames.set(member.memberId, member.displayName);
            groupMemberMediaStates.set(member.memberId, {
                isCameraOn: !!member.isCameraOn,
                isAudioMuted: !!member.isAudioMuted
            });
            if (member.requestedQuality) {
                peerRequestedQualities.set(member.memberId, member.requestedQuality);
            }
            const stableAvatar = getStableAvatarForUser(member.memberId, member.avatarUrl);
            createRemoteParticipantCard(member.memberId, member.displayName, member.isOwner, stableAvatar);
            const connPromise = createGroupPeerConnection(member.memberId, member.displayName, true, member.isCameraOn);
            groupPendingConnections.set(member.memberId, connPromise);
            const peer = await connPromise;
            groupPendingConnections.delete(member.memberId);

            if (peer) {
                const latestState = groupMemberMediaStates.get(member.memberId) || {
                    isCameraOn: !!member.isCameraOn,
                    isAudioMuted: !!member.isAudioMuted
                };
                applyGroupMediaStateToUi(member.memberId, latestState);
            }
        }
    }

    updateGroupOnlineCount();
    emitCurrentQualityPref('group', member.memberId);
    playSystemSound('connect');

    // If user explicitly chose "Join With Camera & Voice", activate camera right away
    if (options.autoEnableCamera && !isLocalCameraOn) {
        await toggleGroupCamera();
    }
}

// Shared helper for queued WebRTC renegotiation (prevents dropped offers if signaling isn't stable)
async function renegotiateGroupPeer(peerId, peer) {
    if (!peer || !peer.pc) return;
    const pc = peer.pc;
    if (pc.signalingState !== 'stable') {
        peer.needsRenegotiation = true;
        console.log(`[Group] Queuing renegotiation for ${peerId} (state: ${pc.signalingState})`);
        return;
    }
    try {
        peer.needsRenegotiation = false;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('group_signal', {
            to: peerId,
            data: { offer }
        });
        console.log(`[Group] Renegotiation offer sent to ${peerId}`);
    } catch (err) {
        console.warn(`[Group] Renegotiation error for ${peerId}:`, err);
    }
}

// Bind active local audio/video tracks onto the RTCPeerConnection's matched transceivers
async function syncLocalTracksToPeer(pc) {
    if (!pc) return;
    const localAudioTrack = (groupAudioStream && groupAudioStream.getAudioTracks()[0]) || null;
    const localVideoTrack = (groupVideoStream && isLocalCameraOn && groupVideoStream.getVideoTracks()[0]) || null;

    let audioTransceiver = getTransceiverByKind(pc, 'audio');
    try {
        if (localAudioTrack) {
            if (audioTransceiver) {
                audioTransceiver.direction = 'sendrecv';
                await audioTransceiver.sender.replaceTrack(localAudioTrack);
                if (typeof audioTransceiver.sender.setStreams === 'function' && groupAudioStream) {
                    audioTransceiver.sender.setStreams(groupAudioStream);
                }
            } else {
                pc.addTransceiver(localAudioTrack, { direction: 'sendrecv', streams: [groupAudioStream] });
            }
        } else if (audioTransceiver) {
            audioTransceiver.direction = 'recvonly';
            await audioTransceiver.sender.replaceTrack(null);
        } else {
            pc.addTransceiver('audio', { direction: 'recvonly' });
        }
    } catch (e) {
        console.warn('[Group] sync audio transceiver note:', e);
    }

    let videoTransceiver = getTransceiverByKind(pc, 'video');
    try {
        if (localVideoTrack) {
            if (videoTransceiver) {
                videoTransceiver.direction = 'sendrecv';
                await videoTransceiver.sender.replaceTrack(localVideoTrack);
                if (typeof videoTransceiver.sender.setStreams === 'function' && groupVideoStream) {
                    videoTransceiver.sender.setStreams(groupVideoStream);
                }
            } else {
                pc.addTransceiver(localVideoTrack, { direction: 'sendrecv', streams: [groupVideoStream] });
            }
            const peerEntry = Array.from(groupPeers.entries()).find(([, p]) => p.pc === pc);
            const peerQual = peerEntry ? peerRequestedQualities.get(peerEntry[0]) : null;
            await applySenderVideoQuality(pc, peerQual);
        } else if (videoTransceiver) {
            videoTransceiver.direction = 'recvonly';
            await videoTransceiver.sender.replaceTrack(null);
        } else {
            pc.addTransceiver('video', { direction: 'recvonly' });
        }
    } catch (e) {
        console.warn('[Group] sync video transceiver note:', e);
    }
}

// Create RTCPeerConnection for a specific remote peer in the group
async function createGroupPeerConnection(targetMemberId, targetDisplayName, isInitiator, initialCameraOn = false) {
    if (groupPeers.has(targetMemberId)) {
        console.log(`[Group] Peer ${targetMemberId} already exists`);
        return groupPeers.get(targetMemberId);
    }

    console.log(`[Group] Creating PC for ${targetMemberId} (isInitiator: ${isInitiator})`);
    const iceServers = await getTurnCredentials();
    const rtcConfig = {
        iceServers: iceServers,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all'
    };

    const pc = new RTCPeerConnection(rtcConfig);

    // Audio element for remote participant
    let remoteAudioEl = document.getElementById(`remote-audio-${targetMemberId}`);
    if (!remoteAudioEl) {
        remoteAudioEl = document.createElement('audio');
        remoteAudioEl.id = `remote-audio-${targetMemberId}`;
        remoteAudioEl.autoplay = true;
        document.body.appendChild(remoteAudioEl);
    }

    const knownMedia = groupMemberMediaStates.get(targetMemberId) || {};
    const peerData = {
        pc: pc,
        memberId: targetMemberId,
        displayName: targetDisplayName,
        audioElement: remoteAudioEl,
        videoStream: null,
        isCameraOn: typeof knownMedia.isCameraOn === 'boolean' ? knownMedia.isCameraOn : !!initialCameraOn,
        isAudioMuted: typeof knownMedia.isAudioMuted === 'boolean' ? knownMedia.isAudioMuted : false,
        needsRenegotiation: false,
        iceMonitor: null
    };

    const setPeerIcePill = (text, isWarning = false) => {
        const card = document.getElementById(`card-${targetMemberId}`);
        if (!card) return;
        const wrapper = card.querySelector('.media-wrapper');
        if (!wrapper) return;
        let pill = document.getElementById(`ice-pill-${targetMemberId}`);
        if (!text) {
            if (pill) pill.remove();
            return;
        }
        if (!pill) {
            pill = document.createElement('span');
            pill.id = `ice-pill-${targetMemberId}`;
            wrapper.appendChild(pill);
        }
        pill.className = isWarning ? 'peer-ice-pill is-warning' : 'peer-ice-pill';
        pill.innerText = text;
    };

    peerData.iceMonitor = createIceDiagnosticsMonitor({
        pc: pc,
        isInitiator: isInitiator,
        onStateChange: (state) => {
            console.log(`[Group] ICE State with ${targetMemberId}: ${state}`);
            if (state === 'connected' || state === 'completed') {
                setPeerIcePill(null);
                hideNetworkReconnectBanner();
                if (peerData.isCameraOn) {
                    applyGroupMediaStateToUi(targetMemberId, { isCameraOn: true });
                }
            } else if (state === 'checking') {
                setPeerIcePill('Connecting...');
            } else if (state === 'failed' || state === 'disconnected') {
                setPeerIcePill('Reconnecting...');
                showNetworkReconnectBanner('Switching network — reconnecting room...');
            }
        },
        onRequestRestart: async () => {
            if (!groupPeers.has(targetMemberId) || !peerData.pc) return;
            if (isInitiator) {
                if (pc.signalingState === 'stable') {
                    try {
                        if (typeof pc.restartIce === 'function') pc.restartIce();
                        const offer = await pc.createOffer({ iceRestart: true });
                        await pc.setLocalDescription(offer);
                        socket.emit('group_signal', { to: targetMemberId, data: { offer } });
                    } catch (e) {
                        console.warn(`[Group] ICE restart failed for ${targetMemberId}:`, e);
                    }
                }
            } else {
                socket.emit('group_signal', { to: targetMemberId, data: { requestIceRestart: true } });
            }
        },
        onBlocked: (reason) => {
            if (!groupPeers.has(targetMemberId)) return;
            setPeerIcePill(reason === 'no-turn' ? 'NAT Blocked (Needs TURN)' : 'Network Blocked', true);
        }
    });

    groupPeers.set(targetMemberId, peerData);

    // Only the Offerer adds transceivers upfront; the Answerer must receive the Offer via
    // setRemoteDescription() first so local audio/video bind to the Offer's exact mid sections!
    if (isInitiator) {
        await syncLocalTracksToPeer(pc);
    }

    // ICE Candidate generation
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            if (peerData.iceMonitor) peerData.iceMonitor.noteLocalCandidate(event.candidate);
            socket.emit('group_signal', {
                to: targetMemberId,
                data: { candidate: event.candidate }
            });
        }
    };

    pc.onicecandidateerror = (event) => {
        if (peerData.iceMonitor) peerData.iceMonitor.noteCandidateError(event);
    };

    // Remote Track received (Audio or Video)
    pc.ontrack = (event) => {
        console.log(`[Group] ontrack from ${targetMemberId}: kind=${event.track.kind}, muted=${event.track.muted}`);
        const currentPeer = groupPeers.get(targetMemberId);

        if (event.track.kind === 'audio') {
            const streamToPlay = event.streams[0] || new MediaStream([event.track]);
            if (remoteAudioEl.srcObject !== streamToPlay) {
                remoteAudioEl.srcObject = streamToPlay;
            }
            safePlayMedia(remoteAudioEl, 'Remote audio play', true);
        } else if (event.track.kind === 'video') {
            const cardVideoEl = document.getElementById(`video-${targetMemberId}`);
            const avatarBox = document.getElementById(`avatar-box-${targetMemberId}`);
            const camBadge = document.getElementById(`cam-badge-${targetMemberId}`);
            const streamToPlay = event.streams[0] || new MediaStream([event.track]);

            if (currentPeer) {
                currentPeer.videoStream = streamToPlay;
            }

            if (cardVideoEl) {
                cardVideoEl.muted = true;
                if (cardVideoEl.srcObject !== streamToPlay) {
                    cardVideoEl.srcObject = streamToPlay;
                }
                cardVideoEl.onloadeddata = () => {
                    if (currentPeer && currentPeer.isCameraOn) {
                        cardVideoEl.classList.remove('hidden');
                        if (avatarBox) avatarBox.classList.add('hidden');
                    }
                };
                // Only show video if sender camera is actually active / frames are flowing (avoids black box when cam OFF!)
                if ((currentPeer && currentPeer.isCameraOn) || !event.track.muted) {
                    if (currentPeer) currentPeer.isCameraOn = true;
                    cardVideoEl.classList.remove('hidden');
                    if (avatarBox) avatarBox.classList.add('hidden');
                    if (camBadge) {
                        camBadge.className = 'media-badge cam-on';
                        camBadge.innerHTML = '<i class="fas fa-video"></i>';
                    }
                    safePlayMedia(cardVideoEl, 'Remote group video play');
                }
            }

            event.track.onunmute = () => {
                console.log(`[Group] Video track unmuted for ${targetMemberId}`);
                setPeerIcePill(null);
                if (currentPeer) currentPeer.isCameraOn = true;
                if (cardVideoEl) {
                    cardVideoEl.muted = true;
                    if (cardVideoEl.srcObject !== streamToPlay) {
                        cardVideoEl.srcObject = streamToPlay;
                    }
                    cardVideoEl.classList.remove('hidden');
                    if (avatarBox) avatarBox.classList.add('hidden');
                    if (camBadge) {
                        camBadge.className = 'media-badge cam-on';
                        camBadge.innerHTML = '<i class="fas fa-video"></i>';
                    }
                    safePlayMedia(cardVideoEl, 'Remote group video unmute play');
                }
            };

            event.track.onmute = () => {
                console.log(`[Group] Video track muted for ${targetMemberId}`);
                if (currentPeer && !currentPeer.isCameraOn) {
                    if (cardVideoEl) cardVideoEl.classList.add('hidden');
                    if (avatarBox) avatarBox.classList.remove('hidden');
                    if (camBadge) {
                        camBadge.className = 'media-badge cam-off';
                        camBadge.innerHTML = '<i class="fas fa-video-slash"></i>';
                    }
                }
            };

            event.track.onended = () => {
                console.log(`[Group] Track ended for ${targetMemberId}`);
                if (currentPeer) currentPeer.isCameraOn = false;
                if (cardVideoEl) cardVideoEl.classList.add('hidden');
                if (avatarBox) avatarBox.classList.remove('hidden');
                if (camBadge) {
                    camBadge.className = 'media-badge cam-off';
                    camBadge.innerHTML = '<i class="fas fa-video-slash"></i>';
                }
            };
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (peerData.iceMonitor) peerData.iceMonitor.handleConnectionStateChange();
    };

    // If initiator, create and send offer
    if (isInitiator) {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('group_signal', {
                to: targetMemberId,
                data: { offer: offer }
            });
            if (peerData.iceMonitor) peerData.iceMonitor.startWatch();
        } catch (err) {
            console.error(`[Group] Failed to create offer for ${targetMemberId}:`, err);
        }
    }

    return peerData;
}

// Handle targeted WebRTC signals from peers
socket.on('group_signal', async ({ from, data }) => {
    let peer = groupPeers.get(from);
    if (!peer) {
        if (groupPendingConnections.has(from)) {
            peer = await groupPendingConnections.get(from);
        } else {
            console.log(`[Group] Incoming signal from new peer ${from}`);
            const peerName = groupMemberNames.get(from) || 'Friend';
            createRemoteParticipantCard(from, peerName, false, getStableAvatarForUser(from));
            const connPromise = createGroupPeerConnection(from, peerName, false);
            groupPendingConnections.set(from, connPromise);
            peer = await connPromise;
            groupPendingConnections.delete(from);
        }
    }

    if (!peer || !peer.pc) return;
    const pc = peer.pc;

    try {
        if (data.offer) {
            console.log(`[Group] Received offer from ${from}`);

            // WebRTC Perfect Negotiation / Glare collision handling
            if (pc.signalingState !== 'stable') {
                console.log(`[Group] Signaling state is ${pc.signalingState} upon offer from ${from}`);
                if (pc.signalingState === 'have-local-offer') {
                    const isPolite = (socket.id || '') < from;
                    if (isPolite) {
                        console.log(`[Group] Polite peer yielding, rolling back offer`);
                        await pc.setLocalDescription({ type: 'rollback' });
                    } else {
                        console.log(`[Group] Impolite peer ignoring collision offer`);
                        return;
                    }
                }
            }

            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

            // Drain queued ICE candidates
            const queued = groupQueuedCandidates.get(from) || [];
            for (const cand of queued) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch (e) {
                    console.warn('[Group] Queued candidate error:', e);
                }
            }
            groupQueuedCandidates.delete(from);

            // Bind active local mic & camera tracks to the Offer-matched transceivers before creating Answer
            await syncLocalTracksToPeer(pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('group_signal', {
                to: from,
                data: { answer: answer }
            });
            if (peer.iceMonitor) peer.iceMonitor.startWatch();
            console.log(`[Group] Sent answer to ${from}`);

            if (peer.needsRenegotiation) {
                renegotiateGroupPeer(from, peer);
            }
        } else if (data.answer) {
            console.log(`[Group] Received answer from ${from}`);
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

            // Drain queued ICE candidates
            const queued = groupQueuedCandidates.get(from) || [];
            for (const cand of queued) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch (e) {
                    console.warn('[Group] Queued candidate error:', e);
                }
            }
            groupQueuedCandidates.delete(from);

            if (peer.needsRenegotiation) {
                renegotiateGroupPeer(from, peer);
            }
        } else if (data.requestIceRestart && pc.signalingState === 'stable') {
            if (typeof pc.restartIce === 'function') pc.restartIce();
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            socket.emit('group_signal', { to: from, data: { offer } });
        } else if (data.candidate) {
            if (peer.iceMonitor) peer.iceMonitor.noteRemoteCandidate(data.candidate);
            if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                console.log(`[Group] Queuing candidate from ${from}`);
                if (!groupQueuedCandidates.has(from)) {
                    groupQueuedCandidates.set(from, []);
                }
                groupQueuedCandidates.get(from).push(data.candidate);
            }
        }
    } catch (err) {
        console.error(`[Group] Signal error with ${from}:`, err);
    }
});

// A new member joined the group room
socket.on('group_member_joined', async (member) => {
    console.log(`[Group] New member joined: ${member.displayName} (${member.memberId})`);
    groupMemberNames.set(member.memberId, member.displayName);
    groupMemberMediaStates.set(member.memberId, {
        isCameraOn: !!member.isCameraOn,
        isAudioMuted: !!member.isAudioMuted
    });
    if (typeof member.roomCount === 'number') serverRoomCount = member.roomCount;
    const stableAvatar = getStableAvatarForUser(member.memberId, member.avatarUrl);
    createRemoteParticipantCard(member.memberId, member.displayName, member.isOwner, stableAvatar);
    applyGroupMediaStateToUi(member.memberId, groupMemberMediaStates.get(member.memberId));
    updateGroupOnlineCount();
    emitCurrentQualityPref('group', member.memberId);
    playSystemSound('connect');
});

// A member left the group room
socket.on('group_member_left', ({ memberId, roomCount }) => {
    console.log(`[Group] Member left: ${memberId}`);
    if (typeof roomCount === 'number') serverRoomCount = roomCount;
    else if (typeof serverRoomCount === 'number') serverRoomCount = Math.max(1, serverRoomCount - 1);
    removeRemoteParticipant(memberId);
    updateGroupOnlineCount();
    playSystemSound('disconnect');
});

function applyGroupMediaStateToUi(memberId, state = {}) {
    const prev = groupMemberMediaStates.get(memberId) || {};
    const merged = {
        isAudioMuted: typeof state.isAudioMuted === 'boolean' ? state.isAudioMuted : !!prev.isAudioMuted,
        isCameraOn: typeof state.isCameraOn === 'boolean' ? state.isCameraOn : !!prev.isCameraOn
    };
    groupMemberMediaStates.set(memberId, merged);

    const peer = groupPeers.get(memberId);
    if (peer) {
        if (typeof state.isAudioMuted === 'boolean') peer.isAudioMuted = state.isAudioMuted;
        if (typeof state.isCameraOn === 'boolean') peer.isCameraOn = state.isCameraOn;
        if (peer.isCameraOn && !peer.videoStream && peer.pc && typeof peer.pc.getReceivers === 'function') {
            const videoReceiver = peer.pc.getReceivers().find(r => r.track && r.track.kind === 'video');
            if (videoReceiver && videoReceiver.track) {
                peer.videoStream = new MediaStream([videoReceiver.track]);
            }
        }
    }

    const micBadge = document.getElementById(`mic-badge-${memberId}`);
    if (micBadge && typeof state.isAudioMuted === 'boolean') {
        micBadge.className = state.isAudioMuted ? 'media-badge mic-muted' : 'media-badge mic-on';
        micBadge.innerHTML = state.isAudioMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
    }

    if (typeof state.isCameraOn === 'boolean') {
        const videoEl = document.getElementById(`video-${memberId}`);
        const avatarBox = document.getElementById(`avatar-box-${memberId}`);
        const camBadge = document.getElementById(`cam-badge-${memberId}`);

        if (state.isCameraOn) {
            if (videoEl) {
                videoEl.muted = true;
                if (peer && peer.videoStream) {
                    if (videoEl.srcObject !== peer.videoStream) {
                        videoEl.srcObject = peer.videoStream;
                    }
                    videoEl.classList.remove('hidden');
                    safePlayMedia(videoEl, 'Play video on state change');
                }
            }
            if (avatarBox && peer && peer.videoStream) avatarBox.classList.add('hidden');
            if (camBadge) {
                camBadge.className = 'media-badge cam-on';
                camBadge.innerHTML = '<i class="fas fa-video"></i>';
            }
        } else {
            if (videoEl) {
                videoEl.classList.add('hidden');
            }
            if (avatarBox) avatarBox.classList.remove('hidden');
            if (camBadge) {
                camBadge.className = 'media-badge cam-off';
                camBadge.innerHTML = '<i class="fas fa-video-slash"></i>';
            }
        }
    }
}

// Media state change from a remote participant (mic muted, camera on/off)
socket.on('group_media_state', ({ memberId, isAudioMuted, isCameraOn }) => {
    applyGroupMediaStateToUi(memberId, { isAudioMuted, isCameraOn });
});

// Speaking indicator from a remote participant
socket.on('group_speaking', ({ memberId, isSpeaking }) => {
    const card = document.getElementById(`card-${memberId}`);
    const pill = document.getElementById(`speaking-pill-${memberId}`);
    if (card) {
        card.classList.toggle('is-speaking', !!isSpeaking);
    }
    if (pill) {
        pill.classList.toggle('hidden', !isSpeaking);
    }
});

// Group deleted by owner
socket.on('group_deleted', ({ message }) => {
    alert(message || 'The group has been deleted by its owner.');
    leaveGroupRoom();
});

// ==========================================
// 5. INDEPENDENT CAMERA CONTROL
// ==========================================
if (groupCamBtn) {
    groupCamBtn.addEventListener('click', toggleGroupCamera);
}
if (groupFlipCamBtn) {
    groupFlipCamBtn.addEventListener('click', toggleGroupFlipCamera);
}

async function toggleGroupCamera() {
    if (!isLocalCameraOn) {
        // TURN CAMERA ON
        try {
            console.log('[Camera] Requesting webcam video track...');
            groupVideoStream = await requestCameraStreamForQuality(groupFacingMode, false);

            isLocalCameraOn = true;
            const videoTrack = groupVideoStream.getVideoTracks()[0];

            // Local Preview
            localVideoPreview.srcObject = groupVideoStream;
            localVideoPreview.style.transform = (!isGroupScreenSharing && groupFacingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
            localVideoPreview.classList.remove('hidden');
            if (localAvatarBox) localAvatarBox.classList.add('hidden');
            if (groupFlipCamBtn) groupFlipCamBtn.classList.remove('hidden');

            // Update Local UI
            groupCamBtn.className = 'live-circle-tool-btn cam-trigger cam-active';
            groupCamBtn.innerHTML = '<i class="fas fa-video"></i>';
            localCamIndicator.className = 'media-badge cam-on';
            localCamIndicator.innerHTML = '<i class="fas fa-video"></i>';

            // Add/Replace video track cleanly via exact video transceiver and renegotiate
            for (const [peerId, peer] of groupPeers.entries()) {
                const pc = peer.pc;
                if (!pc) continue;
                const transceiver = getTransceiverByKind(pc, 'video');
                if (transceiver) {
                    transceiver.direction = 'sendrecv';
                    await transceiver.sender.replaceTrack(videoTrack);
                    if (typeof transceiver.sender.setStreams === 'function' && groupVideoStream) {
                        transceiver.sender.setStreams(groupVideoStream);
                    }
                } else {
                    pc.addTransceiver(videoTrack, { direction: 'sendrecv', streams: [groupVideoStream] });
                }
                await applySenderVideoQuality(pc, peerRequestedQualities.get(peerId));
                await renegotiateGroupPeer(peerId, peer);
            }

            // Notify group peers that camera is ON
            socket.emit('group_media_state', { isCameraOn: true });
            console.log('[Camera] Camera turned ON successfully');
        } catch (err) {
            console.error('[Camera] Camera activation failed:', err);
            alert('Could not start camera. Please check camera permissions on your phone.');
        }
    } else {
        // TURN CAMERA OFF (Independent hardware release)
        console.log('[Camera] Turning camera OFF and releasing hardware...');
        isLocalCameraOn = false;
        groupFacingMode = 'user';
        isGroupScreenSharing = false;
        if (groupShareScreenBtn) groupShareScreenBtn.classList.remove('screen-active');

        // 1. Stop all video tracks to immediately turn off webcam LED/hardware
        if (groupVideoStream) {
            groupVideoStream.getVideoTracks().forEach(track => {
                track.stop();
                console.log('[Camera] Video track stopped');
            });
            groupVideoStream = null;
        }

        // 2. Hide local preview and show avatar
        localVideoPreview.classList.add('hidden');
        localVideoPreview.srcObject = null;
        if (localAvatarBox) localAvatarBox.classList.remove('hidden');
        if (groupFlipCamBtn) groupFlipCamBtn.classList.add('hidden');

        // 3. Update Local UI
        groupCamBtn.className = 'live-circle-tool-btn cam-trigger cam-disabled';
        groupCamBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        localCamIndicator.className = 'media-badge cam-off';
        localCamIndicator.innerHTML = '<i class="fas fa-video-slash"></i>';

        // 4. Replace video track with null, revert transceiver to recvonly, and renegotiate
        for (const [peerId, peer] of groupPeers.entries()) {
            const pc = peer.pc;
            if (!pc) continue;
            const transceiver = getTransceiverByKind(pc, 'video');
            if (transceiver) {
                transceiver.direction = 'recvonly';
                try {
                    await transceiver.sender.replaceTrack(null);
                } catch (e) {
                    console.warn('[Camera] Error setting replaceTrack null:', e);
                }
            }
            await renegotiateGroupPeer(peerId, peer);
        }

        // 5. Inform other participants that video is disabled
        socket.emit('group_media_state', { isCameraOn: false });
        console.log('[Camera] Camera turned OFF. Voice continues uninterrupted.');
    }
}

async function toggleGroupFlipCamera() {
    if (!isLocalCameraOn) return;
    const nextMode = groupFacingMode === 'user' ? 'environment' : 'user';
    const oldStream = groupVideoStream;

    try {
        const newStream = await requestCameraStreamForQuality(nextMode, true);
        const newTrack = newStream.getVideoTracks()[0];
        if (!newTrack) throw new Error('No replacement camera track');

        for (const [peerId, peer] of groupPeers.entries()) {
            const pc = peer.pc;
            if (!pc) continue;
            const transceiver = getTransceiverByKind(pc, 'video');
            if (transceiver && transceiver.sender) {
                await transceiver.sender.replaceTrack(newTrack);
                await applySenderVideoQuality(pc, peerRequestedQualities.get(peerId));
            }
        }

        if (oldStream) {
            oldStream.getVideoTracks().forEach(t => t.stop());
        }

        groupVideoStream = newStream;
        groupFacingMode = nextMode;
        if (localVideoPreview) {
            localVideoPreview.srcObject = groupVideoStream;
            localVideoPreview.style.transform = groupFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
            localVideoPreview.classList.remove('hidden');
            localVideoPreview.play().catch(() => {});
        }
    } catch (err) {
        console.warn('[Camera] Flip camera failed:', err);
    }
}

// ==========================================
// 6. MICROPHONE CONTROLS & VOICE ACTIVITY
// ==========================================
if (groupMicBtn) {
    groupMicBtn.addEventListener('click', toggleGroupMic);
}

// Mobile audio & video autoplay unlock on any tap inside the live room
const groupRoomScreenEl = document.getElementById('group-room-screen');
if (groupRoomScreenEl) {
    groupRoomScreenEl.addEventListener('click', () => {
        if (groupAudioContext && groupAudioContext.state === 'suspended') {
            groupAudioContext.resume().catch(() => {});
        }
        document.querySelectorAll('audio[id^="remote-audio-"]').forEach(el => {
            if (el.paused && el.srcObject) el.play().catch(() => {});
        });
        document.querySelectorAll('video[id^="video-"]:not(.hidden)').forEach(el => {
            if (el.paused && el.srcObject) el.play().catch(() => {});
        });
    }, { passive: true });
}

async function toggleGroupMic() {
    // If joined in Listen-Only mode, request mic now and upgrade peers cleanly
    if (!groupAudioStream) {
        try {
            groupAudioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            isGroupAudioMuted = false;
            setupLocalSpeechDetection(groupAudioStream);
            const audioTrack = groupAudioStream.getAudioTracks()[0];

            for (const [peerId, peer] of groupPeers.entries()) {
                const pc = peer.pc;
                if (!pc) continue;
                const transceiver = getTransceiverByKind(pc, 'audio');
                if (transceiver) {
                    transceiver.direction = 'sendrecv';
                    await transceiver.sender.replaceTrack(audioTrack);
                } else {
                    pc.addTransceiver(audioTrack, { direction: 'sendrecv', streams: [groupAudioStream] });
                }
                await renegotiateGroupPeer(peerId, peer);
            }
        } catch (err) {
            console.warn('[Mic] Could not enable microphone:', err);
            alert('Please allow microphone access in your browser settings to speak.');
            return;
        }
    } else {
        isGroupAudioMuted = !isGroupAudioMuted;
        groupAudioStream.getAudioTracks().forEach(track => {
            track.enabled = !isGroupAudioMuted;
        });
    }

    groupMicBtn.classList.toggle('muted', isGroupAudioMuted);
    const micIcon = groupMicBtn.querySelector('i');

    if (isGroupAudioMuted) {
        if (micIcon) micIcon.className = 'fas fa-microphone-slash';
        localMicIndicator.className = 'media-badge mic-muted';
        localMicIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        // When muted, immediately clear speaking state
        setLocalSpeaking(false);
    } else {
        if (micIcon) micIcon.className = 'fas fa-microphone';
        localMicIndicator.className = 'media-badge mic-on';
        localMicIndicator.innerHTML = '<i class="fas fa-microphone"></i>';
    }

    socket.emit('group_media_state', { isAudioMuted: isGroupAudioMuted });
}

// Local voice activity detection (VAD)
function setupLocalSpeechDetection(stream) {
    try {
        if (!groupAudioContext) {
            groupAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (groupAudioContext.state === 'suspended') {
            groupAudioContext.resume();
        }

        const source = groupAudioContext.createMediaStreamSource(stream);
        const analyser = groupAudioContext.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let speakingCount = 0;

        if (groupSpeechInterval) clearInterval(groupSpeechInterval);

        groupSpeechInterval = setInterval(() => {
            if (isGroupAudioMuted) {
                if (isSpeakingState) setLocalSpeaking(false);
                return;
            }

            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;

            if (average > 20) {
                speakingCount++;
                if (speakingCount >= 2 && !isSpeakingState) {
                    setLocalSpeaking(true);
                }
            } else {
                speakingCount = 0;
                if (isSpeakingState) {
                    setLocalSpeaking(false);
                }
            }
        }, 120);
    } catch (e) {
        console.warn('[VAD] Audio visualizer setup error:', e);
    }
}

function setLocalSpeaking(speaking) {
    isSpeakingState = speaking;
    if (localCard) localCard.classList.toggle('is-speaking', speaking);
    const localPill = document.getElementById('local-speaking-pill');
    if (localPill) localPill.classList.toggle('hidden', !speaking);
    socket.emit('group_speaking', { isSpeaking: speaking });
}

// ==========================================
// 7. PARTICIPANT UI MANAGEMENT & DYNAMIC GRID
// ==========================================
function createRemoteParticipantCard(memberId, displayName, isOwner, avatarUrl) {
    const existingCard = document.getElementById(`card-${memberId}`);
    if (existingCard) {
        // If card exists but had temporary display name, update it
        const nameEl = existingCard.querySelector('.participant-name');
        if (nameEl && displayName && displayName !== 'Friend') {
            nameEl.innerText = `${displayName}${isOwner ? ' (Host)' : ''}`;
        }
        return;
    }

    const card = document.createElement('div');
    card.className = 'participant-card';
    card.id = `card-${memberId}`;

    const avatarSrc = getStableAvatarForUser(memberId, avatarUrl);

    card.innerHTML = `
        <div class="media-wrapper">
            <div class="avatar-display" id="avatar-box-${memberId}">
                <img class="participant-avatar" id="avatar-img-${memberId}" src="${avatarSrc}" alt="${escapeHtml(displayName)}">
                <div class="speaking-halo"></div>
            </div>
            <video id="video-${memberId}" class="participant-video hidden" autoplay playsinline webkit-playsinline muted></video>
            <div class="status-overlay">
                <span id="speaking-pill-${memberId}" class="speaking-pill hidden">Speaking</span>
                <div class="media-badges">
                    <button type="button" class="spotlight-toggle-btn" title="Focus / Enlarge Video">
                        <i class="fas fa-expand-alt"></i>
                    </button>
                    <span id="mic-badge-${memberId}" class="media-badge mic-on" title="Microphone Active">
                        <i class="fas fa-microphone"></i>
                    </span>
                    <span id="cam-badge-${memberId}" class="media-badge cam-off" title="Camera Disabled">
                        <i class="fas fa-video-slash"></i>
                    </span>
                </div>
            </div>
        </div>
        <div class="participant-meta">
            <span class="participant-name">${escapeHtml(displayName)}${isOwner ? ' (Host)' : ''}</span>
        </div>
    `;

    const spotBtn = card.querySelector('.spotlight-toggle-btn');
    if (spotBtn) {
        spotBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasSpotlight = card.classList.contains('is-spotlight');
            if (groupParticipantsGrid) {
                groupParticipantsGrid.querySelectorAll('.participant-card.is-spotlight').forEach(c => {
                    c.classList.remove('is-spotlight');
                    const icon = c.querySelector('.spotlight-toggle-btn i');
                    if (icon) icon.className = 'fas fa-expand-alt';
                });
            }
            if (!wasSpotlight) {
                card.classList.add('is-spotlight');
                const icon = spotBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-compress-alt';
            }
        });
    }

    groupParticipantsGrid.appendChild(card);
    updateLiveGridLayout();
}

function removeRemoteParticipant(memberId) {
    const peer = groupPeers.get(memberId);
    if (peer) {
        if (peer.iceMonitor) {
            peer.iceMonitor.cleanup();
            peer.iceMonitor = null;
        }
        if (peer.pc) {
            peer.pc.onicecandidate = null;
            peer.pc.ontrack = null;
            peer.pc.oniceconnectionstatechange = null;
            peer.pc.close();
        }
        if (peer.audioElement) {
            peer.audioElement.pause();
            peer.audioElement.remove();
        }
        groupPeers.delete(memberId);
    }
    groupPendingConnections.delete(memberId);
    groupQueuedCandidates.delete(memberId);
    groupMemberNames.delete(memberId);
    groupMemberMediaStates.delete(memberId);
    peerRequestedQualities.delete(memberId);

    const card = document.getElementById(`card-${memberId}`);
    if (card) {
        card.remove();
    }
    updateLiveGridLayout();
}

function updateGroupOnlineCount() {
    const cardsCount = groupParticipantsGrid ? groupParticipantsGrid.querySelectorAll('.participant-card').length : 1;
    const total = typeof serverRoomCount === 'number' ? Math.max(serverRoomCount, cardsCount) : Math.max(cardsCount, groupPeers.size + 1);
    if (groupOnlineCount) {
        groupOnlineCount.innerText = total;
    }
    if (groupOnlineText) {
        if (window.innerWidth <= 440) {
            groupOnlineText.innerText = isPublicRoomMode ? 'live' : 'in';
        } else {
            groupOnlineText.innerText = isPublicRoomMode ? 'in Public Call' : 'in room';
        }
    }
    updateLiveGridLayout();
}

function updateLiveGridLayout() {
    if (!groupParticipantsGrid) return;
    const cards = groupParticipantsGrid.querySelectorAll('.participant-card');
    const totalCards = cards.length || (groupPeers.size + 1);
    if (totalCards <= 1) {
        groupParticipantsGrid.className = 'live-grid layout-1';
    } else if (totalCards === 2) {
        groupParticipantsGrid.className = 'live-grid layout-2';
    } else if (totalCards === 3) {
        groupParticipantsGrid.className = 'live-grid layout-3';
    } else if (totalCards === 4) {
        groupParticipantsGrid.className = 'live-grid layout-4';
    } else {
        groupParticipantsGrid.className = 'live-grid layout-more';
    }
}

// ==========================================
// 8. LEAVE & DELETE GROUP
// ==========================================
if (btnLeaveGroup) btnLeaveGroup.addEventListener('click', leaveGroupRoom);
if (groupLeaveControlBtn) groupLeaveControlBtn.addEventListener('click', leaveGroupRoom);

function leaveGroupRoom() {
    console.log('[Group] Leaving room...');
    const wasPublic = isPublicRoomMode;
    hideTapSoundPill();
    cleanupGroupMedia();
    socket.emit('group_leave');

    currentGroupName = null;
    currentGroupPin = null;
    myGroupMemberId = null;
    isCurrentGroupOwner = false;
    isPublicRoomMode = false;
    serverRoomCount = null;
    if (btnCopyLiveLink) btnCopyLiveLink.classList.add('hidden');

    showScreen(wasPublic ? 'start-screen' : 'group-lobby-screen');
}

if (btnDeleteGroup) {
    btnDeleteGroup.addEventListener('click', () => {
        if (!currentGroupName || !isCurrentGroupOwner) return;
        if (confirm(`Are you sure you want to PERMANENTLY delete group "${currentGroupName}"? All participants will be disconnected.`)) {
            let ownerToken = null;
            try {
                ownerToken = localStorage.getItem(`gc_owner_${currentGroupPin}`);
            } catch (e) {}

            socket.emit('group_delete', { pin: currentGroupPin, name: currentGroupName, ownerToken }, (res) => {
                if (res && res.success) {
                    try {
                        localStorage.removeItem(`gc_owner_${currentGroupPin}`);
                    } catch (e) {}
                    leaveGroupRoom();
                } else {
                    alert((res && res.error) || 'Failed to delete group.');
                }
            });
        }
    });
}

function cleanupGroupMedia() {
    if (groupSpeechInterval) {
        clearInterval(groupSpeechInterval);
        groupSpeechInterval = null;
    }

    // Stop local video track and release hardware
    if (groupVideoStream) {
        groupVideoStream.getTracks().forEach(t => t.stop());
        groupVideoStream = null;
    }
    isLocalCameraOn = false;
    groupFacingMode = 'user';
    isGroupScreenSharing = false;
    if (groupShareScreenBtn) groupShareScreenBtn.classList.remove('screen-active');
    peerRequestedQualities.clear();
    const grpReactionDockEl = document.getElementById('group-reaction-dock');
    if (grpReactionDockEl) grpReactionDockEl.classList.add('hidden');
    const grpToolsTrayEl = document.getElementById('group-tools-tray');
    if (grpToolsTrayEl) grpToolsTrayEl.classList.add('hidden');
    const grpPlusBtnEl = document.getElementById('group-plus-btn');
    if (grpPlusBtnEl) grpPlusBtnEl.classList.remove('open');
    cancelActiveVoiceRecording('group');
    hideNetworkReconnectBanner();
    closeGifDrawer();
    if (groupFlipCamBtn) {
        groupFlipCamBtn.classList.add('hidden');
    }
    if (localVideoPreview) {
        localVideoPreview.classList.add('hidden');
        localVideoPreview.srcObject = null;
    }
    if (localAvatarBox) {
        localAvatarBox.classList.remove('hidden');
    }
    if (groupCamBtn) {
        groupCamBtn.className = 'live-circle-tool-btn cam-trigger cam-disabled';
        groupCamBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
    }
    if (localCamIndicator) {
        localCamIndicator.className = 'media-badge cam-off';
        localCamIndicator.innerHTML = '<i class="fas fa-video-slash"></i>';
    }

    // Stop local audio track
    if (groupAudioStream) {
        groupAudioStream.getTracks().forEach(t => t.stop());
        groupAudioStream = null;
    }
    isGroupAudioMuted = false;
    if (groupMicBtn) {
        groupMicBtn.className = 'live-circle-tool-btn mic-trigger';
        groupMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
    if (localMicIndicator) {
        localMicIndicator.className = 'media-badge mic-on';
        localMicIndicator.innerHTML = '<i class="fas fa-microphone"></i>';
    }

    if (groupAudioContext && groupAudioContext.state !== 'closed') {
        try {
            groupAudioContext.close().then(() => { groupAudioContext = null; });
        } catch (e) {}
    }

    // Close all peer connections
    for (const [peerId, peer] of groupPeers.entries()) {
        if (peer.iceMonitor) {
            peer.iceMonitor.cleanup();
            peer.iceMonitor = null;
        }
        if (peer.pc) {
            peer.pc.onicecandidate = null;
            peer.pc.ontrack = null;
            peer.pc.close();
        }
        if (peer.audioElement) {
            peer.audioElement.pause();
            peer.audioElement.remove();
        }
    }
    groupPeers.clear();
    groupPendingConnections.clear();
    groupQueuedCandidates.clear();
    groupMemberNames.clear();
    groupMemberMediaStates.clear();

    // Remove all remote participant cards from DOM cleanly
    if (groupParticipantsGrid) {
        groupParticipantsGrid.querySelectorAll('.participant-card:not(#card-local)').forEach(c => c.remove());
        updateLiveGridLayout();
    }
}


// ==========================================
// 9. DISAPPEARING PHOTO & GIF SHARING
// ==========================================
if (groupShareMediaBtn) {
    groupShareMediaBtn.addEventListener('click', () => {
        if (shareMediaModal) shareMediaModal.classList.remove('hidden');
    });
}

if (closeShareModalBtn) {
    closeShareModalBtn.addEventListener('click', () => {
        if (shareMediaModal) shareMediaModal.classList.add('hidden');
    });
}

// File picker for device photos
if (mediaFileInput) {
    mediaFileInput.addEventListener('change', () => {
        const file = mediaFileInput.files[0];
        if (!file) return;

        if (file.size > 8 * 1024 * 1024) {
            alert('Picture is too large. Please select an image under 8MB.');
            mediaFileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            selectedMediaDataUrl = e.target.result;
            if (fileNamePreview) {
                fileNamePreview.innerText = `Selected: ${file.name}`;
                fileNamePreview.classList.remove('hidden');
            }
            if (mediaUrlInput) mediaUrlInput.value = '';
        };
        reader.readAsDataURL(file);
    });
}

// Quick reaction GIF pills
document.querySelectorAll('.gif-pill').forEach(btn => {
    btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        if (mediaUrlInput) mediaUrlInput.value = url;
        selectedMediaDataUrl = null;
        if (fileNamePreview) fileNamePreview.classList.add('hidden');
        document.querySelectorAll('.gif-pill').forEach(p => p.classList.remove('selected'));
        btn.classList.add('selected');
    });
});

// Send media button
if (btnSendMedia) {
    btnSendMedia.addEventListener('click', () => {
        const finalUrl = selectedMediaDataUrl || (mediaUrlInput && mediaUrlInput.value.trim());
        if (!finalUrl) {
            alert('Please select a picture or paste an image/GIF URL first.');
            return;
        }

        btnSendMedia.disabled = true;
        btnSendMedia.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

        socket.emit('group_share_media', { mediaUrl: finalUrl, duration: 10 }, (res) => {
            btnSendMedia.disabled = false;
            btnSendMedia.innerHTML = '<i class="fas fa-paper-plane"></i> Send (Disappears in 10s)';

            // Reset modal state
            if (shareMediaModal) shareMediaModal.classList.add('hidden');
            selectedMediaDataUrl = null;
            if (mediaFileInput) mediaFileInput.value = '';
            if (mediaUrlInput) mediaUrlInput.value = '';
            if (fileNamePreview) fileNamePreview.classList.add('hidden');
            document.querySelectorAll('.gif-pill').forEach(p => p.classList.remove('selected'));
        });
    });
}

// Handle incoming disappearing photo / GIF in room
socket.on('group_media_shared', ({ mediaUrl, senderName, duration }) => {
    console.log(`[Media] Received media from ${senderName}, duration: ${duration}s`);
    if (!disappearingMediaOverlay || !mediaPopupImg) return;

    if (mediaCountdownTimer) {
        clearInterval(mediaCountdownTimer);
        mediaCountdownTimer = null;
    }

    if (mediaPopupSender) mediaPopupSender.innerText = senderName;
    mediaPopupImg.src = mediaUrl;
    disappearingMediaOverlay.classList.remove('hidden');

    let remaining = duration || 10;
    if (mediaCountdownSec) mediaCountdownSec.innerText = `${remaining}s`;
    if (mediaProgressFill) mediaProgressFill.style.width = '100%';

    const startTime = Date.now();
    const totalMs = remaining * 1000;

    mediaCountdownTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const leftMs = Math.max(0, totalMs - elapsed);
        const leftSec = Math.ceil(leftMs / 1000);

        if (mediaCountdownSec) mediaCountdownSec.innerText = `${leftSec}s`;
        if (mediaProgressFill) {
            const pct = (leftMs / totalMs) * 100;
            mediaProgressFill.style.width = `${pct}%`;
        }

        if (leftMs <= 0) {
            clearInterval(mediaCountdownTimer);
            mediaCountdownTimer = null;
            closeMediaPopup();
        }
    }, 100);
});

if (closeMediaPopupBtn) {
    closeMediaPopupBtn.addEventListener('click', closeMediaPopup);
}

function closeMediaPopup() {
    if (mediaCountdownTimer) {
        clearInterval(mediaCountdownTimer);
        mediaCountdownTimer = null;
    }
    if (disappearingMediaOverlay) disappearingMediaOverlay.classList.add('hidden');
    if (mediaPopupImg) mediaPopupImg.src = '';
}

// ==========================================
// 10. TIKTOK LIVE CHAT & KEYBOARD-STYLE GIF DRAWER
// ==========================================
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 100% Verified Healthy Animated GIFs (Zero 404 or deleted-placeholder assets)
const CURATED_GIFS = {
    all: [
        'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif',
        'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
        'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif',
        'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
        'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif',
        'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
        'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif',
        'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif'
    ],
    trending: [
        'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif',
        'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
        'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif',
        'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
        'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif',
        'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif'
    ],
    sports: [
        'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
        'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
        'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif',
        'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif'
    ],
    laugh: [
        'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
        'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif',
        'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif',
        'https://media.giphy.com/media/9MFsKQ8A6HCN2/giphy.gif'
    ],
    dance: [
        'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif',
        'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
        'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif',
        'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif'
    ],
    fire: [
        'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif',
        'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
        'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
        'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif'
    ],
    love: [
        'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
        'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif',
        'https://media.giphy.com/media/l4pTfx2qLszoacZRS/giphy.gif',
        'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif'
    ],
    anime: [
        'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
        'https://media.giphy.com/media/L95W4wv8nnb9K/giphy.gif',
        'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
        'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif'
    ],
    meme: [
        'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
        'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif',
        'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
        'https://media.giphy.com/media/d3mlE7uhX8KFgEmY/giphy.gif',
        'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
        'https://media.giphy.com/media/9MFsKQ8A6HCN2/giphy.gif'
    ],
    clap: [
        'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif',
        'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
        'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
        'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif'
    ],
    wow: [
        'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif',
        'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
        'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
        'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif'
    ],
    sad: [
        'https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif',
        'https://media.giphy.com/media/L95W4wv8nnb9K/giphy.gif',
        'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
        'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif'
    ]
};

const GIF_METADATA = [
    { url: 'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif', tags: ['dance', 'party', 'parrot', 'groove', 'trending', 'fun', 'music'] },
    { url: 'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif', tags: ['cat', 'vibing', 'vibe', 'cute', 'meme', 'trending', 'love', 'hug'] },
    { url: 'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif', tags: ['surprised', 'wow', 'omg', 'trending', 'meme', 'shocked'] },
    { url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif', tags: ['laugh', 'lol', 'haha', 'funny', 'joke', 'meme', 'comedy'] },
    { url: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif', tags: ['blink', 'wtf', 'meme', 'trending', 'wow', 'confused'] },
    { url: 'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif', tags: ['leonardo', 'dicaprio', 'fire', 'cheers', 'lit', 'party', 'congrats'] },
    { url: 'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif', tags: ['clap', 'laugh', 'cheers', 'toast', 'congrats', 'leo'] },
    { url: 'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif', tags: ['laugh', 'haha', 'lmao', 'funny', 'smile'] },
    { url: 'https://media.giphy.com/media/9MFsKQ8A6HCN2/giphy.gif', tags: ['laugh', 'lizard', 'lol', 'hehe', 'comedy', 'meme'] },
    { url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', tags: ['party', 'celebrate', 'dance', 'fire', 'happy', 'lit'] },
    { url: 'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif', tags: ['love', 'heart', 'sweet', 'kiss', 'romance'] },
    { url: 'https://media.giphy.com/media/l4pTfx2qLszoacZRS/giphy.gif', tags: ['love', 'hearts', 'cute', 'hug', 'sweet'] },
    { url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif', tags: ['anime', 'excited', 'happy', 'star wars', 'hype'] },
    { url: 'https://media.giphy.com/media/d3mlE7uhX8KFgEmY/giphy.gif', tags: ['meme', 'think', 'smart', 'roll safe', 'brain', 'clever'] },
    { url: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif', tags: ['mind blown', 'wow', 'fire', 'clap', 'amazing'] },
    { url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', tags: ['mind blown', 'clap', 'wow', 'omg', 'genius'] },
    { url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif', tags: ['wave', 'hi', 'hello', 'hey', 'forrest gump', 'trending'] },
    { url: 'https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif', tags: ['sad', 'cry', 'crying', 'tears', 'emotional'] },
    { url: 'https://media.giphy.com/media/L95W4wv8nnb9K/giphy.gif', tags: ['sad', 'pikachu', 'anime', 'cry', 'tears', 'cute'] }
];

let currentGifCategory = 'all';
let gifSearchDebounceTimer = null;

if (liveChatForm) {
    liveChatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendLiveChatMessage();
    });
}

function sendLiveChatMessage() {
    if (!liveChatInput) return;
    const text = liveChatInput.value.trim();
    if (!text) return;

    socket.emit('group_chat_message', { text: text }, (res) => {});
    liveChatInput.value = '';
}

socket.on('group_chat_message', (msg) => {
    appendLiveChatMessage(msg);
});

function appendLiveChatMessage(msg) {
    if (!liveOverlayStream) return;

    const bubble = document.createElement('div');
    bubble.className = msg.voiceData ? 'live-chat-bubble has-voice' : 'live-chat-bubble';

    // Stable identity avatar per sender
    const avatarSrc = getStableAvatarForUser(msg.senderId, msg.senderAvatar);
    const cleanName = escapeHtml(msg.senderName || 'Friend');

    let innerContent = `<span class="live-chat-username">${cleanName}</span>`;
    if (msg.text) {
        innerContent += `<span class="live-chat-text">${escapeHtml(msg.text)}</span>`;
    }
    if (msg.gifUrl) {
        innerContent += `<img src="${escapeHtml(msg.gifUrl)}" alt="GIF" class="live-chat-gif-img" loading="lazy" />`;
    }

    bubble.innerHTML = `
        <img class="live-chat-avatar" src="${avatarSrc}" alt="${cleanName}">
        <div class="live-chat-content">
            ${innerContent}
        </div>
    `;

    if (msg.voiceData) {
        const contentBox = bubble.querySelector('.live-chat-content');
        if (contentBox) {
            contentBox.appendChild(createVoiceNotePlayer(msg.voiceData, msg.voiceDuration || 1));
        }
        // If someone is watching video with chat collapsed, softly unhide or notify so they can hear/play it
        if (isLiveChatHidden && btnToggleLiveChat) {
            btnToggleLiveChat.classList.add('has-unread-pulse');
        }
    }

    liveOverlayStream.appendChild(bubble);

    // Trim oldest non-voice bubbles first so voice notes stay playable while in the room
    while (liveOverlayStream.children.length > 40) {
        const oldestNonVoice = Array.from(liveOverlayStream.children).find(el => !el.classList.contains('has-voice'));
        liveOverlayStream.removeChild(oldestNonVoice || liveOverlayStream.children[0]);
    }

    liveOverlayStream.scrollTop = liveOverlayStream.scrollHeight;
    playSystemSound('message');
}

// GIF Keyboard Drawer Controls
function closeGifDrawer() {
    if (gifKeyboardDrawer) gifKeyboardDrawer.classList.remove('is-open');
    if (btnToggleGifDrawer) btnToggleGifDrawer.classList.remove('active');
    if (privateGifBtn) privateGifBtn.classList.remove('active');
    if (gifDrawerBackdrop) gifDrawerBackdrop.classList.add('hidden');
}

let currentGifQuery = 'trending';
let liveCategoriesLoaded = false;
const gifCategoryCache = new Map();
let activeGifPaginationQuery = 'trending';
let activeGifPage = 0;

async function loadLiveGifCategories() {
    if (liveCategoriesLoaded || !gifTagsContainer) return;
    try {
        const res = await fetch('/api/gifs/categories');
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !Array.isArray(data.categories) || data.categories.length === 0) return;

        liveCategoriesLoaded = true;
        gifTagsContainer.innerHTML = '';
        data.categories.forEach((cat) => {
            const btn = document.createElement('button');
            btn.className = 'gif-tag-chip' + (cat.tag === currentGifCategory ? ' active' : '');
            btn.setAttribute('data-tag', cat.tag);
            btn.setAttribute('data-query', cat.query || cat.tag);
            btn.innerText = cat.label;
            gifTagsContainer.appendChild(btn);
        });
    } catch (e) {
        console.warn('[GIF Categories] Live load skipped:', e);
    }
}

if (btnToggleGifDrawer) {
    btnToggleGifDrawer.addEventListener('click', () => {
        if (!gifKeyboardDrawer) return;
        gifDrawerTarget = 'group';
        const isOpen = gifKeyboardDrawer.classList.toggle('is-open');
        btnToggleGifDrawer.classList.toggle('active', isOpen);
        if (gifDrawerBackdrop) gifDrawerBackdrop.classList.toggle('hidden', !isOpen);
        if (isOpen) {
            loadLiveGifCategories();
            if (!gifSheetGrid.children.length || gifSheetGrid.querySelector('.gif-loading-state')) {
                loadGifsForCategory(currentGifCategory, currentGifQuery);
            }
        }
    });
}

if (btnCloseGifDrawer) {
    btnCloseGifDrawer.addEventListener('click', closeGifDrawer);
}

if (gifDrawerBackdrop) {
    gifDrawerBackdrop.addEventListener('click', closeGifDrawer);
}

// Category tag chips (live from Tenor Explore + Reactions)
if (gifTagsContainer) {
    gifTagsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.gif-tag-chip');
        if (!chip) return;
        gifTagsContainer.querySelectorAll('.gif-tag-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (typeof chip.scrollIntoView === 'function') {
            chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
        const tag = chip.getAttribute('data-tag') || 'all';
        const query = chip.getAttribute('data-query') || tag;
        currentGifCategory = tag;
        currentGifQuery = query;
        if (gifSheetSearch) gifSheetSearch.value = '';
        if (btnClearGifSearch) btnClearGifSearch.classList.add('hidden');
        loadGifsForCategory(tag, query);
    });
}

// Instant keyword & Web-wide GIF search (form submit + live input)
if (gifSearchForm) {
    gifSearchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        clearTimeout(gifSearchDebounceTimer);
        const query = gifSheetSearch ? gifSheetSearch.value.trim() : '';
        if (query) {
            searchGifs(query);
        } else {
            loadGifsForCategory(currentGifCategory, currentGifQuery);
        }
    });
}

if (gifSheetSearch) {
    gifSheetSearch.addEventListener('input', () => {
        const query = gifSheetSearch.value.trim();
        if (btnClearGifSearch) {
            btnClearGifSearch.classList.toggle('hidden', !query);
        }
        clearTimeout(gifSearchDebounceTimer);
        gifSearchDebounceTimer = setTimeout(() => {
            if (query) {
                searchGifs(query);
            } else {
                loadGifsForCategory(currentGifCategory, currentGifQuery);
            }
        }, 220);
    });
}

if (btnClearGifSearch) {
    btnClearGifSearch.addEventListener('click', () => {
        if (gifSheetSearch) gifSheetSearch.value = '';
        btnClearGifSearch.classList.add('hidden');
        loadGifsForCategory(currentGifCategory, currentGifQuery);
    });
}

async function loadGifsForCategory(category, queryOverride) {
    if (!gifSheetGrid) return;
    const rawQuery = queryOverride || (category === 'all' ? 'trending' : category);
    activeGifPaginationQuery = rawQuery;
    activeGifPage = 0;

    if (gifCategoryCache.has(rawQuery)) {
        renderGifsInSheet(gifCategoryCache.get(rawQuery), true);
        return;
    }

    gifSheetGrid.innerHTML = '<div class="gif-loading-state"><i class="fas fa-spinner fa-spin"></i> Loading GIFs from web...</div>';

    try {
        const res = await fetch(`/api/gifs/search?q=${encodeURIComponent(rawQuery)}&page=0`);
        if (res.ok) {
            const data = await res.json();
            if (currentGifCategory !== category || (gifSheetSearch && gifSheetSearch.value.trim())) return;
            if (data && Array.isArray(data.results) && data.results.length > 0) {
                gifCategoryCache.set(rawQuery, data.results);
                renderGifsInSheet(data.results, true);
                return;
            }
        }
    } catch (e) {
        console.warn('[GIF Category] Live fetch failed, using offline fallback:', e);
    }

    if (currentGifCategory !== category || (gifSheetSearch && gifSheetSearch.value.trim())) return;
    renderGifsInSheet(CURATED_GIFS[category] || CURATED_GIFS.trending, false);
}

async function searchGifs(query) {
    if (!gifSheetGrid) return;
    const cleanQuery = query.toLowerCase().trim();
    if (!cleanQuery) {
        loadGifsForCategory(currentGifCategory, currentGifQuery);
        return;
    }

    // Direct Image or GIF URL detection: enables sending ANY GIF on the internet!
    if (/^https?:\/\/.+/i.test(cleanQuery)) {
        gifSheetGrid.innerHTML = `
            <div class="custom-gif-url-card" style="grid-column: 1 / -1; display:flex; flex-direction:column; align-items:center; gap:8px; padding:12px; background:rgba(255,255,255,0.05); border-radius:12px; border:1px solid rgba(255,255,255,0.15);">
                <img src="${cleanQuery}" alt="Preview" style="max-height:120px; border-radius:8px; object-fit:contain;" onerror="this.style.display='none'" />
                <button type="button" class="btn-primary" style="padding:6px 16px; border-radius:20px; font-weight:700; cursor:pointer;" id="btn-send-custom-url">
                    <i class="fas fa-paper-plane"></i> Send this GIF / Image
                </button>
            </div>
        `;
        const btnSend = document.getElementById('btn-send-custom-url');
        if (btnSend) {
            btnSend.addEventListener('click', () => {
                selectAndSendGif(cleanQuery);
            });
        }
        return;
    }

    activeGifPaginationQuery = cleanQuery;
    activeGifPage = 0;
    gifSheetGrid.innerHTML = '<div class="gif-loading-state"><i class="fas fa-spinner fa-spin"></i> Searching ALL GIFs...</div>';

    // 1. Live Internet-Wide GIF search (Tenor + Bing + DuckDuckGo)
    try {
        const res = await fetch(`/api/gifs/search?q=${encodeURIComponent(cleanQuery)}&page=0`);
        if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                renderGifsInSheet(data.results, true);
                return;
            }
        }
    } catch (e) {
        console.warn('Live GIF search fetch error, falling back to offline library:', e);
    }

    // 2. Offline-only fallback
    const matched = GIF_METADATA.filter(item => {
        return item.tags.some(t => t.includes(cleanQuery) || cleanQuery.includes(t));
    }).map(i => i.url);

    if (matched.length > 0) {
        renderGifsInSheet(matched, false);
    } else {
        const words = cleanQuery.split(/\s+/);
        const partialMatches = GIF_METADATA.filter(item => {
            return words.some(w => item.tags.some(t => t.startsWith(w) || t.includes(w)));
        }).map(i => i.url);
        renderGifsInSheet(partialMatches.length > 0 ? partialMatches : CURATED_GIFS.trending, false);
    }
}

async function loadMoreGifs(btnEl) {
    if (!gifSheetGrid || !activeGifPaginationQuery) return;
    activeGifPage++;
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerText = 'Loading more...';
    }
    try {
        const res = await fetch(`/api/gifs/search?q=${encodeURIComponent(activeGifPaginationQuery)}&page=${activeGifPage}`);
        if (res.ok) {
            const data = await res.json();
            const existingUrls = new Set([...gifSheetGrid.querySelectorAll('img')].map(i => i.src));
            const fresh = (data.results || []).filter(u => !existingUrls.has(u));
            const loadWrap = gifSheetGrid.querySelector('.gif-load-more-wrap');
            fresh.forEach(url => {
                const card = createGifCardElement(url);
                if (loadWrap) gifSheetGrid.insertBefore(card, loadWrap);
                else gifSheetGrid.appendChild(card);
            });
            if (fresh.length === 0 && loadWrap) {
                loadWrap.remove();
            } else if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerText = 'Load More GIFs';
            }
            return;
        }
    } catch (e) {}
    if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerText = 'Load More GIFs';
    }
}

function createGifCardElement(url) {
    const card = document.createElement('div');
    card.className = 'gif-item-card';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'GIF';
    img.decoding = 'async';
    img.onerror = () => card.remove();
    card.appendChild(img);
    card.addEventListener('click', () => {
        selectAndSendGif(url);
    });
    return card;
}

function renderGifsInSheet(gifUrls, allowLoadMore = false) {
    if (!gifSheetGrid) return;
    gifSheetGrid.innerHTML = '';

    if (!gifUrls || gifUrls.length === 0) {
        gifSheetGrid.innerHTML = '<div class="gif-loading-state">No GIFs found. Try another word!</div>';
        return;
    }

    gifUrls.forEach(url => {
        gifSheetGrid.appendChild(createGifCardElement(url));
    });

    if (allowLoadMore) {
        const wrap = document.createElement('div');
        wrap.className = 'gif-load-more-wrap';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'btn-load-more-gifs';
        btn.className = 'gif-load-more-btn';
        btn.innerText = 'Load More GIFs';
        btn.addEventListener('click', () => loadMoreGifs(btn));
        wrap.appendChild(btn);
        gifSheetGrid.appendChild(wrap);
    }
}

function selectAndSendGif(gifUrl) {
    const isPrivateChatActive = gifDrawerTarget === 'private' || (chatScreen && chatScreen.classList.contains('active'));
    if (isPrivateChatActive) {
        socket.emit('private_gif', { gifUrl });
        addPrivateGifMessage(gifUrl, 'sent');
    } else {
        socket.emit('group_chat_message', { gifUrl: gifUrl });
    }
    closeGifDrawer();
}

// Show Public Video Call Live Preview Sheet if opened via direct ?live=public link
(function checkDirectPublicLink() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('live') === 'public') {
            if (socket.connected) {
                openPublicPreviewModal();
            } else {
                socket.once('connect', () => {
                    openPublicPreviewModal();
                });
            }
        }
    } catch (e) {}
})();

// =====================================================================
// v8.2: TRUE CEILING VIDEO QUALITY (WEBSOCKET/WEBRTC GCC ADAPTIVE)
//       NEVER ARTIFICIALLY LOCKED TO 360p — TRIES HARD FOR MAX HD/FHD
// =====================================================================
const QUALITY_PRESETS = {
    '360p': { key: '360p', badge: '360p', label: 'Data Saver (Max 360p)', width: 640, height: 360, fps: 20, maxBitrate: 350000, scaleDown: 2.0, hardCap: true, degradation: 'balanced' },
    '480p': { key: '480p', badge: '480p', label: 'Standard (Max 480p)', width: 854, height: 480, fps: 24, maxBitrate: 800000, scaleDown: 1.4, hardCap: true, degradation: 'balanced' },
    '720p': { key: '720p', badge: 'HD', label: 'HD (Up to 720p)', width: 1280, height: 720, fps: 30, maxBitrate: 1800000, scaleDown: 1.0, hardCap: false, degradation: 'balanced' },
    '1080p': { key: '1080p', badge: 'FHD', label: 'Full HD (Up to 1080p)', width: 1920, height: 1080, fps: 30, maxBitrate: 4000000, scaleDown: 1.0, hardCap: false, degradation: 'balanced' }
};

function getNetworkAutoSummary() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) {
        return { key: '1080p', networkLabel: 'Wi-Fi / Broadband • Auto Up to Full HD (1080p)', isMobileData: false };
    }
    const saveData = !!conn.saveData;
    const eff = String(conn.effectiveType || '').toLowerCase();
    const type = String(conn.type || '').toLowerCase();
    const downlink = Number(conn.downlink) || 0;

    if (saveData || eff === 'slow-2g' || eff === '2g' || eff === '3g') {
        return { key: '360p', networkLabel: 'Mobile / Data Saver • Auto Max 360p', isMobileData: true };
    }
    if (type === 'cellular') {
        return {
            key: (downlink > 0 && downlink < 2.0) ? '360p' : '480p',
            networkLabel: `Mobile Data (Cellular) • Auto Data Saver (${(downlink > 0 && downlink < 2.0) ? '360p' : '480p'})`,
            isMobileData: true
        };
    }
    // On Wi-Fi / Ethernet / standard broadband: allow WebRTC to push all the way to Full HD (1080p),
    // while WebRTC congestion control naturally scales down smoothly if connection dips!
    return { key: '1080p', networkLabel: 'Wi-Fi / Broadband • Auto Up to Full HD (1080p)', isMobileData: false };
}

function getEffectiveQualityProfile() {
    const autoInfo = getNetworkAutoSummary();
    const chosenKey = QUALITY_PRESETS[privateQualityMode] ? privateQualityMode : autoInfo.key;
    const profile = QUALITY_PRESETS[chosenKey] || QUALITY_PRESETS['1080p'];
    return {
        mode: privateQualityMode,
        userMaxKey: chosenKey,
        effectiveKey: chosenKey,
        throttledByNetwork: false,
        profile,
        userMaxProfile: profile,
        autoInfo
    };
}

function pickStrictQualityCap(localProfile, remotePref) {
    if (!remotePref || !remotePref.maxBitrate || remotePref.maxBitrate <= 0) {
        return localProfile;
    }
    const cappedBitrate = Math.min(localProfile.maxBitrate, Number(remotePref.maxBitrate));
    const cappedHeight = Math.min(localProfile.height, Number(remotePref.maxHeight) || localProfile.height);
    const cappedFps = Math.min(localProfile.fps, Number(remotePref.maxFramerate) || localProfile.fps);
    let scaleDown = localProfile.scaleDown || 1.0;
    if (cappedHeight <= 360) scaleDown = Math.max(scaleDown, 2.0);
    else if (cappedHeight <= 480) scaleDown = Math.max(scaleDown, 1.4);

    return {
        ...localProfile,
        maxBitrate: cappedBitrate,
        fps: cappedFps,
        scaleDown,
        degradation: 'balanced'
    };
}

async function applySenderVideoQuality(pc, remotePref = null) {
    if (!pc || typeof pc.getSenders !== 'function') return;
    const { profile } = getEffectiveQualityProfile();
    const cap = pickStrictQualityCap(profile, remotePref);

    for (const sender of pc.getSenders()) {
        if (!sender || !sender.track || sender.track.kind !== 'video') continue;
        if (typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') continue;
        try {
            const params = sender.getParameters() || {};
            if (!Array.isArray(params.encodings) || params.encodings.length === 0) {
                params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = cap.maxBitrate;
            params.encodings[0].maxFramerate = cap.fps;
            params.encodings[0].scaleResolutionDownBy = cap.scaleDown;
            try {
                params.degradationPreference = 'balanced';
            } catch (e) {}
            await sender.setParameters(params);
        } catch (err) {
            try {
                const retryParams = sender.getParameters() || {};
                if (!Array.isArray(retryParams.encodings) || retryParams.encodings.length === 0) {
                    retryParams.encodings = [{}];
                }
                retryParams.encodings[0].maxBitrate = cap.maxBitrate;
                await sender.setParameters(retryParams);
            } catch (e2) {}
        }
    }
}

async function applyQualityToActivePeersAndTracks() {
    if (isPrivateCameraOn && privateLocalVideoStream && !isPrivateScreenSharing) {
        await applyConstraintsToStream(privateLocalVideoStream);
    }
    if (isLocalCameraOn && groupVideoStream && !isGroupScreenSharing) {
        await applyConstraintsToStream(groupVideoStream);
    }
    if (peerConnection) {
        await applySenderVideoQuality(peerConnection, partnerRequestedQuality);
    }
    for (const [peerId, peer] of groupPeers.entries()) {
        if (peer && peer.pc) {
            await applySenderVideoQuality(peer.pc, peerRequestedQualities.get(peerId));
        }
    }
}

async function requestCameraStreamForQuality(facingMode, exactFacing = false) {
    const { profile } = getEffectiveQualityProfile();
    const facingConstraint = exactFacing ? { exact: facingMode } : facingMode;
    // Ask camera for ideal target resolution (without forcing high min) so good cameras give sharp HD/FHD
    // while WebRTC balanced congestion control automatically adapts down only if network actually struggles
    const primaryVideo = profile.hardCap
        ? { width: { min: 160, ideal: profile.width, max: profile.width }, height: { min: 120, ideal: profile.height, max: profile.height }, frameRate: { ideal: profile.fps, max: profile.fps }, facingMode: facingConstraint }
        : { width: { ideal: profile.width }, height: { ideal: profile.height }, frameRate: { ideal: profile.fps, max: 30 }, facingMode: facingConstraint };

    const attempts = [
        { video: primaryVideo },
        { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: facingConstraint } },
        { video: { facingMode: facingConstraint } },
        { video: { facingMode } },
        { video: true }
    ];
    let lastErr = null;
    for (const constraints of attempts) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error('Camera unavailable');
}

async function applyConstraintsToStream(stream) {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.applyConstraints !== 'function') return;
    const { profile } = getEffectiveQualityProfile();
    try {
        await track.applyConstraints(profile.hardCap
            ? { width: { min: 160, ideal: profile.width, max: profile.width }, height: { min: 120, ideal: profile.height, max: profile.height }, frameRate: { ideal: profile.fps, max: profile.fps } }
            : { width: { ideal: profile.width }, height: { ideal: profile.height }, frameRate: { ideal: profile.fps, max: 30 } }
        );
    } catch (e) {}
}

function emitCurrentQualityPref(scope = 'both', targetMemberId = null) {
    const { mode, profile } = getEffectiveQualityProfile();
    // Only ask partner to cap download if user is in Data Saver (360p) or Standard (480p);
    // otherwise send maxBitrate: 0 (no artificial cap — let partner stream up to full HD!)
    const wantsDataCap = profile.key === '360p' || profile.key === '480p';
    const payload = wantsDataCap
        ? {
            preset: mode === 'auto' ? `auto:${profile.key}` : profile.key,
            maxWidth: profile.width,
            maxHeight: profile.height,
            maxBitrate: profile.maxBitrate,
            maxFramerate: profile.fps
        }
        : {
            preset: mode === 'auto' ? `auto:${profile.key}` : profile.key,
            maxWidth: 0,
            maxHeight: 0,
            maxBitrate: 0,
            maxFramerate: 0
        };
    if ((scope === 'private' || scope === 'both') && peerConnection) {
        socket.emit('private_quality_pref', payload);
    }
    if ((scope === 'group' || scope === 'both') && currentGroupPin) {
        socket.emit('group_quality_pref', targetMemberId ? { ...payload, to: targetMemberId } : payload);
    }
}

function updateQualityUiBadges() {
    const { mode, profile, autoInfo } = getEffectiveQualityProfile();
    const badgeLabel = mode === 'auto' ? `AUTO` : profile.badge;
    const isSaver = profile.key === '360p' || profile.key === '480p';
    const isHd = profile.key === '720p' || profile.key === '1080p';

    const pairs = [
        [document.getElementById('private-quality-btn'), document.getElementById('private-quality-badge')],
        [document.getElementById('group-quality-btn'), document.getElementById('group-quality-badge')]
    ];
    for (const [btn, span] of pairs) {
        if (span) span.innerText = badgeLabel;
        if (btn) {
            btn.classList.toggle('is-saver', isSaver);
            btn.classList.toggle('is-hd', isHd && !isSaver);
            btn.title = `Video Quality: ${mode === 'auto' ? autoInfo.networkLabel : profile.label}`;
        }
    }

    const netEl = document.getElementById('quality-network-status');
    if (netEl) netEl.innerText = autoInfo.networkLabel;
    const autoDesc = document.getElementById('q-auto-desc');
    if (autoDesc) autoDesc.innerText = `Currently: ${profile.label} (uses best clarity Wi-Fi allows, Data Saver on mobile)`;

    document.querySelectorAll('#quality-options-list .quality-option-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.quality === privateQualityMode);
    });
}

async function setVideoQualityPreference(mode) {
    privateQualityMode = (mode === 'auto' || QUALITY_PRESETS[mode]) ? mode : 'auto';
    try { localStorage.setItem('gc_video_quality', privateQualityMode); } catch (e) {}
    updateQualityUiBadges();
    await applyQualityToActivePeersAndTracks();
    emitCurrentQualityPref('both');
}

let sessionTotalSentBytes = 0;
let sessionTotalRecvBytes = 0;

function formatBytesToMb(bytes) {
    const mb = (Number(bytes) || 0) / (1024 * 1024);
    return mb >= 10 ? mb.toFixed(1) : mb.toFixed(2);
}

function updateQualityLiveStatsPanel() {
    const statsEl = document.getElementById('quality-live-stats');
    if (!statsEl) return;
    const parts = [];
    if (privateRemoteVideo && privateRemoteVideo.videoWidth > 0 && !privateRemoteVideo.classList.contains('hidden')) {
        parts.push(`Partner: ${privateRemoteVideo.videoWidth}x${privateRemoteVideo.videoHeight}`);
    }
    if (privateLocalVideo && privateLocalVideo.videoWidth > 0 && !privateLocalVideo.classList.contains('hidden')) {
        parts.push(`You: ${privateLocalVideo.videoWidth}x${privateLocalVideo.videoHeight}`);
    }
    if (localVideoPreview && localVideoPreview.videoWidth > 0 && !localVideoPreview.classList.contains('hidden')) {
        parts.push(`You: ${localVideoPreview.videoWidth}x${localVideoPreview.videoHeight}`);
    }
    document.querySelectorAll('video[id^="video-"]:not(.hidden)').forEach(v => {
        if (v.videoWidth > 0) parts.push(`Remote: ${v.videoWidth}x${v.videoHeight}`);
    });
    const { profile } = getEffectiveQualityProfile();
    const totalBytes = sessionTotalSentBytes + sessionTotalRecvBytes;
    const dataText = totalBytes > 1024
        ? ` • Used ${formatBytesToMb(totalBytes)} MB (▲${formatBytesToMb(sessionTotalSentBytes)} ▼${formatBytesToMb(sessionTotalRecvBytes)})`
        : '';
    statsEl.innerText = parts.length > 0
        ? `Live: ${parts.join(' | ')}${dataText}`
        : `Target: ${profile.label} (Max ${(profile.maxBitrate / 1000).toFixed(0)} kbps)${dataText}`;
}

// Read-only live WebRTC MB traffic counter (never forces artificial video downgrades!)
async function measureConnectionAndAdapt() {
    const connectedPcs = [];
    if (peerConnection && ['connected', 'completed'].includes(peerConnection.iceConnectionState)) {
        connectedPcs.push(peerConnection);
    }
    for (const peer of groupPeers.values()) {
        if (peer && peer.pc && ['connected', 'completed'].includes(peer.pc.iceConnectionState)) {
            connectedPcs.push(peer.pc);
        }
    }
    if (connectedPcs.length === 0) return;

    for (const pc of connectedPcs) {
        try {
            const report = await pc.getStats();
            let pcSent = 0;
            let pcRecv = 0;
            report.forEach(stat => {
                if (stat.type === 'outbound-rtp' && typeof stat.bytesSent === 'number') {
                    pcSent += stat.bytesSent;
                } else if (stat.type === 'inbound-rtp' && typeof stat.bytesReceived === 'number') {
                    pcRecv += stat.bytesReceived;
                }
            });
            const prev = pc._gcTrafficStats || { sent: 0, recv: 0 };
            if (pcSent >= prev.sent) sessionTotalSentBytes += (pcSent - prev.sent);
            if (pcRecv >= prev.recv) sessionTotalRecvBytes += (pcRecv - prev.recv);
            pc._gcTrafficStats = { sent: pcSent, recv: pcRecv };
        } catch (e) {}
    }

    if (qualitySheetEl && qualitySheetEl.classList.contains('open')) {
        updateQualityLiveStatsPanel();
    }
}
setInterval(() => { measureConnectionAndAdapt(); }, 3500);

// Incoming peer quality preference handlers (two-way student data saver!)
socket.on('private_quality_pref', async (pref) => {
    partnerRequestedQuality = pref || null;
    if (peerConnection) {
        await applySenderVideoQuality(peerConnection, partnerRequestedQuality);
    }
    if (pref && pref.maxHeight) {
        const label = pref.maxHeight <= 360 ? 'Data Saver (360p)' : `${pref.maxHeight}p`;
        addMessage(`📉 Partner set quality to ${label} — adapting your video to save their data.`, 'system');
    }
});

socket.on('group_quality_pref', async (pref) => {
    if (!pref || !pref.memberId) return;
    peerRequestedQualities.set(pref.memberId, pref);
    const peer = groupPeers.get(pref.memberId);
    if (peer && peer.pc) {
        await applySenderVideoQuality(peer.pc, pref);
    }
});

// Wire Quality Sheet open/close/options
const qualitySheetEl = document.getElementById('quality-selector-sheet');
const qualityBackdropEl = document.getElementById('quality-sheet-backdrop');
function openQualitySheet() {
    updateQualityUiBadges();
    updateQualityLiveStatsPanel();
    if (qualityBackdropEl) qualityBackdropEl.classList.remove('hidden');
    if (qualitySheetEl) qualitySheetEl.classList.add('open');
}
function closeQualitySheet() {
    if (qualityBackdropEl) qualityBackdropEl.classList.add('hidden');
    if (qualitySheetEl) qualitySheetEl.classList.remove('open');
}
document.getElementById('private-quality-btn')?.addEventListener('click', openQualitySheet);
document.getElementById('group-quality-btn')?.addEventListener('click', openQualitySheet);
document.getElementById('close-quality-sheet-btn')?.addEventListener('click', closeQualitySheet);
qualityBackdropEl?.addEventListener('click', closeQualitySheet);
document.querySelectorAll('#quality-options-list .quality-option-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        await setVideoQualityPreference(btn.dataset.quality);
        closeQualitySheet();
    });
});
if (navigator.connection && typeof navigator.connection.addEventListener === 'function') {
    navigator.connection.addEventListener('change', () => {
        if (privateQualityMode === 'auto') setVideoQualityPreference('auto');
        else updateQualityUiBadges();
    });
}
updateQualityUiBadges();

// ===== Floating Emoji Live Reactions (1-on-1 & Group/Public) =====
function spawnFloatingReaction(layerEl, emoji) {
    if (!layerEl || !emoji) return;
    const bubble = document.createElement('span');
    bubble.className = 'floating-emoji-bubble';
    bubble.innerText = emoji;
    bubble.style.left = `${14 + Math.random() * 72}%`;
    bubble.style.setProperty('--drift-x', `${Math.round((Math.random() - 0.5) * 44)}px`);
    layerEl.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2200);
}

function wireReactionControls({ btnId, dockId, layerId, emitFn }) {
    const btn = document.getElementById(btnId);
    const dock = document.getElementById(dockId);
    const layer = document.getElementById(layerId);
    if (!btn || !dock) return;
    btn.addEventListener('click', () => dock.classList.toggle('hidden'));
    dock.querySelectorAll('.react-chip-btn').forEach(chip => {
        chip.addEventListener('click', () => {
            const emoji = chip.dataset.emoji;
            if (!emoji) return;
            spawnFloatingReaction(layer, emoji);
            emitFn(emoji);
        });
    });
}

wireReactionControls({
    btnId: 'private-react-btn',
    dockId: 'private-reaction-dock',
    layerId: 'private-reaction-layer',
    emitFn: (emoji) => socket.emit('private_reaction', { emoji })
});
wireReactionControls({
    btnId: 'group-react-btn',
    dockId: 'group-reaction-dock',
    layerId: 'group-reaction-layer',
    emitFn: (emoji) => socket.emit('group_reaction', { emoji })
});
socket.on('private_reaction', ({ emoji } = {}) => {
    spawnFloatingReaction(document.getElementById('private-reaction-layer'), emoji);
});
socket.on('group_reaction', ({ emoji } = {}) => {
    spawnFloatingReaction(document.getElementById('group-reaction-layer'), emoji);
});

// ===== In-Call Screen Sharing (Desktop & Android Chrome; auto-hidden if unsupported) =====
if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
    if (privateShareScreenBtn) privateShareScreenBtn.classList.remove('hidden');
    if (groupShareScreenBtn) groupShareScreenBtn.classList.remove('hidden');
}

async function stopPrivateScreenShare() {
    if (!isPrivateScreenSharing) return;
    isPrivateScreenSharing = false;
    if (privateShareScreenBtn) privateShareScreenBtn.classList.remove('screen-active');
    if (isPrivateCameraOn) {
        // Toggle off twice to clean stream cleanly
        isPrivateCameraOn = true;
        await togglePrivateCamera();
    }
}

async function togglePrivateScreenShare() {
    if (!peerConnection) return alert('Connect to a partner first!');
    if (isPrivateScreenSharing) {
        await stopPrivateScreenShare();
        return;
    }
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const screenTrack = screenStream.getVideoTracks()[0];
        if (!screenTrack) return;
        if (privateLocalVideoStream) {
            privateLocalVideoStream.getTracks().forEach(t => t.stop());
        }
        privateLocalVideoStream = screenStream;
        isPrivateCameraOn = true;
        isPrivateScreenSharing = true;
        if (privateShareScreenBtn) privateShareScreenBtn.classList.add('screen-active');
        if (privateFlipCamBtn) privateFlipCamBtn.classList.add('hidden');

        screenTrack.onended = () => {
            if (isPrivateScreenSharing) stopPrivateScreenShare();
        };

        const transceiver = getTransceiverByKind(peerConnection, 'video');
        if (transceiver) {
            transceiver.direction = 'sendrecv';
            await transceiver.sender.replaceTrack(screenTrack);
            if (typeof transceiver.sender.setStreams === 'function') {
                transceiver.sender.setStreams(screenStream);
            }
        } else {
            peerConnection.addTransceiver(screenTrack, { direction: 'sendrecv', streams: [screenStream] });
        }
        await applySenderVideoQuality(peerConnection, partnerRequestedQuality);
        await renegotiatePrivatePeer();
        socket.emit('private_camera_toggle', { isCameraOn: true });
        updatePrivateVideoStage();
    } catch (err) {
        console.warn('[1-on-1] Screen share cancelled/failed:', err);
    }
}

async function stopGroupScreenShare() {
    if (!isGroupScreenSharing) return;
    isGroupScreenSharing = false;
    if (groupShareScreenBtn) groupShareScreenBtn.classList.remove('screen-active');
    if (isLocalCameraOn) {
        await toggleGroupCamera();
    }
}

async function toggleGroupScreenShare() {
    if (isGroupScreenSharing) {
        await stopGroupScreenShare();
        return;
    }
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const screenTrack = screenStream.getVideoTracks()[0];
        if (!screenTrack) return;
        if (groupVideoStream) {
            groupVideoStream.getTracks().forEach(t => t.stop());
        }
        groupVideoStream = screenStream;
        isLocalCameraOn = true;
        isGroupScreenSharing = true;
        if (groupShareScreenBtn) groupShareScreenBtn.classList.add('screen-active');
        if (groupFlipCamBtn) groupFlipCamBtn.classList.add('hidden');

        if (localVideoPreview) {
            localVideoPreview.srcObject = groupVideoStream;
            localVideoPreview.style.transform = 'scaleX(1)';
            localVideoPreview.classList.remove('hidden');
        }
        if (localAvatarBox) localAvatarBox.classList.add('hidden');
        if (localCamIndicator) {
            localCamIndicator.className = 'media-badge cam-on';
            localCamIndicator.innerHTML = '<i class="fas fa-desktop"></i>';
        }

        screenTrack.onended = () => {
            if (isGroupScreenSharing) stopGroupScreenShare();
        };

        for (const [peerId, peer] of groupPeers.entries()) {
            if (!peer || !peer.pc) continue;
            const transceiver = getTransceiverByKind(peer.pc, 'video');
            if (transceiver) {
                transceiver.direction = 'sendrecv';
                await transceiver.sender.replaceTrack(screenTrack);
                if (typeof transceiver.sender.setStreams === 'function') {
                    transceiver.sender.setStreams(screenStream);
                }
            } else {
                peer.pc.addTransceiver(screenTrack, { direction: 'sendrecv', streams: [screenStream] });
            }
            await applySenderVideoQuality(peer.pc, peerRequestedQualities.get(peerId));
            await renegotiateGroupPeer(peerId, peer);
        }
        socket.emit('group_media_state', { isCameraOn: true });
    } catch (err) {
        console.warn('[Group] Screen share cancelled/failed:', err);
    }
}

privateShareScreenBtn?.addEventListener('click', togglePrivateScreenShare);
groupShareScreenBtn?.addEventListener('click', toggleGroupScreenShare);

// =====================================================================
// v8.2: NETWORK RECONNECT BANNER, ORGANIZED STUDIO TRAYS,
//       QUICK VOICE NOTES (1-ON-1 + GROUP), AND PWA INSTALL
// =====================================================================
const networkReconnectBanner = document.getElementById('network-reconnect-banner');
const networkReconnectText = document.getElementById('network-reconnect-text');
let reconnectBannerHideTimer = null;

function showNetworkReconnectBanner(msg = 'Switching network… Reconnecting call') {
    if (!networkReconnectBanner) return;
    if (networkReconnectText) networkReconnectText.innerText = msg;
    networkReconnectBanner.classList.remove('hidden');
    clearTimeout(reconnectBannerHideTimer);
    reconnectBannerHideTimer = setTimeout(() => {
        if (networkReconnectBanner) networkReconnectBanner.classList.add('hidden');
    }, 9000);
}

function hideNetworkReconnectBanner() {
    clearTimeout(reconnectBannerHideTimer);
    if (networkReconnectBanner) networkReconnectBanner.classList.add('hidden');
}

if (navigator.connection && typeof navigator.connection.addEventListener === 'function') {
    navigator.connection.addEventListener('change', () => {
        const hasActiveCall = !!peerConnection || groupPeers.size > 0;
        if (hasActiveCall) {
            showNetworkReconnectBanner('Network changed — keeping call alive...');
            if (peerConnection && isPrivateInitiator && peerConnection.signalingState === 'stable') {
                if (typeof peerConnection.restartIce === 'function') peerConnection.restartIce();
                peerConnection.createOffer({ iceRestart: true }).then(o => peerConnection.setLocalDescription(o)).then(() => {
                    socket.emit('signal', { offer: peerConnection.localDescription });
                }).catch(() => {});
            } else if (peerConnection && !isPrivateInitiator) {
                socket.emit('signal', { requestIceRestart: true });
            }
            for (const [peerId, peer] of groupPeers.entries()) {
                if (peer && peer.pc && peer.pc.signalingState === 'stable') {
                    if ((socket.id || '') > peerId) {
                        if (typeof peer.pc.restartIce === 'function') peer.pc.restartIce();
                        peer.pc.createOffer({ iceRestart: true }).then(o => peer.pc.setLocalDescription(o)).then(() => {
                            socket.emit('group_signal', { to: peerId, data: { offer: peer.pc.localDescription } });
                        }).catch(() => {});
                    }
                }
            }
        }
    });
}

// Smart Send <-> Voice button swap in 1-on-1 chat input bar
function syncPrivateInputActionButton() {
    const voiceBtn = document.getElementById('private-voice-btn');
    if (!messageInput || !sendBtn || !voiceBtn) return;
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.classList.toggle('hidden', !hasText);
    voiceBtn.classList.toggle('hidden', hasText);
}
if (messageInput) {
    messageInput.addEventListener('input', syncPrivateInputActionButton);
    syncPrivateInputActionButton();
}

// Organized Studio "+" Tool Trays (1-on-1 & Group/Public Live)
function wireStudioTray({ plusBtnId, trayId, extraIdsToClose = [] }) {
    const plusBtn = document.getElementById(plusBtnId);
    const tray = document.getElementById(trayId);
    if (!plusBtn || !tray) return;

    const closeTray = () => {
        tray.classList.add('hidden');
        plusBtn.classList.remove('open');
    };

    plusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = tray.classList.contains('hidden');
        extraIdsToClose.forEach(id => document.getElementById(id)?.classList.add('hidden'));
        tray.classList.toggle('hidden', !willOpen);
        plusBtn.classList.toggle('open', willOpen);
    });

    tray.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            closeTray();
        });
    });

    document.addEventListener('click', (e) => {
        if (!tray.classList.contains('hidden') && !tray.contains(e.target) && !plusBtn.contains(e.target)) {
            closeTray();
        }
    });
}

wireStudioTray({
    plusBtnId: 'private-plus-btn',
    trayId: 'private-tools-tray',
    extraIdsToClose: ['private-reaction-dock']
});
wireStudioTray({
    plusBtnId: 'group-plus-btn',
    trayId: 'group-tools-tray',
    extraIdsToClose: ['group-reaction-dock']
});

// ===== Shared Voice Note Player & Recorder (1-on-1 + Group/Public) =====
let activePlayingVoiceAudio = null;
let activePlayingVoiceResetFn = null;

function formatVoiceSec(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return `${mins}:${String(rem).padStart(2, '0')}`;
}

function createVoiceNotePlayer(audioDataUrl, durationSec = 1) {
    const card = document.createElement('div');
    card.className = 'voice-note-card';
    card.innerHTML = `
        <button type="button" class="voice-note-play-btn" title="Play Voice Message">
            <i class="fas fa-play"></i>
        </button>
        <div class="voice-note-progress-wrap">
            <div class="voice-note-progress"><div class="voice-note-bar-fill"></div></div>
            <span class="voice-note-dur">${formatVoiceSec(durationSec)}</span>
        </div>
    `;

    const playBtn = card.querySelector('.voice-note-play-btn');
    const iconEl = playBtn.querySelector('i');
    const fillEl = card.querySelector('.voice-note-bar-fill');
    const durEl = card.querySelector('.voice-note-dur');

    const audio = new Audio(audioDataUrl);
    audio.preload = 'metadata';

    const resetUi = () => {
        iconEl.className = 'fas fa-play';
        fillEl.style.width = '0%';
        durEl.innerText = formatVoiceSec(durationSec);
        if (activePlayingVoiceAudio === audio) {
            activePlayingVoiceAudio = null;
            activePlayingVoiceResetFn = null;
        }
    };

    audio.addEventListener('timeupdate', () => {
        const total = (audio.duration && isFinite(audio.duration)) ? audio.duration : (durationSec || 1);
        const pct = Math.min(100, Math.max(0, (audio.currentTime / total) * 100));
        fillEl.style.width = `${pct}%`;
        durEl.innerText = `${formatVoiceSec(audio.currentTime)} / ${formatVoiceSec(total)}`;
    });

    audio.addEventListener('ended', resetUi);
    audio.addEventListener('error', resetUi);

    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!audio.paused) {
            audio.pause();
            iconEl.className = 'fas fa-play';
            return;
        }
        if (activePlayingVoiceAudio && activePlayingVoiceAudio !== audio) {
            try { activePlayingVoiceAudio.pause(); } catch (err) {}
            if (typeof activePlayingVoiceResetFn === 'function') activePlayingVoiceResetFn();
        }
        activePlayingVoiceAudio = audio;
        activePlayingVoiceResetFn = resetUi;
        iconEl.className = 'fas fa-pause';
        audio.play().catch((err) => {
            console.warn('[VoiceNote] Play blocked/failed:', err);
            resetUi();
        });
    });

    return card;
}

function addPrivateVoiceMessage(audioData, duration, type) {
    if (!messagesContainer || !audioData) return;
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    div.appendChild(createVoiceNotePlayer(audioData, duration));
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (type === 'received' && isPrivateChatHidden) {
        privateUnreadCount++;
        updatePrivateUnreadUi();
        showPrivateToast(`🔊 Partner sent a voice message (${formatVoiceSec(duration)})`);
    }
}

socket.on('private_voice_note', ({ audioData, duration } = {}) => {
    if (!audioData) return;
    addPrivateVoiceMessage(audioData, duration || 1, 'received');
    playSystemSound('message');
});

const voiceRecorderControllers = {};

function cancelActiveVoiceRecording(scope) {
    const ctrl = voiceRecorderControllers[scope];
    if (ctrl && typeof ctrl.cancel === 'function') ctrl.cancel();
}

function initVoiceRecorderController({ scope, triggerBtnId, barId, timerId, cancelBtnId, sendBtnId, onSendVoice }) {
    const triggerBtn = document.getElementById(triggerBtnId);
    const barEl = document.getElementById(barId);
    const timerEl = document.getElementById(timerId);
    const cancelBtn = document.getElementById(cancelBtnId);
    const sendBtnEl = document.getElementById(sendBtnId);
    if (!triggerBtn || !barEl || typeof MediaRecorder === 'undefined') {
        if (triggerBtn && typeof MediaRecorder === 'undefined') triggerBtn.classList.add('hidden');
        return;
    }

    let recorder = null;
    let chunks = [];
    let recStream = null;
    let ownsStream = false;
    let startTs = 0;
    let timerInterval = null;
    let discardRecording = false;

    const cleanup = () => {
        clearInterval(timerInterval);
        timerInterval = null;
        if (barEl) barEl.classList.add('hidden');
        triggerBtn.classList.remove('is-recording');
        if (ownsStream && recStream) {
            recStream.getTracks().forEach(t => t.stop());
        } else if (recStream) {
            recStream.getTracks().forEach(t => t.stop());
        }
        recStream = null;
        recorder = null;
        chunks = [];
    };

    const pickBestAudioMime = () => {
        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
        return candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
    };

    const startRecording = async () => {
        if (recorder && recorder.state === 'recording') {
            stopAndSend();
            return;
        }
        try {
            discardRecording = false;
            const liveAudioTrack = (scope === 'private' ? localStream : groupAudioStream)?.getAudioTracks?.()[0];
            if (liveAudioTrack && liveAudioTrack.readyState === 'live' && liveAudioTrack.enabled) {
                recStream = new MediaStream([liveAudioTrack.clone()]);
                ownsStream = false;
            } else {
                recStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                });
                ownsStream = true;
            }

            const mimeType = pickBestAudioMime();
            const opts = mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 };
            recorder = new MediaRecorder(recStream, opts);
            chunks = [];
            startTs = Date.now();

            recorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) chunks.push(ev.data);
            };

            recorder.onstop = () => {
                const elapsedSec = Math.max(1, Math.round((Date.now() - startTs) / 1000));
                const recordedChunks = chunks;
                const finalMime = (recorder && recorder.mimeType) || mimeType || 'audio/webm';
                const shouldDiscard = discardRecording;
                cleanup();
                if (shouldDiscard || !recordedChunks || recordedChunks.length === 0) return;

                const blob = new Blob(recordedChunks, { type: finalMime });
                if (blob.size < 400) return;
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (typeof reader.result === 'string' && reader.result.startsWith('data:audio/')) {
                        onSendVoice(reader.result, elapsedSec, finalMime);
                    }
                };
                reader.readAsDataURL(blob);
            };

            recorder.start(250);
            barEl.classList.remove('hidden');
            triggerBtn.classList.add('is-recording');
            if (timerEl) timerEl.innerText = '0:00';
            timerInterval = setInterval(() => {
                const sec = Math.floor((Date.now() - startTs) / 1000);
                if (timerEl) timerEl.innerText = formatVoiceSec(sec);
                if (sec >= 45) stopAndSend();
            }, 250);
        } catch (err) {
            console.warn(`[VoiceNote] Could not record (${scope}):`, err);
            cleanup();
            alert('Microphone permission is needed to record a voice note.');
        }
    };

    const stopAndSend = () => {
        discardRecording = false;
        if (recorder && recorder.state === 'recording') {
            recorder.stop();
        } else {
            cleanup();
        }
    };

    const cancel = () => {
        discardRecording = true;
        if (recorder && recorder.state === 'recording') {
            recorder.stop();
        } else {
            cleanup();
        }
    };

    triggerBtn.addEventListener('click', startRecording);
    cancelBtn?.addEventListener('click', cancel);
    sendBtnEl?.addEventListener('click', stopAndSend);
    voiceRecorderControllers[scope] = { cancel };
}

initVoiceRecorderController({
    scope: 'private',
    triggerBtnId: 'private-voice-btn',
    barId: 'private-voice-recording-bar',
    timerId: 'private-voice-rec-timer',
    cancelBtnId: 'private-voice-cancel-btn',
    sendBtnId: 'private-voice-send-btn',
    onSendVoice: (audioData, duration, mimeType) => {
        if (!peerConnection && !currentRoomId) return;
        socket.emit('private_voice_note', { audioData, duration, mimeType });
        addPrivateVoiceMessage(audioData, duration, 'sent');
    }
});

initVoiceRecorderController({
    scope: 'group',
    triggerBtnId: 'group-voice-btn',
    barId: 'group-voice-recording-bar',
    timerId: 'group-voice-rec-timer',
    cancelBtnId: 'group-voice-cancel-btn',
    sendBtnId: 'group-voice-send-btn',
    onSendVoice: (audioData, duration, mimeType) => {
        if (!currentGroupPin) return;
        socket.emit('group_chat_message', { voiceData: audioData, voiceDuration: duration, voiceMime: mimeType });
    }
});

// ===== PWA Registration & Install App Button =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

let deferredPwaPrompt = null;
const pwaInstallBtn = document.getElementById('pwa-install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    if (pwaInstallBtn) pwaInstallBtn.classList.remove('hidden');
});

pwaInstallBtn?.addEventListener('click', async () => {
    if (!deferredPwaPrompt) return;
    deferredPwaPrompt.prompt();
    try { await deferredPwaPrompt.userChoice; } catch (e) {}
    deferredPwaPrompt = null;
    if (pwaInstallBtn) pwaInstallBtn.classList.add('hidden');
});
