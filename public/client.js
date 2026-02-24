const socket = io();

// PeerJS for video calls
let peer = null;
let myPeerId = null;
let myStream = null;
const calls = {};

document.addEventListener('DOMContentLoaded', () => {
  const playerNameInput = document.getElementById('playerName');
  const joinBtn = document.getElementById('joinBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const dealTableBtn = document.getElementById('dealTableBtn');
  const clearTableBtn = document.getElementById('clearTableBtn');
  const resetBtn = document.getElementById('resetBtn');

  // Join game
  joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) {
      alert('Please enter your name');
      return;
    }
    socket.emit('join', name);
    playerNameInput.disabled = true;
    joinBtn.disabled = true;
    joinBtn.textContent = 'Joined!';
    
    // Initialize PeerJS after joining
    initPeerJS(name);
  });

  // Shuffle deck
  shuffleBtn.addEventListener('click', () => {
    socket.emit('shuffle');
  });

  // Deal to table
  dealTableBtn.addEventListener('click', () => {
    socket.emit('dealToTable', 1);
  });

  // Clear table
  clearTableBtn.addEventListener('click', () => {
    socket.emit('clearTable');
  });

  // Reset game
  resetBtn.addEventListener('click', () => {
    if (confirm('Reset game? This will redistribute all cards.')) {
      socket.emit('reset');
    }
  });

  // Socket events
  socket.on('updatePlayers', (players) => {
    renderPlayers(players);
  });

  socket.on('updateTable', ({ tableCards, deckCount }) => {
    document.getElementById('deckCount').textContent = deckCount;
    renderTableCards(tableCards);
  });

  socket.on('error', (msg) => {
    alert(msg);
  });
});

function initPeerJS(name) {
  peer = new Peer();

  peer.on('open', (id) => {
    myPeerId = id;
    socket.emit('setPeerId', id);
    startVideo();
  });

  peer.on('call', (call) => {
    call.answer(myStream);
    call.on('stream', (remoteStream) => {
      addVideoStream(call.peer, remoteStream);
    });
  });
}

async function startVideo() {
  try {
    myStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    addVideoStream(myPeerId, myStream, true);
    
    // Notify others to call me
    socket.emit('setPeerId', myPeerId);
  } catch (err) {
    console.log('Could not get video:', err);
  }
}

function addVideoStream(peerId, stream, isMine = false) {
  const videoGrid = document.getElementById('videoGrid');
  
  // Remove existing if any
  const existing = document.getElementById(`video-${peerId}`);
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = `video-${peerId}`;
  
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = isMine;
  if (isMine) video.classList.add('my-video');
  
  div.appendChild(video);
  videoGrid.appendChild(div);

  // Call all existing peers
  if (!isMine && peer) {
    const call = peer.call(peerId, myStream);
    call.on('stream', (remoteStream) => {
      addVideoStream(peerId, remoteStream);
    });
  }
}

function renderPlayers(players) {
  const grid = document.getElementById('playersGrid');
  grid.innerHTML = '';

  players.forEach(player => {
    const div = document.createElement('div');
    div.className = 'player-card';
    
    const isMe = player.id === socket.id;
    const cardsHtml = player.cards.map(card => 
      `<div class="card ${card.color}">${card.value}${card.suit}</div>`
    ).join('');

    div.innerHTML = `
      <div class="player-header">
        <span class="player-name">${player.name} ${isMe ? '(You)' : ''}</span>
        ${!isMe ? `<button class="remove-btn" data-id="${player.id}">Remove</button>` : ''}
      </div>
      <div class="player-cards">
        ${cardsHtml || '<span style="color:#666">No cards</span>'}
      </div>
      ${!isMe ? `<button class="deal-btn" data-id="${player.id}">Deal 1 Card</button>` : ''}
    `;
    
    grid.appendChild(div);
  });

  // Add event listeners
  document.querySelectorAll('.deal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('dealToPlayer', btn.dataset.id);
    });
  });

  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('removePlayer', btn.dataset.id);
    });
  });
}

function renderTableCards(cards) {
  const container = document.getElementById('tableCards');
  
  if (cards.length === 0) {
    container.innerHTML = '<p class="empty-msg">No cards on table</p>';
    return;
  }

  container.innerHTML = cards.map(card => 
    `<div class="card ${card.color}">${card.value}${card.suit}</div>`
  ).join('');
}
