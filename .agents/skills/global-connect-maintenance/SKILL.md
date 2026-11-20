---
name: global-connect-maintenance
description: Engineering and maintenance guidelines for Global Connect WebRTC, Socket.IO, and UI features.
---

# Global Connect — Engineering and Maintenance Skill

## Project identity
- GitHub repository: https://github.com/UmerMK/global-connect
- Live website: https://global-connect-dd7f.onrender.com/

This is an existing application. Never rebuild it from scratch.

## 1. Understand before modifying
Always inspect:
- server.js
- groups-manager.js
- package.json
- public/index.html
- public/script.js
- public/style.css
- Git history and current branch
- Render deployment configuration

Compare the current GitHub source with the live website.
Identify whether the deployed version matches the repository before diagnosing bugs.
Never assume that frontend and backend are synchronized.

## 2. Preserve the existing architecture
The application uses:
- Node.js
- Express
- Socket.IO
- HTML / CSS / Vanilla JavaScript
- WebRTC (P2P Mesh + Metered TURN)

Preserve the existing technologies unless a documented technical reason requires a change.
Do not introduce SQL, authentication, frameworks or external unnecessary services.

## 3. WebRTC and multi-participant video
Treat each remote participant as an independent WebRTC peer.
Investigate:
- Peer connection creation and destruction.
- Offer/answer negotiation.
- ICE candidate exchange.
- Signaling sender and recipient IDs.
- Race conditions during simultaneous joins.
- Late joiners.
- Existing participants receiving new participants.
- Participants leaving unexpectedly.
- Camera enable/disable renegotiation.
- Audio and video track lifecycle.
- ICE connection recovery.

Every participant who enables their camera should be visible to every other participant, subject to their own camera permissions.
A participant who disables their camera must remain connected through audio.
Never assume that one successful WebRTC connection proves that the entire group mesh works.
Verify with at least three independent participants.

## 4. Stable anonymous identities
Every participant must have one stable identity for the duration of their session.
Generate the avatar and display name once.
Reuse the same identity in:
- Participant cards.
- Live chat messages.
- Video tiles.
- Voice indicators.
- System notifications.

Never generate a random avatar during message rendering.
Never replace a missing identity with a newly randomized identity on every message.
Use stable participant IDs as the primary identity key.
Handle missing avatar data with one consistent fallback.

## 5. GIF and disappearing media
Investigate:
- GIF provider responses.
- URL validity.
- CORS restrictions where applicable.
- Image loading and error handling.
- Tenor search and category behavior.
- Animated image rendering.
- Mobile browser compatibility.
- Expiration and cleanup timers.

Ensure GIFs actually display and animate.
Do not let GIF drawers or media overlays block unrelated controls.
Preserve the existing disappearing-media behavior.

## 6. Overlay and interface debugging
Inspect CSS stacking contexts, z-index, position, overflow, pointer-events and responsive layouts.
Check:
- Live chat overlay.
- GIF keyboard drawer.
- Media sharing modal.
- Video participant grid.
- Local video preview.
- Camera and microphone controls.
- Mobile viewport and scrolling.

A visible overlay must never unintentionally intercept clicks intended for another control.
Preserve the existing visual design.

## 7. Mandatory testing strategy
Whenever possible, run the actual repository locally and test with multiple independent browser sessions:
- Participant A, B, and C mesh verification.
- Test independent video enablement and muting.
- Test disconnect and reconnect behavior.
- Capture browser console errors and server logs.

## 8. Safe modification protocol
Before every modification:
1. Inspect Git status.
2. Identify the relevant files.
3. Reproduce the bug.
4. Find the root cause.
5. Explain the proposed fix.
6. Await review and approval before landing code.
