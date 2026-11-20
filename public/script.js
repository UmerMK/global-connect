console.log("CONNECTED_JS_VERSION: 3.1 - Reliable TURN Servers");
if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
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
const privateVideoStage = document.getElementById('private-video-stage');
const privateRemoteVideo = document.getElementById('private-remote-video');
const privateLocalVideo = document.getElementById('private-local-video');
let privateLocalVideoStream = null;
let privateRemoteVideoStream = null;
let isPrivateCameraOn = false;
let isPartnerCameraOn = false;
const groupMemberNames = new Map();

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

// Function to fetch TURN server credentials dynamically from Metered API (with global caching)
let cachedTurnCredentials = null;
let turnCredentialsPromise = null;

async function getTurnCredentials() {
    if (cachedTurnCredentials) return cachedTurnCredentials;
    if (turnCredentialsPromise) return turnCredentialsPromise;

    turnCredentialsPromise = (async () => {
        try {
            const response = await fetch("https://globalconnect.metered.live/api/v1/turn/credentials?apiKey=09587faf8d3d9a4627979ab8196eb8f0ee4c");
            if (!response.ok) {
                console.warn('Failed to fetch TURN credentials, using fallback servers');
                cachedTurnCredentials = getFallbackIceServers();
                return cachedTurnCredentials;
            }
            const iceServers = await response.json();
            console.log('%c✅ Dynamic TURN credentials loaded successfully', 'color: green; font-weight: bold');
            cachedTurnCredentials = iceServers;
            return iceServers;
        } catch (error) {
            console.error('Error fetching TURN credentials:', error);
            console.warn('Using fallback TURN servers');
            cachedTurnCredentials = getFallbackIceServers();
            return cachedTurnCredentials;
        } finally {
            turnCredentialsPromise = null;
        }
    })();
    return turnCredentialsPromise;
}

// Fallback ICE servers in case the Metered API is unavailable
function getFallbackIceServers() {
    return [
        // STUN servers for NAT traversal (multiple for redundancy)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' },

        // Fallback TURN: Metered Open Relay
        {
            urls: [
                'turn:global.relay.metered.ca:80',
                'turn:global.relay.metered.ca:80?transport=tcp',
                'turn:global.relay.metered.ca:443',
                'turns:global.relay.metered.ca:443?transport=tcp'
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },

        // Backup TURN: FreeStun.net
        {
            urls: 'turn:freestun.net:3478',
            username: 'free',
            credential: 'free'
        }
    ];
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
        if (appHeader) appHeader.classList.remove('hidden');
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

function updatePrivateVideoStage() {
    if (!privateVideoStage) return;
    const chatScreen = document.getElementById('chat-screen');
    const remoteVideo = document.getElementById('private-remote-video');
    const remotePlaceholder = document.getElementById('private-remote-placeholder');
    const localVideo = document.getElementById('private-local-video');
    const localPlaceholder = document.getElementById('private-local-placeholder');
    const partnerAvatarImg = document.getElementById('split-partner-avatar');
    const partnerAvatarMain = document.getElementById('partner-avatar');

    if (partnerAvatarImg && partnerAvatarMain && partnerAvatarMain.src) {
        partnerAvatarImg.src = partnerAvatarMain.src;
    }

    const isAnyVideoActive = isPrivateCameraOn || isPartnerCameraOn;

    if (isAnyVideoActive) {
        if (chatScreen) chatScreen.classList.add('video-active');
        privateVideoStage.classList.remove('hidden');

        // Local Split Pane
        if (isPrivateCameraOn && privateLocalVideoStream) {
            if (localVideo) {
                localVideo.srcObject = privateLocalVideoStream;
                localVideo.classList.remove('hidden');
                localVideo.play().catch(e => {});
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
                remoteVideo.srcObject = privateRemoteVideoStream;
                remoteVideo.classList.remove('hidden');
                remoteVideo.play().catch(e => console.warn('Remote video play blocked:', e));
            }
            if (remotePlaceholder) remotePlaceholder.classList.add('hidden');
        } else {
            if (remoteVideo) {
                remoteVideo.classList.add('hidden');
            }
            if (remotePlaceholder) remotePlaceholder.classList.remove('hidden');
        }
    } else {
        if (chatScreen) chatScreen.classList.remove('video-active');
        privateVideoStage.classList.add('hidden');
    }
}

async function togglePrivateCamera() {
    if (!peerConnection) {
        alert('Please wait until connected to a partner before starting video.');
        return;
    }

    if (!isPrivateCameraOn) {
        // TURN 1-ON-1 CAMERA ON
        try {
            console.log('[1-on-1] Requesting camera for private call...');
            try {
                privateLocalVideoStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
                });
            } catch (err1) {
                privateLocalVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            }

            isPrivateCameraOn = true;
            if (privateCamBtn) {
                privateCamBtn.classList.add('active');
                const camIcon = privateCamBtn.querySelector('i');
                if (camIcon) camIcon.className = 'fas fa-video';
            }

            // Attach video track to 1-on-1 RTCPeerConnection and elevate transceiver to sendrecv
            const videoTrack = privateLocalVideoStream.getVideoTracks()[0];
            const transceiver = peerConnection.getTransceivers().find(t => 
                (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
                (t.receiver && t.receiver.track && t.receiver.track.kind === 'video')
            );
            if (transceiver) {
                transceiver.direction = 'sendrecv';
            }

            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video') ||
                           peerConnection.getSenders().find(s => !s.track);
            if (sender) {
                await sender.replaceTrack(videoTrack);
            } else {
                peerConnection.addTrack(videoTrack, privateLocalVideoStream);
            }

            // Renegotiate with partner so their browser decodes the new video track
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('signal', { offer });
                console.log('[1-on-1] Renegotiation offer sent to partner');
            } catch (renegErr) {
                console.warn('[1-on-1] Renegotiation offer error:', renegErr);
            }

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

        const transceiver = peerConnection.getTransceivers().find(t => 
            (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
            (t.receiver && t.receiver.track && t.receiver.track.kind === 'video')
        );
        if (transceiver) {
            transceiver.direction = 'recvonly';
        }

        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            try {
                await sender.replaceTrack(null);
            } catch (e) {}
        }

        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { offer });
            console.log('[1-on-1] Renegotiation (camera off) offer sent');
        } catch (renegErr) {
            console.warn('[1-on-1] Camera off renegotiation error:', renegErr);
        }

        socket.emit('private_camera_toggle', { isCameraOn: false });
        updatePrivateVideoStage();
        console.log('[1-on-1] Camera deactivated. Voice continues uninterrupted.');
    }
}

socket.on('private_camera_toggle', ({ isCameraOn }) => {
    console.log('[1-on-1] Partner camera status:', isCameraOn);
    isPartnerCameraOn = !!isCameraOn;
    updatePrivateVideoStage();
});

function endSession() {
    console.log('Ending session and cleaning up resources...');
    stopTimer();
    stopVisualizers(); // Renamed from stopVisualizer
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

function initVisualizers(localStream, remoteStream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') audioContext.resume();

    // Local Visualizer (Your Mic)
    const localSource = audioContext.createMediaStreamSource(localStream);
    const localAnalyser = audioContext.createAnalyser();
    localAnalyser.fftSize = 32;
    localSource.connect(localAnalyser);

    // Remote Visualizer (Partner Mic)
    let remoteAnalyser = null;
    if (remoteStream) {
        const remoteSource = audioContext.createMediaStreamSource(remoteStream);
        remoteAnalyser = audioContext.createAnalyser();
        remoteAnalyser.fftSize = 32;
        remoteSource.connect(remoteAnalyser);
    }

    drawVisualizers(localAnalyser, remoteAnalyser);
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

    try {
        console.log('Requesting microphone...');
        callStatus.innerText = 'Please allow microphone...';

        // Try current API, then fallbacks
        const mediaDevices = navigator.mediaDevices || {};
        const getUserMedia = mediaDevices.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia ||
            navigator.msGetUserMedia;

        if (!getUserMedia) {
            throw new Error('Microphone blocked by browser security (Network not trusted).');
        }

        // Use Promise-based version if available, else wrap callback version
        if (mediaDevices.getUserMedia) {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
            localStream = await new Promise((res, rej) => getUserMedia.call(navigator, { audio: true }, res, rej));
        }
        console.log('Mic access granted.');
        initVisualizers(localStream, null); // Start local visualizer immediately

        callStatus.innerText = 'Connecting...';

        // Fetch fresh TURN credentials for this connection
        console.log('Fetching TURN server credentials...');
        const iceServers = await getTurnCredentials();

        const rtcConfig = {
            iceServers: iceServers,
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all' // Allow all connection types (host, srflx, relay)
        };

        console.log("Initializing RTCPeerConnection with config:", JSON.stringify(rtcConfig, null, 2));
        peerConnection = new RTCPeerConnection(rtcConfig);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Monitor connection state - Detailed UI updates
        peerConnection.oniceconnectionstatechange = () => {
            const state = peerConnection.iceConnectionState;
            console.log('ICE Connection State Change:', state);

            if (state === 'checking') {
                callStatus.innerText = 'Finding person...';
            } else if (state === 'connected' || state === 'completed') {
                callStatus.innerText = 'Connected - Speaking';
            } else if (state === 'failed' || state === 'disconnected') {
                callStatus.innerText = 'Connection Failed';
                addMessage('Connection failed. Retrying with backup server...', 'system');
                // Auto-retry once if it fails early
                if (peerConnection.iceConnectionState === 'failed') {
                    console.log("Auto-retrying connection...");
                    socket.emit('manual_disconnect');
                    setTimeout(() => socket.emit('find_match'), 1000);
                }
            } else {
                callStatus.innerText = 'Status: ' + state;
            }
        };

        peerConnection.onicegatheringstatechange = () => {
            console.log("ICE Gathering State:", peerConnection.iceGatheringState);
        };

        peerConnection.ontrack = (event) => {
            console.log('Got remote track in 1-on-1:', event.track.kind);
            if (event.track.kind === 'audio') {
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.play().then(() => {
                    console.log("Remote audio playing successfully");
                }).catch(e => {
                    console.warn("Autoplay blocked or failed:", e);
                    addMessage("Click anywhere to enable voice.", "system");
                });

                callStatus.innerText = 'Connected - Speaking';
                startTimer();
                initVisualizers(localStream, event.streams[0]); // Update with remote stream
            } else if (event.track.kind === 'video') {
                const stream = event.streams[0] || new MediaStream([event.track]);
                privateRemoteVideoStream = stream;
                isPartnerCameraOn = true;
                if (privateRemoteVideo) {
                    privateRemoteVideo.srcObject = stream;
                    privateRemoteVideo.play().catch(e => console.warn("Remote video play failed:", e));
                }
                updatePrivateVideoStage();

                event.track.onunmute = () => {
                    console.log('[1-on-1] Partner video track unmuted');
                    privateRemoteVideoStream = stream;
                    isPartnerCameraOn = true;
                    if (privateRemoteVideo) {
                        privateRemoteVideo.srcObject = stream;
                        privateRemoteVideo.play().catch(e => {});
                    }
                    updatePrivateVideoStage();
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
            console.warn("ICE Candidate Error:", event.errorCode, event.errorText);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const candidateStr = event.candidate.candidate;
                const candidateType = event.candidate.type;
                console.log(`%c[ICE] Local Candidate Generated`, "color: cyan; font-weight: bold");
                console.log(`  Type: ${candidateType}`);
                console.log(`  Full: ${candidateStr}`);

                // Check if this is a RELAY candidate (CRITICAL for different networks)
                if (candidateStr.includes('typ relay')) {
                    console.log("%c✅ RELAY CANDIDATE FOUND! This can bridge different networks.", "color: green; font-weight: bold; font-size: 14px");
                    addMessage('🌐 Cross-network connection ready!', 'system');
                } else if (candidateStr.includes('typ srflx')) {
                    console.log("%c⚠️  SRFLX (Server Reflexive) candidate - may work for some networks", "color: orange");
                } else if (candidateStr.includes('typ host')) {
                    console.log("%c📡 HOST candidate - works for same network only", "color: gray");
                }

                socket.emit('signal', { candidate: event.candidate });
            } else {
                console.log("%c🏁 ICE Gathering Complete", "color: blue; font-weight: bold");
                console.log("%c[Summary] Check above for relay candidates. If none found, cross-network connections may fail.", "color: yellow");
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
        }
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
        console.log('Setting remote description (offer)...');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        console.log('Creating answer...');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('Sending answer...');
        socket.emit('signal', { answer });
    } else if (data.answer) {
        console.log('Setting remote description (answer)...');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.candidate) {
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
let isGroupCameraOn = false;
let currentGroupPin = null;
let currentGroupName = null;
let myGroupMemberId = null;
let isCurrentGroupOwner = false;
let groupSpeechInterval = null;
let isSpeakingState = false;
let groupAudioContext = null;
let selectedMediaDataUrl = null;
let mediaCountdownTimer = null;

// DOM Elements - Group Lobby
const groupLobbyBtn = document.getElementById('group-lobby-btn');
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
const groupOnlineCount = document.getElementById('group-online-count');

// Live Stream & Chat Elements
const liveOverlayStream = document.getElementById('live-overlay-stream');
const liveChatForm = document.getElementById('live-chat-form');
const liveChatInput = document.getElementById('live-chat-input');
const btnToggleGifDrawer = document.getElementById('btn-toggle-gif-drawer');
const gifKeyboardDrawer = document.getElementById('gif-keyboard-drawer');
const gifDrawerBackdrop = document.getElementById('gif-drawer-backdrop');
const btnCloseGifDrawer = document.getElementById('btn-close-gif-drawer');
const gifSheetSearch = document.getElementById('gif-sheet-search');
const btnClearGifSearch = document.getElementById('btn-clear-gif-search');
const gifSheetGrid = document.getElementById('gif-sheet-grid');
const gifTagsContainer = document.getElementById('gif-tags-container');
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
// 1. NAVIGATION & SWITCHING (JOIN IS DEFAULT)
// ==========================================
if (groupLobbyBtn) {
    groupLobbyBtn.addEventListener('click', () => {
        // Show Join Panel by default every time!
        if (panelJoinGroup) panelJoinGroup.classList.remove('hidden');
        if (panelCreateGroup) panelCreateGroup.classList.add('hidden');
        if (joinGroupError) joinGroupError.classList.add('hidden');
        if (createGroupError) createGroupError.classList.add('hidden');
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
    const displayName = joinGroupUserInput.value.trim() || 'Friend';

    if (!pin) {
        showFormError(joinGroupError, 'Please enter the 4-digit PIN.');
        return;
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
    const displayName = createGroupUserInput.value.trim() || 'Host';

    if (!pin || pin.length < 3) {
        showFormError(createGroupError, 'Please enter a 4-digit PIN.');
        return;
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
        currentGroupPin = response.group.pin;
        currentGroupName = response.group.name;
        myGroupMemberId = response.memberId;
        isCurrentGroupOwner = response.isOwner;

        // Register local avatar in stable identity map
        userAvatarsMap.set(myGroupMemberId, myLocalFunnyAvatar);

        // Update UI Header
        if (roomGroupName) roomGroupName.innerText = currentGroupName;
        if (roomPinDisplay) roomPinDisplay.innerText = currentGroupPin;
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
async function initGroupVoiceRoom(existingMembers) {
    console.log('[Group] Initializing Voice Room with existing members:', existingMembers);
    cleanupGroupMedia();

    // 1. Request microphone access for group voice
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
        console.error('[Group] Microphone error:', err);
        alert('Could not access microphone. You can listen, but other participants cannot hear you.');
    }

    // 2. Establish WebRTC connection with all existing members in room
    if (Array.isArray(existingMembers)) {
        for (const member of existingMembers) {
            groupMemberNames.set(member.memberId, member.displayName);
            const stableAvatar = getStableAvatarForUser(member.memberId, member.avatarUrl);
            createRemoteParticipantCard(member.memberId, member.displayName, member.isOwner, stableAvatar);
            const peer = await createGroupPeerConnection(member.memberId, member.displayName, true, member.isCameraOn);
            if (peer && member.isCameraOn) {
                peer.isCameraOn = true;
                const camBadge = document.getElementById(`cam-badge-${member.memberId}`);
                if (camBadge) {
                    camBadge.className = 'media-badge cam-on';
                    camBadge.innerHTML = '<i class="fas fa-video"></i>';
                }
            }
        }
    }

    updateGroupOnlineCount();
    playSystemSound('connect');
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

    const peerData = {
        pc: pc,
        memberId: targetMemberId,
        displayName: targetDisplayName,
        audioElement: remoteAudioEl,
        videoStream: null,
        isCameraOn: !!initialCameraOn,
        isAudioMuted: false
    };

    groupPeers.set(targetMemberId, peerData);

    // Add local audio tracks if available
    if (groupAudioStream) {
        const audioTrack = groupAudioStream.getAudioTracks()[0];
        if (audioTrack) {
            pc.addTrack(audioTrack, groupAudioStream);
        }
    }

    // Add local video track if camera is currently enabled
    if (groupVideoStream && isLocalCameraOn) {
        const videoTrack = groupVideoStream.getVideoTracks()[0];
        if (videoTrack) {
            pc.addTrack(videoTrack, groupVideoStream);
        }
    }

    // Video transceiver configuration: use 'sendrecv' only if camera active, otherwise 'recvonly'
    // This allows phone/mobile devices to connect seamlessly with camera OFF without throwing capture errors!
    const videoDirection = (groupVideoStream && isLocalCameraOn) ? 'sendrecv' : 'recvonly';
    try {
        pc.addTransceiver('video', { direction: videoDirection });
    } catch (e) {
        console.warn('[Group] addTransceiver note:', e);
    }

    // ICE Candidate generation
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('group_signal', {
                to: targetMemberId,
                data: { candidate: event.candidate }
            });
        }
    };

    // Remote Track received (Audio or Video)
    pc.ontrack = (event) => {
        console.log(`[Group] ontrack from ${targetMemberId}: kind=${event.track.kind}`);
        const currentPeer = groupPeers.get(targetMemberId);

        if (event.track.kind === 'audio') {
            const streamToPlay = event.streams[0] || new MediaStream([event.track]);
            remoteAudioEl.srcObject = streamToPlay;
            remoteAudioEl.play().catch(e => console.warn('Remote audio play blocked:', e));
        } else if (event.track.kind === 'video') {
            const cardVideoEl = document.getElementById(`video-${targetMemberId}`);
            const avatarBox = document.getElementById(`avatar-box-${targetMemberId}`);
            const camBadge = document.getElementById(`cam-badge-${targetMemberId}`);
            const streamToPlay = event.streams[0] || new MediaStream([event.track]);

            if (currentPeer) {
                currentPeer.videoStream = streamToPlay;
                currentPeer.isCameraOn = true;
            }

            if (cardVideoEl) {
                cardVideoEl.srcObject = streamToPlay;
                cardVideoEl.classList.remove('hidden');
                if (avatarBox) avatarBox.classList.add('hidden');
                if (camBadge) {
                    camBadge.className = 'media-badge cam-on';
                    camBadge.innerHTML = '<i class="fas fa-video"></i>';
                }
                cardVideoEl.play().catch(e => console.warn('Remote video play blocked:', e));
            }

            event.track.onunmute = () => {
                console.log(`[Group] Track unmuted for ${targetMemberId}`);
                if (currentPeer) currentPeer.isCameraOn = true;
                if (cardVideoEl) {
                    cardVideoEl.srcObject = streamToPlay;
                    cardVideoEl.classList.remove('hidden');
                    if (avatarBox) avatarBox.classList.add('hidden');
                    if (camBadge) {
                        camBadge.className = 'media-badge cam-on';
                        camBadge.innerHTML = '<i class="fas fa-video"></i>';
                    }
                    cardVideoEl.play().catch(e => {});
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
        console.log(`[Group] ICE State with ${targetMemberId}: ${pc.iceConnectionState}`);
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

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('group_signal', {
                to: from,
                data: { answer: answer }
            });
            console.log(`[Group] Sent answer to ${from}`);
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
        } else if (data.candidate) {
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
    const stableAvatar = getStableAvatarForUser(member.memberId, member.avatarUrl);
    createRemoteParticipantCard(member.memberId, member.displayName, member.isOwner, stableAvatar);
    updateGroupOnlineCount();
    playSystemSound('connect');
});

// A member left the group room
socket.on('group_member_left', ({ memberId }) => {
    console.log(`[Group] Member left: ${memberId}`);
    removeRemoteParticipant(memberId);
    updateGroupOnlineCount();
    playSystemSound('disconnect');
});

// Media state change from a remote participant (mic muted, camera on/off)
socket.on('group_media_state', ({ memberId, isAudioMuted, isCameraOn }) => {
    const peer = groupPeers.get(memberId);
    if (!peer) return;

    if (typeof isAudioMuted === 'boolean') {
        peer.isAudioMuted = isAudioMuted;
        const micBadge = document.getElementById(`mic-badge-${memberId}`);
        if (micBadge) {
            micBadge.className = isAudioMuted ? 'media-badge mic-muted' : 'media-badge mic-on';
            micBadge.innerHTML = isAudioMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
        }
    }

    if (typeof isCameraOn === 'boolean') {
        peer.isCameraOn = isCameraOn;
        const videoEl = document.getElementById(`video-${memberId}`);
        const avatarBox = document.getElementById(`avatar-box-${memberId}`);
        const camBadge = document.getElementById(`cam-badge-${memberId}`);

        if (isCameraOn) {
            if (videoEl) {
                if (peer.videoStream) {
                    videoEl.srcObject = peer.videoStream;
                }
                videoEl.classList.remove('hidden');
                videoEl.play().catch(e => console.warn('Play video on state change:', e));
            }
            if (avatarBox) avatarBox.classList.add('hidden');
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

async function toggleGroupCamera() {
    if (!isLocalCameraOn) {
        // TURN CAMERA ON
        try {
            console.log('[Camera] Requesting webcam video track...');
            try {
                groupVideoStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user' }
                });
            } catch (err1) {
                console.warn('[Camera] Fallback to basic video constraint:', err1);
                groupVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            }

            isLocalCameraOn = true;
            const videoTrack = groupVideoStream.getVideoTracks()[0];

            // Local Preview
            localVideoPreview.srcObject = groupVideoStream;
            localVideoPreview.classList.remove('hidden');
            if (localAvatarBox) localAvatarBox.classList.add('hidden');

            // Update Local UI
            groupCamBtn.className = 'live-circle-tool-btn cam-trigger cam-active';
            groupCamBtn.innerHTML = '<i class="fas fa-video"></i>';
            localCamIndicator.className = 'media-badge cam-on';
            localCamIndicator.innerHTML = '<i class="fas fa-video"></i>';

            // Add/Replace video track on all peer connections, set transceiver to 'sendrecv', and renegotiate
            for (const [peerId, peer] of groupPeers.entries()) {
                const pc = peer.pc;
                const transceiver = pc.getTransceivers().find(t => (t.sender && t.sender.track && t.sender.track.kind === 'video') || (t.receiver && t.receiver.track && t.receiver.track.kind === 'video'));
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video') ||
                               pc.getSenders().find(s => !s.track);

                if (transceiver) {
                    transceiver.direction = 'sendrecv';
                }

                if (sender) {
                    await sender.replaceTrack(videoTrack);
                } else {
                    pc.addTrack(videoTrack, groupVideoStream);
                }

                // ALWAYS renegotiate with this peer so their phone receives the new video track
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    socket.emit('group_signal', {
                        to: peerId,
                        data: { offer: offer }
                    });
                    console.log(`[Camera] Renegotiation offer sent to ${peerId}`);
                } catch (e) {
                    console.warn(`[Camera] Renegotiation note for ${peerId}:`, e);
                }
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

        // 3. Update Local UI
        groupCamBtn.className = 'live-circle-tool-btn cam-trigger cam-disabled';
        groupCamBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        localCamIndicator.className = 'media-badge cam-off';
        localCamIndicator.innerHTML = '<i class="fas fa-video-slash"></i>';

        // 4. Remove/replace video track with null on all peers, set transceiver to 'recvonly', and renegotiate
        for (const [peerId, peer] of groupPeers.entries()) {
            const pc = peer.pc;
            const transceiver = pc.getTransceivers().find(t => (t.sender && t.sender.track && t.sender.track.kind === 'video') || (t.receiver && t.receiver.track && t.receiver.track.kind === 'video'));
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');

            if (transceiver) {
                transceiver.direction = 'recvonly';
            }
            if (sender) {
                try {
                    await sender.replaceTrack(null);
                } catch (e) {
                    console.warn('[Camera] Error setting replaceTrack null:', e);
                }
            }

            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('group_signal', {
                    to: peerId,
                    data: { offer: offer }
                });
                console.log(`[Camera] Renegotiation (camera off) offer sent to ${peerId}`);
            } catch (e) {
                console.warn(`[Camera] Renegotiation error for ${peerId}:`, e);
            }
        }

        // 5. Inform other participants that video is disabled
        socket.emit('group_media_state', { isCameraOn: false });
        console.log('[Camera] Camera turned OFF. Voice continues uninterrupted.');
    }
}

// ==========================================
// 6. MICROPHONE CONTROLS & VOICE ACTIVITY
// ==========================================
if (groupMicBtn) {
    groupMicBtn.addEventListener('click', toggleGroupMic);
}

function toggleGroupMic() {
    isGroupAudioMuted = !isGroupAudioMuted;

    if (groupAudioStream) {
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

    groupParticipantsGrid.appendChild(card);
    updateLiveGridLayout();
}

function removeRemoteParticipant(memberId) {
    const peer = groupPeers.get(memberId);
    if (peer) {
        if (peer.pc) {
            peer.pc.onicecandidate = null;
            peer.pc.ontrack = null;
            peer.pc.close();
        }
        if (peer.audioElement) {
            peer.audioElement.pause();
            peer.audioElement.remove();
        }
        groupPeers.delete(memberId);
    }

    const card = document.getElementById(`card-${memberId}`);
    if (card) {
        card.remove();
    }
    updateLiveGridLayout();
}

function updateGroupOnlineCount() {
    const total = groupPeers.size + 1; // peers + self
    if (groupOnlineCount) {
        groupOnlineCount.innerText = total;
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
    } else {
        groupParticipantsGrid.className = 'live-grid layout-4';
    }
}

// ==========================================
// 8. LEAVE & DELETE GROUP
// ==========================================
if (btnLeaveGroup) btnLeaveGroup.addEventListener('click', leaveGroupRoom);
if (groupLeaveControlBtn) groupLeaveControlBtn.addEventListener('click', leaveGroupRoom);

function leaveGroupRoom() {
    console.log('[Group] Leaving group room...');
    cleanupGroupMedia();
    socket.emit('group_leave');

    // Clean up remote cards
    for (const memberId of groupPeers.keys()) {
        removeRemoteParticipant(memberId);
    }

    currentGroupKey = null;
    currentGroupName = null;
    currentGroupPin = null;
    myGroupMemberId = null;
    isCurrentGroupOwner = false;

    showScreen('group-lobby-screen');
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

const CURATED_GIFS = {
    trending: [
        'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif',
        'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
        'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif',
        'https://media.giphy.com/media/DhstvI3CH0EGtQ80IL/giphy.gif',
        'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
        'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif',
        'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif',
        'https://media.giphy.com/media/26n6Gx9moCdu1GdHL/giphy.gif'
    ],
    laugh: [
        'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
        'https://media.giphy.com/media/10JhviFuU2gWS6W/giphy.gif',
        'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif',
        'https://media.giphy.com/media/26n6Gx9moCdu1GdHL/giphy.gif',
        'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif',
        'https://media.giphy.com/media/9MFsKQ8A6HCN2/giphy.gif'
    ],
    dance: [
        'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif',
        'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
        'https://media.giphy.com/media/kuqMAJaK9GK64/giphy.gif',
        'https://media.giphy.com/media/14qb1Uhf40ndy8/giphy.gif',
        'https://media.giphy.com/media/l0amJbM1KxJAaqIgg/giphy.gif',
        'https://media.giphy.com/media/26n6Gx9moCdu1GdHL/giphy.gif'
    ],
    fire: [
        'https://media.giphy.com/media/QMHoU66sBXCAHonOmG/giphy.gif',
        'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif',
        'https://media.giphy.com/media/3ov9jOJSQhGCthsAn6/giphy.gif',
        'https://media.giphy.com/media/xT0Gqz4x4eLd5gDms0/giphy.gif',
        'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif'
    ],
    love: [
        'https://media.giphy.com/media/3oriO04qxVwuM5ZwXY/giphy.gif',
        'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
        'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif',
        'https://media.giphy.com/media/l4pTfx2qLszoacZRS/giphy.gif',
        'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif'
    ],
    anime: [
        'https://media.giphy.com/media/7kn27lnYSAQ9O/giphy.gif',
        'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
        'https://media.giphy.com/media/11vD9bCP2HHN28/giphy.gif',
        'https://media.giphy.com/media/wkW0maGDN1OBG/giphy.gif',
        'https://media.giphy.com/media/kd9BlRovbPOykL6YzX/giphy.gif'
    ],
    meme: [
        'https://media.giphy.com/media/QMHoU66sBXCAHonOmG/giphy.gif',
        'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
        'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif',
        'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
        'https://media.giphy.com/media/d3mlE7uhX8KFgEmY/giphy.gif',
        'https://media.giphy.com/media/9b5oSOGDESrCw/giphy.gif'
    ],
    clap: [
        'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
        'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
        'https://media.giphy.com/media/7rj2ieuN2KSZO/giphy.gif',
        'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif'
    ],
    wow: [
        'https://media.giphy.com/media/7kn27lnYSAQ9O/giphy.gif',
        'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif',
        'https://media.giphy.com/media/DhstvI3CH0EGtQ80IL/giphy.gif',
        'https://media.giphy.com/media/26AHzqU91X3V37BQA/giphy.gif',
        'https://media.giphy.com/media/l0HlvtIP80nupEFtS/giphy.gif',
        'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif'
    ],
    sad: [
        'https://media.giphy.com/media/OPU660alU7j2g/giphy.gif',
        'https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif',
        'https://media.giphy.com/media/L95W4wv8nnb9K/giphy.gif',
        'https://media.giphy.com/media/2WxWfavuNDiF2/giphy.gif'
    ]
};

const GIF_METADATA = [
    { url: 'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif', tags: ['dance', 'party', 'parrot', 'groove', 'trending', 'fun', 'music'] },
    { url: 'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif', tags: ['cat', 'vibing', 'vibe', 'cute', 'meme', 'trending', 'music', 'chill'] },
    { url: 'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif', tags: ['leonardo', 'dicaprio', 'cheers', 'toast', 'celebrate', 'trending', 'meme', 'wow', 'champagne', 'congrats'] },
    { url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif', tags: ['laugh', 'lol', 'haha', 'funny', 'joke', 'meme', 'giggle', 'comedy'] },
    { url: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif', tags: ['dance', 'groove', 'cool', 'trending', 'happy', 'party'] },
    { url: 'https://media.giphy.com/media/QMHoU66sBXCAHonOmG/giphy.gif', tags: ['fire', 'this is fine', 'fine', 'burn', 'flame', 'meme', 'coffee'] },
    { url: 'https://media.giphy.com/media/BPJmthQ3YRwD6QqcVD/giphy.gif', tags: ['fire', 'cheers', 'greatsby', 'toast', 'lit', 'party', 'rich'] },
    { url: 'https://media.giphy.com/media/7kn27lnYSAQ9O/giphy.gif', tags: ['anime', 'wow', 'shocked', 'hype', 'eyes', 'omg', 'surprise'] },
    { url: 'https://media.giphy.com/media/DhstvI3CH0EGtQ80IL/giphy.gif', tags: ['thumbs up', 'ok', 'good', 'trending', 'wow', 'hype', 'yes', 'approve'] },
    { url: 'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif', tags: ['laugh', 'smile', 'happy', 'cheers', 'toast', 'friendly'] },
    { url: 'https://media.giphy.com/media/10JhviFuU2gWS6W/giphy.gif', tags: ['laugh', 'lol', 'haha', 'giggle', 'baby', 'cute'] },
    { url: 'https://media.giphy.com/media/26n6Gx9moCdu1GdHL/giphy.gif', tags: ['dance', 'happy', 'laugh', 'joy', 'celebration'] },
    { url: 'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif', tags: ['laugh', 'haha', 'dead', 'lmao', 'funny'] },
    { url: 'https://media.giphy.com/media/9MFsKQ8A6HCN2/giphy.gif', tags: ['laugh', 'hysterical', 'lol', 'wheeze', 'comedy'] },
    { url: 'https://media.giphy.com/media/kuqMAJaK9GK64/giphy.gif', tags: ['dance', 'carlton', 'fresh prince', 'funny', 'moves'] },
    { url: 'https://media.giphy.com/media/14qb1Uhf40ndy8/giphy.gif', tags: ['dance', 'snoop dogg', 'hip hop', 'groove', 'cool'] },
    { url: 'https://media.giphy.com/media/l0amJbM1KxJAaqIgg/giphy.gif', tags: ['dance', 'disco', 'groovy', 'party', 'music'] },
    { url: 'https://media.giphy.com/media/3ov9jOJSQhGCthsAn6/giphy.gif', tags: ['fire', 'lit', 'explosion', 'boom', 'hot'] },
    { url: 'https://media.giphy.com/media/xT0Gqz4x4eLd5gDms0/giphy.gif', tags: ['fire', 'flame', 'blaze', 'lit', 'hot'] },
    { url: 'https://media.giphy.com/media/3oriO04qxVwuM5ZwXY/giphy.gif', tags: ['love', 'heart', 'hug', 'affection', 'sweet', 'hearts'] },
    { url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', tags: ['love', 'hugs', 'cuddle', 'sweet', 'warm'] },
    { url: 'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif', tags: ['love', 'heart eyes', 'romantic', 'crush', 'cute'] },
    { url: 'https://media.giphy.com/media/l4pTfx2qLszoacZRS/giphy.gif', tags: ['love', 'hug', 'hugging', 'friends', 'caring'] },
    { url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif', tags: ['anime', 'excited', 'energy', 'hype', 'jump'] },
    { url: 'https://media.giphy.com/media/11vD9bCP2HHN28/giphy.gif', tags: ['anime', 'shocked', 'gasp', 'omg', 'eyes'] },
    { url: 'https://media.giphy.com/media/wkW0maGDN1OBG/giphy.gif', tags: ['anime', 'dance', 'cute', 'chibi', 'girl'] },
    { url: 'https://media.giphy.com/media/kd9BlRovbPOykL6YzX/giphy.gif', tags: ['anime', 'spark', 'magical', 'glow', 'point'] },
    { url: 'https://media.giphy.com/media/d3mlE7uhX8KFgEmY/giphy.gif', tags: ['meme', 'think', 'smart', 'roll safe', 'brain', 'logic'] },
    { url: 'https://media.giphy.com/media/9b5oSOGDESrCw/giphy.gif', tags: ['meme', 'doge', 'wow', 'dog', 'shiba'] },
    { url: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif', tags: ['clap', 'applause', 'bravo', 'congrats', 'clapping'] },
    { url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', tags: ['clap', 'applause', 'respect', 'slow clap'] },
    { url: 'https://media.giphy.com/media/7rj2ieuN2KSZO/giphy.gif', tags: ['clap', 'standing ovation', 'cheers', 'bravo'] },
    { url: 'https://media.giphy.com/media/26AHzqU91X3V37BQA/giphy.gif', tags: ['wow', 'gasp', 'shocked', 'omg', 'surprised'] },
    { url: 'https://media.giphy.com/media/l0HlvtIP80nupEFtS/giphy.gif', tags: ['wow', 'dramatic', 'shock', 'unbelievable'] },
    { url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif', tags: ['wow', 'jaw drop', 'speechless', 'shocked'] },
    { url: 'https://media.giphy.com/media/OPU660alU7j2g/giphy.gif', tags: ['sad', 'cry', 'crying', 'tears', 'cat', 'heartbroken'] },
    { url: 'https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif', tags: ['sad', 'cry', 'rain', 'depressed', 'grief'] },
    { url: 'https://media.giphy.com/media/L95W4wv8nnb9K/giphy.gif', tags: ['sad', 'tears', 'crying', 'sorrow', 'hurt'] },
    { url: 'https://media.giphy.com/media/2WxWfavuNDiF2/giphy.gif', tags: ['sad', 'wipe tears', 'weep', 'cry', 'emotional'] }
];

let currentGifCategory = 'trending';
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
    bubble.className = 'live-chat-bubble';

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

    liveOverlayStream.appendChild(bubble);

    // Keep memory tidy and performant
    while (liveOverlayStream.children.length > 35) {
        liveOverlayStream.removeChild(liveOverlayStream.children[0]);
    }

    liveOverlayStream.scrollTop = liveOverlayStream.scrollHeight;
    playSystemSound('message');
}

// GIF Keyboard Drawer Controls
function closeGifDrawer() {
    if (gifKeyboardDrawer) gifKeyboardDrawer.classList.remove('is-open');
    if (btnToggleGifDrawer) btnToggleGifDrawer.classList.remove('active');
    if (gifDrawerBackdrop) gifDrawerBackdrop.classList.add('hidden');
}

if (btnToggleGifDrawer) {
    btnToggleGifDrawer.addEventListener('click', () => {
        if (!gifKeyboardDrawer) return;
        const isOpen = gifKeyboardDrawer.classList.toggle('is-open');
        btnToggleGifDrawer.classList.toggle('active', isOpen);
        if (gifDrawerBackdrop) gifDrawerBackdrop.classList.toggle('hidden', !isOpen);
        if (isOpen && (!gifSheetGrid.children.length || gifSheetGrid.querySelector('.gif-loading-state'))) {
            loadGifsForCategory(currentGifCategory);
        }
    });
}

if (btnCloseGifDrawer) {
    btnCloseGifDrawer.addEventListener('click', closeGifDrawer);
}

if (gifDrawerBackdrop) {
    gifDrawerBackdrop.addEventListener('click', closeGifDrawer);
}

// Category tag chips
if (gifTagsContainer) {
    gifTagsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.gif-tag-chip');
        if (!chip) return;
        gifTagsContainer.querySelectorAll('.gif-tag-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const tag = chip.getAttribute('data-tag');
        currentGifCategory = tag;
        if (gifSheetSearch) gifSheetSearch.value = '';
        if (btnClearGifSearch) btnClearGifSearch.classList.add('hidden');
        loadGifsForCategory(tag);
    });
}

// Instant keyword & tag search in GIF drawer with custom image URL support
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
                loadGifsForCategory(currentGifCategory);
            }
        }, 150);
    });
}

if (btnClearGifSearch) {
    btnClearGifSearch.addEventListener('click', () => {
        if (gifSheetSearch) gifSheetSearch.value = '';
        btnClearGifSearch.classList.add('hidden');
        loadGifsForCategory(currentGifCategory);
    });
}

function loadGifsForCategory(category) {
    const gifs = CURATED_GIFS[category] || CURATED_GIFS.trending;
    renderGifsInSheet(gifs);
}

async function searchGifs(query) {
    if (!gifSheetGrid) return;
    const cleanQuery = query.toLowerCase().trim();
    if (!cleanQuery) {
        loadGifsForCategory(currentGifCategory);
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

    gifSheetGrid.innerHTML = '<div class="gif-loading-state"><i class="fas fa-spinner fa-spin"></i> Searching GIFs...</div>';

    // 1. Live Internet-Wide GIF search (DuckDuckGo real-time GIF search engine)
    try {
        const res = await fetch(`/api/gifs/search?q=${encodeURIComponent(cleanQuery)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                renderGifsInSheet(data.results);
                return;
            }
        }
    } catch (e) {
        console.warn('Live GIF search fetch error, falling back to curated library:', e);
    }

    // 2. Fallback to rich local keyword & tag search across curated GIFs
    const matched = GIF_METADATA.filter(item => {
        return item.tags.some(t => t.includes(cleanQuery) || cleanQuery.includes(t));
    }).map(i => i.url);

    if (matched.length > 0) {
        renderGifsInSheet(matched);
    } else {
        const words = cleanQuery.split(/\s+/);
        const partialMatches = GIF_METADATA.filter(item => {
            return words.some(w => item.tags.some(t => t.startsWith(w) || t.includes(w)));
        }).map(i => i.url);

        if (partialMatches.length > 0) {
            renderGifsInSheet(partialMatches);
        } else {
            renderGifsInSheet(CURATED_GIFS.trending);
        }
    }
}

function renderGifsInSheet(gifUrls) {
    if (!gifSheetGrid) return;
    gifSheetGrid.innerHTML = '';

    if (!gifUrls || gifUrls.length === 0) {
        gifSheetGrid.innerHTML = '<div class="gif-loading-state">No GIFs found. Try another word!</div>';
        return;
    }

    gifUrls.forEach(url => {
        const card = document.createElement('div');
        card.className = 'gif-item-card';
        card.innerHTML = `<img src="${url}" alt="GIF" loading="lazy">`;
        card.addEventListener('click', () => {
            selectAndSendGif(url);
        });
        gifSheetGrid.appendChild(card);
    });
}

function selectAndSendGif(gifUrl) {
    socket.emit('group_chat_message', { gifUrl: gifUrl });
    closeGifDrawer();
}
