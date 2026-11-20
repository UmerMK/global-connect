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

// Function to fetch TURN server credentials dynamically from Metered API
async function getTurnCredentials() {
    try {
        // Calling the REST API to fetch the TURN Server Credentials
        const response = await fetch("https://globalconnect.metered.live/api/v1/turn/credentials?apiKey=09587faf8d3d9a4627979ab8196eb8f0ee4c");

        if (!response.ok) {
            console.warn('Failed to fetch TURN credentials, using fallback servers');
            return getFallbackIceServers();
        }

        // Saving the response in the iceServers array
        const iceServers = await response.json();
        console.log('%c✅ Dynamic TURN credentials loaded successfully', 'color: green; font-weight: bold');
        return iceServers;
    } catch (error) {
        console.error('Error fetching TURN credentials:', error);
        console.warn('Using fallback TURN servers');
        return getFallbackIceServers();
    }
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

    // Set dynamic avatar based on roomId to make it unique per session
    if (partnerAvatar) {
        partnerAvatar.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.roomId}`;
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
            console.log('Got remote audio track');
            // We must take the audio stream from the event and give it to the 'remote-audio' element
            remoteAudio.srcObject = event.streams[0];

            // Explicitly call play to handle browser autoplay policies
            remoteAudio.play().then(() => {
                console.log("Remote audio playing successfully");
            }).catch(e => {
                console.warn("Autoplay blocked or failed:", e);
                addMessage("Click anywhere to enable voice.", "system");
            });

            callStatus.innerText = 'Connected - Speaking';
            startTimer();
            initVisualizers(localStream, event.streams[0]); // Update with remote stream
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
let groupPeers = new Map(); // memberId -> { pc, displayName, audioElement, videoElement, cardElement, ... }
let groupAudioStream = null;
let groupVideoStream = null;
let isGroupAudioMuted = false;
let isGroupCameraOn = false;
let currentGroupCode = null;
let currentGroupName = null;
let myGroupMemberId = null;
let isCurrentGroupOwner = false;
let pendingCreatedGroup = null;
let groupSpeechInterval = null;
let isSpeakingState = false;
let groupAudioContext = null;

// DOM Elements - Group Lobby
const groupLobbyBtn = document.getElementById('group-lobby-btn');
const groupBackHomeBtn = document.getElementById('group-back-home-btn');
const tabCreateGroup = document.getElementById('tab-create-group');
const tabJoinGroup = document.getElementById('tab-join-group');
const panelCreateGroup = document.getElementById('panel-create-group');
const panelJoinGroup = document.getElementById('panel-join-group');

// Form Elements - Create
const createGroupNameInput = document.getElementById('create-group-name');
const createGroupPassInput = document.getElementById('create-group-password');
const createGroupUserInput = document.getElementById('create-group-username');
const btnSubmitCreateGroup = document.getElementById('btn-submit-create-group');
const createGroupError = document.getElementById('create-group-error');

// Form Elements - Join
const joinGroupCodeInput = document.getElementById('join-group-code');
const joinGroupPassInput = document.getElementById('join-group-password');
const joinGroupUserInput = document.getElementById('join-group-username');
const btnSubmitJoinGroup = document.getElementById('btn-submit-join-group');
const joinGroupError = document.getElementById('join-group-error');

// Modal Elements
const groupCreatedModal = document.getElementById('group-created-modal');
const createdCodeDisplay = document.getElementById('created-code-display');
const btnCopyCode = document.getElementById('btn-copy-code');
const copyConfirmation = document.getElementById('copy-confirmation');
const btnEnterCreatedGroup = document.getElementById('btn-enter-created-group');

// Room Elements
const roomGroupName = document.getElementById('room-group-name');
const roomGroupCode = document.getElementById('room-group-code');
const roomCodeBadge = document.getElementById('room-code-badge');
const btnDeleteGroup = document.getElementById('btn-delete-group');
const btnLeaveGroup = document.getElementById('btn-leave-group');
const groupLeaveControlBtn = document.getElementById('group-leave-control-btn');
const groupParticipantsGrid = document.getElementById('group-participants-grid');
const localCard = document.getElementById('card-local');
const localAvatarImg = document.getElementById('local-avatar-img');
const localVideoPreview = document.getElementById('local-video-preview');
const localDisplayName = document.getElementById('local-display-name');
const localMicIndicator = document.getElementById('local-mic-indicator');
const localCamIndicator = document.getElementById('local-cam-indicator');
const groupMicBtn = document.getElementById('group-mic-btn');
const groupCamBtn = document.getElementById('group-cam-btn');
const groupOnlineCount = document.getElementById('group-online-count');

// ==========================================
// 1. NAVIGATION & TAB SWITCHING
// ==========================================
if (groupLobbyBtn) {
    groupLobbyBtn.addEventListener('click', () => {
        showScreen('group-lobby-screen');
    });
}

if (groupBackHomeBtn) {
    groupBackHomeBtn.addEventListener('click', () => {
        showScreen('start-screen');
    });
}

if (tabCreateGroup && tabJoinGroup) {
    tabCreateGroup.addEventListener('click', () => {
        tabCreateGroup.classList.add('active');
        tabJoinGroup.classList.remove('active');
        panelCreateGroup.classList.remove('hidden');
        panelJoinGroup.classList.add('hidden');
        if (createGroupError) createGroupError.classList.add('hidden');
    });

    tabJoinGroup.addEventListener('click', () => {
        tabJoinGroup.classList.add('active');
        tabCreateGroup.classList.remove('active');
        panelJoinGroup.classList.remove('hidden');
        panelCreateGroup.classList.add('hidden');
        if (joinGroupError) joinGroupError.classList.add('hidden');
    });
}

// Auto uppercase group code input
if (joinGroupCodeInput) {
    joinGroupCodeInput.addEventListener('input', () => {
        joinGroupCodeInput.value = joinGroupCodeInput.value.toUpperCase();
    });
}

// ==========================================
// 2. CREATE GROUP
// ==========================================
if (btnSubmitCreateGroup) {
    btnSubmitCreateGroup.addEventListener('click', handleCreateGroup);
}

function handleCreateGroup() {
    const name = createGroupNameInput.value.trim();
    const password = createGroupPassInput.value;
    const displayName = createGroupUserInput.value.trim() || 'Host';

    if (!name) {
        showFormError(createGroupError, 'Please enter a group name.');
        return;
    }
    if (!password || password.length < 4) {
        showFormError(createGroupError, 'Password must be at least 4 characters.');
        return;
    }

    createGroupError.classList.add('hidden');
    btnSubmitCreateGroup.disabled = true;
    btnSubmitCreateGroup.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Room...';

    socket.emit('group_create', { name, password }, (res) => {
        btnSubmitCreateGroup.disabled = false;
        btnSubmitCreateGroup.innerHTML = '<i class="fas fa-sparkles"></i> Create Group Room';

        if (!res || !res.success) {
            showFormError(createGroupError, (res && res.error) || 'Failed to create group.');
            return;
        }

        const group = res.group;
        // Persist creator's owner token in localStorage
        try {
            localStorage.setItem(`gc_owner_${group.code}`, group.ownerToken);
        } catch (e) {
            console.warn('localStorage not accessible:', e);
        }

        pendingCreatedGroup = {
            code: group.code,
            name: group.name,
            password: password,
            displayName: displayName,
            ownerToken: group.ownerToken
        };

        createdCodeDisplay.innerText = group.code;
        groupCreatedModal.classList.remove('hidden');
    });
}

// Copy Code Button in Modal
if (btnCopyCode) {
    btnCopyCode.addEventListener('click', () => {
        if (!pendingCreatedGroup) return;
        copyTextToClipboard(pendingCreatedGroup.code);
        copyConfirmation.classList.remove('hidden');
        setTimeout(() => {
            copyConfirmation.classList.add('hidden');
        }, 2500);
    });
}

// Enter Room after Group Creation
if (btnEnterCreatedGroup) {
    btnEnterCreatedGroup.addEventListener('click', () => {
        if (!pendingCreatedGroup) return;
        groupCreatedModal.classList.add('hidden');
        enterGroupRoom(
            pendingCreatedGroup.code,
            pendingCreatedGroup.password,
            pendingCreatedGroup.displayName,
            pendingCreatedGroup.ownerToken
        );
    });
}

// ==========================================
// 3. JOIN GROUP
// ==========================================
if (btnSubmitJoinGroup) {
    btnSubmitJoinGroup.addEventListener('click', handleJoinGroup);
}

function handleJoinGroup() {
    const code = joinGroupCodeInput.value.trim().toUpperCase();
    const password = joinGroupPassInput.value;
    const displayName = joinGroupUserInput.value.trim() || 'Friend';

    if (!code) {
        showFormError(joinGroupError, 'Please enter the group code.');
        return;
    }
    if (!password) {
        showFormError(joinGroupError, 'Please enter the group password.');
        return;
    }

    joinGroupError.classList.add('hidden');
    btnSubmitJoinGroup.disabled = true;
    btnSubmitJoinGroup.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';

    // Check if this browser has an ownerToken saved for this group
    let ownerToken = null;
    try {
        ownerToken = localStorage.getItem(`gc_owner_${code}`);
    } catch (e) {}

    enterGroupRoom(code, password, displayName, ownerToken, () => {
        btnSubmitJoinGroup.disabled = false;
        btnSubmitJoinGroup.innerHTML = '<i class="fas fa-door-open"></i> Join Group Room';
    });
}

// Helper: Enter group room
function enterGroupRoom(code, password, displayName, ownerToken, onComplete) {
    socket.emit('group_join', { code, password, displayName, ownerToken }, async (response) => {
        if (typeof onComplete === 'function') onComplete();

        if (!response || !response.success) {
            const errEl = (panelJoinGroup.classList.contains('hidden')) ? createGroupError : joinGroupError;
            showFormError(errEl, (response && response.error) || 'Failed to join group.');
            return;
        }

        // Successfully joined group on server
        currentGroupCode = response.group.code;
        currentGroupName = response.group.name;
        myGroupMemberId = response.memberId;
        isCurrentGroupOwner = response.isOwner;

        // Update UI Header
        roomGroupName.innerText = currentGroupName;
        roomGroupCode.innerText = currentGroupCode;
        localDisplayName.innerText = `${response.displayName}${response.isOwner ? ' (Host)' : ''}`;
        localAvatarImg.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${response.memberId}`;

        // Owner controls
        if (btnDeleteGroup) {
            if (response.isOwner) {
                btnDeleteGroup.classList.remove('hidden');
            } else {
                btnDeleteGroup.classList.add('hidden');
            }
        }

        // Switch to Room screen
        showScreen('group-room-screen');

        // Start Group Voice Engine & WebRTC Mesh
        await initGroupVoiceRoom(response.existingMembers);
    });
}

// Copy Code Pill in Room Header
if (roomCodeBadge) {
    roomCodeBadge.addEventListener('click', () => {
        if (!currentGroupCode) return;
        copyTextToClipboard(currentGroupCode);
        const origHtml = roomCodeBadge.innerHTML;
        roomCodeBadge.innerHTML = '<i class="fas fa-check"></i> <span>Copied!</span>';
        setTimeout(() => {
            roomCodeBadge.innerHTML = origHtml;
        }, 1800);
    });
}

// Helper: Form Error Display
function showFormError(element, message) {
    if (!element) return;
    element.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    element.classList.remove('hidden');
}

// Helper: Clipboard Copy
function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(e => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(input);
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
            createRemoteParticipantCard(member.memberId, member.displayName, member.isOwner);
            await createGroupPeerConnection(member.memberId, member.displayName, true);
        }
    }

    updateGroupOnlineCount();
    playSystemSound('connect');
}

// Create RTCPeerConnection for a specific remote peer in the group
async function createGroupPeerConnection(targetMemberId, targetDisplayName, isInitiator) {
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
    const remoteAudioEl = document.createElement('audio');
    remoteAudioEl.id = `remote-audio-${targetMemberId}`;
    remoteAudioEl.autoplay = true;
    document.body.appendChild(remoteAudioEl);

    const peerData = {
        pc: pc,
        memberId: targetMemberId,
        displayName: targetDisplayName,
        audioElement: remoteAudioEl,
        videoTrack: null,
        audioTrack: null,
        isCameraOn: false,
        isAudioMuted: false
    };

    groupPeers.set(targetMemberId, peerData);

    // Add local audio tracks if available
    if (groupAudioStream) {
        groupAudioStream.getAudioTracks().forEach(track => {
            pc.addTrack(track, groupAudioStream);
        });
    }

    // Add local video track if camera is currently enabled
    if (groupVideoStream && isLocalCameraOn) {
        groupVideoStream.getVideoTracks().forEach(track => {
            pc.addTrack(track, groupVideoStream);
        });
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
        if (!currentPeer) return;

        if (event.track.kind === 'audio') {
            remoteAudioEl.srcObject = event.streams[0];
            remoteAudioEl.play().catch(e => console.warn('Remote audio play blocked:', e));
        } else if (event.track.kind === 'video') {
            const cardVideoEl = document.getElementById(`video-${targetMemberId}`);
            if (cardVideoEl) {
                cardVideoEl.srcObject = event.streams[0];
                cardVideoEl.play().catch(e => console.warn('Remote video play blocked:', e));
                if (currentPeer.isCameraOn) {
                    cardVideoEl.classList.remove('hidden');
                }
            }
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
        // If received offer from a peer not yet registered in map, create peer connection
        console.log(`[Group] Incoming signal from new peer ${from}`);
        peer = await createGroupPeerConnection(from, 'Friend', false);
    }

    const pc = peer.pc;
    try {
        if (data.offer) {
            console.log(`[Group] Received offer from ${from}`);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('group_signal', {
                to: from,
                data: { answer: answer }
            });
        } else if (data.answer) {
            console.log(`[Group] Received answer from ${from}`);
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.candidate) {
            if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                // If remote description not yet set, wait briefly
                setTimeout(async () => {
                    try {
                        if (pc.remoteDescription) {
                            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                        }
                    } catch (e) {}
                }, 500);
            }
        }
    } catch (err) {
        console.error(`[Group] Signal error with ${from}:`, err);
    }
});

// A new member joined the group room
socket.on('group_member_joined', async (member) => {
    console.log(`[Group] New member joined: ${member.displayName} (${member.memberId})`);
    createRemoteParticipantCard(member.memberId, member.displayName, member.isOwner);
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
        const camBadge = document.getElementById(`cam-badge-${memberId}`);

        if (isCameraOn) {
            if (videoEl && videoEl.srcObject) {
                videoEl.classList.remove('hidden');
            }
            if (camBadge) {
                camBadge.className = 'media-badge cam-on';
                camBadge.innerHTML = '<i class="fas fa-video"></i>';
            }
        } else {
            if (videoEl) {
                videoEl.classList.add('hidden');
            }
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
            groupVideoStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                }
            });

            isLocalCameraOn = true;
            const videoTrack = groupVideoStream.getVideoTracks()[0];

            // Local Preview
            localVideoPreview.srcObject = groupVideoStream;
            localVideoPreview.classList.remove('hidden');

            // Update Local UI
            groupCamBtn.className = 'control-btn cam-active';
            groupCamBtn.querySelector('i').className = 'fas fa-video';
            localCamIndicator.className = 'media-badge cam-on';
            localCamIndicator.innerHTML = '<i class="fas fa-video"></i>';

            // Add/Replace video track on all peer connections
            for (const [peerId, peer] of groupPeers.entries()) {
                const pc = peer.pc;
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');

                if (sender) {
                    await sender.replaceTrack(videoTrack);
                } else {
                    pc.addTrack(videoTrack, groupVideoStream);
                    // Renegotiate with peer
                    try {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        socket.emit('group_signal', {
                            to: peerId,
                            data: { offer: offer }
                        });
                    } catch (e) {
                        console.error('[Camera] Renegotiation error with', peerId, e);
                    }
                }
            }

            // Notify group peers that camera is ON
            socket.emit('group_media_state', { isCameraOn: true });
            console.log('[Camera] Camera turned ON successfully');
        } catch (err) {
            console.error('[Camera] Camera activation failed:', err);
            alert('Could not start camera. Please check camera permissions.');
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

        // 2. Hide local preview
        localVideoPreview.classList.add('hidden');
        localVideoPreview.srcObject = null;

        // 3. Update Local UI
        groupCamBtn.className = 'control-btn cam-disabled';
        groupCamBtn.querySelector('i').className = 'fas fa-video-slash';
        localCamIndicator.className = 'media-badge cam-off';
        localCamIndicator.innerHTML = '<i class="fas fa-video-slash"></i>';

        // 4. Remove/replace video track with null on all peers without interrupting audio
        for (const [peerId, peer] of groupPeers.entries()) {
            const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                try {
                    await sender.replaceTrack(null);
                } catch (e) {
                    console.warn('[Camera] Error setting replaceTrack null:', e);
                }
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
    const micLabel = groupMicBtn.querySelector('.btn-label');

    if (isGroupAudioMuted) {
        if (micIcon) micIcon.className = 'fas fa-microphone-slash';
        if (micLabel) micLabel.innerText = 'Unmute';
        localMicIndicator.className = 'media-badge mic-muted';
        localMicIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        // When muted, immediately clear speaking state
        setLocalSpeaking(false);
    } else {
        if (micIcon) micIcon.className = 'fas fa-microphone';
        if (micLabel) micLabel.innerText = 'Mute';
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
// 7. PARTICIPANT UI MANAGEMENT
// ==========================================
function createRemoteParticipantCard(memberId, displayName, isOwner) {
    if (document.getElementById(`card-${memberId}`)) return;

    const card = document.createElement('div');
    card.className = 'participant-card';
    card.id = `card-${memberId}`;

    card.innerHTML = `
        <div class="media-wrapper">
            <div class="avatar-display" id="avatar-box-${memberId}">
                <img class="participant-avatar" src="https://api.dicebear.com/7.x/avataaars/svg?seed=${memberId}" alt="${displayName}">
                <div class="speaking-halo"></div>
            </div>
            <video id="video-${memberId}" class="participant-video hidden" autoplay playsinline></video>
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
            <span class="participant-name">${displayName}${isOwner ? ' (Host)' : ''}</span>
        </div>
    `;

    groupParticipantsGrid.appendChild(card);
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
}

function updateGroupOnlineCount() {
    const total = groupPeers.size + 1; // peers + self
    if (groupOnlineCount) {
        groupOnlineCount.innerText = total;
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

    currentGroupCode = null;
    currentGroupName = null;
    myGroupMemberId = null;
    isCurrentGroupOwner = false;

    showScreen('group-lobby-screen');
}

if (btnDeleteGroup) {
    btnDeleteGroup.addEventListener('click', () => {
        if (!currentGroupCode || !isCurrentGroupOwner) return;
        if (confirm('Are you sure you want to PERMANENTLY delete this group? All participants will be disconnected.')) {
            let ownerToken = null;
            try {
                ownerToken = localStorage.getItem(`gc_owner_${currentGroupCode}`);
            } catch (e) {}

            socket.emit('group_delete', { code: currentGroupCode, ownerToken }, (res) => {
                if (res && res.success) {
                    try {
                        localStorage.removeItem(`gc_owner_${currentGroupCode}`);
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
    if (groupCamBtn) {
        groupCamBtn.className = 'control-btn cam-disabled';
        const camIcon = groupCamBtn.querySelector('i');
        if (camIcon) camIcon.className = 'fas fa-video-slash';
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
        groupMicBtn.className = 'control-btn';
        const micIcon = groupMicBtn.querySelector('i');
        const micLabel = groupMicBtn.querySelector('.btn-label');
        if (micIcon) micIcon.className = 'fas fa-microphone';
        if (micLabel) micLabel.innerText = 'Mute';
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
}
