const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCvfWdmRz1vWCkHhxJy_Ojp8ji2zXlMGdk",
  authDomain:        "fiverwatch.firebaseapp.com",
  databaseURL:       "https://fiverwatch-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "fiverwatch",
  storageBucket:     "fiverwatch.firebasestorage.app",
  messagingSenderId: "86776416908",
  appId:             "1:86776416908:web:ad8f23c36c1bded852c9a9"
};

const MEMBERS = [
  { id: 'mubashir',  name: 'Mubashir Marshal', photo: 'Mubashir%20Marshal.jpg', pos: 'center 15%' },
  { id: 'jehanzaib', name: 'Jehanzaib',         photo: 'Jehanzaib.jpeg',       pos: 'center 40%' },
  { id: 'amir',      name: 'Amir Sohail',       photo: 'Amir.jpeg',            pos: 'center 45%' },
  { id: 'ahmad',     name: 'Muhammad Ahmad',    photo: 'Ahmad.JPG',            pos: 'center 8%'  },
];

const STORAGE_KEY = 'fiverrwatch_member_id';
const SOUND_KEY   = 'fiverrwatch_sound_muted';

// ── State ──
let db           = null;
let myId         = null;
let currentStatus = {};
let alertActive  = false;
let soundMuted   = localStorage.getItem(SOUND_KEY) === 'true';
let wakeLock     = null;
let audioCtx     = null;
let beepTimer    = null;
let vibrateTimer = null;

// ── Boot ──
firebase.initializeApp(FIREBASE_CONFIG);
db = firebase.database();

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('touchstart', unlockAudio, { once: true });
  document.addEventListener('click',      unlockAudio, { once: true });

  subscribeToStatus();

  myId = localStorage.getItem(STORAGE_KEY);
  if (myId && MEMBERS.find(m => m.id === myId)) {
    buildCards();
    bindDashboardButtons();
    setScreen('screen-dashboard');
    requestWakeLock();
  } else {
    buildNameButtons();
    setScreen('screen-select');
  }

  setInterval(refreshTimestamps, 60_000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// Re-acquire wake lock whenever the tab comes back into view
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && myId) requestWakeLock();
});

// ─────────────────────────────────────────────────────────
// WAKE LOCK — keeps screen on while app is open
// ─────────────────────────────────────────────────────────
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────
// SOUND TOGGLE
// ─────────────────────────────────────────────────────────
function initSoundToggle() {
  updateSoundToggleUI();
  document.getElementById('sound-toggle').addEventListener('click', () => {
    soundMuted = !soundMuted;
    localStorage.setItem(SOUND_KEY, String(soundMuted));
    updateSoundToggleUI();
    if (soundMuted) stopBeeping();
    else if (alertActive) startBeeping();
  });
}

function updateSoundToggleUI() {
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;
  btn.textContent = soundMuted ? '🔕' : '🔔';
  btn.classList.toggle('muted', soundMuted);
}

// ─────────────────────────────────────────────────────────
// NAME SELECTION
// ─────────────────────────────────────────────────────────
function buildNameButtons() {
  const grid = document.getElementById('name-grid');
  grid.innerHTML = '';
  MEMBERS.forEach(member => {
    const btn = document.createElement('button');
    btn.className = 'name-btn';
    btn.id        = `name-btn-${member.id}`;

    const photoInner = member.photo
      ? `<img src="${member.photo}" class="name-btn-photo-img"
             style="object-position:${member.pos}" alt="${member.name}" loading="lazy">`
      : `<div class="name-btn-photo-placeholder">${getInitials(member.name)}</div>`;

    btn.innerHTML = `
      <div class="name-btn-photo-wrap" id="nav-${member.id}">${photoInner}</div>
      <span class="name-btn-name">${member.name}</span>
      <span class="name-btn-seen" id="seen-${member.id}"></span>
    `;
    btn.addEventListener('click', () => selectMember(member.id));
    grid.appendChild(btn);
  });
}

function updateNameButtons() {
  MEMBERS.forEach(member => {
    const seenEl = document.getElementById(`seen-${member.id}`);
    const wrapEl = document.getElementById(`nav-${member.id}`);
    if (!seenEl) return;
    const data     = currentStatus[member.id] || {};
    const isActive = !!data.active;
    const ts       = data.lastChanged || null;
    seenEl.textContent = ts ? formatLastSeen(ts, isActive) : '';
    seenEl.className   = `name-btn-seen${isActive ? ' seen-active' : ''}`;
    if (wrapEl) wrapEl.className = `name-btn-photo-wrap${isActive ? ' photo-ring-active' : ''}`;
  });
}

function selectMember(id) {
  localStorage.setItem(STORAGE_KEY, id);
  myId = id;
  buildCards();
  bindDashboardButtons();
  setScreen('screen-dashboard');
  checkCoverage();
  requestWakeLock();
}

// ─────────────────────────────────────────────────────────
// DASHBOARD CARDS
// ─────────────────────────────────────────────────────────
function buildCards() {
  const grid = document.getElementById('cards-grid');
  grid.innerHTML = '';
  MEMBERS.forEach(member => {
    const isMe = member.id === myId;
    const card = document.createElement('div');
    card.className = `member-card${isMe ? ' card-me' : ''}`;
    card.id        = `card-${member.id}`;

    const photoInner = member.photo
      ? `<img src="${member.photo}" class="card-photo-img"
             style="object-position:${member.pos}" alt="${member.name}" loading="lazy">`
      : `<div class="card-photo-placeholder">${getInitials(member.name)}</div>`;

    card.innerHTML = `
      <div class="card-photo-wrap">
        ${photoInner}
        <div class="card-live-dot"></div>
        ${isMe ? '<div class="card-you-badge">You</div>' : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${member.name.split(' ')[0]}</div>
        <div class="card-chip">
          <span class="chip-dot"></span>
          <span class="chip-text">Inactive</span>
        </div>
        <div class="card-lastseen"></div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function bindDashboardButtons() {
  document.getElementById('toggle-btn').addEventListener('click', toggleMyStatus);
  document.getElementById('im-on-it-btn').addEventListener('click', imOnIt);
  initSoundToggle();
}

// ─────────────────────────────────────────────────────────
// FIREBASE
// ─────────────────────────────────────────────────────────
function subscribeToStatus() {
  db.ref('status').on('value', snapshot => {
    currentStatus = snapshot.val() || {};
    updateAllUI();
  });
}

async function writeMyStatus(active) {
  if (!myId) return;
  const ref     = db.ref(`status/${myId}`);
  const payload = { active, lastChanged: firebase.database.ServerValue.TIMESTAMP };
  if (active) {
    await ref.onDisconnect().set({ active: false, lastChanged: firebase.database.ServerValue.TIMESTAMP });
    await ref.set(payload);
  } else {
    await ref.onDisconnect().cancel();
    await ref.set(payload);
  }
}

// ─────────────────────────────────────────────────────────
// UI UPDATE
// ─────────────────────────────────────────────────────────
function updateAllUI() {
  updateNameButtons();
  const dashVisible = document.getElementById('screen-dashboard').classList.contains('active');
  if (dashVisible) {
    renderCards();
    checkCoverage();
  }
}

function renderCards() {
  const myActive = !!(currentStatus[myId] || {}).active;

  MEMBERS.forEach(member => {
    const data      = currentStatus[member.id] || {};
    const isActive  = !!data.active;
    const ts        = data.lastChanged || null;
    const card      = document.getElementById(`card-${member.id}`);
    if (!card) return;

    const wasActive     = card.classList.contains('card-active');
    const statusChanged = isActive !== wasActive;

    card.classList.toggle('card-active', isActive);
    card.querySelector('.chip-text').textContent     = isActive ? 'Active' : 'Inactive';
    card.querySelector('.card-lastseen').textContent = ts ? formatLastSeen(ts, isActive) : '';

    if (statusChanged) {
      card.classList.remove('card-pop');
      void card.offsetWidth;
      card.classList.add('card-pop');
      setTimeout(() => card.classList.remove('card-pop'), 400);
    }
  });

  const toggleBtn   = document.getElementById('toggle-btn');
  const statusLabel = document.getElementById('my-status-label');

  if (myActive) {
    toggleBtn.textContent   = 'Go Inactive';
    toggleBtn.className     = 'toggle-btn btn-go-inactive';
    statusLabel.textContent = 'You are active on Fiverr ✓';
    statusLabel.className   = 'my-status-label label-active';
  } else {
    toggleBtn.textContent   = 'Go Active';
    toggleBtn.className     = 'toggle-btn btn-go-active';
    statusLabel.textContent = 'You are currently inactive';
    statusLabel.className   = 'my-status-label';
  }
}

function refreshTimestamps() {
  MEMBERS.forEach(member => {
    const data = currentStatus[member.id] || {};
    const ts   = data.lastChanged || null;
    if (!ts) return;
    const card = document.getElementById(`card-${member.id}`);
    if (card) card.querySelector('.card-lastseen').textContent = formatLastSeen(ts, !!data.active);
    const seenEl = document.getElementById(`seen-${member.id}`);
    if (seenEl && seenEl.textContent) seenEl.textContent = formatLastSeen(ts, !!data.active);
  });
}

// ─────────────────────────────────────────────────────────
// COVERAGE CHECK
// ─────────────────────────────────────────────────────────
function checkCoverage() {
  const anyActive = MEMBERS.some(m => !!(currentStatus[m.id] || {}).active);
  const badge     = document.getElementById('coverage-badge');
  const banner    = document.getElementById('warning-banner');

  if (anyActive) {
    badge.className = 'coverage-badge badge-ok';
    badge.querySelector('.badge-text').textContent = 'All Clear';
    banner.classList.add('hidden');
    if (alertActive) hideAlert();
  } else {
    badge.className = 'coverage-badge badge-alert';
    badge.querySelector('.badge-text').textContent = 'No Coverage';
    banner.classList.remove('hidden');
    if (!alertActive) showAlert();
  }
}

// ─────────────────────────────────────────────────────────
// ALERT
// ─────────────────────────────────────────────────────────
function showAlert() {
  alertActive = true;
  document.getElementById('alert-overlay').classList.remove('hidden');
  startBeeping();
  startVibrating();
}

function hideAlert() {
  alertActive = false;
  document.getElementById('alert-overlay').classList.add('hidden');
  stopBeeping();
  stopVibrating();
}

// ─────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────
function toggleMyStatus() {
  writeMyStatus(!!(currentStatus[myId] || {}).active === false);
}
function imOnIt() { writeMyStatus(true); }

// ─────────────────────────────────────────────────────────
// SCREEN TRANSITIONS
// ─────────────────────────────────────────────────────────
function setScreen(newId) {
  const current = document.querySelector('.screen.active');
  const next    = document.getElementById(newId);
  if (current === next) return;
  if (current) {
    current.classList.remove('active');
    current.classList.add('exiting');
    setTimeout(() => current.classList.remove('exiting'), 280);
  }
  setTimeout(() => next.classList.add('active'), current ? 40 : 0);
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────
function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatLastSeen(ts, isActive) {
  if (!ts) return '';
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  if (isActive) {
    if (mins < 1)  return 'Just went active';
    if (mins < 60) return `Active for ${mins}m`;
    return `Active for ${hours}h ${mins % 60}m`;
  } else {
    if (mins < 1)  return 'Just went offline';
    if (mins < 60) return `Last seen ${mins}m ago`;
    if (hours < 24) {
      return `Last seen at ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return `Last seen ${new Date(ts).toLocaleDateString()}`;
  }
}

// ─────────────────────────────────────────────────────────
// AUDIO — Web Audio API beep
// ─────────────────────────────────────────────────────────
function unlockAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch (_) {}
}

function beep() {
  if (!audioCtx || soundMuted) return;        // ← respects mute toggle
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t    = audioCtx.currentTime;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type            = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.start(t);
    osc.stop(t + 0.28);
  } catch (_) {}
}

function startBeeping() { beep(); beepTimer = setInterval(beep, 900); }
function stopBeeping()  { clearInterval(beepTimer); beepTimer = null; }

// ─────────────────────────────────────────────────────────
// VIBRATION — Android alert buzz (iOS ignores silently)
// ─────────────────────────────────────────────────────────
function startVibrating() {
  if (!('vibrate' in navigator)) return;
  navigator.vibrate([400, 150, 400, 150, 400]);           // immediate burst
  vibrateTimer = setInterval(() => {
    navigator.vibrate([400, 150, 400, 150, 400]);
  }, 4_000);                                              // repeat every 4s
}

function stopVibrating() {
  if ('vibrate' in navigator) navigator.vibrate(0);       // cancel immediately
  clearInterval(vibrateTimer);
  vibrateTimer = null;
}
