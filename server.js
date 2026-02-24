const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
  deck: [],
  players: [],
  centerCards: [],
  currentPlayerIndex: 0,
  adminId: null,
  adminPassword: '8888'
};

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

gameState.deck = shuffleDeck(generateDeck());

function isAdmin(socketId) {
  return gameState.adminId && socketId === gameState.adminId;
}

function broadcastState() {
  io.emit('updateGame', gameState);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.emit('updateGame', gameState);

  socket.on('setAdminPassword', (password) => {
    if (password === gameState.adminPassword) {
      gameState.adminId = socket.id;
      broadcastState();
    } else {
      socket.emit('error', 'Wrong password!');
    }
  });

  socket.on('join', (playerName) => {
    const existingPlayer = gameState.players.find(p => p.id === socket.id);
    if (existingPlayer) {
      existingPlayer.name = playerName;
    } else {
      gameState.players.push({
        id: socket.id,
        name: playerName,
        cards: [],
        balance: 0
      });
    }
    broadcastState();
  });

  socket.on('shuffle', () => {
    if (!isAdmin(socket.id)) { socket.emit('error', 'Only admin can shuffle!'); return; }
    gameState.deck = shuffleDeck(generateDeck());
    broadcastState();
  });

  socket.on('dealToAll', () => {
    if (gameState.players.length === 0) {
      socket.emit('error', 'No players at table!');
      return;
    }
    if (gameState.deck.length < gameState.players.length) {
      socket.emit('error', 'Not enough cards! Shuffle first.');
      return;
    }
    gameState.players.forEach(player => {
      const card = gameState.deck.pop();
      player.cards.push(card);
    });
    broadcastState();
  });

  socket.on('dealToCenter', () => {
    if (!isAdmin(socket.id)) { socket.emit('error', 'Only admin can deal!'); return; }
    if (gameState.deck.length === 0) {
      socket.emit('error', 'Deck is empty! Shuffle first.');
      return;
    }
    gameState.centerCards.push(gameState.deck.pop());
    broadcastState();
  });

  socket.on('clearCenter', () => {
    if (!isAdmin(socket.id)) { socket.emit('error', 'Only admin!'); return; }
    gameState.deck.push(...gameState.centerCards);
    gameState.deck = shuffleDeck(gameState.deck);
    gameState.centerCards = [];
    broadcastState();
  });

  socket.on('dealToPlayer', (playerId) => {
    if (!isAdmin(socket.id)) { socket.emit('error', 'Only admin can deal!'); return; }
    if (gameState.deck.length === 0) {
      socket.emit('error', 'Deck is empty! Shuffle first.');
      return;
    }
    const player = gameState.players.find(p => p.id === playerId);
    if (player) {
      player.cards.push(gameState.deck.pop());
      broadcastState();
    }
  });

  socket.on('updateBalance', ({ playerId, amount }) => {
    if (!isAdmin(socket.id)) { socket.emit('error', 'Only admin can update balance!'); return; }
    const player = gameState.players.find(p => p.id === playerId);
    if (player) {
      player.balance = (player.balance || 0) + amount;
      broadcastState();
    }
  });

  socket.on('resetGame', () => {
    if (!isAdmin(socket.id)) { socket.emit('error', 'Only admin can reset!'); return; }
    gameState.deck = shuffleDeck(generateDeck());
    gameState.players = [];
    gameState.centerCards = [];
    gameState.currentPlayerIndex = 0;
    gameState.adminId = null;
    broadcastState();
  });

  socket.on('removePlayer', (playerId) => {
    if (!isAdmin(socket.id)) { socket.emit('error', 'Only admin can remove players!'); return; }
    const player = gameState.players.find(p => p.id === playerId);
    if (player) {
      gameState.deck.push(...player.cards);
    }
    gameState.players = gameState.players.filter(p => p.id !== playerId);
    broadcastState();
  });

  socket.on('returnCardToDeck', (cardIndex) => {
    if (!isAdmin(socket.id)) { socket.emit('error', 'Only admin!'); return; }
    if (cardIndex >= 0 && cardIndex < gameState.centerCards.length) {
      const card = gameState.centerCards.splice(cardIndex, 1)[0];
      gameState.deck.push(card);
      broadcastState();
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
