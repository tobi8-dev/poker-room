/**
 * CNY Card Game Server
 * ====================
 * Modular multiplayer card game server
 * Supports: Free Deal, Blackjack
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = '8888';

// =============================================================================
// APP SETUP
// =============================================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

// =============================================================================
// GAME MODES
// =============================================================================
const GameMode = {
    FREE_DEAL: 'freeDeal',
    BLACKJACK: 'blackjack'
};

// =============================================================================
// GAME STATE
// =============================================================================
const state = {
    deck: [],
    players: [],
    centerCards: [],
    adminId: null,
    gameMode: GameMode.FREE_DEAL,
    blackjack: null
};

// =============================================================================
// DECK UTILITIES
// =============================================================================
function generateDeck() {
    const suits = ['♠️', '♥️', '♦️', '♣️'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const deck = [];
    for (const suit of suits) {
        for (const value of values) {
            deck.push({ suit, value, color: (suit === '♥️' || suit === '♦️') ? 'red' : 'black' });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function drawCard() {
    if (state.deck.length < 10) state.deck = shuffleDeck(generateDeck());
    return state.deck.pop();
}

// =============================================================================
// BLACKJACK MODULE
// =============================================================================
const Blackjack = {
    init() {
        state.blackjack = {
            dealerCards: [],
            currentPlayerId: null,
            players: {}, // socketId -> { bet, result, standing, busted }
            phase: 'betting' // betting, playing, dealer, settled
        };
    },
    
    getCardValue(card) {
        if (['J', 'Q', 'K'].includes(card.value)) return 10;
        if (card.value === 'A') return 11;
        return parseInt(card.value);
    },
    
    calculateScore(cards) {
        let score = 0, aces = 0;
        for (const card of cards) {
            score += this.getCardValue(card);
            if (card.value === 'A') aces++;
        }
        while (score > 21 && aces > 0) { score -= 10; aces--; }
        return score;
    },
    
    isBlackjack(cards) {
        return cards.length === 2 && this.calculateScore(cards) === 21;
    },
    
    placeBet(socketId, bet) {
        // Initialize blackjack if not done
        if (!state.blackjack) Blackjack.init();
        
        const player = state.players.find(p => p.id === socketId);
        if (!player || !state.blackjack.players[socketId]) return false;
        if (bet < 1 || bet > player.balance) return false;
        
        player.balance -= bet;
        state.blackjack.players[socketId] = { bet, result: null, standing: false, busted: false };
        
        // Check if all can start
        this.checkStart();
        return true;
    },
    
    checkStart() {
        const allReady = state.players
            .filter(p => p.balance > 0)
            .every(p => state.blackjack.players[p.id]);
        
        if (allReady && state.players.length > 0) {
            this.startRound();
        }
        broadcastState();
    },
    
    startRound() {
        state.blackjack.phase = 'playing';
        state.blackjack.dealerCards = [drawCard(), drawCard()];
        
        // Deal to players
        for (const player of state.players) {
            if (state.blackjack.players[player.id]) {
                player.cards = [drawCard(), drawCard()];
                
                // Check blackjack
                if (this.isBlackjack(player.cards)) {
                    state.blackjack.players[player.id].result = 'blackjack';
                    state.blackjack.players[player.id].standing = true;
                }
            } else {
                player.cards = [];
            }
        }
        
        // Check dealer blackjack
        if (this.isBlackjack(state.blackjack.dealerCards)) {
            this.settleRound();
        }
        
        // Set first player
        const firstPlayer = state.players.find(p => state.blackjack.players[p.id] && !state.blackjack.players[p.id].standing);
        state.blackjack.currentPlayerId = firstPlayer ? firstPlayer.id : null;
        
        broadcastState();
    },
    
    hit(socketId) {
        if (state.blackjack.currentPlayerId !== socketId) return;
        
        const player = state.players.find(p => p.id === socketId);
        const bs = state.blackjack.players[socketId];
        
        if (!player || !bs || bs.standing || bs.busted) return;
        
        player.cards.push(drawCard());
        const score = this.calculateScore(player.cards);
        
        if (score > 21) {
            bs.busted = true;
            bs.result = 'bust';
            this.nextPlayer();
        } else if (score === 21) {
            bs.standing = true;
            this.nextPlayer();
        }
        
        broadcastState();
    },
    
    stand(socketId) {
        if (state.blackjack.currentPlayerId !== socketId) return;
        
        const bs = state.blackjack.players[socketId];
        if (!bs || bs.standing || bs.busted) return;
        
        bs.standing = true;
        this.nextPlayer();
        broadcastState();
    },
    
    double(socketId) {
        if (state.blackjack.currentPlayerId !== socketId) return;
        
        const player = state.players.find(p => p.id === socketId);
        const bs = state.blackjack.players[socketId];
        
        if (!player || !bs || player.cards.length !== 2 || player.balance < bs.bet) return;
        
        player.balance -= bs.bet;
        bs.bet *= 2;
        player.cards.push(drawCard());
        
        const score = this.calculateScore(player.cards);
        if (score > 21) {
            bs.busted = true;
            bs.result = 'bust';
        } else {
            bs.standing = true;
        }
        
        this.nextPlayer();
        broadcastState();
    },
    
    nextPlayer() {
        const currentIdx = state.players.findIndex(p => p.id === state.blackjack.currentPlayerId);
        let nextIdx = -1;
        
        for (let i = currentIdx + 1; i < state.players.length; i++) {
            const bs = state.blackjack.players[state.players[i].id];
            if (bs && !bs.standing && !bs.busted) {
                nextIdx = i;
                break;
            }
        }
        
        if (nextIdx === -1) {
            this.dealerPlay();
        } else {
            state.blackjack.currentPlayerId = state.players[nextIdx].id;
        }
    },
    
    dealerPlay() {
        state.blackjack.phase = 'dealer';
        
        let score = this.calculateScore(state.blackjack.dealerCards);
        while (score < 17) {
            state.blackjack.dealerCards.push(drawCard());
            score = this.calculateScore(state.blackjack.dealerCards);
        }
        
        this.settleRound();
        broadcastState();
    },
    
    settleRound() {
        state.blackjack.phase = 'settled';
        const dealerScore = this.calculateScore(state.blackjack.dealerCards);
        
        for (const player of state.players) {
            const bs = state.blackjack.players[player.id];
            if (!bs) continue;
            
            const playerScore = this.calculateScore(player.cards);
            
            if (bs.result === 'blackjack') {
                player.balance += Math.floor(bs.bet * 2.5);
            } else if (bs.busted) {
                // Already lost
            } else if (dealerScore > 21) {
                player.balance += bs.bet * 2;
                bs.result = 'win';
            } else if (playerScore > dealerScore) {
                player.balance += bs.bet * 2;
                bs.result = 'win';
            } else if (playerScore < dealerScore) {
                bs.result = 'lose';
            } else {
                player.balance += bs.bet;
                bs.result = 'push';
            }
            
            bs.bet = 0;
            io.to(player.id).emit('balanceUpdate', player.balance);
        }
    },
    
    nextRound() {
        // Reset
        for (const player of state.players) {
            if (player.balance === 0) {
                state.players = state.players.filter(p => p.id !== player.id);
            } else {
                player.cards = [];
            }
        }
        
        if (state.deck.length < 20) state.deck = shuffleDeck(generateDeck());
        this.init();
        broadcastState();
    }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
function isAdmin(socketId) {
    return state.adminId && socketId === state.adminId;
}

function broadcastState() {
    const stateToSend = {
        ...state,
        players: state.players.map(p => ({ ...p, isMe: false })),
        blackjack: state.blackjack ? {
            ...state.blackjack,
            dealerScore: state.blackjack.dealerCards.length > 0 ? Blackjack.calculateScore(state.blackjack.dealerCards) : 0,
            currentPlayerId: state.blackjack.currentPlayerId
        } : null
    };
    io.emit('updateGame', stateToSend);
}

// =============================================================================
// SOCKET HANDLERS
// =============================================================================
io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);
    socket.emit('updateGame', { ...state, players: [], blackjack: null });

    // Admin
    socket.on('setAdminPassword', (password) => {
        if (password === ADMIN_PASSWORD) {
            state.adminId = socket.id;
            console.log(`[ADMIN] ${socket.id}`);
        } else {
            socket.emit('error', 'Wrong password!');
        }
        broadcastState();
    });

    // Join
    socket.on('join', (playerName) => {
        const existing = state.players.find(p => p.id === socket.id);
        if (existing) {
            existing.name = playerName;
        } else {
            state.players.push({ id: socket.id, name: playerName, cards: [], balance: 100 });
            console.log(`[PLAYER] ${playerName} joined`);
            
            if (state.gameMode === GameMode.BLACKJACK) {
                Blackjack.init();
            }
        }
        broadcastState();
    });

    // Game Mode
    socket.on('setGameMode', (mode) => {
        // Any player can set game mode when joining
        state.gameMode = mode;
        
        if (mode === GameMode.BLACKJACK) {
            Blackjack.init();
        } else {
            state.blackjack = null;
        }
        
        console.log(`[MODE] ${mode} set by ${socket.id}`);
        broadcastState();
    });

    // Remove player
    socket.on('removePlayer', (playerId) => {
        if (!isAdmin(socket.id)) return;
        state.players = state.players.filter(p => p.id !== playerId);
        broadcastState();
    });

    // Free Deal actions
    socket.on('shuffle', () => {
        if (!isAdmin(socket.id)) return;
        state.deck = shuffleDeck(generateDeck());
        broadcastState();
    });

    socket.on('dealToAll', () => {
        if (!isAdmin(socket.id)) return;
        for (const player of state.players) {
            player.cards.push(drawCard());
        }
        broadcastState();
    });

    socket.on('dealToCenter', () => {
        if (!isAdmin(socket.id)) return;
        state.centerCards.push(drawCard());
        broadcastState();
    });

    socket.on('dealToPlayer', (playerId) => {
        if (!isAdmin(socket.id)) return;
        const player = state.players.find(p => p.id === playerId);
        if (player) player.cards.push(drawCard());
        broadcastState();
    });

    socket.on('clearCenter', () => {
        if (!isAdmin(socket.id)) return;
        state.deck.push(...state.centerCards);
        state.deck = shuffleDeck(state.deck);
        state.centerCards = [];
        broadcastState();
    });

    socket.on('returnCardToDeck', (index) => {
        if (!isAdmin(socket.id)) return;
        if (index >= 0 && index < state.centerCards.length) {
            state.deck.push(state.centerCards.splice(index, 1)[0]);
        }
        broadcastState();
    });

    socket.on('updateBalance', ({ playerId, amount }) => {
        const isOwn = socket.id === playerId;
        if (!isAdmin(socket.id) && !isOwn) return;
        const player = state.players.find(p => p.id === playerId);
        if (player) {
            player.balance = (player.balance || 0) + amount;
            io.to(player.id).emit('balanceUpdate', player.balance);
        }
        broadcastState();
    });

    socket.on('resetGame', () => {
        if (!isAdmin(socket.id)) return;
        state.deck = shuffleDeck(generateDeck());
        state.players = [];
        state.centerCards = [];
        state.adminId = null;
        if (state.gameMode === GameMode.BLACKJACK) Blackjack.init();
        broadcastState();
    });

    // Blackjack actions
    socket.on('placeBet', ({ bet }) => {
        Blackjack.placeBet(socket.id, bet);
    });

    socket.on('hit', () => Blackjack.hit(socket.id));
    socket.on('stand', () => Blackjack.stand(socket.id));
    socket.on('double', () => Blackjack.double(socket.id));
    socket.on('nextRound', () => Blackjack.nextRound());

    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] ${socket.id}`);
    });
});

// =============================================================================
// START
// =============================================================================
state.deck = shuffleDeck(generateDeck());
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🃏 CNY Card Game Server\n   Port: ${PORT}\n   Admin: ${ADMIN_PASSWORD}\n`);
});
