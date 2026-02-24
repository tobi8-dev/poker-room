# 🃏 🐲 CNY Card Game - Multiplayer Card Game

A real-time multiplayer card game built with Node.js, Express, and Socket.IO.

## 🎮 Features

- **Multiplayer** - Multiple players can join and play together in real-time
- **Admin Controls** - Password-protected admin (password: `8888`)
- **Card Dealing** - Deal to all players, deal to table, shuffle deck
- **Player Balances** - Track player balances with +1/+5/+10/-1/-5/-10 controls
- **Real-time Sync** - All actions sync instantly across all connected players
- **Debug Mode** - Admin can view complete deck sequence for testing

## 🚀 Live URL

**https://cny-card-game.onrender.com**

> ⚠️ **Note**: Free tier on Render may take 30-50 seconds to wake up after inactivity.

## 🔐 Admin Password

```
8888
```

## 🎯 How to Use

### For Players:
1. Open the game URL
2. Enter your name and click **Join Table**
3. Wait for the admin to deal cards

### For Admin:
1. Enter admin password (`8888`) in the password field
2. Click **Set Admin** to unlock admin controls:
   - 🔀 **Shuffle** - Shuffle the deck
   - 🎯 **Deal to All** - Deal 1 card to each player
   - 📤 **Deal to Table** - Deal 1 card to center
   - 🗑️ **Clear Table** - Return table cards to deck and reshuffle
   - 🔄 **Reset** - Reset entire game
   - 🔍 **Debug Deck** - View full card sequence (for testing)
   - **+1/+5/+10/-1/-5/-10** - Adjust player balances
   - **Remove** - Kick a player from the table

## 🛠️ Running Locally

```bash
# Clone the repository
git clone https://github.com/tobi8-dev/cny-card-game.git
cd cny-card-game

# Install dependencies
npm install

# Start the server
node server.js
```

Then open **http://localhost:3000**

## 🔧 Debug Feature

The debug button (🔍 Debug Deck) is only visible to admin and shows:
- Complete deck sequence from top to bottom
- Card index number for each card
- Color coding (red/black)

This is for testing the randomness of the shuffle algorithm. **Hide or disable this in production.**

## 📦 Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Express |
| Real-time | Socket.IO |
| Frontend | HTML, CSS, Vanilla JavaScript |
| Hosting | Render (Free tier) |

## 🐛 Shuffle Algorithm

Uses **Fisher-Yates shuffle** - the same algorithm used by online casinos:
- Truly random - no bias
- Every card has equal probability
- 52! possible combinations (~8×10^67)

## 📄 License

MIT
