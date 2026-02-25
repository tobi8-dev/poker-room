/**
 * CNY Card Game Server
 * ====================
 * A real-time multiplayer card game server using Socket.IO
 * Supports: 21点 (Blackjack)
 * 
 * @author Tobi
 * @version 2.0.0
 */

// =============================================================================
// IMPORTS
// =============================================================================
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

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// =============================================================================
// GAME STATE
// =============================================================================
const gameState = {
    // Card deck
    deck: [],
    
    // Player management
    players: {},
    
    // Blackjack game state
    blackjack: {
        dealerCards: [],
        currentPlayerId: null,
        bet: 0,
        gameOver: false,
        result: null,
        dealerHidden: true
    },
    
    adminId: null
};

// =============================================================================
// CARD DECK UTILITIES
// =============================================================================

/**
 * Generate a standard 52-card deck
 */
function generateDeck() {
    const suits = ['♠️', '♥️', '♦️', '♣️'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    
    const deck = [];
    for (const suit of suits) {
        for (const value of values) {
            deck.push({
                suit,
                value,
                color: (suit === '♥️' || suit === '♦️') ? 'red' : 'black'
            });
        }
    }
    return deck;
}

/**
 * Fisher-Yates shuffle
 */
function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Get card value for scoring
 */
function getCardValue(card) {
    if (['J', 'Q', 'K'].includes(card.value)) return 10;
    if (card.value === 'A') return 11; // Will be reduced to 1 if needed
    return parseInt(card.value);
}

/**
 * Calculate hand score (handles Aces)
 */
function calculateScore(cards) {
    let score = 0;
    let aces = 0;
    
    for (const card of cards) {
        score += getCardValue(card);
        if (card.value === 'A') aces++;
    }
    
    // Reduce Aces from 11 to 1 while over 21
    while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
    }
    
    return score;
}

/**
 * Initialize/reshuffle deck
 */
function initDeck() {
    gameState.deck = shuffleDeck(generateDeck());
}

// Initialize deck on start
initDeck();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function isAdmin(socketId) {
    return gameState.adminId && socketId === gameState.adminId;
}

function getPlayer(socketId) {
    return gameState.players[socketId];
}

function broadcastGameState() {
    // Send to the specific player their balance
    const state = {
        dealerCards: gameState.blackjack.dealerCards,
        dealerHidden: gameState.blackjack.dealerHidden,
        dealerScore: gameState.blackjack.dealerHidden ? '?' : calculateScore(gameState.blackjack.dealerCards),
        playerCards: [],
        playerScore: 0,
        gameOver: gameState.blackjack.gameOver,
        result: gameState.blackjack.result
    };
    
    // Broadcast to all
    io.emit('gameState', state);
}

function broadcastBalance(socketId) {
    const player = gameState.players[socketId];
    if (player) {
        io.to(socketId).emit('balanceUpdate', player.balance);
    }
}

// =============================================================================
// BLACKJACK GAME LOGIC
// =============================================================================

function startBlackjackRound(bet) {
    // Reset round
    gameState.blackjack = {
        dealerCards: [],
        currentPlayerId: null,
        bet: bet,
        gameOver: false,
        result: null,
        dealerHidden: true
    };
    
    // Deal initial cards: player, dealer, player, dealer
    gameState.blackjack.dealerCards.push(gameState.deck.pop());
    gameState.blackjack.dealerCards.push(gameState.deck.pop());
    
    const playerCards = [gameState.deck.pop(), gameState.deck.pop()];
    
    // Check for blackjack
    const playerScore = calculateScore(playerCards);
    const dealerScore = calculateScore(gameState.blackjack.dealerCards);
    
    // Store player cards in their player object
    for (const socketId in gameState.players) {
        gameState.players[socketId].cards = [...playerCards];
        gameState.players[socketId].currentBet = bet;
    }
    
    // Check for instant blackjack
    if (playerScore === 21) {
        gameState.blackjack.gameOver = true;
        
        if (dealerScore === 21) {
            gameState.blackjack.result = 'push';
            // Return bet
            const player = gameState.players[gameState.blackjack.currentPlayerId];
            if (player) player.balance += bet;
        } else {
            gameState.blackjack.result = 'blackjack';
            // Blackjack pays 3:2
            const player = gameState.players[gameState.blackjack.currentPlayerId];
            if (player) player.balance += Math.floor(bet * 2.5);
        }
        
        gameState.blackjack.dealerHidden = false;
    }
    
    broadcastGameState();
}

function playerHit() {
    const playerId = gameState.blackjack.currentPlayerId;
    const player = gameState.players[playerId];
    
    if (!player || gameState.blackjack.gameOver) return;
    
    // Deal card to player
    player.cards.push(gameState.deck.pop());
    
    const score = calculateScore(player.cards);
    
    // Check if bust
    if (score > 21) {
        // Player busts - dealer wins
        gameState.blackjack.gameOver = true;
        gameState.blackjack.result = 'lose';
        gameState.blackjack.dealerHidden = false;
    }
    
    broadcastGameState();
}

function playerStand() {
    // Dealer plays
    gameState.blackjack.dealerHidden = false;
    
    // Dealer hits until 17+
    let dealerScore = calculateScore(gameState.blackjack.dealerCards);
    
    while (dealerScore < 17) {
        gameState.blackjack.dealerCards.push(gameState.deck.pop());
        dealerScore = calculateScore(gameState.blackjack.dealerCards);
    }
    
    // Determine winner
    const player = gameState.players[gameState.blackjack.currentPlayerId];
    const playerScore = calculateScore(player.cards);
    const bet = gameState.blackjack.bet;
    
    gameState.blackjack.gameOver = true;
    
    if (dealerScore > 21) {
        // Dealer busts - player wins
        gameState.blackjack.result = 'win';
        if (player) player.balance += bet * 2;
    } else if (playerScore > dealerScore) {
        gameState.blackjack.result = 'win';
        if (player) player.balance += bet * 2;
    } else if (playerScore < dealerScore) {
        gameState.blackjack.result = 'lose';
    } else {
        // Push
        gameState.blackjack.result = 'push';
        if (player) player.balance += bet;
    }
    
    broadcastGameState();
    broadcastBalance(gameState.blackjack.currentPlayerId);
}

function playerDouble() {
    const playerId = gameState.blackjack.currentPlayerId;
    const player = gameState.players[playerId];
    const currentBet = gameState.blackjack.bet;
    
    if (!player || player.balance < currentBet) return;
    
    // Double the bet
    player.balance -= currentBet;
    gameState.blackjack.bet = currentBet * 2;
    
    // Deal one card
    player.cards.push(gameState.deck.pop());
    
    const score = calculateScore(player.cards);
    
    // If bust, lose immediately
    if (score > 21) {
        gameState.blackjack.gameOver = true;
        gameState.blackjack.result = 'lose';
        gameState.blackjack.dealerHidden = false;
    } else {
        // Otherwise auto-stand
        playerStand();
    }
    
    broadcastGameState();
    broadcastBalance(playerId);
}

// =============================================================================
// SOCKET.IO EVENT HANDLERS
// =============================================================================

io.on('connection', (socket) => {
    console.log(`[CONNECT] User connected: ${socket.id}`);
    
    // Send current game state
    socket.emit('gameState', {
        dealerCards: [],
        dealerHidden: true,
        dealerScore: '?',
        playerCards: [],
        playerScore: 0,
        gameOver: false,
        result: null
    });

    // -------------------------------------------------------------------------
    // ADMIN
    // -------------------------------------------------------------------------
    socket.on('setAdmin', ({ password }) => {
        if (password === ADMIN_PASSWORD) {
            gameState.adminId = socket.id;
            console.log(`[ADMIN] Admin authenticated: ${socket.id}`);
        } else {
            socket.emit('error', 'Wrong password!');
        }
    });
    
    socket.on('adminReset', () => {
        if (!isAdmin(socket.id)) return;
        
        // Reset all players
        for (const id in gameState.players) {
            gameState.players[id].balance = 100;
            gameState.players[id].cards = [];
            gameState.players[id].currentBet = 0;
        }
        
        initDeck();
        gameState.blackjack = {
            dealerCards: [],
            currentPlayerId: null,
            bet: 0,
            gameOver: false,
            result: null,
            dealerHidden: true
        };
        
        broadcastGameState();
        for (const id in gameState.players) {
            broadcastBalance(id);
        }
    });

    // -------------------------------------------------------------------------
    // JOIN GAME
    // -------------------------------------------------------------------------
    socket.on('joinGame', ({ name, game }) => {
        if (game !== 'blackjack') {
            socket.emit('error', 'Game not available yet!');
            return;
        }
        
        // Create or update player
        if (!gameState.players[socket.id]) {
            gameState.players[socket.id] = {
                id: socket.id,
                name: name,
                balance: 100,
                cards: [],
                currentBet: 0
            };
            console.log(`[PLAYER] ${name} joined (${socket.id})`);
        } else {
            gameState.players[socket.id].name = name;
        }
        
        // Send balance
        broadcastBalance(socket.id);
        
        // If no active game, ready to bet
        if (!gameState.blackjack.currentPlayerId && !gameState.blackjack.gameOver) {
            // Ready for new bet
        }
        
        broadcastGameState();
    });

    socket.on('leaveGame', () => {
        const player = gameState.players[socket.id];
        if (player && gameState.blackjack.currentPlayerId === socket.id) {
            // Forfeit current bet
            gameState.blackjack.currentPlayerId = null;
            gameState.blackjack.gameOver = true;
            gameState.blackjack.result = 'forfeit';
        }
        broadcastGameState();
    });

    // -------------------------------------------------------------------------
    // BLACKJACK ACTIONS
    // -------------------------------------------------------------------------
    socket.on('placeBet', ({ bet }) => {
        const player = gameState.players[socket.id];
        
        if (!player) {
            socket.emit('error', 'Join game first!');
            return;
        }
        
        if (bet < 1 || bet > player.balance) {
            socket.emit('error', 'Invalid bet amount!');
            return;
        }
        
        if (gameState.blackjack.currentPlayerId) {
            socket.emit('error', 'Game in progress!');
            return;
        }
        
        // Place bet
        player.balance -= bet;
        gameState.blackjack.currentPlayerId = socket.id;
        
        broadcastBalance(socket.id);
        startBlackjackRound(bet);
    });

    socket.on('hit', () => {
        if (gameState.blackjack.currentPlayerId !== socket.id) return;
        playerHit();
    });

    socket.on('stand', () => {
        if (gameState.blackjack.currentPlayerId !== socket.id) return;
        playerStand();
    });

    socket.on('double', () => {
        if (gameState.blackjack.currentPlayerId !== socket.id) return;
        playerDouble();
    });

    // -------------------------------------------------------------------------
    // DISCONNECT
    // -------------------------------------------------------------------------
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
        
        // If current player disconnects, end the game
        if (gameState.blackjack.currentPlayerId === socket.id) {
            gameState.blackjack.gameOver = true;
            gameState.blackjack.result = 'forfeit';
            gameState.blackjack.dealerHidden = false;
            broadcastGameState();
        }
    });
});

// =============================================================================
// START SERVER
// =============================================================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  🐲 CNY Card Game Server v2.0                             ║
║  ==========================================================║
║  Server running on: http://0.0.0.0:${PORT}                ║
║  Admin password: ${ADMIN_PASSWORD}                                   ║
║  ==========================================================║
║  Games:                                                  ║
║    • 21点 (Blackjack) - Play now!                        ║
║    • More coming soon...                                 ║
╚════════════════════════════════════════════════════════════╝
    `);
});
