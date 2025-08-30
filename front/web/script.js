// Simple seeded RNG (mulberry32)
function rngMulberry32(seed) {
    let t = seed >>> 0;
    return function() {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

class ConcentrationGame {
    constructor() {
        this.numbers = [];
        this.currentTarget = 1;
        this.startTime = null;
        this.timerInterval = null;
        this.gameStarted = false;
        this.gameComplete = false;
        this.particles = [];
        this.particleSystem = null;
        this.isMultiplayer = false;
        this.opponentProgress = 0;
        this.myScore = 0;
        this.opponentScore = 0;
        this.myFoundNumbers = new Set();
        this.opponentFoundNumbers = new Set();
        this.myNick = null;
        this.opponentNick = null;
        this.isHost = false;
        this.roomCode = null;
        this.roomId = null;
        this.ready = false;
        this.mpConnected = false;
        this.pendingStart = null; // {seed, startAt}
        this.pendingReadyState = null; // Track pending ready state changes
        
        this.initializeElements();
        this.bindEvents();
        this.loadScores();
        this.initParticleSystem();
        this.initSoundEffects();
        this.startBackgroundAnimations();

        this.initMultiplayer();
        
        // Auto-connect to check for ongoing game session
        setTimeout(() => {
            if (this.mp && !this.gameStarted) {
                this.mp.connect();
            }
            // Also check for solo game state
            this.checkForSoloGameState();
        }, 100);
    }

    initializeElements() {
        this.startBtn = document.getElementById('startBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.scoresBtn = document.getElementById('scoresBtn');
        this.leaveSessionBtn = document.getElementById('leaveSessionBtn');
        this.playAgainBtn = document.getElementById('playAgainBtn');
        this.closeScoresBtn = document.getElementById('closeScoresBtn');
        
        this.gameGrid = document.getElementById('gameGrid');
        this.currentTargetEl = document.getElementById('currentTarget');
        this.timerEl = document.getElementById('timer');
        this.progressEl = document.getElementById('progress');
        this.gameCompleteEl = document.getElementById('gameComplete');
        this.finalTimeEl = document.getElementById('finalTime');
        this.scoreboardEl = document.getElementById('scoreboard');
        this.scoresListEl = document.getElementById('scoresList');
        
        // Multiplayer score elements
        this.multiplayerScoresEl = document.getElementById('multiplayerScores');
        this.myScoreEl = document.getElementById('myScore');
        this.opponentScoreEl = document.getElementById('opponentScore');
        this.opponentScoreLabelEl = document.getElementById('opponentScoreLabel');

        // Modal elements
        this.modal = document.getElementById('gameModeModal');
        this.closeModal = document.getElementById('closeModal');
        this.soloTab = document.getElementById('soloTab');
        this.multiTab = document.getElementById('multiTab');
        this.soloPanel = document.getElementById('soloPanel');
        this.multiPanel = document.getElementById('multiPanel');
        this.startSoloBtn = document.getElementById('startSoloBtn');
        
        // New MP step-by-step UI
        this.mpTypeSelector = document.getElementById('mpTypeSelector');
        this.mpPrivateRoom = document.getElementById('mpPrivateRoom');
        this.mpRoomLobby = document.getElementById('mpRoomLobby');
        this.mpConnecting = document.getElementById('mpConnecting');
        
        // Step navigation
        this.backToTypes = document.getElementById('backToTypes');
        this.backFromRoom = document.getElementById('backFromRoom');
        
        // Type selection
        this.quickMatchCard = document.getElementById('quickMatchCard');
        this.privateRoomCard = document.getElementById('privateRoomCard');
        
        // Room actions
        this.createRoomBtn = document.getElementById('createRoomBtn');
        this.joinRoomBtn = document.getElementById('joinRoomBtn');
        this.createNameInput = document.getElementById('createNameInput');
        this.joinNameInput = document.getElementById('joinNameInput');
        this.roomCodeInput = document.getElementById('roomCodeInput');
        
        // Room lobby
        this.roomCodeDisplay = document.getElementById('roomCodeDisplay');
        this.displayedRoomCode = document.getElementById('displayedRoomCode');
        this.copyCodeBtn = document.getElementById('copyCodeBtn');
        this.myStatus = document.getElementById('myStatus');
        this.opponentName = document.getElementById('opponentName');
        this.opponentReady = document.getElementById('opponentReady');
        this.readyBtn = document.getElementById('readyBtn');
        this.startMatchBtn = document.getElementById('startMatchBtn');
        this.lobbyStatus = document.getElementById('lobbyStatus');
        
        // Connecting screen
        this.connectingTitle = document.getElementById('connectingTitle');
        this.connectingDesc = document.getElementById('connectingDesc');
        this.cancelSearch = document.getElementById('cancelSearch');
    }

    bindEvents() {
        // Prevent zoom on double tap
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function (event) {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, {passive: false});
        
        // Prevent context menu on long press
        document.addEventListener('contextmenu', function (event) {
            event.preventDefault();
        }, {passive: false});

        this.startBtn.addEventListener('click', () => this.showModal());
        this.resetBtn.addEventListener('click', () => this.resetGame());
        this.scoresBtn.addEventListener('click', () => this.showScoreboard());
        this.playAgainBtn.addEventListener('click', () => this.resetGame());
        this.closeScoresBtn.addEventListener('click', () => this.hideScoreboard());
        if (this.leaveSessionBtn) {
            this.leaveSessionBtn.addEventListener('click', () => this.quitSession());
        }

        // Modal controls
        this.closeModal.addEventListener('click', () => this.hideModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hideModal();
        });
        
        // Tab controls
        this.soloTab.addEventListener('click', () => this.switchTab('solo'));
        this.multiTab.addEventListener('click', () => this.switchTab('multi'));
        
        // Solo mode
        this.startSoloBtn.addEventListener('click', () => {
            this.hideModal();
            this.isMultiplayer = false;
            this.updateMultiplayerScores(); // Hide multiplayer scores in solo mode
            this.startGame();
        });
        
        // MP Step navigation
        this.backToTypes.addEventListener('click', () => this.showMpStep('type'));
        this.backFromRoom.addEventListener('click', () => this.leaveMpRoom());
        
        // Type selection
        document.querySelectorAll('.btn-type-select').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.target.dataset.type;
                this.handleMpTypeSelection(type);
            });
        });
        
        // Room actions
        this.createRoomBtn.addEventListener('click', () => this.createMpRoom());
        this.joinRoomBtn.addEventListener('click', () => this.joinMpRoom());
        this.copyCodeBtn.addEventListener('click', () => this.copyRoomCode());
        
        // Lobby actions
        this.readyBtn.addEventListener('click', () => this.toggleReady());
        this.startMatchBtn.addEventListener('click', () => this.startMpMatch());
        
        // Cancel search
        this.cancelSearch.addEventListener('click', () => this.cancelMpSearch());
    }

    generateNumbers(seed = null) {
        this.numbers = [];
        for (let i = 1; i <= 100; i++) {
            this.numbers.push(i);
        }
        if (seed == null) {
            this.shuffleArray(this.numbers);
        } else {
            this.seededShuffle(this.numbers, seed >>> 0);
        }
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    seededShuffle(array, seed) {
        const rnd = rngMulberry32(seed >>> 0);
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    createGrid() {
        this.gameGrid.innerHTML = '';
        this.numbers.forEach((number, index) => {
            const card = document.createElement('button');
            card.className = 'number-card';
            card.textContent = number;
            card.dataset.number = number;
            card.style.setProperty('--index', index);
            card.addEventListener('click', () => this.handleCardClick(card));
            
            this.gameGrid.appendChild(card);
        });
    }

    handleCardClick(card) {
        if (!this.gameStarted || this.gameComplete) return;
        // Prevent double/triple-click races on already-processed cards
        if (card.disabled || card.classList.contains('my-found') || card.classList.contains('opponent-found') || card.classList.contains('found')) {
            return;
        }
        
        const clickedNumber = parseInt(card.dataset.number);
        
        if (clickedNumber === this.currentTarget) {
            // Immediately disable this card to avoid duplicate processing
            card.disabled = true;
            card.setAttribute('aria-disabled', 'true');
            this.playSound('correct');
            this.vibrateDevice(50);
            card.classList.add('correct-click');
            this.createSuccessParticles(card);
            // In multiplayer, notify the server immediately to minimize race windows
            if (this.isMultiplayer && this.mpConnected) {
                this.mp?.sendProgress(clickedNumber);
            }
            
            setTimeout(() => {
                card.classList.remove('correct-click');
                
                if (this.isMultiplayer && this.mpConnected) {
                    // No local changes here; wait for server broadcast to update UI/state
                } else {
                    // In solo mode, handle progression locally
                    card.classList.add('found');
                    // Use the clicked number; previous code referenced an undefined variable
                    this.myFoundNumbers.add(clickedNumber);
                    this.currentTarget++;
                    this.updateProgress();
                    
                    // Save game state after each progress
                    this.saveGameState();
                    
                    if (this.currentTarget > 100) {
                        this.completeGame();
                    }
                }
            }, 400);
        } else {
            this.playSound('error');
            this.vibrateDevice(100);
            this.createErrorParticles(card);
            card.classList.add('shake-error');
            setTimeout(() => {
                card.classList.remove('shake-error');
            }, 600);
        }
    }

    updateProgress() {
        this.currentTargetEl.textContent = this.currentTarget;
        this.progressEl.textContent = `${this.currentTarget - 1}/100`;
    }

    updateMultiplayerScores() {
        if (this.isMultiplayer && this.multiplayerScoresEl) {
            this.multiplayerScoresEl.classList.remove('hidden');
            this.myScoreEl.textContent = this.myScore;
            this.opponentScoreEl.textContent = this.opponentScore;
            
            // Update labels with player names if available
            const myLabel = this.multiplayerScoresEl.querySelector('.player-score.me .score-label');
            const opponentLabel = this.multiplayerScoresEl.querySelector('.player-score.opponent .score-label');
            
            if (myLabel) {
                myLabel.textContent = this.myNick || 'VOUS';
            }
            if (opponentLabel) {
                opponentLabel.textContent = this.opponentNick || 'ADVERSAIRE';
            }
        } else if (this.multiplayerScoresEl) {
            this.multiplayerScoresEl.classList.add('hidden');
        }
    }

    markOpponentFound(number) {
        // Find the card with this number and mark it as opponent-found
        const cards = this.gameGrid.querySelectorAll('.number-card');
        cards.forEach(card => {
            if (parseInt(card.dataset.number) === number) {
                card.classList.add('opponent-found');
            }
        });
    }

    updateConnectionUI() {
        // Update any connection-related UI elements
        // This method can be extended to show connection status, ping, etc.
        if (this.isMultiplayer && this.lobbyStatus && this.gameStarted) {
            const myName = this.myNick || 'Vous';
            const opponentName = this.opponentNick || 'Adversaire';
            this.lobbyStatus.textContent = `🎯 En jeu - ${myName}: ${this.myScore} | ${opponentName}: ${this.opponentScore}`;
        }
    }

    startGame(options = {}) {
        // options: { seed?: number, startAt?: number }
        const seed = typeof options.seed === 'number' ? options.seed : null;
        const startAt = typeof options.startAt === 'number' ? options.startAt : null;

        this.generateNumbers(seed);
        this.createGrid();
        this.currentTarget = 1;
        this.gameComplete = false;
        this.startBtn.style.display = 'none';
        this.gameCompleteEl.classList.add('hidden');
        this.updateProgress();

        if (startAt) {
            // Schedule synchronized start
            this.startTime = startAt;
            this.gameStarted = false; // block clicks until start
            const delay = Math.max(0, startAt - Date.now());
            setTimeout(() => {
                this.gameStarted = true;
                this.startTimer();
            }, delay);
        } else {
            this.gameStarted = true;
            this.startTime = Date.now();
            this.startTimer();
            // Save initial game state for solo games
            if (!this.isMultiplayer) {
                this.saveGameState();
            }
        }
        this.updateMpVisibility();
    }

    // Render helper for resume flows (alias to createGrid)
    renderGrid() {
        this.createGrid();
    }

    // Minimal UI refresh after resuming a game (solo or multi)
    updateUI() {
        // Hide start button and completion banner while a game is active
        if (this.startBtn) this.startBtn.style.display = 'none';
        if (this.gameCompleteEl) this.gameCompleteEl.classList.add('hidden');
        // Update progress counters
        this.updateProgress();
        // Ensure multiplayer score visibility reflects current mode
        this.updateMultiplayerScores();
        // Optionally refresh any connection-related text
        this.updateConnectionUI?.();
    }

    resetGame() {
        this.gameStarted = false;
        this.gameComplete = false;
        this.currentTarget = 1;
        this.myScore = 0;
        this.opponentScore = 0;
        this.myFoundNumbers.clear();
        this.opponentFoundNumbers.clear();
        // Don't reset nicknames as they persist through games
        
        // Clear saved game state when resetting
        this.clearGameState();
        
        this.startBtn.style.display = 'inline-block';
        this.gameCompleteEl.classList.add('hidden');
        this.hideScoreboard();
        
        this.gameGrid.innerHTML = '';
        this.timerEl.textContent = '00:00:00.00';
        this.updateProgress();
        this.updateMultiplayerScores();
        
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            if (this.gameStarted && !this.gameComplete) {
                const now = Date.now();
                const elapsed = Math.max(0, (now - this.startTime) / 1000);
                this.timerEl.textContent = this.formatTime(elapsed);
            }
        }, 10);
    }

    completeGame() {
        this.gameComplete = true;
        this.gameStarted = false;
        clearInterval(this.timerInterval);
        
        // Clear saved game state since game is complete
        this.clearGameState();
        
        const finalTime = (Date.now() - this.startTime) / 1000;
        this.finalTimeEl.textContent = this.formatTime(finalTime);
        
        this.createVictoryFireworks();
        
        setTimeout(() => {
            this.gameCompleteEl.classList.remove('hidden');
        }, 1000);
        
        // In multiplayer, winner is announced by server; still save personal time
        this.saveScore(finalTime);
        this.startBtn.style.display = 'inline-block';
    }

    saveScore(time) {
        let scores = JSON.parse(localStorage.getItem('concentrationScores') || '[]');
        
        const now = new Date();
        const newScore = {
            time: time,
            date: now.toLocaleDateString('fr-FR'),
            timeOfDay: now.toLocaleTimeString('fr-FR'),
            fullDateTime: now.toLocaleString('fr-FR'),
            timestamp: Date.now()
        };
        
        scores.push(newScore);
        scores.sort((a, b) => a.time - b.time);
        scores = scores.slice(0, 10);
        
        localStorage.setItem('concentrationScores', JSON.stringify(scores));
        this.loadScores();
    }

    loadScores() {
        this.scores = JSON.parse(localStorage.getItem('concentrationScores') || '[]');
    }

    showScoreboard() {
        this.loadScores();
        this.renderScores();
        this.scoreboardEl.classList.remove('hidden');
    }

    hideScoreboard() {
        this.scoreboardEl.classList.add('hidden');
    }

    renderScores() {
        if (this.scores.length === 0) {
            this.scoresListEl.innerHTML = '<p style="text-align: center; color: #ccc;">Aucun score enregistré</p>';
            return;
        }

        this.scoresListEl.innerHTML = this.scores.map((score, index) => `
            <div class="score-item">
                <div class="score-info">
                    <span class="score-rank">#${index + 1}</span>
                    <span class="score-time">${this.formatTime(score.time)}</span>
                </div>
                <div class="score-datetime">
                    <span class="score-date">${score.date}</span>
                    <span class="score-time-of-day">${score.timeOfDay || score.fullDateTime || ''}</span>
                </div>
            </div>
        `).join('');
    }

    // Advanced effects system
    initParticleSystem() {
        this.particles = [];
        this.particleCanvas = document.createElement('canvas');
        this.particleCanvas.style.position = 'fixed';
        this.particleCanvas.style.top = '0';
        this.particleCanvas.style.left = '0';
        this.particleCanvas.style.width = '100%';
        this.particleCanvas.style.height = '100%';
        this.particleCanvas.style.pointerEvents = 'none';
        this.particleCanvas.style.zIndex = '1000';
        document.body.appendChild(this.particleCanvas);
        
        this.particleCtx = this.particleCanvas.getContext('2d');
        this.resizeCanvas();
        
        window.addEventListener('resize', () => this.resizeCanvas());
        this.animateParticles();
    }

    resizeCanvas() {
        this.particleCanvas.width = window.innerWidth;
        this.particleCanvas.height = window.innerHeight;
    }

    initSoundEffects() {
        this.audioContext = null;
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) {
            console.log('Audio not supported');
        }
    }

    playSound(type) {
        if (!this.audioContext) return;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        if (type === 'correct') {
            oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + 0.2);
        } else if (type === 'error') {
            oscillator.frequency.setValueAtTime(200, this.audioContext.currentTime);
            oscillator.type = 'sawtooth';
            gainNode.gain.setValueAtTime(0.2, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + 0.3);
        }
    }

    vibrateDevice(pattern) {
        if ('vibrate' in navigator) {
            navigator.vibrate(pattern);
        }
    }

    createSuccessParticles(card) {
        const rect = card.getBoundingClientRect();
        const colors = ['#28a745', '#fff', '#000'];
        
        for (let i = 0; i < 15; i++) {
            setTimeout(() => {
                this.createParticle(
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2,
                    colors[Math.floor(Math.random() * colors.length)],
                    4 + Math.random() * 4
                );
            }, i * 20);
        }
    }

    createErrorParticles(card) {
        const rect = card.getBoundingClientRect();
        const colors = ['#dc3545', '#fff', '#000'];
        
        for (let i = 0; i < 10; i++) {
            this.createParticle(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                colors[Math.floor(Math.random() * colors.length)],
                3 + Math.random() * 3
            );
        }
    }

    createVictoryFireworks() {
        const colors = ['#28a745', '#dc3545', '#fff', '#000', '#666'];
        
        for (let burst = 0; burst < 8; burst++) {
            setTimeout(() => {
                const x = Math.random() * window.innerWidth;
                const y = Math.random() * window.innerHeight * 0.7;
                
                for (let i = 0; i < 25; i++) {
                    this.createParticle(
                        x, y,
                        colors[Math.floor(Math.random() * colors.length)],
                        6 + Math.random() * 6
                    );
                }
            }, burst * 200);
        }
    }

    createParticle(x, y, color, size) {
        const particle = {
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15 - 5,
            color: color,
            size: size,
            life: 1,
            decay: Math.random() * 0.015 + 0.01,
            shape: Math.random() > 0.5 ? 'circle' : 'square'
        };
        this.particles.push(particle);
    }

    animateParticles() {
        this.particleCtx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.3; // gravity
            p.vx *= 0.99; // air resistance
            p.life -= p.decay;
            
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            
            this.particleCtx.save();
            this.particleCtx.globalAlpha = p.life;
            this.particleCtx.fillStyle = p.color;
            
            if (p.shape === 'circle') {
                this.particleCtx.beginPath();
                this.particleCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.particleCtx.fill();
            } else {
                this.particleCtx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
            }
            
            this.particleCtx.restore();
        }
        
        requestAnimationFrame(() => this.animateParticles());
    }

    startBackgroundAnimations() {
        // Pulsing target animation
        setInterval(() => {
            if (this.gameStarted && !this.gameComplete) {
                this.currentTargetEl.style.animation = 'none';
                setTimeout(() => {
                    this.currentTargetEl.style.animation = 'targetPulse 1.5s ease-in-out';
                }, 10);
            }
        }, 1500);
    }
    
    // Modal management
    showModal() {
        this.modal.classList.add('show');
    }
    
    hideModal() {
        this.modal.classList.remove('show');
    }
    
    switchTab(tab) {
        if (tab === 'solo') {
            this.soloTab.classList.add('active');
            this.multiTab.classList.remove('active');
            this.soloPanel.classList.add('active');
            this.multiPanel.classList.remove('active');
        } else {
            this.multiTab.classList.add('active');
            this.soloTab.classList.remove('active');
            this.multiPanel.classList.add('active');
            this.soloPanel.classList.remove('active');
        }
    }
    
    // New MP flow management
    showMpStep(step) {
        // Ensure modal is open when we need to show a multiplayer step (e.g., after refresh)
        if (this.modal && !this.modal.classList.contains('show')) {
            this.showModal();
        }
        if (!this.modal) return;
        
        // Hide all steps
        document.querySelectorAll('.mp-step').forEach(s => s.classList.remove('active'));
        
        // Show requested step
        switch(step) {
            case 'type':
                this.mpTypeSelector.classList.add('active');
                break;
            case 'private':
                this.mpPrivateRoom.classList.add('active');
                break;
            case 'lobby':
                this.mpRoomLobby.classList.add('active');
                this.updateLobbyUI();
                break;
            case 'connecting':
                this.mpConnecting.classList.add('active');
                break;
        }
    }
    
    handleMpTypeSelection(type) {
        this.isMultiplayer = true;
        
        if (!this.mp) {
            this.initMultiplayer();
        }
        
        if (type === 'quick') {
            this.showMpStep('connecting');
            this.connectingTitle.textContent = '🔍 RECHERCHE D\'ADVERSAIRE...';
            this.connectingDesc.textContent = 'Nous cherchons un joueur disponible';
            this.mp?.connect();
            setTimeout(() => {
                this.mp?.joinQueue();
            }, 1000);
        } else if (type === 'private') {
            this.showMpStep('private');
            if (!this.mpConnected) {
                this.mp?.connect();
            }
        }
    }
    
    createMpRoom() {
        const name = this.createNameInput.value.trim();
        if (!name) {
            alert('Veuillez entrer votre nom');
            return;
        }
        
        if (!this.mpConnected) {
            this.showMpStep('connecting');
            this.connectingTitle.textContent = '📶 CONNEXION...';
            this.connectingDesc.textContent = 'Connexion au serveur';
            this.mp?.connect();
            setTimeout(() => {
                this.mp?.createRoom(name);
            }, 1000);
        } else {
            this.mp?.createRoom(name);
        }
    }
    
    joinMpRoom() {
        const name = this.joinNameInput.value.trim();
        const code = this.roomCodeInput.value.trim().toUpperCase();
        
        if (!name) {
            alert('Veuillez entrer votre nom');
            return;
        }
        
        if (!code) {
            alert('Veuillez entrer le code de la salle');
            return;
        }
        
        if (!this.mpConnected) {
            this.showMpStep('connecting');
            this.connectingTitle.textContent = '📶 CONNEXION...';
            this.connectingDesc.textContent = 'Connexion au serveur';
            this.mp?.connect();
            setTimeout(() => {
                this.mp?.joinRoom(code, name);
            }, 1000);
        } else {
            this.mp?.joinRoom(code, name);
        }
    }
    
    copyRoomCode() {
        const code = this.displayedRoomCode.textContent;
        navigator.clipboard.writeText(code).then(() => {
            this.copyCodeBtn.textContent = '✅ COPIÉ';
            setTimeout(() => {
                this.copyCodeBtn.textContent = '📋 COPIER';
            }, 2000);
        }).catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = code;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.copyCodeBtn.textContent = '✅ COPIÉ';
            setTimeout(() => {
                this.copyCodeBtn.textContent = '📋 COPIER';
            }, 2000);
        });
    }
    
    toggleReady() {
        this.ready = !this.ready;
        this.pendingReadyState = this.ready; // Track what we're trying to set
        this.mp?.setReady(this.ready);
        this.updateLobbyUI();
        
        // Clear pending state after 3 seconds in case server doesn't respond
        setTimeout(() => {
            if (this.pendingReadyState !== null) {
                console.warn('⚠️ Server took too long to confirm ready state, clearing pending state');
                this.pendingReadyState = null;
            }
        }, 3000);
    }
    
    startMpMatch() {
        this.mp?.start();
    }
    
    cancelMpSearch() {
        this.mp?.leaveQueue();
        this.showMpStep('type');
    }
    
    leaveMpRoom() {
        this.mp?.leaveRoom();
        this.leaveRoomIfAny();
        this.showMpStep('type');
    }
    
    updateLobbyUI() {
        // Update lobby UI even if some fields (like room code) are not yet filled,
        // to avoid race conditions where a user presses Ready before room code is set.
        
        // Update room code display
        if (this.displayedRoomCode && this.roomCode) {
            this.displayedRoomCode.textContent = this.roomCode;
        }
        
        // Update my status
        if (this.myStatus) {
            this.myStatus.textContent = this.ready ? 'Prêt !' : 'Pas prêt';
            this.myStatus.className = this.ready ? 'player-ready ready' : 'player-ready';
        }
        
        // Update ready button
        if (this.readyBtn) {
            if (this.ready) {
                this.readyBtn.textContent = '✅ JE SUIS PRÊT';
                this.readyBtn.classList.add('ready');
            } else {
                this.readyBtn.textContent = '✋ JE SUIS PRÊT';
                this.readyBtn.classList.remove('ready');
            }
        }
        
        // Update start button (host only)
        if (this.startMatchBtn) {
            if (this.isHost) {
                this.startMatchBtn.classList.remove('hidden');
            } else {
                this.startMatchBtn.classList.add('hidden');
            }
        }
        
        // Update lobby status
        if (this.lobbyStatus) {
            if (this.ready && this.opponentProgress > 0) {
                this.lobbyStatus.textContent = 'Tous prêts ! L\'hôte peut lancer la partie.';
            } else {
                this.lobbyStatus.textContent = 'En attente que tous les joueurs soient prêts...';
            }
        }
    }

    // --- Multiplayer integration ---
    initMultiplayer() {
        this.mp = new MultiplayerClient({
            url: this.detectWsUrl(),
            onOpen: () => {
                console.log('✅ Connecté au serveur multijoueur');
                this.mpConnected = true;
                // Stay on current step, connection successful
            },
            onClose: () => {
                console.log('❌ Déconnecté du serveur multijoueur');
                this.mpConnected = false;
                // Only show the step if modal is already open
                if (this.modal && this.modal.classList.contains('show')) {
                    this.showMpStep('type');
                }
            },
            onGameResume: (data) => {
                console.log('🔄 Reprise de jeu:', data);
                this.resumeGame(data);
            },
            onRoomUpdate: (info) => {
                console.log('🏠 Mise à jour de salle:', info);
                this.isMultiplayer = true;
                this.roomId = info.roomId || null;
                this.roomCode = info.code || null;
                this.isHost = info.hostId === this.mp.sessionId;
                const me = info.members?.find(m => m.id === this.mp.sessionId);
                const opponent = info.members?.find(m => m.id !== this.mp.sessionId);
                
                // Only update ready state if we're not in the middle of changing it
                const serverReady = !!me?.ready;
                if (this.pendingReadyState === null) {
                    this.ready = serverReady;
                } else if (this.pendingReadyState === serverReady) {
                    // Server confirmed our change
                    this.pendingReadyState = null;
                    this.ready = serverReady;
                }
                
                // Store nicknames for game display
                this.myNick = me?.nick || null;
                this.opponentNick = opponent?.nick || null;
                
                if (opponent) {
                    this.opponentName.textContent = opponent.nick || 'ADVERSAIRE';
                    this.opponentReady.textContent = opponent.ready ? 'Prêt !' : 'Pas prêt';
                    this.opponentReady.className = opponent.ready ? 'player-ready ready' : 'player-ready';
                } else {
                    this.opponentName.textContent = 'EN ATTENTE...';
                    this.opponentReady.textContent = '-';
                    this.opponentReady.className = 'player-ready';
                }
                
                this.showMpStep('lobby');
                this.updateMpVisibility();
            },
            onMatchFound: (info) => {
                console.log('🎯 Match trouvé:', info);
                this.roomId = info.roomId;
                this.roomCode = info.code;
                this.isHost = info.hostId === this.mp.sessionId;
                
                // Show lobby immediately
                this.showMpStep('lobby');
                this.opponentName.textContent = 'ADVERSAIRE';
                this.opponentReady.textContent = 'Pas prêt';
                this.lobbyStatus.textContent = '🎯 Match trouvé ! Préparez-vous...';
            },
            onGameStart: ({ seed, startAt }) => {
                console.log('🚀 Début de partie multijoueur');
                this.hideModal();
                this.isMultiplayer = true;
                this.pendingStart = { seed, startAt };
                this.resetGame();
                this.startGame({ seed, startAt });
                this.updateMultiplayerScores(); // Show multiplayer scores
                this.updateMpVisibility();
            },
            onOpponentProgress: ({ found, currentTarget, from, scores }) => {
                // Apply visual marks based on authoritative server event
                if (typeof found === 'number' && found > 0) {
                    if (from && from === this.mp.sessionId) {
                        // My successful find acknowledged by server
                        const myCard = this.gameGrid.querySelector(`.number-card[data-number="${found}"]`);
                        if (myCard) {
                            myCard.classList.add('my-found');
                            myCard.disabled = true;
                            myCard.setAttribute('aria-disabled', 'true');
                        }
                        // Set guards prevent duplicate entries
                        this.myFoundNumbers.add(found);
                    } else {
                        // Opponent's successful find
                        this.markOpponentFound(found);
                        this.opponentFoundNumbers.add(found);
                    }
                }

                // Update server-authoritative scores if provided
                if (scores && Array.isArray(scores)) {
                    const me = scores.find(s => s && s.id === this.mp.sessionId);
                    const other = scores.find(s => s && s.id !== this.mp.sessionId);
                    if (me && typeof me.score === 'number') this.myScore = me.score;
                    if (other && typeof other.score === 'number') this.opponentScore = other.score;
                    this.updateMultiplayerScores();
                }

                if (typeof currentTarget === 'number') {
                    // Server sent updated current target - synchronize both players
                    this.currentTarget = currentTarget;
                    this.updateProgress();
                    
                    if (this.currentTarget > 100) {
                        this.completeGame();
                    }
                }
                this.updateConnectionUI();
            },
            onGameOver: ({ winner }) => {
                if (winner === this.mp.sessionId) {
                    this.lobbyStatus.textContent = `🏆 VICTOIRE ! Code: ${this.roomCode || ''}`;
                } else {
                    this.lobbyStatus.textContent = `💔 DÉFAITE. Code: ${this.roomCode || ''}`;
                    this.gameStarted = false;
                    this.gameComplete = true;
                    if (this.timerInterval) clearInterval(this.timerInterval);
                }
                // Reset ready states
                this.ready = false;
                this.pendingReadyState = null;
                this.updateLobbyUI();
            }
        });
        this.updateMpVisibility();
    }

    detectWsUrl() {
        return 'wss://shaka-server.relais.dev';
    }

    updateMpVisibility() {
        // Ensure multiplayer scores visibility is updated
        this.updateMultiplayerScores();
        // Toggle leave session button if applicable
        if (this.leaveSessionBtn) {
            const show = this.isMultiplayer && (this.roomId || this.gameStarted);
            if (show) this.leaveSessionBtn.classList.remove('hidden');
            else this.leaveSessionBtn.classList.add('hidden');
        }
    }

    updateRoomControls(info = null) {
        if (!this.isMultiplayer) return;
        // Guard against missing legacy elements in the new UI
        if (!this.roomInfo || !this.startMatchBtn || !this.readyBtn) {
            return;
        }
        const inRoom = !!this.roomId;
        if (!inRoom) {
            this.roomInfo.textContent = '';
            this.startMatchBtn.classList.add('hidden');
            this.readyBtn.textContent = this.ready ? 'Prêt' : 'Prêt';
            // show solo start button when not in room
            this.startBtn.style.display = 'inline-block';
            return;
        }
        const members = info?.members || [];
        const me = members.find(m => m.id === this.mp.sessionId);
        const other = members.find(m => m.id !== this.mp.sessionId);
        const otherReady = other ? other.ready : false;
        const allReady = members.length === 2 && members.every(m => m.ready);
        this.roomInfo.textContent = `Salle ${this.roomCode || ''} • Joueurs: ${members.length}/2 • ${me?.ready ? 'Vous: prêt' : 'Vous: pas prêt'}${other ? ` • Adverse: ${otherReady ? 'prêt' : 'pas prêt'}` : ''}`;
        this.readyBtn.textContent = this.ready ? 'Pas prêt' : 'Prêt';
        // hide solo start button while in room
        this.startBtn.style.display = 'none';
        if (this.isHost) {
            this.startMatchBtn.classList.remove('hidden');
            this.startMatchBtn.disabled = !allReady;
        } else {
            this.startMatchBtn.classList.add('hidden');
        }
        this.renderOpponentInfo();
    }

    renderOpponentInfo() {
        // This method is no longer needed with the new UI structure
        // Opponent info is now displayed in the multiplayer scores
    }

    resumeGame(data) {
        console.log('📊 Données de reprise:', data);
        
        // Check if game is still valid (not too old)
        const now = Date.now();
        const gameAge = now - data.startAt;
        if (gameAge > 30 * 60 * 1000) { // 30 minutes max
            console.log('⏰ Jeu trop ancien, pas de reprise');
            return;
        }
        
        // Restore game state
        this.isMultiplayer = true;
        this.gameStarted = true;
        this.gameComplete = false;
        this.currentTarget = data.currentTarget;
        this.myFoundNumbers = new Set(data.myFoundNumbers || []);
        this.opponentFoundNumbers = new Set(data.opponentFoundNumbers || []);
        
        // Update scores (server authoritative if provided)
        if (Array.isArray(data.scores)) {
            const me = data.scores.find(s => s && s.id === this.mp?.sessionId);
            const other = data.scores.find(s => s && s.id !== this.mp?.sessionId);
            this.myScore = (me && typeof me.score === 'number') ? me.score : this.myFoundNumbers.size;
            this.opponentScore = (other && typeof other.score === 'number') ? other.score : this.opponentFoundNumbers.size;
        } else {
            this.myScore = this.myFoundNumbers.size;
            this.opponentScore = this.opponentFoundNumbers.size;
        }
        
        // Hide modal and show game UI
        this.hideModal();
        
        // Generate the same grid as when the game started
        this.generateNumbers(data.seed);
        this.renderGrid();
        
        // Mark found numbers on the grid
        this.myFoundNumbers.forEach(num => {
            const card = document.querySelector(`.number-card[data-number="${num}"]`);
            if (card) card.classList.add('my-found');
        });
        
        this.opponentFoundNumbers.forEach(num => {
            const card = document.querySelector(`.number-card[data-number="${num}"]`);
            if (card) card.classList.add('opponent-found');
        });
        
        // Show multiplayer UI
        this.updateMultiplayerScores();
        this.updateMpVisibility();
        
        // Resume timer (calculate elapsed time)
        const elapsedSinceStart = Math.max(0, now - data.startAt);
        this.startTime = now - elapsedSinceStart;
        this.startTimer();
        
        // Update UI
        this.updateUI();
        
        // Show notification to user
        console.log('🔄 Partie reprise automatiquement !');
        
        console.log(`🔄 Jeu repris: ${this.myScore} vs ${this.opponentScore}, recherche du ${this.currentTarget}`);
    }

    checkForSoloGameState() {
        try {
            const savedState = localStorage.getItem('soloGameState');
            if (savedState && !this.gameStarted) {
                const state = JSON.parse(savedState);
                const now = Date.now();
                const gameAge = now - state.startTime;
                
                // Only resume if game is less than 30 minutes old
                if (gameAge < 30 * 60 * 1000 && state.currentTarget <= 100) {
                    console.log('🔄 Reprise du jeu solo:', state);
                    this.resumeSoloGame(state);
                }
            }
        } catch (e) {
            console.warn('⚠️ Erreur lors de la lecture de l\'état sauvé:', e);
            localStorage.removeItem('soloGameState');
        }
    }
    
    resumeSoloGame(state) {
        this.isMultiplayer = false;
        this.gameStarted = true;
        this.gameComplete = false;
        this.currentTarget = state.currentTarget;
        this.startTime = state.startTime;
        this.numbers = state.numbers;
        this.myFoundNumbers = new Set(state.foundNumbers);
        
        // Render the grid and mark found numbers
        this.renderGrid();
        this.myFoundNumbers.forEach(num => {
            const card = document.querySelector(`.number-card[data-number="${num}"]`);
            if (card) card.classList.add('my-found');
        });
        
        // Resume timer
        this.startTimer();
        this.updateUI();
        this.updateMultiplayerScores(); // Hide multiplayer UI
        
        console.log(`🔄 Jeu solo repris: ${this.myFoundNumbers.size}/100, recherche du ${this.currentTarget}`);
    }
    
    saveGameState() {
        if (this.gameStarted && !this.gameComplete && !this.isMultiplayer) {
            const state = {
                currentTarget: this.currentTarget,
                startTime: this.startTime,
                numbers: this.numbers,
                foundNumbers: Array.from(this.myFoundNumbers),
                timestamp: Date.now()
            };
            localStorage.setItem('soloGameState', JSON.stringify(state));
        }
    }
    
    clearGameState() {
        localStorage.removeItem('soloGameState');
    }

    leaveRoomIfAny() {
        this.roomId = null;
        this.roomCode = null;
        this.ready = false;
        this.pendingReadyState = null;
        this.isHost = false;
        this.opponentProgress = 0;
        this.mp?.leaveRoom();
        this.updateRoomControls();
        this.updateMpVisibility();
    }

    quitSession() {
        // Leave any multiplayer room and reset the game UI
        this.leaveRoomIfAny();
        this.isMultiplayer = false;
        this.resetGame();
        this.hideModal();
        this.updateMpVisibility();
    }
}

// Add advanced animations
const addAdvancedAnimations = () => {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes targetPulse {
            0%, 100% { 
                transform: scale(1);
                box-shadow: 0 0 0 rgba(220, 53, 69, 0.4);
            }
            50% { 
                transform: scale(1.05);
                box-shadow: 0 0 15px rgba(220, 53, 69, 0.8);
            }
        }
        
        @keyframes cardEntrance {
            0% {
                opacity: 0;
                transform: scale(0) rotate(45deg);
            }
            70% {
                opacity: 0.8;
                transform: scale(1.1) rotate(-5deg);
            }
            100% {
                opacity: 1;
                transform: scale(1) rotate(0deg);
            }
        }
        
        .number-card {
            animation: cardEntrance 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
            animation-delay: calc(var(--index) * 0.02s);
        }
    `;
    document.head.appendChild(style);
};

document.addEventListener('DOMContentLoaded', () => {
    addAdvancedAnimations();
    new ConcentrationGame();
});

// --- Multiplayer client (browser) ---
class MultiplayerClient {
    constructor({ url, onOpen, onClose, onRoomUpdate, onMatchFound, onGameStart, onGameResume, onOpponentProgress, onGameOver }) {
        this.url = url;
        this.ws = null;
        this.backoff = 1000;
        this.maxBackoff = 10000;
        this.timer = null;
        this.onOpen = onOpen || (() => {});
        this.onClose = onClose || (() => {});
        this.onRoomUpdate = onRoomUpdate || (() => {});
        this.onMatchFound = onMatchFound || (() => {});
        this.onGameStart = onGameStart || (() => {});
        this.onGameResume = onGameResume || (() => {});
        this.onOpponentProgress = onOpponentProgress || (() => {});
        this.onGameOver = onGameOver || (() => {});
        this.sessionId = localStorage.getItem('mpSessionId') || localStorage.getItem('deviceId') || null;
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        try {
            // Ensure we have a stable per-device id before connecting
            if (!this.sessionId) {
                this.sessionId = this.getOrCreateDeviceId();
                localStorage.setItem('deviceId', this.sessionId);
            }
            this.ws = new WebSocket(this.url);
        } catch (e) {
            this.scheduleReconnect();
            return;
        }
        this.ws.onopen = () => {
            this.send({ type: 'hello', sessionId: this.sessionId || undefined });
            this.onOpen();
            this.backoff = 1000;
        };
        this.ws.onclose = () => {
            this.onClose();
            this.scheduleReconnect();
        };
        this.ws.onerror = () => {
            // ignore, close will follow
        };
        this.ws.onmessage = (ev) => {
            let msg; try { msg = JSON.parse(ev.data); } catch { return; }
            this.handle(msg);
        };
    }

    scheduleReconnect() {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.connect();
            this.backoff = Math.min(this.maxBackoff, this.backoff * 1.6);
        }, this.backoff);
    }

    send(obj) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try { this.ws.send(JSON.stringify(obj)); } catch {}
    }

    handle(msg) {
        const t = msg.type;
        if (t === 'hello') {
            if (msg.sessionId && msg.sessionId !== this.sessionId) {
                this.sessionId = msg.sessionId;
                localStorage.setItem('mpSessionId', this.sessionId);
                // Keep deviceId aligned for future connects as well
                localStorage.setItem('deviceId', this.sessionId);
            }
        } else if (t === 'match:found') {
            this.onMatchFound(msg);
        } else if (t === 'room:created' || t === 'room:joined' || t === 'room:state') {
            this.onRoomUpdate(msg);
        } else if (t === 'game:start') {
            this.onGameStart(msg);
        } else if (t === 'game:resume') {
            this.onGameResume(msg);
        } else if (t === 'game:progress') {
            this.onOpponentProgress(msg);
        } else if (t === 'game:over') {
            this.onGameOver(msg);
        }
    }

    // Public actions
    joinQueue() { this.send({ type: 'queue:join' }); }
    leaveQueue() { this.send({ type: 'queue:leave' }); }
    createRoom(name) { this.send({ type: 'room:create', nick: name }); }
    joinRoom(code, name) { this.send({ type: 'room:join', code, nick: name }); }
    leaveRoom() { this.send({ type: 'room:leave' }); }
    setReady(ready) { this.send({ type: 'room:ready', ready: !!ready }); }
    start() { this.send({ type: 'room:start' }); }
    sendProgress(found) { this.send({ type: 'game:progress', found }); }

    // Utilities
    getOrCreateDeviceId() {
        let id = localStorage.getItem('deviceId');
        if (id && typeof id === 'string' && id.length >= 8) return id;
        id = this.uuidv4();
        localStorage.setItem('deviceId', id);
        return id;
    }
    uuidv4() {
        // RFC4122-ish v4 using crypto if available
        const cryptoObj = (window.crypto || window.msCrypto);
        if (cryptoObj && cryptoObj.getRandomValues) {
            const buf = new Uint8Array(16);
            cryptoObj.getRandomValues(buf);
            buf[6] = (buf[6] & 0x0f) | 0x40;
            buf[8] = (buf[8] & 0x3f) | 0x80;
            const toHex = (n) => n.toString(16).padStart(2, '0');
            return (
                toHex(buf[0]) + toHex(buf[1]) + toHex(buf[2]) + toHex(buf[3]) + '-' +
                toHex(buf[4]) + toHex(buf[5]) + '-' +
                toHex(buf[6]) + toHex(buf[7]) + '-' +
                toHex(buf[8]) + toHex(buf[9]) + '-' +
                toHex(buf[10]) + toHex(buf[11]) + toHex(buf[12]) + toHex(buf[13]) + toHex(buf[14]) + toHex(buf[15])
            );
        }
        // Fallback: timestamp + random
        return 'dev-' + Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
    }
}
