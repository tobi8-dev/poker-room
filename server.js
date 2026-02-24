/**
 * CNY Card Game Server
 * ====================
 * A real-time multiplayer card game server using Socket.IO
 * 
 * @author Tobi
 * @version 1.0.0
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
    deck: [],
    players: [],
    centerCards: [],
    currentPlayerIndex: 0,
    adminId: null
};

// =============================================================================
// CARD DECK UTILITIES
// =============================================================================

/**
 * Generate a standard 52-card deck
 * @returns {Array} Array of card objects
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
 * Fisher-Yates shuffle algorithm - truly random shuffle
 * @param {Array} deck - Array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleDeck(deck) {
    // Create a copy to avoid mutating original
    const shuffled = [...deck];
    
    for (let i = shuffled.length - 1; i > 0; i--) {
        // Random index from 0 to i
        const j = Math.floor(Math.random() * (i + 1));
        
        // Swap elements i and j
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled;
}

// Initialize deck
gameState.deck = shuffleDeck(generateDeck());

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a socket is the admin
 * @param {string} socketId - The socket ID to check
 * @returns {boolean} True if admin
 */
function isAdmin(socketId) {
    return gameState.adminId && socketId === gameState.adminId;
}

/**
 * Broadcast current game state to all connected clients
 */
function broadcastState() {
    // Add 'isMe' flag to each player for client rendering
    const stateToSend = {
        ...gameState,
        players: gameState.players.map(p => ({
            ...p,
            isMe: false // Will be set by client
        }))
    };
    io.emit('updateGame', stateToSend);
}

// =============================================================================
// SOCKET.IO EVENT HANDLERS
// =============================================================================

io.on('connection', (socket) => {
    console.log(`[CONNECT] User connected: ${socket.id}`);
    
    // Send current game state to newly connected user
    socket.emit('updateGame', gameState);

    // -------------------------------------------------------------------------
    // ADMIN AUTHENTICATION
    // -------------------------------------------------------------------------
    socket.on('setAdminPassword', (password) => {
        if (password === ADMIN_PASSWORD) {
            gameState.adminId = socket.id;
            console.log(`[ADMIN] Admin authenticated: ${socket.id}`);
            broadcastState();
        } else {
            console.log(`[ADMIN] Failed auth attempt from: ${socket.id}`);
            socket.emit('error', 'Wrong password!');
        }
    });

    // -------------------------------------------------------------------------
    // PLAYER MANAGEMENT
    // -------------------------------------------------------------------------
    socket.on('join', (playerName) => {
        const existingPlayer = gameState.players.find(p => p.id === socket.id);
        
        if (existingPlayer) {
            // Update name if already joined
            existingPlayer.name = playerName;
        } else {
            // Add new player
            gameState.players.push({
                id: socket.id,
                name: playerName,
                cards: [],
                balance: 0
            });
            console.log(`[PLAYER] ${playerName} joined (${socket.id})`);
        }
        broadcastState();
    });

    socket.on('removePlayer', (playerId) => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Only admin can remove players!');
            return;
        }
        
        const player = gameState.players.find(p => p.id === playerId);
        if (player) {
            // Return cards to deck
            gameState.deck.push(...player.cards);
            console.log(`[PLAYER] Removed: ${player.name}`);
        }
        
        gameState.players = gameState.players.filter(p => p.id !== playerId);
        broadcastState();
    });

    // -------------------------------------------------------------------------
    // DECK OPERATIONS (Admin Only)
    // -------------------------------------------------------------------------
    socket.on('shuffle', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Only admin can shuffle!');
            return;
        }
        
        gameState.deck = shuffleDeck(generateDeck());
        console.log(`[DECK] Shuffled by admin (${socket.id})`);
        broadcastState();
    });

    // -------------------------------------------------------------------------
    // DEALING CARDS (Admin Only)
    // -------------------------------------------------------------------------
    socket.on('dealToAll', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Only admin can deal!');
            return;
        }
        
        if (gameState.players.length === 0) {
            socket.emit('error', 'No players at table!');
            return;
        }
        
        if (gameState.deck.length < gameState.players.length) {
            socket.emit('error', 'Not enough cards! Shuffle first.');
            return;
        }
        
        // Deal one card to each player
        gameState.players.forEach(player => {
            const card = gameState.deck.pop();
            player.cards.push(card);
        });
        
        console.log(`[DEAL] Cards dealt to all ${gameState.players.length} players`);
        broadcastState();
    });

    socket.on('dealToCenter', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Only admin can deal!');
            return;
        }
        
        if (gameState.deck.length === 0) {
            socket.emit('error', 'Deck is empty! Shuffle first.');
            return;
        }
        
        gameState.centerCards.push(gameState.deck.pop());
        console.log(`[DEAL] Card dealt to center (${gameState.centerCards.length} total)`);
        broadcastState();
    });

    socket.on('dealToPlayer', (playerId) => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Only admin can deal!');
            return;
        }
        
        if (gameState.deck.length === 0) {
            socket.emit('error', 'Deck is empty! Shuffle first.');
            return;
        }
        
        const player = gameState.players.find(p => p.id === playerId);
        if (player) {
            player.cards.push(gameState.deck.pop());
            console.log(`[DEAL] Card dealt to ${player.name}`);
            broadcastState();
        }
    });

    // -------------------------------------------------------------------------
    // TABLE MANAGEMENT (Admin Only)
    // -------------------------------------------------------------------------
    socket.on('clearCenter', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Only admin can clear table!');
            return;
        }
        
        // Return center cards to deck and reshuffle
        gameState.deck.push(...gameState.centerCards);
        gameState.deck = shuffleDeck(gameState.deck);
        gameState.centerCards = [];
        
        console.log(`[TABLE] Center cleared, deck reshuffled`);
        broadcastState();
    });

    socket.on('returnCardToDeck', (cardIndex) => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Only admin can return cards!');
            return;
        }
        
        if (cardIndex >= 0 && cardIndex < gameState.centerCards.length) {
            const card = gameState.centerCards.splice(cardIndex, 1)[0];
            gameState.deck.push(card);
            console.log(`[CARD] Returned ${card.value}${card.suit} to deck`);
            broadcastState();
        }
    });

    // -------------------------------------------------------------------------
    // BALANCE MANAGEMENT (Player can update own, Admin can update anyone)
    // -------------------------------------------------------------------------
    socket.on('updateBalance', ({ playerId, amount }) => {
        const isOwnBalance = socket.id === playerId;
        
        if (!isAdmin(socket.id) && !isOwnBalance) {
            socket.emit('error', 'You can only update your own balance!');
            return;
        }
        
        const player = gameState.players.find(p => p.id === playerId);
        if (player) {
            player.balance = (player.balance || 0) + amount;
            console.log(`[BALANCE] ${player.name}: ${amount > 0 ? '+' : ''}${amount}`);
            broadcastState();
        }
    });

    // -------------------------------------------------------------------------
    // GAME RESET (Admin Only)
    // -------------------------------------------------------------------------
    socket.on('resetGame', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Only admin can reset game!');
            return;
        }
        
        gameState.deck = shuffleDeck(generateDeck());
        gameState.players = [];
        gameState.centerCards = [];
        gameState.currentPlayerIndex = 0;
        gameState.adminId = null;
        
        console.log(`[GAME] Reset by admin`);
        broadcastState();
    });

    // -------------------------------------------------------------------------
    // DEBUG FUNCTIONS (Admin Only) - FOR TESTING ONLY
    // -------------------------------------------------------------------------
    socket.on('debugShowDeck', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', 'Admin only!');
            return;
        }
        
        // Send deck to admin only (not broadcast)
        const deckInfo = gameState.deck.map((card, index) => {
            return { index: index + 1, ...card };
        });
        
        socket.emit('debugDeck', deckInfo);
        console.log(`[DEBUG] Deck sequence sent to admin (${deckInfo.length} cards)`);
    });

    // -------------------------------------------------------------------------
    // DISCONNECT
    // -------------------------------------------------------------------------
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
        
        // Optionally remove player on disconnect
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            // Keep player but mark as disconnected for reconnection handling
            console.log(`[PLAYER] ${player.name} disconnected`);
        }
    });
});

// =============================================================================
// START SERVER
// =============================================================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  🐲 CNY Card Game Server                                   ║
║  ==========================================================  ║
║  Server running on: http://0.0.0.0:${PORT}                   ║
║  Admin password: ${ADMIN_PASSWORD}                                     ║
║  ==========================================================  ║
║  Commands:                                                  ║
║    • shuffle    - Shuffle the deck                         ║
║    • dealToAll  - Deal 1 card to each player               ║
║    • dealToCenter - Deal 1 card to table center            ║
║    • clearCenter - Return center cards and reshuffle        ║
║    • resetGame  - Reset everything                          ║
╚════════════════════════════════════════════════════════════╝
    `);
});
