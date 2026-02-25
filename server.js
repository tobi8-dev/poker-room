/**
 * CNY Card Game Server - Blackjack v2.0
 * ====================
 * Proper Blackjack with multi-player support
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = '8888';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// =============================================================================
// GAME STATE
// =============================================================================
let deck = [];
let adminId = null;

// Blackjack game state
let blackjack = {
    phase: 'waiting', // waiting, betting, dealing, playerTurn, dealerTurn, settled
    dealerCards: [],
    players: {}, // socketId -> { name, cards, bet, balance, standing, busted, result }
    currentPlayerIndex: [],
    dealerScore: 0
};

// =============================================================================
// CARD UTILITIES
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

function getCardValue(card) {
    if (['J', 'Q', 'K'].includes(card.value)) return 10;
    if (card.value === 'A') return 11;
    return parseInt(card.value);
}

function calculateScore(cards) {
    let score = 0;
    let aces = 0;
    for (const card of cards) {
        score += getCardValue(card);
        if (card.value === 'A') aces++;
    }
    while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
    }
    return score;
}

function isBlackjack(cards) {
    return cards.length === 2 && calculateScore(cards) === 21;
}

function initDeck() {
    deck = shuffleDeck(generateDeck());
}

function drawCard() {
    if (deck.length < 10) initDeck(); // Reshuffle if low
    return deck.pop();
}

initDeck();

// =============================================================================
// GAME LOGIC
// =============================================================================

function startNewRound() {
    blackjack = {
        phase: 'betting',
        dealerCards: [],
        players: {},
        currentPlayerIndex: [],
        dealerScore: 0
    };
    broadcastGameState();
}

function placeBet(socketId, bet) {
    const player = blackjack.players[socketId];
    if (!player || player.bet > 0) return false;
    if (bet < 1 || bet > player.balance) return false;
    
    player.balance -= bet;
    player.bet = bet;
    player.cards = [];
    player.standing = false;
    player.busted = false;
    player.result = null;
    
    // Check if we can start dealing (all players with balance > 0 have bet)
    const playersWithBalance = Object.keys(blackjack.players).filter(id => blackjack.players[id].balance > 0);
    const allBet = playersWithBalance.every(id => blackjack.players[id].bet > 0);
    
    if (allBet && playersWithBalance.length > 0 && blackjack.phase === 'betting') {
        startDealing();
    }
    
    broadcastGameState();
    broadcastBalance(socketId);
    return true;
}

function startDealing() {
    blackjack.phase = 'dealing';
    
    // Deal 2 cards to each player
    for (const id in blackjack.players) {
        if (blackjack.players[id].bet > 0) {
            blackjack.players[id].cards.push(drawCard());
            blackjack.players[id].cards.push(drawCard());
        }
    }
    
    // Deal 2 cards to dealer
    blackjack.dealerCards.push(drawCard());
    blackjack.dealerCards.push(drawCard());
    
    // Check for blackjacks
    let hasBlackjack = false;
    for (const id in blackjack.players) {
        const player = blackjack.players[id];
        if (player.bet > 0 && isBlackjack(player.cards)) {
            player.result = 'blackjack';
            hasBlackjack = true;
        }
    }
    
    const dealerBlackjack = isBlackjack(blackjack.dealerCards);
    
    if (hasBlackjack || dealerBlackjack) {
        blackjack.phase = 'settled';
        blackjack.dealerScore = calculateScore(blackjack.dealerCards);
        
        // Settle all bets
        for (const id in blackjack.players) {
            const player = blackjack.players[id];
            if (player.bet === 0) continue;
            
            if (dealerBlackjack && isBlackjack(player.cards)) {
                player.result = 'push';
                player.balance += player.bet;
            } else if (dealerBlackjack) {
                player.result = 'lose';
            } else if (player.result === 'blackjack') {
                player.result = 'blackjack';
                player.balance += Math.floor(player.bet * 2.5);
            }
            player.bet = 0;
            broadcastBalance(id);
        }
    } else {
        // Set up turn order
        blackjack.currentPlayerIndex = Object.keys(blackjack.players).filter(id => blackjack.players[id].bet > 0);
        blackjack.phase = 'playerTurn';
    }
    
    broadcastGameState();
}

function hit(socketId) {
    const player = blackjack.players[socketId];
    if (!player || player.bet === 0 || player.standing || player.busted) return;
    
    // Check if it's this player's turn
    const currentIdx = blackjack.currentPlayerIndex.indexOf(socketId);
    if (currentIdx !== 0) return; // Not this player's turn
    
    player.cards.push(drawCard());
    const score = calculateScore(player.cards);
    
    if (score > 21) {
        player.busted = true;
        player.result = 'bust';
        nextTurn();
    } else if (score === 21) {
        player.standing = true;
        nextTurn();
    }
    
    broadcastGameState();
}

function stand(socketId) {
    const player = blackjack.players[socketId];
    if (!player || player.bet === 0) return;
    
    const currentIdx = blackjack.currentPlayerIndex.indexOf(socketId);
    if (currentIdx !== 0) return;
    
    player.standing = true;
    nextTurn();
    broadcastGameState();
}

function double(socketId) {
    const player = blackjack.players[socketId];
    if (!player || player.bet === 0 || player.cards.length !== 2) return;
    if (player.balance < player.bet) return;
    
    const currentIdx = blackjack.currentPlayerIndex.indexOf(socketId);
    if (currentIdx !== 0) return;
    
    player.balance -= player.bet;
    player.bet *= 2;
    player.cards.push(drawCard());
    
    const score = calculateScore(player.cards);
    if (score > 21) {
        player.busted = true;
        player.result = 'bust';
    } else {
        player.standing = true;
    }
    
    broadcastBalance(socketId);
    nextTurn();
    broadcastGameState();
}

function nextTurn() {
    blackjack.currentPlayerIndex.shift();
    
    if (blackjack.currentPlayerIndex.length === 0) {
        dealerPlay();
    }
}

function dealerPlay() {
    blackjack.phase = 'dealerTurn';
    blackjack.dealerScore = calculateScore(blackjack.dealerCards);
    
    // Dealer hits on soft 17
    while (blackjack.dealerScore < 17) {
        blackjack.dealerCards.push(drawCard());
        blackjack.dealerScore = calculateScore(blackjack.dealerCards);
    }
    
    settleBets();
    broadcastGameState();
}

function settleBets() {
    blackjack.phase = 'settled';
    
    for (const id in blackjack.players) {
        const player = blackjack.players[id];
        if (player.bet === 0) continue;
        
        const playerScore = calculateScore(player.cards);
        
        if (player.busted) {
            player.result = 'bust';
        } else if (blackjack.dealerScore > 21) {
            player.result = 'win';
            player.balance += player.bet * 2;
        } else if (playerScore > blackjack.dealerScore) {
            player.result = 'win';
            player.balance += player.bet * 2;
        } else if (playerScore < blackjack.dealerScore) {
            player.result = 'lose';
        } else {
            player.result = 'push';
            player.balance += player.bet;
        }
        
        player.bet = 0;
        broadcastBalance(id);
    }
}

function startNextRound() {
    // Remove players with 0 balance
    for (const id in blackjack.players) {
        if (blackjack.players[id].balance === 0) {
            delete blackjack.players[id];
        } else {
            blackjack.players[id].cards = [];
            blackjack.players[id].bet = 0;
            blackjack.players[id].standing = false;
            blackjack.players[id].busted = false;
            blackjack.players[id].result = null;
        }
    }
    
    if (deck.length < 20) initDeck();
    
    startNewRound();
}

// =============================================================================
// BROADCAST
// =============================================================================

function broadcastGameState() {
    const state = {
        phase: blackjack.phase,
        dealerCards: blackjack.dealerCards,
        dealerScore: blackjack.dealerScore,
        players: {},
        currentPlayerId: blackjack.currentPlayerIndex.length > 0 ? blackjack.currentPlayerIndex[0] : null
    };
    
    for (const id in blackjack.players) {
        const p = blackjack.players[id];
        state.players[id] = {
            name: p.name,
            cards: p.cards,
            score: calculateScore(p.cards),
            bet: p.bet,
            balance: p.balance,
            standing: p.standing,
            busted: p.busted,
            result: p.result,
            isMe: false // Client will set this
        };
    }
    
    io.emit('gameState', state);
}

function broadcastBalance(socketId) {
    const player = blackjack.players[socketId];
    if (player) {
        io.to(socketId).emit('balanceUpdate', player.balance);
    }
}

// =============================================================================
// SOCKET HANDLERS
// =============================================================================

io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);
    
    // Send current state
    socket.emit('gameState', {
        phase: 'waiting',
        dealerCards: [],
        dealerScore: 0,
        players: {},
        currentPlayerId: null
    });

    // Join game
    socket.on('joinGame', ({ name }) => {
        if (!blackjack.players[socket.id]) {
            blackjack.players[socket.id] = {
                name: name,
                cards: [],
                bet: 0,
                balance: 100,
                standing: false,
                busted: false,
                result: null
            };
            console.log(`[PLAYER] ${name} joined`);
        }
        
        broadcastBalance(socket.id);
        
        // Start new round if not already in progress
        if (blackjack.phase === 'waiting') {
            startNewRound();
        } else if (blackjack.phase === 'settled') {
            // Ready for next round
            startNewRound();
        }
        
        broadcastGameState();
    });

    // Place bet
    socket.on('placeBet', ({ bet }) => {
        placeBet(socket.id, bet);
    });

    // Game actions
    socket.on('hit', () => hit(socket.id));
    socket.on('stand', () => stand(socket.id));
    socket.on('double', () => double(socket.id));
    
    // Start next round
    socket.on('nextRound', () => {
        startNextRound();
    });

    // Admin
    socket.on('setAdmin', ({ password }) => {
        if (password === ADMIN_PASSWORD) {
            adminId = socket.id;
            socket.emit('adminSet', true);
        } else {
            socket.emit('error', 'Wrong password!');
        }
    });
    
    socket.on('adminReset', () => {
        if (socket.id !== adminId) return;
        for (const id in blackjack.players) {
            blackjack.players[id].balance = 100;
            broadcastBalance(id);
        }
        initDeck();
        startNewRound();
    });

    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] ${socket.id}`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  🃏 Blackjack Server v2.0                               ║
║  Server: http://0.0.0.0:${PORT}                          ║
║  Admin: ${ADMIN_PASSWORD}                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});
