const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const lightningCanvas = document.getElementById('lightningCanvas');
const lightningCtx = lightningCanvas.getContext('2d');

const dom = {
    rotateOverlay: document.getElementById('rotate-overlay'),
    menu: document.getElementById('menu'),
    gameOverScreen: document.getElementById('gameOver'),
    gameOverTitle: document.getElementById('gameOverTitle'),
    newRecord: document.getElementById('newRecord'),
    comboMeter: document.getElementById('combo-meter'),
    comboValue: document.getElementById('combo-value'),
    comboBar: document.getElementById('combo-bar'),
    gameContainer: document.getElementById('game-container'),
    dashStatus: document.getElementById('dash-status'),
    shieldStatus: document.getElementById('shield-status'),
    slowmoStatus: document.getElementById('slowmo-status'),
    gravityStatus: document.getElementById('gravity-status'),
    dashBar: document.getElementById('dash-bar'),
    shieldBar: document.getElementById('shield-bar'),
    slowmoBar: document.getElementById('slowmo-bar'),
    gravityBar: document.getElementById('gravity-bar'),
    time: document.getElementById('time'),
    score: document.getElementById('score'),
    highScoreMenu: document.getElementById('highScoreMenu'),
    finalTime: document.getElementById('finalTime'),
    finalScore: document.getElementById('finalScore'),
    highScoreDisplay: document.getElementById('highScoreDisplay'),
    startBtn: document.getElementById('startBtn'),
    restartBtn: document.getElementById('restartBtn'),
    menuBtn: document.getElementById('menuBtn'),
    muteBtn: document.getElementById('mute-btn'),
    fullscreenBtn: document.getElementById('fullscreen-btn'),
    mobileControls: document.getElementById('mobile-controls'),
    dashButton: document.getElementById('dash-button')
};

const bgTextureCanvas = document.createElement('canvas');
const bgTextureCtx = bgTextureCanvas.getContext('2d');

let bgGradient = null;
let lastUiTime = '';
let lastUiScore = '';

function resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = lightningCanvas.width = bgTextureCanvas.width = width;
    canvas.height = lightningCanvas.height = bgTextureCanvas.height = height;
    bgGradient = null;
    buildBackgroundTexture();
    // Keep the canvas sizes in sync and update the portrait overlay state.
    try {
        const mobileCheck = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (mobileCheck && height > width) {
            if (dom.rotateOverlay) dom.rotateOverlay.classList.remove('hidden');
        } else {
            if (dom.rotateOverlay) dom.rotateOverlay.classList.add('hidden');
        }
    } catch (e) {}
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function buildBackgroundTexture() {
    if (!bgTextureCtx) return;

    const width = bgTextureCanvas.width;
    const height = bgTextureCanvas.height;
    bgTextureCtx.clearRect(0, 0, width, height);
    bgTextureCtx.fillStyle = 'rgba(0, 0, 0, 0.03)';

    const gridSize = 60;
    for (let x = 0; x < width; x += gridSize) {
        for (let y = 0; y < height; y += gridSize) {
            bgTextureCtx.beginPath();
            bgTextureCtx.arc(x, y, 1, 0, Math.PI * 2);
            bgTextureCtx.fill();
        }
    }
}

const DEBUG_LOGS = false;

function debugLog() {
    if (!DEBUG_LOGS) return;
}

function readStoredScore() {
    const raw = localStorage.getItem('highScore');
    const parsed = Number.parseInt(String(raw ?? '0').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const audioState = {
    context: null,
    master: null,
    musicGain: null,
    sfxGain: null,
    ambientTimer: null,
    musicStep: 0,
    // default to muted on every startup (do not persist user choice)
    muted: true,
    ambientNodes: []
};

const MUSIC_SEED = 24681357;
let musicSeedValue = MUSIC_SEED;
let musicBeatStep = 0;
let musicPhraseStep = 0;

function randomRange(min, max) {
    return min + Math.random() * (max - min);
}

function seededMusicRandom() {
    musicSeedValue = (musicSeedValue * 1664525 + 1013904223) >>> 0;
    return musicSeedValue / 4294967296;
}

function getThreatLevel() {
    const survivalGrowth = Math.log1p(game.survived / 900) * 1.2;
    const waveGrowth = game.wave * 0.08;
    return 1 + survivalGrowth + waveGrowth;
}

function updateMuteButton() {
    if (!dom.muteBtn) return;
    dom.muteBtn.textContent = audioState.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    dom.muteBtn.title = audioState.muted ? 'Unmute sound' : 'Mute sound';
    dom.muteBtn.setAttribute('aria-pressed', String(audioState.muted));
}

function setMuted(muted) {
    audioState.muted = muted;
    if (audioState.master) {
        audioState.master.gain.value = muted ? 0 : 1.0;
    }
    if (muted) {
        stopAmbientMusic();
    } else {
        // start ambient regardless of current game/menu state — only mute controls playback
        startAmbientMusic();
    }
    updateMuteButton();
}

function ensureAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioState.context) {
        audioState.context = new AudioContextClass();
        audioState.master = audioState.context.createGain();
        audioState.musicGain = audioState.context.createGain();
        audioState.sfxGain = audioState.context.createGain();
        // increase default volume for better audibility but keep music warm and not overpowering
        audioState.master.gain.value = audioState.muted ? 0 : 1.0;
        audioState.musicGain.gain.value = 0.85;
        audioState.sfxGain.gain.value = 1.05;
        audioState.musicGain.connect(audioState.master);
        audioState.sfxGain.connect(audioState.master);
        audioState.compressor = audioState.context.createDynamicsCompressor();
        audioState.compressor.threshold.value = -22;
        audioState.compressor.knee.value = 18;
        audioState.compressor.ratio.value = 3.5;
        audioState.compressor.attack.value = 0.006;
        audioState.compressor.release.value = 0.2;
        // optional menu gain bypasses master mute so menu ambience can still play
        audioState.menuGain = audioState.context.createGain();
        audioState.menuGain.gain.value = 0.36;
        audioState.menuGain.connect(audioState.compressor);
        // create a simple reverb/feedback network for lush pads
        (function createDefaultReverb() {
            try {
                const conGain = audioState.context.createGain();
                const delay1 = audioState.context.createDelay();
                const delay2 = audioState.context.createDelay();
                const fb1 = audioState.context.createGain();
                const fb2 = audioState.context.createGain();
                delay1.delayTime.value = 0.12;
                delay2.delayTime.value = 0.25;
                fb1.gain.value = 0.38;
                fb2.gain.value = 0.28;
                // routing
                delay1.connect(fb1);
                fb1.connect(delay1);
                delay2.connect(fb2);
                fb2.connect(delay2);
                // combined output
                const out = audioState.context.createGain();
                delay1.connect(out);
                delay2.connect(out);
                out.gain.value = 0.45;
                out.connect(audioState.master);
                audioState.reverb = { delay1, delay2, fb1, fb2, out };
            } catch (e) { audioState.reverb = null; }
        })();
        audioState.master.connect(audioState.compressor);
        audioState.compressor.connect(audioState.context.destination);
    }

    return audioState.context;
}

function playTone(options = {}) {
    const ctx = ensureAudioContext();
    if (!ctx || !audioState.master) return;

    // By default do NOT bypass master mute. Caller may set options.allowWhileMuted=true to bypass.
    const allowWhileMuted = (typeof options.allowWhileMuted !== 'undefined') ? options.allowWhileMuted : false;
    if (audioState.muted && !allowWhileMuted) return;

    const {
        type = 'sine',
        freq = 440,
        endFreq = null,
        duration = 0.12,
        gain = 0.04,
        detune = 0,
        attack = 0.005,
        release = 0.08,
        filterFreq = 1600,
        bus = 'sfx'
    } = options;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }
    osc.detune.value = detune;

    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(gain, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(bus === 'music' && audioState.musicGain ? audioState.musicGain : audioState.sfxGain || audioState.master);

    osc.start(now);
    osc.stop(now + duration + release + 0.05);
}

function playNoiseBurst(options = {}) {
    const ctx = ensureAudioContext();
    if (!ctx || !audioState.master) return;

    const allowWhileMuted = (typeof options.allowWhileMuted !== 'undefined') ? options.allowWhileMuted : false;
    if (audioState.muted && !allowWhileMuted) return;

    const {
        duration = 0.08,
        gain = 0.03,
        filterFreq = 1000,
        detune = 0,
        bus = 'sfx'
    } = options;

    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
        const falloff = 1 - i / data.length;
        data[i] = (Math.random() * 2 - 1) * falloff;
    }

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gainNode = ctx.createGain();

    source.buffer = buffer;
    source.detune.value = detune;
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.8;
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(bus === 'music' && audioState.musicGain ? audioState.musicGain : audioState.sfxGain || audioState.master);

    source.start(now);
    source.stop(now + duration + 0.02);
}

function playSfx(kind) {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const opts = arguments[1] || {};
    const allowWhileMuted = (typeof opts.allowWhileMuted !== 'undefined') ? opts.allowWhileMuted : false;
    if (audioState.muted && !allowWhileMuted) return;

    switch (kind) {
        case 'pickup':
            playTone({ type: 'triangle', freq: randomRange(500, 560), endFreq: randomRange(820, 940), duration: 0.1, gain: 0.03, filterFreq: 1800 });
            playTone({ type: 'sine', freq: randomRange(840, 940), endFreq: randomRange(1200, 1450), duration: 0.07, gain: 0.018, attack: 0.002, release: 0.05, filterFreq: 2400 });
            break;
        case 'shield':
            playTone({ type: 'triangle', freq: randomRange(300, 340), endFreq: randomRange(620, 720), duration: 0.12, gain: 0.035, filterFreq: 1400 });
            playNoiseBurst({ duration: 0.06, gain: 0.014, filterFreq: 1400 });
            break;
        case 'impact':
            playNoiseBurst({ duration: 0.045, gain: 0.02, filterFreq: 900 });
            playTone({ type: 'square', freq: randomRange(190, 230), endFreq: randomRange(110, 140), duration: 0.05, gain: 0.012, filterFreq: 700 });
            break;
        case 'dash':
            playTone({ type: 'sine', freq: randomRange(320, 380), endFreq: randomRange(680, 820), duration: 0.08, gain: 0.018, attack: 0.002, release: 0.08, filterFreq: 2100 });
            playNoiseBurst({ duration: 0.035, gain: 0.01, filterFreq: 1800 });
            break;
        case 'clickPop':
            // crisp pop: short filtered noise + quick pitched click
            playNoiseBurst({ duration: 0.03, gain: 0.035, filterFreq: 2400, allowWhileMuted: true });
            playTone({ type: 'sine', freq: 960, endFreq: 640, duration: 0.06, gain: 0.02, attack: 0.001, release: 0.04, filterFreq: 3500, allowWhileMuted: true });
            break;
        case 'ghostKill':
            playTone({ type: 'triangle', freq: randomRange(620, 720), endFreq: randomRange(420, 520), duration: 0.1, gain: 0.02, attack: 0.002, release: 0.06, filterFreq: 2600 });
            playTone({ type: 'sine', freq: randomRange(980, 1180), endFreq: randomRange(650, 780), duration: 0.07, gain: 0.01, attack: 0.001, release: 0.04, filterFreq: 3000 });
            break;
        case 'blast':
            playNoiseBurst({ duration: 0.1, gain: 0.035, filterFreq: 700 });
            playTone({ type: 'sawtooth', freq: randomRange(150, 170), endFreq: randomRange(65, 85), duration: 0.2, gain: 0.028, filterFreq: 500 });
            break;
        case 'gameOver':
            playTone({ type: 'triangle', freq: 220, endFreq: 110, duration: 0.2, gain: 0.03, filterFreq: 700 });
            playTone({ type: 'sine', freq: 110, endFreq: 55, duration: 0.25, gain: 0.022, attack: 0.005, release: 0.1, filterFreq: 300 });
            break;
        default:
            playTone({ type: 'sine', freq: 440, endFreq: 660, duration: 0.08, gain: 0.015 });
            break;
    }
}

function playGameOverSound() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Low rumble
    const rum = ctx.createOscillator();
    const rumGain = ctx.createGain();
    rum.type = 'sine';
    rum.frequency.value = 40;
    rumGain.gain.setValueAtTime(0.0001, now);
    rumGain.gain.linearRampToValueAtTime(0.08, now + 0.02);
    rumGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    rum.connect(rumGain);
    rumGain.connect(audioState.sfxGain);
    rum.start(now);
    rum.stop(now + 1.6);

    // Melodic descending cluster
    const tones = [660, 440, 330, 220];
    tones.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = i % 2 === 0 ? 'triangle' : 'sine';
        o.frequency.setValueAtTime(f, now + i * 0.06);
        g.gain.setValueAtTime(0.0001, now + i * 0.06);
        g.gain.linearRampToValueAtTime(0.06 / (i + 1), now + i * 0.06 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4 + i * 0.02);
        o.connect(g);
        g.connect(audioState.sfxGain);
        o.start(now + i * 0.06);
        o.stop(now + 1.4 + i * 0.02);
        audioState.ambientNodes.push(o, g);
    });
}

function startAmbientMusic() {
    if (audioState.ambientTimer) return;

    const ctx = ensureAudioContext();
    if (!ctx) return;

    // === Improved Atmospheric Music System ===
    // Inspired by dark ambient / cinematic tension — evolving pads, distant bells, filtered breath

    const SCALE = [65.41, 77.78, 87.31, 98.00, 116.54, 130.81]; // C2 pentatonic minor

    const PHRASE_ROOTS = [0, 2, 4, 1];
    const PHRASE_LENGTHS = [10800, 11400, 12000, 11100];
    const BEAT_SEQUENCE = [0, 1, 0, 3, 0, 2, 0, 4];
    const BEAT_INTERVALS = [640, 640, 720, 620, 560, 620, 700, 580];
    const ARP_PATTERN = [0, 2, 4, 5, 4, 2, 1, 2];
    const ARP_DELAYS = [0.45, 0.9, 1.35, 1.8, 2.25, 2.7, 3.15, 3.6];
    musicSeedValue = MUSIC_SEED;
    musicBeatStep = 0;
    musicPhraseStep = 0;

    function makePad(rootFreq, detuneCents, duration, gainVal, type = 'sawtooth') {
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const osc3 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const filterLFO = ctx.createOscillator();
        const filterLFOGain = ctx.createGain();
        const gainNode = ctx.createGain();
        const pan = ctx.createStereoPanner();

        osc1.type = type;
        osc2.type = 'triangle';
        osc3.type = 'sine';

        osc1.frequency.value = rootFreq;
        osc2.frequency.value = rootFreq * 1.5;     // perfect fifth 
        osc3.frequency.value = rootFreq * 0.5;     // sub octave
        osc1.detune.value = detuneCents;
        osc2.detune.value = -detuneCents * 0.7;
        osc3.detune.value = detuneCents * 0.3;

        filter.type = 'lowpass';
        filter.frequency.value = 300;
        filter.Q.value = 2.5;

        // Slowly open filter for swell effect
        filter.frequency.setValueAtTime(150, now);
        filter.frequency.linearRampToValueAtTime(600 + seededMusicRandom() * 400, now + duration * 0.5);
        filter.frequency.linearRampToValueAtTime(200, now + duration);

        // LFO on filter for breathing quality
        filterLFO.type = 'sine';
        filterLFO.frequency.value = 0.04 + seededMusicRandom() * 0.08;
        filterLFOGain.gain.value = 150;
        filterLFO.connect(filterLFOGain);
        filterLFOGain.connect(filter.frequency);

        // Slow volume swell
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.linearRampToValueAtTime(gainVal, now + duration * 0.35);
        gainNode.gain.setValueAtTime(gainVal, now + duration * 0.65);
        gainNode.gain.linearRampToValueAtTime(0.0001, now + duration);

        pan.pan.value = -0.8 + seededMusicRandom() * 1.6;

        osc1.connect(filter);
        osc2.connect(filter);
        osc3.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(pan);

        // Route through reverb if available, also direct
        if (audioState.reverb && audioState.reverb.out) pan.connect(audioState.reverb.out);
        pan.connect(audioState.musicGain);

        const end = now + duration + 0.1;
        osc1.start(now); osc1.stop(end);
        osc2.start(now); osc2.stop(end);
        osc3.start(now); osc3.stop(end);
        filterLFO.start(now); filterLFO.stop(end);

        audioState.ambientNodes.push(osc1, osc2, osc3, filter, gainNode, pan, filterLFO, filterLFOGain);
    }

    function makeBreath() {
        // Filtered noise for wind/air texture
        const now = ctx.currentTime;
        const duration = 8 + seededMusicRandom() * 6;
        const bufLen = ctx.sampleRate * duration;
        const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = seededMusicRandom() * 2 - 1;

        const src = ctx.createBufferSource();
        src.buffer = buf;

        const hipass = ctx.createBiquadFilter();
        hipass.type = 'highpass';
        hipass.frequency.value = 200;

        const lopass = ctx.createBiquadFilter();
        lopass.type = 'lowpass';
        lopass.frequency.value = 800 + seededMusicRandom() * 600;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.018 + seededMusicRandom() * 0.012, now + 1.5);
        g.gain.linearRampToValueAtTime(0.0001, now + duration);

        const pan = ctx.createStereoPanner();
        pan.pan.value = -0.5 + seededMusicRandom() * 1.0;

        src.connect(hipass);
        hipass.connect(lopass);
        lopass.connect(g);
        g.connect(pan);
        pan.connect(audioState.musicGain);

        src.start(now);
        audioState.ambientNodes.push(src, hipass, lopass, g, pan);
    }

    function makeBell(freq, delay = 0) {
        const now = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const pan = ctx.createStereoPanner();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 2, now);
        osc.frequency.exponentialRampToValueAtTime(freq, now + 0.02);

        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.06, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);

        pan.pan.value = -0.9 + seededMusicRandom() * 1.8;

        osc.connect(g);
        g.connect(pan);
        if (audioState.reverb && audioState.reverb.out) pan.connect(audioState.reverb.out);
        pan.connect(audioState.musicGain);

        osc.start(now);
        osc.stop(now + 4.0);
        audioState.ambientNodes.push(osc, g, pan);
    }

    function makePulse(freq) {
        // Sub-bass rhythmic pulse
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * 0.25; // sub
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.04, now + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
        osc.connect(g);
        g.connect(audioState.musicGain);
        osc.start(now); osc.stop(now + 1.3);
        audioState.ambientNodes.push(osc, g);
    }

    function makeArp(rootFreq, phraseIndex) {
        for (let i = 0; i < ARP_PATTERN.length; i++) {
            const now = ctx.currentTime + ARP_DELAYS[i];
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            const filt = ctx.createBiquadFilter();
            const pan = ctx.createStereoPanner();

            osc.type = 'triangle';
            osc.frequency.value = rootFreq * [1, 1.25, 1.5, 1.75, 2.0, 1.75, 1.5, 1.25][ARP_PATTERN[i]];

            filt.type = 'lowpass';
            filt.frequency.value = 2400 + phraseIndex * 180;

            g.gain.setValueAtTime(0.0001, now);
            g.gain.linearRampToValueAtTime(0.012 + phraseIndex * 0.002, now + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

            pan.pan.value = -0.25 + i * 0.07;

            osc.connect(filt);
            filt.connect(g);
            g.connect(pan);
            if (audioState.reverb && audioState.reverb.out) pan.connect(audioState.reverb.out);
            pan.connect(audioState.musicGain);

            osc.start(now);
            osc.stop(now + 0.4);
            audioState.ambientNodes.push(osc, g, filt, pan);
        }
    }

    const schedule = () => {
        const phraseIndex = musicPhraseStep % PHRASE_ROOTS.length;
        const rootIndex = PHRASE_ROOTS[phraseIndex];
        const root = SCALE[rootIndex];
        const harmony = SCALE[(rootIndex + 2) % SCALE.length];
        const padDuration = 10.5 + (phraseIndex * 0.5);

        // Main evolving pad
        makePad(root, 4 + phraseIndex * 1.5, padDuration, 0.032, 'sawtooth');

        // Harmonic pad for depth
        makePad(harmony, 2 + phraseIndex, padDuration * 0.84, 0.017, 'triangle');

        // Breath texture stays constant and sparse
        if (phraseIndex !== 1) makeBreath();

        // Sparse melodic bell hits
        const bellCount = phraseIndex === 3 ? 2 : 1;
        for (let b = 0; b < bellCount; b++) {
            const bellFreq = SCALE[(rootIndex + 2 + b * 2) % SCALE.length] * 4;
            const bellDelay = 0.75 + b * 1.05;
            makeBell(bellFreq, bellDelay);
        }

        // Anchoring pulse
        if (phraseIndex === 0 || phraseIndex === 2) makePulse(root);

        // Consistent arpeggio motif for a stronger musical identity
        makeArp(root, phraseIndex);

        musicPhraseStep++;
        audioState.ambientTimer = setTimeout(schedule, PHRASE_LENGTHS[phraseIndex]);
    };

    schedule();
    // rhythmic beat sequencer to add stronger beats and harmonic pitch motion
    function makeBeat(rootFreq, timeOffset = 0, isKick = true) {
        const now = ctx.currentTime + timeOffset;

        // Kick / sub thump
        if (isKick) {
            const kick = ctx.createOscillator();
            const g = ctx.createGain();
            kick.type = 'sine';
            kick.frequency.setValueAtTime(rootFreq * 0.5, now);
            kick.frequency.exponentialRampToValueAtTime(Math.max(30, rootFreq * 0.12), now + 0.08);
            g.gain.setValueAtTime(0.0001, now);
            g.gain.linearRampToValueAtTime(0.08, now + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
            kick.connect(g);
            g.connect(audioState.musicGain);
            kick.start(now); kick.stop(now + 0.35);
            audioState.ambientNodes.push(kick, g);
        }

        // Click/pluck on top for rhythmic clarity
        const clickTime = now + (isKick ? 0.12 : 0);
        const clickOsc = ctx.createOscillator();
        const clickG = ctx.createGain();
        const clickFilt = ctx.createBiquadFilter();
        clickOsc.type = 'triangle';
        clickOsc.frequency.setValueAtTime(rootFreq * (seededMusicRandom() > 0.5 ? 2.0 : 3.0), clickTime);
        clickG.gain.setValueAtTime(0.0001, clickTime);
        clickG.gain.linearRampToValueAtTime(0.02, clickTime + 0.002);
        clickG.gain.exponentialRampToValueAtTime(0.0001, clickTime + 0.12);
        clickFilt.type = 'highpass';
        clickFilt.frequency.value = 900 + seededMusicRandom() * 1600;
        clickOsc.connect(clickFilt);
        clickFilt.connect(clickG);
        clickG.connect(audioState.musicGain);
        clickOsc.start(clickTime); clickOsc.stop(clickTime + 0.14);
        audioState.ambientNodes.push(clickOsc, clickG, clickFilt);
    }

    const scheduleBeat = () => {
        try {
            const patternIndex = musicBeatStep % BEAT_SEQUENCE.length;
            const beatRoot = SCALE[BEAT_SEQUENCE[patternIndex]];
            makeBeat(beatRoot, 0, true);
            if (patternIndex === 1 || patternIndex === 5) {
                makeBeat(beatRoot * 1.5, 0.28, false);
            }
        } catch (e) {}

        musicBeatStep++;
        const nextBeat = BEAT_INTERVALS[musicBeatStep % BEAT_INTERVALS.length];
        audioState.beatTimer = setTimeout(scheduleBeat, nextBeat);
    };

    scheduleBeat();
}

function stopAmbientMusic() {
    if (audioState.ambientTimer) {
        clearTimeout(audioState.ambientTimer);
        audioState.ambientTimer = null;
    }
    if (audioState.beatTimer) {
        clearTimeout(audioState.beatTimer);
        audioState.beatTimer = null;
    }

    // stop and disconnect all ambient nodes
    try {
        for (const n of audioState.ambientNodes) {
            try {
                if (n && typeof n.stop === 'function') {
                    try { n.stop(); } catch (e) {}
                }
                if (n && typeof n.disconnect === 'function') {
                    try { n.disconnect(); } catch (e) {}
                }
            } catch (e) {}
        }
    } catch (e) {}
    audioState.ambientNodes.length = 0;
    audioState.musicStep = 0;
}

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
if (isMobile) {
    if (dom.mobileControls) dom.mobileControls.classList.remove('hidden');
}

// --- Custom cursor: fade away when idle (applies across menu and gameplay) ---
if (!isMobile) {
    (function setupFakeCursor() {
        const fake = document.createElement('div');
        fake.id = 'fake-cursor';
        document.body.appendChild(fake);

        // enable fake cursor (hide system cursor)
        document.body.classList.add('use-fake-cursor');

        let idleTimer = null;
        const IDLE_TIMEOUT = 1600; // ms before fading

        function setIdle() {
            document.body.classList.add('cursor-idle');
        }

        function resetIdleTimer() {
            document.body.classList.remove('cursor-idle');
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(setIdle, IDLE_TIMEOUT);
        }

        // move fake cursor on pointer move and show immediately
        window.addEventListener('pointermove', (e) => {
            fake.style.left = (e.clientX || 0) + 'px';
            fake.style.top = (e.clientY || 0) + 'px';
            fake.style.transform = 'translate(-50%, -50%) scale(1)';
            resetIdleTimer();
        }, { passive: true });

        // show cursor on pointerdown and reset timer
        window.addEventListener('pointerdown', () => { resetIdleTimer(); }, { passive: true });

        // initialize
        resetIdleTimer();
    })();
}

const game = {
    state: 'menu',
    keys: {},
    mobileDashQueued: false,
    time: 0,
    survived: 0,
    score: 0,
    multiplier: 1,
    multiplierTimer: 0,
    highScore: readStoredScore(),
    shake: 0,
    difficulty: 'normal',
    wave: 0,
    waveTimer: 0,
    seed: Math.floor(Math.random() * 1000000)
};

// Seeded random for reproducibility
let seedValue = game.seed;
function seededRandom() {
    seedValue = (seedValue * 9301 + 49297) % 233280;
    return seedValue / 233280;
}

const player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 20,
    speed: 6.5,
    friction: 0.86,
    acceleration: 0.85,
    trail: [],
    shieldActive: false,
    shieldTime: 0,
    slowmoActive: false,
    slowmoTime: 0,
    dashCooldown: 0,
    dashDuration: 0,
    dashSpeed: 25,
    ghosts: [],
    gravityTime: 0
};

const projectiles = [];
const particles = [];
const powerups = [];
const bgParticles = [];
const floatingTexts = [];
const lightningBolts = [];
const notifications = [];

let spawnTimer = 0;
let spawnRate = 100;
let difficulty = 1;
let powerupTimer = 0;

let joystick = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
let mobileJoystickPointerId = null;
let mobileDashPointerId = null;
let animationId = null; // Track current animation frame for cleanup

for (let i = 0; i < 80; i++) {
    bgParticles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.5 + 0.2,
        opacity: Math.random() * 0.4 + 0.1,
        twinkle: Math.random() * Math.PI * 2,
        hue: 180 + Math.random() * 60
    });
}

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key.startsWith('arrow') || key === 'shift') {
        e.preventDefault();
        return;
    }
    if (key === ' ' || key === 'w' || key === 'a' || key === 's' || key === 'd') {
        e.preventDefault();
        game.keys[key] = true;
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'w' || key === 'a' || key === 's' || key === 'd') {
        e.preventDefault();
        game.keys[key] = false;
    }
});

const joystickArea = document.getElementById('joystick-area');
const joystickStick = document.getElementById('joystick-stick');
const dashButton = dom.dashButton;

function setJoystickFromPoint(clientX, clientY) {
    const rect = joystickArea.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const maxRadius = rect.width * 0.28;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const scale = Math.min(1, maxRadius / dist);

    joystick.active = true;
    joystick.startX = centerX;
    joystick.startY = centerY;
    joystick.currentX = centerX + dx * scale;
    joystick.currentY = centerY + dy * scale;

    const offsetX = joystick.currentX - centerX;
    const offsetY = joystick.currentY - centerY;
    joystickStick.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
}

function resetJoystick() {
    joystick.active = false;
    joystick.startX = 0;
    joystick.startY = 0;
    joystick.currentX = 0;
    joystick.currentY = 0;
    joystickStick.style.transform = 'translate(-50%, -50%)';
}

joystickArea.addEventListener('pointerdown', (e) => {
    if (mobileJoystickPointerId !== null) return;
    mobileJoystickPointerId = e.pointerId;
    joystickArea.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    setJoystickFromPoint(e.clientX, e.clientY);
});

joystickArea.addEventListener('pointermove', (e) => {
    if (mobileJoystickPointerId !== e.pointerId || !joystick.active) return;
    e.preventDefault();
    setJoystickFromPoint(e.clientX, e.clientY);
});

function releaseJoystickPointer(e) {
    if (mobileJoystickPointerId !== e.pointerId) return;
    mobileJoystickPointerId = null;
    resetJoystick();
}

joystickArea.addEventListener('pointerup', releaseJoystickPointer);
joystickArea.addEventListener('pointercancel', releaseJoystickPointer);
joystickArea.addEventListener('lostpointercapture', releaseJoystickPointer);

if (dashButton) {
    dashButton.addEventListener('pointerdown', (e) => {
        if (mobileDashPointerId !== null) return;
        mobileDashPointerId = e.pointerId;
        dashButton.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
        game.mobileDashQueued = true;
        dashButton.classList.add('is-active');
    });

    function releaseDashPointer(e) {
        if (mobileDashPointerId !== e.pointerId) return;
        mobileDashPointerId = null;
        dashButton.classList.remove('is-active');
    }

    dashButton.addEventListener('pointerup', releaseDashPointer);
    dashButton.addEventListener('pointercancel', releaseDashPointer);
    dashButton.addEventListener('lostpointercapture', releaseDashPointer);
}

const clickRipples = [];

function createClickRipple(x, y) {
    clickRipples.push({
        x, y,
        radius: 6,
        maxRadius: Math.min(140, Math.max(40, Math.min(canvas.width, canvas.height) * 0.12)),
        life: 1.0,
        decay: 0.045,
        popped: false
    });
}

function updateClickRipples() {
    for (let i = clickRipples.length - 1; i >= 0; i--) {
        const r = clickRipples[i];

        // quick ease-out expansion with slight overshoot
        r.radius += (r.maxRadius * (1.02 - r.radius / r.maxRadius) - r.radius) * 0.22;

        // decay life and detect pop moment
        r.life -= r.decay;
        if (!r.popped && r.life <= 0.18) {
            r.popped = true;
            // burst a few particles for visual pop
            for (let p = 0; p < 8; p++) {
                particles.push({
                    x: r.x + (Math.random() - 0.5) * 8,
                    y: r.y + (Math.random() - 0.5) * 8,
                    vx: (Math.random() - 0.5) * 3,
                    vy: (Math.random() - 0.9) * 3,
                    life: 18 + Math.floor(Math.random() * 12),
                    radius: 2 + Math.random() * 3,
                    hue: 60
                });
            }
            // visual pop only; sound is played on pointerdown to avoid duplicates
        }

        if (r.life <= 0) clickRipples.splice(i, 1);
    }
}

function drawClickRipples() {
    clickRipples.forEach(r => {
        // Always draw to lightningCtx (z-index 2, visible above menu)
        const renderCtx = lightningCtx;
        
        renderCtx.save();
        // soft white bubbly fill
        const alpha = Math.max(0, Math.min(1, r.life * 1.05));
        const grd = renderCtx.createRadialGradient(r.x, r.y, Math.max(1, r.radius * 0.05), r.x, r.y, r.radius);
        grd.addColorStop(0, `rgba(255,255,255,${0.95 * alpha})`);
        grd.addColorStop(0.6, `rgba(255,255,255,${0.45 * alpha})`);
        grd.addColorStop(1, `rgba(255,255,255,${0.12 * alpha})`);

        renderCtx.globalCompositeOperation = 'lighter';
        renderCtx.fillStyle = grd;
        renderCtx.beginPath();
        renderCtx.arc(r.x, r.y, r.radius * (1 + (1 - r.life) * 0.12), 0, Math.PI * 2);
        renderCtx.fill();

        // thin bright rim to emphasize pop
        renderCtx.lineWidth = 2 + 2 * r.life;
        renderCtx.strokeStyle = `rgba(255,255,255,${0.6 * alpha})`;
        renderCtx.beginPath();
        renderCtx.arc(r.x, r.y, r.radius * 0.9, 0, Math.PI * 2);
        renderCtx.stroke();

        renderCtx.restore();
    });
}

// Canvas-based click pop: unified for menu and gameplay
document.addEventListener('pointerdown', (e) => {
    try {
        const x = e.clientX || 0;
        const y = e.clientY || 0;
        // ensure audio context is resumed so menu clicks produce sound
        const ac = ensureAudioContext();
        if (ac) ac.resume().catch(() => {});

        createClickRipple(x, y);
        // single unified click sound (played once per user click) — respects mute
        playSfx('clickPop');
    } catch (err) {}
}, true);

// Lightweight DOM ripple for overlays (ensures ripple is visible above menus)
function makeDomRipple(x, y) {
    try {
        const el = document.createElement('div');
        el.className = 'click-ripple';
        // prefer appending into game-container to respect stacking contexts
        const container = dom.gameContainer;
        if (container) {
            // position absolute inside container
            el.style.position = 'absolute';
            const rect = container.getBoundingClientRect();
            el.style.left = (x - rect.left) + 'px';
            el.style.top = (y - rect.top) + 'px';
            el.style.width = '10px';
            el.style.height = '10px';
            el.style.zIndex = 99999;
            container.appendChild(el);
        } else {
            el.style.left = x + 'px';
            el.style.top = y + 'px';
            el.style.width = '10px';
            el.style.height = '10px';
            document.body.appendChild(el);
        }
        el.addEventListener('animationend', () => { try { el.remove(); } catch (e) {} }, { once: true });
    } catch (e) {}
}

// Fallback: ensure a fixed positioned ripple on body with very high z-index
function makeDomRippleFallback(x, y) {
    try {
        const f = document.createElement('div');
        f.className = 'click-ripple';
        f.style.position = 'fixed';
        f.style.left = x + 'px';
        f.style.top = y + 'px';
        f.style.width = '10px';
        f.style.height = '10px';
        f.style.zIndex = '2147483647';
        document.body.appendChild(f);
        f.addEventListener('animationend', () => { try { f.remove(); } catch (e) {} }, { once: true });
    } catch (e) {}
}

// Also create DOM ripple so it's visible above menu overlays
document.addEventListener('pointerdown', (e) => {
    try {
        makeDomRippleFallback(e.clientX || 0, e.clientY || 0);
    } catch (e) {}
}, true);

function startGame() {
    game.state = 'playing';
    const audioContext = ensureAudioContext();
    if (audioContext) {
        audioContext.resume().catch(() => {});
    }
    game.time = 0;
    game.survived = 0;
    game.score = 0;
    game.multiplier = 1;
    game.multiplierTimer = 0;
    game.shake = 0;
    game.wave = 1;
    game.waveTimer = 0;
    game.seed = Math.floor(Math.random() * 1000000);
    seedValue = game.seed;

    player.x = canvas.width / 2;
    player.y = canvas.height / 2;
    player.vx = 0;
    player.vy = 0;
    player.trail = [];
    player.shieldActive = false;
    player.shieldTime = 0;
    player.slowmoActive = false;
    player.slowmoTime = 0;
    player.dashCooldown = 0;
    player.dashDuration = 0;
    player.ghosts = [];
    player.gravityTime = 0;
    player.speed = 6.5;
    game.mobileDashQueued = false;
    mobileDashPointerId = null;
    mobileJoystickPointerId = null;
    resetJoystick();
    if (dashButton) dashButton.classList.remove('is-active');

    projectiles.length = 0;
    particles.length = 0;
    powerups.length = 0;
    floatingTexts.length = 0;
    lightningBolts.length = 0;
    notifications.length = 0;
    shockwaves.length = 0;
    spawnTimer = 0;
    spawnRate = 100;
    difficulty = 1;
    powerupTimer = 0;

    // Clear canvases
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lightningCtx.clearRect(0, 0, lightningCanvas.width, lightningCanvas.height);

    // Hide all UI elements
    dom.menu.classList.add('hidden');
    dom.gameOverScreen.classList.add('hidden');
    dom.newRecord.classList.add('hidden');
    dom.comboMeter.classList.add('hidden');
    dom.shieldStatus.classList.add('hidden');
    dom.slowmoStatus.classList.add('hidden');
    dom.gravityStatus.classList.add('hidden');

    // Always show dash status
    dom.dashStatus.classList.remove('hidden');
    dom.dashBar.style.width = '100%';

    // Reset status bars to full width
    dom.shieldBar.style.width = '100%';
    dom.slowmoBar.style.width = '100%';
    dom.gravityBar.style.width = '100%';

    // Reset combo bar
    dom.comboBar.style.width = '100%';
    dom.comboValue.textContent = 'x1.0';

    // Reset UI displays
    dom.time.textContent = '0s';
    dom.score.textContent = '0';
    lastUiTime = '0s';
    lastUiScore = '0';
}

// Mute button wiring
dom.muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const ac = ensureAudioContext();
    if (ac) ac.resume().catch(() => {});
    setMuted(!audioState.muted);
});
// Set correct initial state of button on page load
updateMuteButton();
// Auto-start ambient on first user interaction (respects muted state via musicGain)
document.addEventListener('pointerdown', function tryStart() {
    const ac = ensureAudioContext();
    if (ac) {
        ac.resume().then(() => { if (!audioState.muted) startAmbientMusic(); }).catch(() => {});
    }
}, { once: true });
const difficultyBtns = document.querySelectorAll('.difficulty-btn');
difficultyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        difficultyBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        game.difficulty = btn.dataset.difficulty;
    });
});

dom.startBtn.addEventListener('click', startGame);
dom.restartBtn.addEventListener('click', startGame);
dom.menuBtn.addEventListener('click', returnToMenu);

const rawBest = localStorage.getItem('highScore') || '0';
const cleanBest = parseInt(rawBest.replace(/\D/g, '')) || 0;
game.highScore = cleanBest;

if (game.highScore > 0) {
    dom.highScoreMenu.textContent = `Best: ${game.highScore}`;
}

function returnToMenu() {
    game.state = 'menu';

    // Reset player state completely
    player.shieldActive = false;
    player.shieldTime = 0;
    player.slowmoActive = false;
    player.slowmoTime = 0;
    player.dashCooldown = 0;
    player.dashDuration = 0;
    player.trail = [];
    game.mobileDashQueued = false;
    mobileDashPointerId = null;
    mobileJoystickPointerId = null;
    resetJoystick();
    if (dashButton) dashButton.classList.remove('is-active');

    // Clear all game elements
    projectiles.length = 0;
    particles.length = 0;
    powerups.length = 0;
    floatingTexts.length = 0;
    lightningBolts.length = 0;
    notifications.length = 0;
    shockwaves.length = 0;

    // Clear canvases
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lightningCtx.clearRect(0, 0, lightningCanvas.width, lightningCanvas.height);

    // Hide all status indicators
    dom.shieldStatus.classList.add('hidden');
    dom.slowmoStatus.classList.add('hidden');
    dom.dashStatus.classList.add('hidden');
    dom.gravityStatus.classList.add('hidden');
    dom.comboMeter.classList.add('hidden');

    // Show menu, hide game over
    dom.gameOverScreen.classList.add('hidden');
    dom.menu.classList.remove('hidden');

    updateMenuDisplay();
}

function updateMenuDisplay() {
    if (game.highScore > 0) {
        dom.highScoreMenu.textContent = `Best: ${game.highScore}`;
    }
}

// Fullscreen functionality
if (dom.fullscreenBtn) {
    dom.fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error('Fullscreen request failed:', err);
            });
        } else {
            document.exitFullscreen();
        }
    });

    document.addEventListener('fullscreenchange', () => {
        dom.fullscreenBtn.textContent = '\u26F6';
    });
}

function spawnProjectile() {
    const side = Math.floor(seededRandom() * 4);
    let x, y;

    const margin = 60;
    if (side === 0) {
        x = seededRandom() * canvas.width;
        y = -margin;
    } else if (side === 1) {
        x = canvas.width + margin;
        y = seededRandom() * canvas.height;
    } else if (side === 2) {
        x = seededRandom() * canvas.width;
        y = canvas.height + margin;
    } else {
        x = -margin;
        y = seededRandom() * canvas.height;
    }

    const baseRange = Math.min(canvas.width, canvas.height) * 0.75;
    const rangeIncrease = Math.floor(game.survived / 1500) * 250;
    const maxRange = baseRange + rangeIncrease;

    // Difficulty modifiers
    let speedMultiplier = 1;
    if (game.difficulty === 'easy') {
        speedMultiplier = 0.8;
    } else if (game.difficulty === 'hard') {
        speedMultiplier = 1.3;
    }

    // Enemy mix scales forever, but with diminishing returns so it stays playable.
    const trackerWeight = Math.max(1.0, 6.0 - difficulty * 0.18);
    const straightWeight = 2.0 + difficulty * 0.05;
    const explosiveWeight = 0.8 + difficulty * 0.08;
    const splitterWeight = 0.45 + difficulty * 0.09;
    const typeRoll = seededRandom() * (trackerWeight + straightWeight + explosiveWeight + splitterWeight);
    let type = 'tracker';
    if (typeRoll < trackerWeight) {
        type = 'tracker';
    } else if (typeRoll < trackerWeight + straightWeight) {
        type = 'straight';
    } else if (typeRoll < trackerWeight + straightWeight + explosiveWeight) {
        type = 'explosive';
    } else {
        type = 'splitter';
    }

    let speed, hue, radius, maxRangeOverride;

    if (type === 'tracker') {
        speed = (1.45 + difficulty * 0.08) * speedMultiplier;
        hue = 180; radius = 15;
    } else if (type === 'straight') {
        speed = (3.1 + difficulty * 0.1) * speedMultiplier;
        hue = 300; radius = 12;
        maxRangeOverride = Math.max(canvas.width, canvas.height) * 1.2;
    } else if (type === 'explosive') {
        speed = (1.1 + difficulty * 0.06) * speedMultiplier;
        hue = 35; radius = 18;
    } else if (type === 'splitter') {
        speed = (2.0 + difficulty * 0.08) * speedMultiplier; 
        hue = 120; radius = 22;
    }

    // Calculate initial velocity toward player
    const dx = canvas.width / 2 - x;
    const dy = canvas.height / 2 - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const vx = (dx / dist) * speed;
    const vy = (dy / dist) * speed;

    projectiles.push({
        x, y,
        vx: vx,
        vy: vy,
        startX: x,
        startY: y,
        radius: radius,
        speed: speed,
        maxRange: maxRangeOverride || maxRange,
        hue: hue,
        type: type,
        trail: [],
        pulse: Math.random() * Math.PI * 2
    });
}

function spawnPowerup() {
    const types = ['shield', 'slowmo', 'clear', 'gravity'];
    const type = types[Math.floor(Math.random() * types.length)];

    const margin = 100;
    const x = margin + Math.random() * (canvas.width - margin * 2);
    const y = margin + Math.random() * (canvas.height - margin * 2);

    powerups.push({
        x, y,
        radius: 18,
        type: type,
        life: 600,
        pulse: 0
    });
}

function updatePlayer() {
    let dx = 0, dy = 0;

    if (game.keys['w']) dy -= 1;
    if (game.keys['s']) dy += 1;
    if (game.keys['a']) dx -= 1;
    if (game.keys['d']) dx += 1;

    let moveSpeed = player.speed;
    let auraSlow = 1;

    // Determine slow effect
    const auraRadiusSq = 180 * 180;
    for (let i = 0; i < projectiles.length; i++) {
        const proj = projectiles[i];
        if (proj.type !== 'splitter') continue;

        const adx = player.x - proj.x;
        const ady = player.y - proj.y;
        if ((adx * adx + ady * ady) < auraRadiusSq) {
            auraSlow = 0.4;
            break;
        }
    }
    
    moveSpeed *= auraSlow;

    // Dash Mechanic (Space or mobile dash button)
    const dashPressed = game.keys[' '] || game.mobileDashQueued;
    if (dashPressed && player.dashCooldown <= 0 && (dx !== 0 || dy !== 0)) {
        player.dashDuration = 8;
        player.dashCooldown = 45;
        game.shake = 15;
        // DASH speed is less affected by slow to allow "bursting" out
        player.dashSpeed = 25 * (auraSlow > 0.5 ? 1 : 0.8);
        playSfx('dash');
        showNotification('DASH!', '#fff');
        
        // Create afterimage ghost
        player.ghosts.push({
            x: player.x,
            y: player.y,
            radius: player.radius * 0.8,
            life: 60
        });
    }
    if (game.mobileDashQueued) {
        game.mobileDashQueued = false;
    }

    if (player.dashCooldown > 0) player.dashCooldown--;

    if (joystick.active) {
        const jdx = joystick.currentX - joystick.startX;
        const jdy = joystick.currentY - joystick.startY;
        const jdist = Math.sqrt(jdx * jdx + jdy * jdy);

        if (jdist > 10) {
            dx = jdx / jdist;
            dy = jdy / jdist;

            const maxOffset = 50;
            const offsetX = Math.max(-maxOffset, Math.min(maxOffset, jdx));
            const offsetY = Math.max(-maxOffset, Math.min(maxOffset, jdy));
            joystickStick.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
        }
    }

    if (dx !== 0 || dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;

        if (player.dashDuration > 0) {
            player.vx = dx * player.dashSpeed;
            player.vy = dy * player.dashSpeed;
            player.dashDuration--;
        } else {
            player.vx += dx * player.acceleration;
            player.vy += dy * player.acceleration;
        }
    } else if (player.dashDuration > 0) {
        // Continue dash even if key released
        player.dashDuration--;
    }

    const currentSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    const maxSpeedLimit = player.dashDuration > 0 ? player.dashSpeed : moveSpeed;
    if (currentSpeed > maxSpeedLimit) {
        player.vx = (player.vx / currentSpeed) * maxSpeedLimit;
        player.vy = (player.vy / currentSpeed) * maxSpeedLimit;
    }

    player.vx *= player.friction;
    player.vy *= player.friction;

    player.x += player.vx;
    player.y += player.vy;

    const margin = player.radius;
    if (player.x < margin) {
        player.x = margin;
        player.vx *= -0.5;
    }
    if (player.x > canvas.width - margin) {
        player.x = canvas.width - margin;
        player.vx *= -0.5;
    }
    if (player.y < margin) {
        player.y = margin;
        player.vy *= -0.5;
    }
    if (player.y > canvas.height - margin) {
        player.y = canvas.height - margin;
        player.vy *= -0.5;
    }

    if (Math.abs(player.vx) > 0.5 || Math.abs(player.vy) > 0.5) {
        player.trail.push({
            x: player.x,
            y: player.y,
            life: player.dashDuration > 0 ? 45 : 30,
            isDash: player.dashDuration > 0
        });
    }

    if (player.trail.length > 50) player.trail.shift();
    for (let i = player.trail.length - 1; i >= 0; i--) {
        const t = player.trail[i];
        t.life--;
        if (t.life <= 0) player.trail.splice(i, 1);
    }

    if (player.dashCooldown > 0) {
        const dashPercent = ((45 - player.dashCooldown) / 45) * 100;
        dom.dashBar.style.width = dashPercent + '%';
        if (player.dashCooldown === 44) dom.dashStatus.classList.remove('hidden');
    } else {
        dom.dashBar.style.width = '100%';
    }

    if (player.shieldTime > 0) {
        player.shieldTime--;
        const shieldPercent = (player.shieldTime / 300) * 100;
        dom.shieldBar.style.width = shieldPercent + '%';
        if (player.shieldTime === 0) {
            player.shieldActive = false;
            dom.shieldStatus.classList.add('hidden');
        }
    }

    if (player.slowmoTime > 0) {
        player.slowmoTime--;
        const slowmoPercent = (player.slowmoTime / 360) * 100;
        dom.slowmoBar.style.width = slowmoPercent + '%';
        if (player.slowmoTime === 0) {
            player.slowmoActive = false;
            dom.slowmoStatus.classList.add('hidden');
        }
    }

    if (player.gravityTime > 0) {
        player.gravityTime--;
        const gravityPercent = (player.gravityTime / 300) * 100;
        dom.gravityBar.style.width = gravityPercent + '%';
        if (player.gravityTime === 0) {
            dom.gravityStatus.classList.add('hidden');
        }
    }

    // Update ghosts
    for (let i = player.ghosts.length - 1; i >= 0; i--) {
        player.ghosts[i].life--;
        if (player.ghosts[i].life <= 0) player.ghosts.splice(i, 1);
    }

    if (game.multiplierTimer > 0) {
        game.multiplierTimer--;
        if (game.multiplierTimer === 0) {
            game.multiplier = 1;
            dom.comboMeter.classList.add('hidden');
        }
    }
}

function updateProjectiles() {
    if (game.state !== 'playing') return;

    const timeScale = player.slowmoActive ? 0.4 : 1;
    applyGravityWell(timeScale);

    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];

        if (!proj) continue; // Safety check

        proj.pulse += 0.08 * timeScale;

        // Only tracker (cyan) homes in on player
        if (proj.type === 'tracker') {
            const dx = player.x - proj.x;
            const dy = player.y - proj.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 0) {
                const targetVx = (dx / dist) * proj.speed;
                const targetVy = (dy / dist) * proj.speed;
                proj.vx += (targetVx - proj.vx) * 0.06 * timeScale;
                proj.vy += (targetVy - proj.vy) * 0.06 * timeScale;
            }
        }
        
        if (proj.type === 'splitter') {
            proj.pulse += 0.08 * timeScale; // Slightly slower spin for clearer read
        }
        // Straight (magenta) and explosive (orange) move in straight line

        proj.x += proj.vx * timeScale;
        proj.y += proj.vy * timeScale;

        if (Math.abs(proj.vx) > 0.3 || Math.abs(proj.vy) > 0.3) {
            proj.trail.push({
                x: proj.x,
                y: proj.y,
                life: 24
            });
        }

        if (proj.trail.length > 24) proj.trail.shift();
        for (let t = proj.trail.length - 1; t >= 0; t--) {
            proj.trail[t].life--;
            if (proj.trail[t].life <= 0) proj.trail.splice(t, 1);
        }

        const distSq = (proj.x - proj.startX) * (proj.x - proj.startX) + (proj.y - proj.startY) * (proj.y - proj.startY);

        if (distSq > proj.maxRange * proj.maxRange) {
            createExplosion(proj.x, proj.y, proj.hue, 18);
            createLightning(proj.x, proj.y, proj.hue);
            projectiles.splice(i, 1);
            addScore(5);
            continue;
        }

        const playerDistSq = (player.x - proj.x) * (player.x - proj.x) + (player.y - proj.y) * (player.y - proj.y);
        const hitRadius = player.radius + proj.radius;

        if (playerDistSq < hitRadius * hitRadius) {
            if (player.shieldActive) {
                destroyProjectileAtIndex(i, {
                    points: 25,
                    textColor: '#00ffff',
                    spawnShockwave: proj.type === 'explosive',
                    safeShockwave: proj.type === 'explosive',
                    shake: 6,
                    sound: 'shield'
                });
                continue;
            }

            gameOver();
            return;
        }

        for (let j = i - 1; j >= 0; j--) {
            const other = projectiles[j];
            const dx2 = other.x - proj.x;
            const dy2 = other.y - proj.y;
            const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

            if (dist2 < proj.radius + other.radius) {
                // Impact effects
                createExplosion((proj.x + other.x) / 2, (proj.y + other.y) / 2, proj.hue, 15);
                playSfx('impact');
                game.shake = Math.min(game.shake + 8, 25);

                const handleSplit = (p) => {
                    // Splitter now behaves like a spinshuriken- triangle. Doesn't split unless desired
                    // Keep for possible future expansion or just remove split logic entirely
                };

                handleSplit(proj);
                handleSplit(other);

                if (proj.type === 'explosive' || other.type === 'explosive') {
                    createShockwave((proj.x + other.x) / 2, (proj.y + other.y) / 2);
                }

                projectiles.splice(i, 1);
                projectiles.splice(j, 1);

                const basePoints = 25;
                game.multiplier = Math.min(game.multiplier + 0.5, 8); // Higher cap
                game.multiplierTimer = 200 + game.wave * 5;
                
                const earned = Math.floor(basePoints * game.multiplier);
                addScore(basePoints);
                game.xp += 15;

                addFloatingText((proj.x + other.x) / 2, (proj.y + other.y) / 2, '+' + earned, game.multiplier > 5 ? '#ffec00' : '#fff');
                updateComboMeter();

                if (game.multiplier >= 5) {
                    showNotification('CRITICAL STREAK!', '#ffec00');
                    game.shake += 5;
                } else if (game.multiplier >= 3) {
                    showNotification('x' + game.multiplier.toFixed(1) + ' COMBO!', '#fff');
                }
                break;
            }
        }

        // Check collision with player ghosts
        for (let g = player.ghosts.length - 1; g >= 0; g--) {
            const ghost = player.ghosts[g];
            const gdx = ghost.x - proj.x;
            const gdy = ghost.y - proj.y;
            const gdist = Math.sqrt(gdx * gdx + gdy * gdy);
            if (gdist < ghost.radius + proj.radius) {
                createExplosion(proj.x, proj.y, proj.hue, 15);
                projectiles.splice(i, 1);
                addScore(50);
                playSfx('ghostKill');
                addFloatingText(ghost.x, ghost.y, 'GHOST KILL!', '#00f2ff');
                game.shake = 5;
                break;
            }
        }
    }
}

function updatePowerups() {
    if (game.state !== 'playing') return;

    for (let i = powerups.length - 1; i >= 0; i--) {
        const powerup = powerups[i];

        if (!powerup) continue; // Safety check

        powerup.life--;
        powerup.pulse += 0.1;

        if (powerup.life <= 0) {
            createExplosion(powerup.x, powerup.y, 60, 15);
            powerups.splice(i, 1);
            continue;
        }

        const dx = player.x - powerup.x;
        const dy = player.y - powerup.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < player.radius + powerup.radius) {
            activatePowerup(powerup.type);
            createExplosion(powerup.x, powerup.y, 120, 35);
            createLightning(powerup.x, powerup.y, 180);
            powerups.splice(i, 1);
        }
    }
}

function applyGravityWell(timeScale) {
    if (player.gravityTime <= 0) return;

    if (projectiles.length < 2) {
        for (const proj of projectiles) {
            proj.vx *= 0.9;
            proj.vy *= 0.9;
        }
        return;
    }

    const influenceRadius = 420;
    const influenceRadiusSq = influenceRadius * influenceRadius;
    const pullStrength = 0.11 * timeScale;
    const drag = 0.985;
    const accelerations = projectiles.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < projectiles.length; i++) {
        const a = projectiles[i];
        for (let j = i + 1; j < projectiles.length; j++) {
            const b = projectiles[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < 1 || distSq > influenceRadiusSq) continue;

            const dist = Math.sqrt(distSq);
            const closeness = (influenceRadius - dist) / influenceRadius;
            const pull = Math.max(0, closeness) * pullStrength;
            const nx = dx / dist;
            const ny = dy / dist;

            accelerations[i].x += nx * pull;
            accelerations[i].y += ny * pull;
            accelerations[j].x -= nx * pull;
            accelerations[j].y -= ny * pull;
        }
    }

    for (let i = 0; i < projectiles.length; i++) {
        const proj = projectiles[i];
        proj.vx += accelerations[i].x;
        proj.vy += accelerations[i].y;
        proj.vx *= drag;
        proj.vy *= drag;

        const speed = Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);
        const maxSpeed = proj.speed * 1.2;
        if (speed > maxSpeed) {
            const scale = maxSpeed / speed;
            proj.vx *= scale;
            proj.vy *= scale;
        }
    }
}

function destroyProjectileAtIndex(index, options = {}) {
    const proj = projectiles[index];
    if (!proj) return;

    const {
        points = 25,
        textColor = '#fff',
        floatingText = true,
        spawnShockwave = false,
        safeShockwave = false,
        particles = 20,
        lightning = true,
        shake = 6,
        sound = 'impact'
    } = options;

    const earned = Math.floor(points * game.multiplier);
    createExplosion(proj.x, proj.y, proj.hue, particles);

    if (lightning) {
        createLightning(proj.x, proj.y, proj.hue);
    }

    if (sound) {
        playSfx(sound);
    }

    if (spawnShockwave) {
        if (safeShockwave) {
            createShockwave(proj.x, proj.y, {
                dangerous: false,
                destroyProjectiles: true,
                hue: 28,
                maxRadius: 160,
                life: 26
            });
        } else {
            createShockwave(proj.x, proj.y);
        }
    }

    projectiles.splice(index, 1);
    addScore(points);

    if (floatingText) {
        addFloatingText(proj.x, proj.y, '+' + earned, textColor);
    }

    game.shake = Math.min(game.shake + shake, 24);
}

function activatePowerup(type) {
    if (type === 'shield') {
        player.shieldActive = true;
        player.shieldTime = 300;
        playSfx('shield');
        showNotification('SHIELD ACTIVE', '#00ffff');
        dom.shieldStatus.classList.remove('hidden');
        game.shake = 8;
    } else if (type === 'slowmo') {
        player.slowmoActive = true;
        player.slowmoTime = 360;
        playSfx('pickup');
        showNotification('SLOW MOTION', '#ffff00');
        dom.slowmoStatus.classList.remove('hidden');
        game.shake = 8;
    } else if (type === 'clear') {
        createShockwave(player.x, player.y, {
            dangerous: false,
            destroyProjectiles: true,
            hue: 28,
            maxRadius: 170,
            life: 28
        });
        createExplosion(player.x, player.y, 28, 20);
        createLightning(player.x, player.y, 28);
        playSfx('blast');
        showNotification('BLAST WAVE', '#ff8a00');
        game.shake = 18;
    } else if (type === 'gravity') {
        player.gravityTime = 300;
        playSfx('pickup');
        showNotification('GRAVITY WELL', '#00ff00');
        dom.gravityStatus.classList.remove('hidden');
        game.shake = 10;
    }
}

function addScore(points) {
    const earned = Math.floor(points * game.multiplier);
    game.score += earned;
}


function showNotification(text, color) {
    const item = {
        text,
        color,
        life: 180,
        y: 0,
        targetY: 0,
        scale: 1.0,
        targetScale: 1.0
    };
    notifications.unshift(item); // Add to top
    if (notifications.length > 5) notifications.pop();
}

function updateNotifications() {
    notifications.forEach((notif, i) => {
        notif.life--;
        // Stack on Z-axis visually: slight Y shift up, scale down
        notif.targetY = -(i * 20); 
        notif.targetScale = Math.max(0.6, 1.0 - (i * 0.15));
        
        notif.y += (notif.targetY - notif.y) * 0.12;
        notif.scale += (notif.targetScale - notif.scale) * 0.12;
    });
    for (let i = notifications.length - 1; i >= 0; i--) {
        if (notifications[i].life <= 0) notifications.splice(i, 1);
    }
}

function drawNotifications() {
    // Draw from oldest to newest so newest is on top
    for (let i = notifications.length - 1; i >= 0; i--) {
        const notif = notifications[i];
        
        const alpha = Math.min(notif.life / 40, 0.9) * (1.0 - (i * 0.15)); // Fade older ones
        if (alpha <= 0) continue;

        const baseDrawY = 220;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '400 36px "Bebas Neue"';
        ctx.textAlign = 'center';

        const textWidth = ctx.measureText(notif.text).width;
        const pad = 30;
        
        ctx.translate(canvas.width / 2, baseDrawY + notif.y);
        ctx.scale(notif.scale, notif.scale);
        
        // Z-stack tilt
        ctx.rotate((i % 2 === 0 ? 0.5 : -0.5) * Math.PI / 180);
        
        // Glassmorphism box
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        
        ctx.fillRect(-textWidth / 2 - pad, -35, textWidth + pad * 2, 55);
        ctx.strokeRect(-textWidth / 2 - pad, -35, textWidth + pad * 2, 55);

        ctx.fillStyle = '#000';
        ctx.fillText(notif.text, 0, 8);
        ctx.restore();
    }
}

function addFloatingText(x, y, text, color) {
    floatingTexts.push({
        x, y,
        text,
        color,
        life: 60,
        vy: -2
    });
}

function updateFloatingTexts() {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const text = floatingTexts[i];
        text.y += text.vy;
        text.life--;

        if (text.life <= 0) {
            floatingTexts.splice(i, 1);
        }
    }
}

function updateComboMeter() {
    dom.comboMeter.classList.remove('hidden');
    const comboText = `x${game.multiplier.toFixed(1)}`;
    if (dom.comboValue.textContent !== comboText) {
        dom.comboValue.textContent = comboText;
    }

    const barWidth = `${(game.multiplierTimer / 180) * 100}%`;
    if (dom.comboBar.style.width !== barWidth) {
        dom.comboBar.style.width = barWidth;
    }
}

function createLightning(x, y, hue) {
    const numBolts = 2 + Math.floor(Math.random() * 2);
    const angleStep = (Math.PI * 2) / numBolts;

    for (let i = 0; i < numBolts; i++) {
        const angle = angleStep * i + Math.random() * 0.4;
        const length = 70 + Math.random() * 80;
        const segments = 6;
        const segmentLength = length / segments;

        const points = [{ x, y }];
        let currentX = x;
        let currentY = y;

        for (let j = 0; j < segments; j++) {
            const offsetAngle = angle + (Math.random() - 0.5) * 0.6;
            currentX += Math.cos(offsetAngle) * segmentLength;
            currentY += Math.sin(offsetAngle) * segmentLength;
            points.push({ x: currentX, y: currentY });
        }

        lightningBolts.push({
            points,
            life: 6,
            hue: hue,
            width: 2 + Math.random()
        });
    }
}

function updateLightning() {
    if (lightningBolts.length === 0) return;
    for (let i = lightningBolts.length - 1; i >= 0; i--) {
        if (--lightningBolts[i].life <= 0) {
            lightningBolts.splice(i, 1);
        }
    }
}

// Shockwave system for explosive enemies
const shockwaves = [];

function createShockwave(x, y, options = {}) {
    shockwaves.push({
        x, y,
        radius: 10,
        maxRadius: options.maxRadius || 150,
        life: options.life || 30,
        hue: options.hue || 30,
        age: 0,  // Track age to prevent instant damage
        dangerous: options.dangerous !== false,
        destroyProjectiles: !!options.destroyProjectiles
    });
}

function updateShockwaves() {
    if (game.state !== 'playing') return;

    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];

        if (!sw) continue; // Safety check

        sw.radius += 6;
        sw.life--;
        sw.age++;

        // Only check collision after shockwave has expanded a bit (grace period)
        if (sw.age > 2) {
            if (sw.destroyProjectiles) {
                for (let p = projectiles.length - 1; p >= 0; p--) {
                    const proj = projectiles[p];
                    const dx = proj.x - sw.x;
                    const dy = proj.y - sw.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < sw.radius + proj.radius) {
                        destroyProjectileAtIndex(p, {
                            points: 25,
                            textColor: '#ff8a00',
                            spawnShockwave: false,
                            lightning: true,
                            shake: 4,
                            sound: null
                        });
                    }
                }
            }

            if (sw.dangerous) {
                // Check if player hits shockwave
                const dx = player.x - sw.x;
                const dy = player.y - sw.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Shockwave damages if player is within the outer 20px ring.
                // When shockwave is small (< 20px), the whole shockwave is dangerous.
                const innerRadius = Math.max(0, sw.radius - 20);
                if (dist < sw.radius + player.radius && dist > innerRadius && !player.shieldActive) {
                    gameOver();
                    return;
                }
            }
        }

        if (sw.life <= 0) {
            shockwaves.splice(i, 1);
        }
    }
}

function drawShockwaves() {
    shockwaves.forEach(sw => {
        const alpha = sw.life / 30;
        ctx.save();
        ctx.setLineDash([12, 10]);
        ctx.lineCap = 'round';
        ctx.strokeStyle = `hsla(28, 100%, 52%, ${alpha})`;
        ctx.lineWidth = 5;
        ctx.shadowBlur = 18;
        ctx.shadowColor = `hsla(22, 100%, 48%, ${alpha})`;

        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `hsla(18, 100%, 82%, ${alpha * 0.75})`;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    });
}

function drawLightning() {
    lightningCtx.clearRect(0, 0, lightningCanvas.width, lightningCanvas.height);

    if (lightningBolts.length === 0) return;

    lightningCtx.lineCap = 'round';
    lightningCtx.lineJoin = 'round';

    lightningBolts.forEach(bolt => {
        const alpha = bolt.life / 6;

        lightningCtx.strokeStyle = `hsla(${bolt.hue}, 100%, 70%, ${alpha * 0.8})`;
        lightningCtx.lineWidth = bolt.width;
        lightningCtx.shadowBlur = 10;
        lightningCtx.shadowColor = `hsla(${bolt.hue}, 100%, 60%, ${alpha * 0.5})`;

        lightningCtx.beginPath();
        lightningCtx.moveTo(bolt.points[0].x, bolt.points[0].y);
        for (let i = 1; i < bolt.points.length; i++) {
            lightningCtx.lineTo(bolt.points[i].x, bolt.points[i].y);
        }
        lightningCtx.stroke();
    });

    lightningCtx.shadowBlur = 0;
}

function createExplosion(x, y, hue, count) {
    const actualCount = Math.min(count, 12);
    const angleStep = (Math.PI * 2) / actualCount;
    for (let i = 0; i < actualCount; i++) {
        const angle = angleStep * i + Math.random() * 0.3;
        const speed = Math.random() * 5 + 2;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            hue: hue,
            size: Math.random() * 5 + 2
        });
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.life -= 0.02;
        p.size *= 0.95;

        if (p.life <= 0) particles.splice(i, 1);
    }
}

function updateBackground() {
    bgParticles.forEach(p => {
        p.y += p.speed;
        p.twinkle += 0.06;
        if (p.y > canvas.height) {
            p.y = 0;
            p.x = Math.random() * canvas.width;
        }
    });
}

function drawBackground() {
    // We let the CSS background-color (--primary-bg) show through
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (bgTextureCanvas.width > 0 && bgTextureCanvas.height > 0) {
        ctx.drawImage(bgTextureCanvas, 0, 0);
    }

    for (let i = 0; i < bgParticles.length; i++) {
        const p = bgParticles[i];
        const twinkleAlpha = p.opacity * (0.6 + Math.sin(p.twinkle) * 0.4);
        ctx.fillStyle = `hsla(${p.hue}, 100%, 40%, ${twinkleAlpha * 0.4})`; // Darker particles on light bg
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPlayer() {
    // Check splitter slow indicators to draw connection lines
    projectiles.forEach(proj => {
        if (proj.type === 'splitter') {
            const adx = player.x - proj.x;
            const ady = player.y - proj.y;
            const adist = Math.sqrt(adx * adx + ady * ady);
            if (adist < 180) {
                ctx.save();
                ctx.strokeStyle = `rgba(0, 255, 0, ${0.4 + Math.sin(Date.now()*0.01)*0.2})`;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(player.x, player.y);
                ctx.lineTo(proj.x, proj.y);
                ctx.stroke();
                ctx.restore();
            }
        }
    });

    // Draw trail as soft colorful bubbles
    player.trail.forEach((t, i) => {
        const alpha = (t.life / 30) * 0.2;
        const size = player.radius * (0.4 + (t.life / 30) * 0.6);
        ctx.fillStyle = `hsla(190, 100%, 50%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, size, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw ghosts
    player.ghosts.forEach(g => {
        const alpha = (g.life / 60) * 0.4;
        ctx.fillStyle = `rgba(0, 242, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    });

    const time = Date.now() * 0.002;
    const bounce = Math.sin(time) * 2;

    if (player.shieldActive) {
        const shieldPulse = Math.sin(Date.now() * 0.01) * 0.15 + 0.85;
        const shieldRadius = player.radius * 2.2;

        ctx.save();
        ctx.beginPath();
        ctx.arc(player.x, player.y, shieldRadius, 0, Math.PI * 2);
        const shieldGrad = ctx.createRadialGradient(player.x, player.y, shieldRadius * 0.7, player.x, player.y, shieldRadius);
        shieldGrad.addColorStop(0, 'rgba(0, 255, 255, 0)');
        shieldGrad.addColorStop(1, `rgba(0, 255, 255, ${0.4 * shieldPulse})`);
        ctx.fillStyle = shieldGrad;
        ctx.fill();
        
        ctx.strokeStyle = `rgba(0, 0, 0, 1)`;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
    }

    ctx.save();
    ctx.translate(player.x, player.y + bounce);
    
    // Main Body - Rounded & Colorful
    const grad = ctx.createLinearGradient(-player.radius, -player.radius, player.radius, player.radius);
    grad.addColorStop(0, player.dashDuration > 0 ? '#fff' : '#00f2ff');
    grad.addColorStop(1, player.dashDuration > 0 ? '#00f2ff' : '#0062ff');
    
    if (player.dashDuration > 0) {
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#fff';
    } else {
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'rgba(0, 150, 255, 0.5)';
    }
    
    // Outer Border (Brutalist style but rounded)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Fill
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(-player.radius * 0.3, -player.radius * 0.3, player.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

function drawProjectile(proj) {
    // Trail as soft colorful bubbles
    proj.trail.forEach((t, i) => {
        const alpha = (t.life / 24) * 0.15;
        const size = proj.radius * (0.4 + (t.life / 24) * 0.4);
        ctx.fillStyle = `hsla(${proj.hue}, 100%, 50%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, size, 0, Math.PI * 2);
        ctx.fill();
    });

    const pulseSize = proj.radius * (1 + Math.sin(proj.pulse) * 0.1);

    ctx.save();
    ctx.translate(proj.x, proj.y);
    
    // Shadow
    ctx.shadowBlur = 10;
    ctx.shadowColor = `hsla(${proj.hue}, 100%, 50%, 0.4)`;

    // Rounded Colorful Shape
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, pulseSize);
    grad.addColorStop(0, `hsla(${proj.hue}, 100%, 80%, 1)`);
    grad.addColorStop(1, `hsla(${proj.hue}, 100%, 50%, 1)`);
    
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    
    if (proj.type === 'straight') {
        // Rounded pill shape
        const angle = Math.atan2(proj.vy, proj.vx);
        ctx.rotate(angle);
        ctx.beginPath();
        const width = pulseSize * 1.5;
        const height = pulseSize;
        ctx.roundRect(-width, -height, width * 2, height * 2, height);
        ctx.fill();
        ctx.stroke();
    } else if (proj.type === 'explosive') {
        // Spiky but rounded star
        ctx.beginPath();
        const points = 8;
        for (let i = 0; i < points * 2; i++) {
            const r = i % 2 === 0 ? pulseSize * 1.2 : pulseSize * 0.8;
            const a = (i * Math.PI) / points + proj.pulse * 0.5;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.bezierCurveTo(x * 0.8, y * 0.8, x, y, x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (proj.type === 'splitter') {
        // SPINNING SHURIKEN (Green Triangle)
        ctx.beginPath();
        const segments = 3;
        for (let i = 0; i < segments; i++) {
            const a = (i * Math.PI * 2) / segments + proj.pulse;
            const x = Math.cos(a) * pulseSize * 1.4;
            const y = Math.sin(a) * pulseSize * 1.4;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = `hsl(${proj.hue}, 100%, 50%)`;
        ctx.fill();
        ctx.stroke();
    } else {
        // Normal rounded sphere (tracker)
        ctx.beginPath();
        ctx.arc(0, 0, pulseSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
}

function drawPowerup(powerup) {
    const pulseSize = powerup.radius * (1 + Math.sin(powerup.pulse) * 0.18);

    let symbol;
    if (powerup.type === 'shield') {
        symbol = '🛡️';
    } else if (powerup.type === 'slowmo') {
        symbol = '⏱️';
    } else if (powerup.type === 'gravity') {
        symbol = '🌀';
    } else {
        symbol = '💥';
    }

    ctx.save();
    ctx.translate(powerup.x, powerup.y);

    const wheelColors = ['#ff4d4d', '#ff9f1c', '#ffe45e', '#7dff6b', '#4de3ff', '#4d7cff', '#b44dff', '#ff4dd8'];
    const slices = wheelColors.length;
    const sliceAngle = (Math.PI * 2) / slices;

    ctx.shadowBlur = 12;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    for (let i = 0; i < slices; i++) {
        const start = -Math.PI / 2 + i * sliceAngle;
        const end = start + sliceAngle;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, pulseSize, start, end);
        ctx.closePath();
        ctx.fillStyle = wheelColors[i];
        ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, pulseSize, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.beginPath();
    ctx.arc(-pulseSize * 0.28, -pulseSize * 0.28, pulseSize * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(0, 0, pulseSize * 0.26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(0, 0, pulseSize * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `${pulseSize * 1.0}px "Segoe UI Emoji", "Apple Color Emoji", Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.strokeText(symbol, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillText(symbol, 0, 0);
    ctx.restore();
}

function drawParticle(p) {
    ctx.fillStyle = `hsla(${p.hue}, 100%, 50%, ${p.life})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    // Tiny black border for brutalist pop
    ctx.strokeStyle = `rgba(0, 0, 0, ${p.life * 0.5})`;
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawFloatingText(text) {
    const alpha = text.life / 60;
    ctx.font = '800 28px "Outfit"';
    ctx.fillStyle = text.color;
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    
    // Black outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(text.text, text.x, text.y);
    
    ctx.fillText(text.text, text.x, text.y);
    ctx.globalAlpha = 1;
}

function updateUI() {
    const seconds = Math.floor(game.survived / 60);
    const timeText = `${seconds}s`;
    const scoreText = `${game.score}`;

    if (timeText !== lastUiTime) {
        dom.time.textContent = timeText;
        lastUiTime = timeText;
    }
    if (scoreText !== lastUiScore) {
        dom.score.textContent = scoreText;
        lastUiScore = scoreText;
    }

    if (game.multiplier > 1) {
        updateComboMeter();
    }
}

function renderLoop() {
    // 1. ALWAYS UPDATE BACKGROUND / RIPPLES
    updateBackground();
    updateClickRipples();
    updateNotifications();

    if (game.state === 'playing') {
        game.time++;
        game.survived++;
        spawnTimer++;
        powerupTimer++;
        game.waveTimer++;

        difficulty = getThreatLevel();

        let spawnRateMultiplier = 1;
        if (game.difficulty === 'easy') spawnRateMultiplier = 1.4;
        else if (game.difficulty === 'hard') spawnRateMultiplier = 0.75;

        spawnRate = Math.max(18, Math.round((112 - difficulty * 7.5) * spawnRateMultiplier));

        if (spawnTimer > spawnRate) {
            spawnProjectile();
            spawnTimer = 0;
        }

        if (game.waveTimer >= 1800) { // 30 seconds
            game.wave++;
            game.waveTimer = 0;
            showNotification(`WAVE ${game.wave} COMMENCED`, '#00ff00');
            game.shake = 18;
        }

        const powerupInterval = Math.max(420, Math.round(760 - difficulty * 18));
        if (powerupTimer > powerupInterval && powerups.length < 3) {
            spawnPowerup();
            powerupTimer = 0;
        }

        updatePlayer();
        updateProjectiles();
        updatePowerups();
        updateParticles();
        updateFloatingTexts();
        updateLightning();
        updateShockwaves();
        updateUI();
    }

    // 2. ALWAYS DRAW
    ctx.save();
    
    if (game.shake > 0) {
        ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
        game.shake *= 0.9;
        if (game.shake < 0.1) game.shake = 0;
    }

    drawBackground();
    drawClickRipples();

    if (game.state === 'playing') {
        particles.forEach(drawParticle);
        powerups.forEach(drawPowerup);
        drawPlayer();
        projectiles.forEach(drawProjectile);
        drawShockwaves();
        
        if (player.slowmoActive) {
            ctx.fillStyle = 'rgba(0, 100, 255, 0.05)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        floatingTexts.forEach(drawFloatingText);
    }
    
    drawNotifications();
    ctx.restore();

    // Always draw ripples and lightning to the overlay canvas
    if (game.state === 'playing') {
        drawLightning();
    } else {
        // Clear the lightning canvas when not playing to remove old effects
        lightningCtx.clearRect(0, 0, lightningCanvas.width, lightningCanvas.height);
    }
    
    // Always draw click ripples on top, regardless of game state
    drawClickRipples();

    animationId = requestAnimationFrame(renderLoop);
}

// Start main rendering loop immediately
if (animationId) cancelAnimationFrame(animationId);
renderLoop();

function gameOver() {
    game.state = 'gameOver';
    playSfx('gameOver');
    // richer game over sound
    playGameOverSound();
    const seconds = Math.floor(game.survived / 60);

    // Clear all visual elements immediately
    notifications.length = 0;
    floatingTexts.length = 0;
    game.mobileDashQueued = false;
    mobileDashPointerId = null;
    mobileJoystickPointerId = null;
    resetJoystick();
    if (dashButton) dashButton.classList.remove('is-active');

    // Hide all status UI elements
    dom.slowmoStatus.classList.add('hidden');
    dom.shieldStatus.classList.add('hidden');
    dom.dashStatus.classList.add('hidden');
    dom.comboMeter.classList.add('hidden');

    // Clear canvases to remove any lingering effects
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lightningCtx.clearRect(0, 0, lightningCanvas.width, lightningCanvas.height);

    const previousBest = readStoredScore();
    const isNewRecord = game.score > previousBest;
    game.highScore = isNewRecord ? game.score : previousBest;

    if (isNewRecord) {
        localStorage.setItem('highScore', String(game.score));
    }
    dom.newRecord.classList.toggle('hidden', !isNewRecord);

    dom.highScoreMenu.textContent = `Best: ${game.highScore}`;

    dom.finalTime.textContent = `Time: ${seconds}s`;
    dom.finalScore.textContent = `Score: ${game.score}`;
    dom.highScoreDisplay.textContent = `Best: ${game.highScore}`;
    dom.gameOverScreen.classList.remove('hidden');
}
