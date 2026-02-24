# 🃏 🐲 CNY Card Game - Multiplayer Card Game

A real-time multiplayer card game built with Node.js, Express, and Socket.io.

## Features

- **Multiplayer** - Multiple players can join and play together in real-time
- **Admin Controls** - Password-protected admin (password: `secret123`)
- **Card Dealing** - Deal to all players, deal to table, shuffle deck
- **Player Balances** - Track player balances with +1/+5/+10/-1/-5/-10 controls
- **Real-time Sync** - All actions sync instantly across all connected players

## How to Play

1. Open the game in your browser
2. Enter your name and click "Join Table"
3. Enter admin password (`secret123`) and click "Set Admin" to get admin controls
4. Use admin controls to shuffle, deal cards, and manage players

## Running Locally

```bash
cd poker-room
npm install
node server.js
```

Then open http://localhost:3000

## Deployment

The game is currently deployed at: https://castellated-elvera-strapped.ngrok-free.dev

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: HTML, CSS, JavaScript
- **Real-time**: Socket.io for WebSocket communication

## License

MIT
