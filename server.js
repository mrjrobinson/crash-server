const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── Serve a simple status page ──
app.get('/', (req, res) => {
  res.send(`
    <html><head><title>Crash Server</title>
    <style>body{font-family:sans-serif;background:#0e1a12;color:#f0f4f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
    .box{text-align:center;}.title{font-size:3rem;color:#f5c842;font-weight:900;}.sub{color:#7a9e82;margin-top:8px;}</style></head>
    <body><div class="box"><div class="title">CRASH</div>
    <div class="sub">Multiplayer server running ✓</div>
    <div class="sub" style="margin-top:16px">Rooms active: ${Object.keys(rooms).length}</div>
    </div></body></html>
  `);
});

// ── Room state ──
// rooms[code] = { code, players, state, phase, hostId }
const rooms = {};

function broadcastActiveGames() {
  // Count rooms where a game is actively in progress (not just in the lobby)
  const count = Object.values(rooms).filter(r =>
    r.phase === 'building' || r.phase === 'revealing' ||
    r.phase === 'between_deals' || r.phase === 'six_pairs'
  ).length;
  io.emit('active_games', { count });
}
const sbRooms = {}; // live scoreboard sessions

// ── Scoreboard helpers ──
function sbSummary(room) {
  return {
    code: room.code,
    scorerId: room.scorerId,
    players: room.players,
    target: room.target,
    stakePerPoint: room.stakePerPoint,
    winnerId: room.winnerId,
    dealerStartId: room.dealerStartId,
    members: room.members.map(m => ({ id: m.id, name: m.name, connected: m.connected }))
  };
}

// ── Game constants (mirrored from client) ──
const SUITS = [
  { key: 'S', symbol: '♠', colour: 'black' },
  { key: 'H', symbol: '♥', colour: 'red' },
  { key: 'D', symbol: '♦', colour: 'red' },
  { key: 'C', symbol: '♣', colour: 'black' }
];
const VALUE_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const DESC_ORDER  = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
const DISP_LONG = {A:'Ace',K:'King',Q:'Queen',J:'Jack',10:'10',9:'9',8:'8',7:'7',6:'6',5:'5',4:'4',3:'3',2:'2'};

function dvl(v) { return DISP_LONG[v] || v; }
function valueToRank(v) { return VALUE_ORDER.indexOf(v) + 2; }

function createDeck() {
  const d = [];
  for (const s of SUITS)
    for (const v of VALUE_ORDER)
      d.push({ id: `${v}${s.key}`, value: v, suit: s.key, symbol: s.symbol, colour: s.colour });
  return d;
}
function shuffle(deck) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sortCards(cards) {
  return cards.slice().sort((a, b) => {
    const ra = DESC_ORDER.indexOf(a.value), rb = DESC_ORDER.indexOf(b.value);
    if (ra !== rb) return ra - rb;
    return a.suit.localeCompare(b.suit);
  });
}

// ── Hand evaluation (server-side for scoring authority) ──
const RANKINGS = {
  prial: ["3 x 3s","3 x Ace's","3 x Kings","3 x Queens","3 x Jacks","3 x 10's","3 x 9's","3 x 8's","3 x 7's","3 x 6's","3 x 5's","3 x 4's","3 x 2's"],
  onTheBounce: ["Ace, 2, 3","Ace, King, Queen","King, Queen, Jack","Queen, Jack, 10","Jack, 10, 9","10, 9, 8","9, 8, 7","8, 7, 6","7, 6, 5","6, 5, 4","5, 4, 3","4, 3, 2"],
  run: ["Ace, 2, 3","Ace, King, Queen","King, Queen, Jack","Queen, Jack, 10","Jack, 10, 9","10, 9, 8","9, 8, 7","8, 7, 6","7, 6, 5","6, 5, 4","5, 4, 3","4, 3, 2"],
  flush: ["Ace, King, Jack","Ace, King, 10","Ace, King, 9","Ace, King, 8","Ace, King, 7","Ace, King, 6","Ace, King, 5","Ace, King, 4","Ace, King, 3","Ace, King, 2","Ace, Queen, Jack","Ace, Queen, 10","Ace, Queen, 9","Ace, Queen, 8","Ace, Queen, 7","Ace, Queen, 6","Ace, Queen, 5","Ace, Queen, 4","Ace, Queen, 3","Ace, Queen, 2","Ace, Jack, 10","Ace, Jack, 9","Ace, Jack, 8","Ace, Jack, 7","Ace, Jack, 6","Ace, Jack, 5","Ace, Jack, 4","Ace, Jack, 3","Ace, Jack, 2","Ace, 10, 9","Ace, 10, 8","Ace, 10, 7","Ace, 10, 6","Ace, 10, 5","Ace, 10, 4","Ace, 10, 3","Ace, 10, 2","Ace, 9, 8","Ace, 9, 7","Ace, 9, 6","Ace, 9, 5","Ace, 9, 4","Ace, 9, 3","Ace, 9, 2","Ace, 8, 7","Ace, 8, 6","Ace, 8, 5","Ace, 8, 4","Ace, 8, 3","Ace, 8, 2","Ace, 7, 6","Ace, 7, 5","Ace, 7, 4","Ace, 7, 3","Ace, 7, 2","Ace, 6, 5","Ace, 6, 4","Ace, 6, 3","Ace, 6, 2","Ace, 5, 4","Ace, 5, 3","Ace, 5, 2","Ace, 4, 3","Ace, 4, 2","Ace, 3, 2","King, Queen, 10","King, Queen, 9","King, Queen, 8","King, Queen, 7","King, Queen, 6","King, Queen, 5","King, Queen, 4","King, Queen, 3","King, Queen, 2","King, Jack, 10","King, Jack, 9","King, Jack, 8","King, Jack, 7","King, Jack, 6","King, Jack, 5","King, Jack, 4","King, Jack, 3","King, Jack, 2","King, 10, 9","King, 10, 8","King, 10, 7","King, 10, 6","King, 10, 5","King, 10, 4","King, 10, 3","King, 10, 2","King, 9, 8","King, 9, 7","King, 9, 6","King, 9, 5","King, 9, 4","King, 9, 3","King, 9, 2","King, 8, 7","King, 8, 6","King, 8, 5","King, 8, 4","King, 8, 3","King, 8, 2","King, 7, 6","King, 7, 5","King, 7, 4","King, 7, 3","King, 7, 2","King, 6, 5","King, 6, 4","King, 6, 3","King, 6, 2","King, 5, 4","King, 5, 3","King, 5, 2","King, 4, 3","King, 4, 2","King, 3, 2","Queen, Jack, 9","Queen, Jack, 8","Queen, Jack, 7","Queen, Jack, 6","Queen, Jack, 5","Queen, Jack, 4","Queen, Jack, 3","Queen, Jack, 2","Queen, 10, 9","Queen, 10, 8","Queen, 10, 7","Queen, 10, 6","Queen, 10, 5","Queen, 10, 4","Queen, 10, 3","Queen, 10, 2","Queen, 9, 8","Queen, 9, 7","Queen, 9, 6","Queen, 9, 5","Queen, 9, 4","Queen, 9, 3","Queen, 9, 2","Queen, 8, 7","Queen, 8, 6","Queen, 8, 5","Queen, 8, 4","Queen, 8, 3","Queen, 8, 2","Queen, 7, 6","Queen, 7, 5","Queen, 7, 4","Queen, 7, 3","Queen, 7, 2","Queen, 6, 5","Queen, 6, 4","Queen, 6, 3","Queen, 6, 2","Queen, 5, 4","Queen, 5, 3","Queen, 5, 2","Queen, 4, 3","Queen, 4, 2","Queen, 3, 2","Jack, 10, 8","Jack, 10, 7","Jack, 10, 6","Jack, 10, 5","Jack, 10, 4","Jack, 10, 3","Jack, 10, 2","Jack, 9, 8","Jack, 9, 7","Jack, 9, 6","Jack, 9, 5","Jack, 9, 4","Jack, 9, 3","Jack, 9, 2","Jack, 8, 7","Jack, 8, 6","Jack, 8, 5","Jack, 8, 4","Jack, 8, 3","Jack, 8, 2","Jack, 7, 6","Jack, 7, 5","Jack, 7, 4","Jack, 7, 3","Jack, 7, 2","Jack, 6, 5","Jack, 6, 4","Jack, 6, 3","Jack, 6, 2","Jack, 5, 4","Jack, 5, 3","Jack, 5, 2","Jack, 4, 3","Jack, 4, 2","Jack, 3, 2","10, 9, 7","10, 9, 6","10, 9, 5","10, 9, 4","10, 9, 3","10, 9, 2","10, 8, 7","10, 8, 6","10, 8, 5","10, 8, 4","10, 8, 3","10, 8, 2","10, 7, 6","10, 7, 5","10, 7, 4","10, 7, 3","10, 7, 2","10, 6, 5","10, 6, 4","10, 6, 3","10, 6, 2","10, 5, 4","10, 5, 3","10, 5, 2","10, 4, 3","10, 4, 2","10, 3, 2","9, 8, 6","9, 8, 5","9, 8, 4","9, 8, 3","9, 8, 2","9, 7, 6","9, 7, 5","9, 7, 4","9, 7, 3","9, 7, 2","9, 6, 5","9, 6, 4","9, 6, 3","9, 6, 2","9, 5, 4","9, 5, 3","9, 5, 2","9, 4, 3","9, 4, 2","9, 3, 2","8, 7, 5","8, 7, 4","8, 7, 3","8, 7, 2","8, 6, 5","8, 6, 4","8, 6, 3","8, 6, 2","8, 5, 4","8, 5, 3","8, 5, 2","8, 4, 3","8, 4, 2","8, 3, 2","7, 6, 4","7, 6, 3","7, 6, 2","7, 5, 4","7, 5, 3","7, 5, 2","7, 4, 3","7, 4, 2","7, 3, 2","6, 5, 3","6, 5, 2","6, 4, 3","6, 4, 2","6, 3, 2","5, 4, 2","5, 3, 2"],
  pair: ["2 x Ace's","2 x Kings","2 x Queens","2 x Jacks","2 x 10's","2 x 9's","2 x 8's","2 x 7's","2 x 6's","2 x 5's","2 x 4's","2 x 3's","2 x 2's"]
};

const rankMaps = {
  prial: new Map(RANKINGS.prial.map((t,i) => [t,i])),
  onTheBounce: new Map(RANKINGS.onTheBounce.map((t,i) => [t,i])),
  run: new Map(RANKINGS.run.map((t,i) => [t,i])),
  flush: new Map(RANKINGS.flush.map((t,i) => [t,i])),
  pair: new Map(RANKINGS.pair.map((t,i) => [t,i]))
};

function countsByValue(cards) {
  const m = new Map();
  for (const c of cards) m.set(c.value, (m.get(c.value) || 0) + 1);
  return m;
}
function getRunSeq(cards) {
  const vals = [...new Set(cards.map(c => c.value))];
  if (vals.length !== 3) return null;
  const wheel = ['A','2','3'].every(v => vals.includes(v));
  const royal = ['Q','K','A'].every(v => vals.includes(v));
  if (wheel) return 'Ace, 2, 3';
  if (royal) return 'Ace, King, Queen';
  const asc = vals.slice().sort((a,b) => valueToRank(a) - valueToRank(b));
  const n = asc.map(v => valueToRank(v));
  if (n[0]+1===n[1] && n[1]+1===n[2]) return asc.slice().reverse().map(dvl).join(', ');
  return null;
}
function getFlushLabel(cards) {
  const vals = [...new Set(cards.map(c => c.value))];
  if (vals.length !== 3) return null;
  return vals.slice().sort((a,b) => DESC_ORDER.indexOf(a) - DESC_ORDER.indexOf(b)).map(dvl).join(', ');
}
function getPrialLabel(cards) {
  const m = countsByValue(cards); if (m.size !== 1) return null;
  const v = cards[0].value; const s = ['K','Q','J','3'].includes(v) ? 's' : "'s";
  return `3 x ${dvl(v)}${s}`;
}
function getPairLabel(cards) {
  const m = countsByValue(cards);
  const e = [...m.entries()].find(([,c]) => c === 2); if (!e) return null;
  const v = e[0]; const s = ['K','Q','J'].includes(v) ? 's' : "'s";
  return `2 x ${dvl(v)}${s}`;
}
function evaluateHand(cards) {
  if (!cards || cards.length < 2 || cards.length > 3) return null;
  if (cards.length === 2) {
    const prl = getPairLabel(cards);
    if (prl && rankMaps.pair.has(prl)) return { kind:'Pair', rankGroup:1, rankingIndex:rankMaps.pair.get(prl), rankingText:prl };
    return null;
  }
  const pl = getPrialLabel(cards);
  if (pl && rankMaps.prial.has(pl)) return { kind:'Prial', rankGroup:5, rankingIndex:rankMaps.prial.get(pl), rankingText:pl };
  const same = cards.every(c => c.suit === cards[0].suit);
  const rt = getRunSeq(cards);
  if (same && rt && rankMaps.onTheBounce.has(rt)) return { kind:'On The Bounce', rankGroup:4, rankingIndex:rankMaps.onTheBounce.get(rt), rankingText:rt };
  if (rt && rankMaps.run.has(rt)) return { kind:'Run', rankGroup:3, rankingIndex:rankMaps.run.get(rt), rankingText:rt };
  if (same) { const fl = getFlushLabel(cards); if (fl && rankMaps.flush.has(fl)) return { kind:'Flush', rankGroup:2, rankingIndex:rankMaps.flush.get(fl), rankingText:fl }; }
  const prl = getPairLabel(cards);
  if (prl && rankMaps.pair.has(prl)) return { kind:'Pair', rankGroup:1, rankingIndex:rankMaps.pair.get(prl), rankingText:prl };
  return null;
}
function compareHands(a, b) {
  if (!a && !b) return 0; if (!a) return -1; if (!b) return 1;
  if (a.rankGroup !== b.rankGroup) return a.rankGroup > b.rankGroup ? 1 : -1;
  if (a.rankingIndex !== b.rankingIndex) return a.rankingIndex < b.rankingIndex ? 1 : -1;
  return 0;
}
function hasFourThrees(cards) { return cards.filter(c => c.value === '3').length === 4; }
function hasFourOfAKind(cards) {
  const m = countsByValue(cards);
  for (const [v, c] of m.entries()) if (c === 4) return v;
  return null;
}
function handsInOrder(hands) {
  let lastEval = null;
  for (const hand of hands) {
    const ev = evaluateHand(hand);
    if (!ev) continue;
    if (lastEval && compareHands(ev, lastEval) > 0) return false;
    lastEval = ev;
  }
  return true;
}

// ── Room helpers ──
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms[code]);
  return code;
}

function roomSummary(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      ready: p.ready,
      submitted: p.submitted,
      connected: p.connected
    })),
    currentDeal: room.currentDeal,
    carryPoints: room.carryPoints,
    hostId: room.hostId
  };
}

function scoreRound(room, roundIndex) {
  const played = room.players.map(player => {
    const cards = (player.hands || [])[roundIndex] || [];
    const ev = evaluateHand(cards);
    return { playerId: player.id, player: player.name, cards, eval: ev, status: ev ? 'played' : 'ignored' };
  });
  let remaining = played.filter(p => p.eval).slice();
  let winner = null;
  const cancelledIds = new Set();
  while (remaining.length > 0 && !winner) {
    remaining.sort((a,b) => -compareHands(a.eval, b.eval));
    const top = remaining[0];
    const ties = remaining.filter(x => compareHands(x.eval, top.eval) === 0);
    if (ties.length === 1) { winner = top; break; }
    ties.forEach(t => cancelledIds.add(t.playerId));
    remaining = remaining.filter(x => !cancelledIds.has(x.playerId));
  }
  played.forEach(p => {
    if (!p.eval) p.status = 'ignored';
    else if (winner && p.playerId === winner.playerId) p.status = 'winner';
    else if (cancelledIds.has(p.playerId)) p.status = 'cancelled';
    else p.status = 'played';
  });
  return { played, winner };
}

function playDeal(room) {
  let carry = room.carryPoints;
  const roundResults = [];
  const roundWinners = [];
  let gameWinner = null, gameMsg = '', winningRound = null;

  for (let round = 0; round < 4; round++) {
    const result = scoreRound(room, round);
    let outcome = '';
    const carryBefore = carry; // capture BEFORE modifying
    if (result.winner) {
      const wp = room.players.find(p => p.id === result.winner.playerId);
      const gained = 1 + carryBefore;
      wp.score += gained;
      carry = 0;
      roundWinners.push(wp.name);
      outcome = `${wp.name} wins${gained > 1 ? ` (${gained} pts, incl. carry)` : ''}`;
      if (wp.score >= 11) {
        wp.score = 11;
        gameWinner = wp;
        gameMsg = `${wp.name} reaches 11 — wins on round ${round+1} of deal ${room.currentDeal}!`;
        winningRound = round + 1;
        roundResults.push({ round: round+1, played: result.played, winner: result.winner, outcome, carry, carryBefore, winningRound: true });
        break;
      }
    } else {
      carry += 1;
      outcome = `No winner — carry now ${carry}`;
    }
    roundResults.push({ round: round+1, played: result.played, winner: result.winner, outcome, carry, carryBefore, winningRound: false });
  }

  room.carryPoints = gameWinner ? 0 : carry;

  // Check crash conditions
  if (!gameWinner) {
    for (const p of room.players) {
      if (hasFourThrees(p.dealCards || [])) {
        gameWinner = p; gameMsg = `${p.name} had four 3s — instant Crash!`; break;
      }
    }
  }
  if (!gameWinner && roundWinners.length === 4 && roundWinners.every(n => n === roundWinners[0])) {
    gameWinner = room.players.find(p => p.name === roundWinners[0]);
    if (gameWinner) gameMsg = `${gameWinner.name} won all four hands — Crash!`;
  }
  if (gameWinner) { gameWinner.score = Math.min(gameWinner.score, 11); room.gameOver = true; }

  return { roundResults, gameWinner, gameMsg, winningRound };
}

// ── Pair counting helper ──
function countPairs(cards) {
  const m = new Map();
  cards.forEach(c => m.set(c.value, (m.get(c.value) || 0) + 1));
  let pairs = 0;
  m.forEach(count => { if (count >= 2) pairs++; });
  return pairs;
}

// ── CPU hand arrangement (server-side for CPU players) ──
function cpuOptimise(cards) {
  const idxs = cards.map((_,i) => i);
  function combos(arr, size) {
    const out = [];
    function walk(start, combo) {
      if (combo.length === size) { out.push(combo.slice()); return; }
      for (let i = start; i < arr.length; i++) { combo.push(arr[i]); walk(i+1, combo); combo.pop(); }
    }
    walk(0, []); return out;
  }
  const scored = [...combos(idxs,3), ...combos(idxs,2)].map(combo => {
    const hand = combo.map(i => cards[i]);
    const ev = evaluateHand(hand);
    return { combo, hand, ev, score: ev ? ev.rankGroup*10000 - ev.rankingIndex : -1 };
  }).filter(x => x.score >= 0).sort((a,b) => b.score - a.score);
  const used = new Set(), picked = [];
  for (const item of scored) {
    if (picked.length >= 4) break;
    if (item.combo.some(i => used.has(i))) continue;
    item.combo.forEach(i => used.add(i));
    picked.push(item.hand);
  }
  while (picked.length < 4) picked.push([]);
  return picked.sort((a,b) => compareHands(evaluateHand(b), evaluateHand(a)));
}

function scoreAndBroadcast(room) {
  // Clear any pending auto-submit timer
  if (room.autoSubmitTimerHandle) { clearInterval(room.autoSubmitTimerHandle); room.autoSubmitTimerHandle = null; }
  room.phase = 'revealing';
  const { roundResults, gameWinner, gameMsg, winningRound } = playDeal(room);
  io.to(room.code).emit('room_update', roomSummary(room));
  broadcastActiveGames(); // update active count
  // Auto-mark CPU players as ready for next game
  if (room.gameOver) {
    if (!room.readyMap) room.readyMap = {};
    room.players.filter(p => p.isCpu).forEach(p => {
      room.readyMap[p.name] = true;
    });
    if (Object.keys(room.readyMap).length > 0) {
      // Broadcast after a short delay so clients receive deal_results first
      setTimeout(() => {
        io.to(room.code).emit('ready_update', { readyMap: room.readyMap });
      }, 500);
    }
  }
  io.to(room.code).emit('deal_results', {
    roundResults, gameWinner: gameWinner ? { id: gameWinner.id, name: gameWinner.name, score: gameWinner.score } : null,
    gameMsg, winningRound,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    allHands: room.players.map(p => ({ id: p.id, name: p.name, hands: p.hands }))
  });
  room.phase = room.gameOver ? 'gameover' : 'between_deals';
  if (!room.gameOver) room.currentDeal += 1;
}

// ── Socket.io logic ──
io.on('connection', (socket) => {
  // Send current active game count to newly connected client
  const activeCount = Object.values(rooms).filter(r =>
    r.phase === 'building' || r.phase === 'revealing' ||
    r.phase === 'between_deals' || r.phase === 'six_pairs'
  ).length;
  socket.emit('active_games', { count: activeCount });
  console.log('Connected:', socket.id);

  // ── Create room ──
  socket.on('create_room', ({ name }) => {
    const code = generateCode();
    const player = { id: socket.id, name: name || 'Player 1', score: 0, ready: false, submitted: false, connected: true, hands: [[],[],[],[]], dealCards: [] };
    rooms[code] = {
      code, hostId: socket.id, phase: 'lobby', autoSubmitTimer: true,
      players: [player],
      currentDeal: 1, carryPoints: 0, gameOver: false
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room_created', { code });
    io.to(code).emit('room_update', roomSummary(rooms[code]));
    console.log(`Room ${code} created by ${name}`);
  });

  // ── Join room ──
  socket.on('join_room', ({ code, name }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error', { msg: 'Room not found. Check your code.' }); return; }
    if (room.players.length >= 4) { socket.emit('error', { msg: 'Room is full (4 players max).' }); return; }
    if (room.phase !== 'lobby') { socket.emit('error', { msg: 'Game already in progress.' }); return; }
    const player = { id: socket.id, name: name || `Player ${room.players.length + 1}`, score: 0, ready: false, submitted: false, connected: true, hands: [[],[],[],[]], dealCards: [] };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room_joined', { code });
    io.to(code).emit('room_update', roomSummary(room));
    console.log(`${name} joined room ${code}`);
  });

  // ── Host starts game ──
  socket.on('start_game', ({ cpuCount = 0, autoSubmitTimer = true } = {}) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id) return;
    const humanCount = room.players.length;
    if (humanCount < 1) { socket.emit('error', { msg: 'Need at least 1 player to start.' }); return; }
    const totalNeeded = Math.min(cpuCount, 4 - humanCount);
    // Add CPU players to fill slots
    for (let i = 0; i < totalNeeded; i++) {
      room.players.push({
        id: `cpu_${i+1}`,
        name: `CPU ${i+1}`,
        score: 0, ready: true, submitted: false, connected: true,
        hands: [[],[],[],[]], dealCards: [], isCpu: true
      });
    }
    if (room.players.length < 2) { socket.emit('error', { msg: 'Need at least 2 players to start.' }); return; }
    dealCards(room);
  });

  // ── Deal cards ──
  function dealCards(room) {
    const deck = shuffle(createDeck());
    let ptr = 0;
    room.autoSubmitTimer = autoSubmitTimer;
    room.phase = 'building';
    broadcastActiveGames();
    room.players.forEach(p => {
      p.dealCards = sortCards(deck.slice(ptr, ptr + 13));
      ptr += 13;
      p.hands = [[],[],[],[]];
      p.submitted = false;
      p.bonusApplied = false;
    });

    // Check four threes
    for (const p of room.players) {
      if (hasFourThrees(p.dealCards)) {
        p.score = 11; room.gameOver = true; room.phase = 'gameover';
        io.to(room.code).emit('room_update', roomSummary(room));
        io.to(room.code).emit('game_over', { winnerId: p.id, msg: `${p.name} was dealt four 3s — instant Crash!` });
        return;
      }
    }

    // Check four of a kind bonus upfront for all players
    room.players.forEach(p => {
      const fv = hasFourOfAKind(p.dealCards);
      if (fv) p.fourOfAKindValue = fv;
    });

    io.to(room.code).emit('room_update', roomSummary(room));

    // Check for 6-pairs for each human player — notify them privately
    // They have the option to request a full re-deal
    let sixPairsPlayer = null;
    for (const p of room.players) {
      if (!p.isCpu && countPairs(p.dealCards) >= 6) {
        sixPairsPlayer = p;
        break; // first player with 6 pairs gets the choice
      }
    }

    if (sixPairsPlayer) {
      // Notify just that player — others get a "waiting" message
      io.to(sixPairsPlayer.id).emit('six_pairs_choice', {
        pairCount: countPairs(sixPairsPlayer.dealCards),
        dealNumber: room.currentDeal
      });
      io.to(room.code).emit('six_pairs_pending', { playerName: sixPairsPlayer.name });
      room.phase = 'six_pairs'; // pause dealing until choice is made
      console.log(`Room ${room.code}: ${sixPairsPlayer.name} has 6+ pairs`);
      return; // don't deal cards yet
    }

    // Send each human player their own cards privately
    // CPU players auto-arrange immediately
    room.players.forEach(p => {
      if (p.isCpu) {
        // CPU auto-arranges and submits
        p.hands = cpuOptimise(p.dealCards);
        p.submitted = true;
      } else {
        io.to(p.id).emit('your_cards', {
          dealCards: p.dealCards,
          dealNumber: room.currentDeal,
          carryPoints: room.carryPoints,
          fourOfAKindValue: p.fourOfAKindValue || null
        });
      }
    });

    // If all players are CPU (shouldn't happen) or all already submitted
    const allDone = room.players.every(p => p.submitted);
    if (allDone) {
      setTimeout(() => scoreAndBroadcast(room), 1500);
    }

    console.log(`Room ${room.code}: deal ${room.currentDeal} dealt`);
  }

  // ── Player submits hands ──
  socket.on('submit_hands', ({ hands }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'building') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.submitted) return;

    // Validate hands
    const usedIds = hands.flat().map(c => c.id);
    if (new Set(usedIds).size !== usedIds.length) {
      socket.emit('error', { msg: 'A card appears in more than one hand.' }); return;
    }
    if (!handsInOrder(hands)) {
      socket.emit('error', { msg: 'Hands must go strongest to weakest: Prial → On the Bounce → Run → Flush → Pair' }); return;
    }

    // Check four of a kind bonus
    if (player.fourOfAKindValue && !player.bonusApplied) {
      const fv = player.fourOfAKindValue;
      const placedCount = hands.flat().filter(c => c.value === fv).length;
      if (placedCount >= 4) {
        player.score += 1;
        player.bonusApplied = true;
        if (player.score >= 11) { player.score = 11; }
        socket.emit('bonus_awarded', { msg: `+1 bonus — all four ${fv}s used!` });
      }
    }

    player.hands = hands;
    player.submitted = true;

    // Notify everyone of submission progress
    const humanPlayers = room.players.filter(p => !p.isCpu);
    const submittedCount = room.players.filter(p => p.submitted).length;
    io.to(room.code).emit('submission_update', {
      submittedCount,
      totalPlayers: humanPlayers.length,
      submittedNames: room.players.filter(p => p.submitted).map(p => p.name)
    });

    // If all submitted, score the deal
    if (room.players.every(p => p.submitted)) {
      if (room.autoSubmitTimerHandle) { clearInterval(room.autoSubmitTimerHandle); room.autoSubmitTimerHandle = null; }
      scoreAndBroadcast(room);
      return;
    }

    // If only 1 human player left to submit, start 20s countdown
    const humanRemaining = room.players.filter(p => !p.isCpu && !p.submitted);
    if (humanRemaining.length === 1 && room.autoSubmitTimer && !room.autoSubmitTimerHandle) {
      let secondsLeft = 20;
      const lastPlayerName = humanRemaining[0].name;
      io.to(room.code).emit('auto_submit_countdown', { seconds: secondsLeft, playerName: lastPlayerName });
      room.autoSubmitTimerHandle = setInterval(() => {
        secondsLeft--;
        io.to(room.code).emit('auto_submit_countdown', { seconds: secondsLeft, playerName: lastPlayerName });
        if (secondsLeft <= 0) {
          clearInterval(room.autoSubmitTimerHandle);
          room.autoSubmitTimerHandle = null;
          const lastPlayer = room.players.find(p => p.name === lastPlayerName);
          if (!lastPlayer.submitted) {
            // Auto-submit with whatever hands they have
            lastPlayer.hands = lastPlayer.hands && lastPlayer.hands.length === 4
              ? lastPlayer.hands : [[], [], [], []];
            lastPlayer.submitted = true;
            io.to(room.code).emit('submission_update', {
              submittedCount: room.players.filter(p => p.submitted).length,
              totalPlayers: humanPlayers.length,
              submittedNames: room.players.filter(p => p.submitted).map(p => p.name)
            });
            scoreAndBroadcast(room);
          }
        }
      }, 1000);
    }

    console.log(`Room ${room.code}: ${player.name} submitted (${submittedCount}/${room.players.length})`);
  });

  // ── Host kicks a player from lobby ──
  socket.on('kick_player', ({ playerId }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    const idx = room.players.findIndex(p => p.id === playerId && !p.isCpu);
    if (idx === -1) return;
    const kicked = room.players[idx];
    room.players.splice(idx, 1);
    // Tell the kicked player
    io.to(playerId).emit('kicked_from_room', { msg: 'You were removed from the lobby by the host.' });
    // Update everyone else
    io.to(room.code).emit('room_update', roomSummary(room));
    console.log(`${kicked.name} kicked from room ${room.code}`);
  });

  // ── Player ready for next game ──
  socket.on('player_ready', ({ ready }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (!room.readyMap) room.readyMap = {};
    room.readyMap[player.name] = ready;
    // Broadcast updated ready map to all players
    io.to(room.code).emit('ready_update', { readyMap: room.readyMap });
  });

  // Reset readyMap when a new deal starts
  // (handled in dealCards — reset there)

  // ── Celebrate selfie relay ──
  socket.on('celebrate_selfie', ({ name, image }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    // Relay to all OTHER players in the room (not back to sender)
    socket.to(room.code).emit('celebrate_selfie', { name, image });
    console.log(`Selfie from ${name} relayed to room ${room.code}`);
  });

  // ── Six pairs response ──
  socket.on('six_pairs_response', ({ redeal }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'six_pairs') return;
    room.phase = 'building';
    if (redeal) {
      io.to(room.code).emit('six_pairs_redeal');
      dealCards(room); // full re-deal for everyone
    } else {
      io.to(room.code).emit('six_pairs_continue');
      // Now send out the already-dealt cards
      room.players.forEach(p => {
        if (p.isCpu) {
          p.hands = cpuOptimise(p.dealCards);
          p.submitted = true;
        } else {
          io.to(p.id).emit('your_cards', {
            dealCards: p.dealCards,
            dealNumber: room.currentDeal,
            carryPoints: room.carryPoints,
            fourOfAKindValue: p.fourOfAKindValue || null
          });
        }
      });
      const allDone = room.players.every(p => p.submitted);
      if (allDone) setTimeout(() => scoreAndBroadcast(room), 1500);
    }
  });

  // ── Host requests next deal ──
  socket.on('next_deal', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id) return;
    room.readyMap = {}; // reset ready states for new game
    dealCards(room);
  });

  // ── Host restarts game ──
  socket.on('restart_game', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id) return;
    room.players.forEach(p => { p.score = 0; p.submitted = false; p.hands = [[],[],[],[]]; p.dealCards = []; });
    room.currentDeal = 1; room.carryPoints = 0; room.gameOver = false;
    dealCards(room);
  });

  // ══════════════════════════════════════
  // LIVE SCOREBOARD HANDLERS
  // ══════════════════════════════════════

  socket.on('sb_create', ({ name, players, target, stakePerPoint }) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
    while (sbRooms[code]);
    const member = { id: socket.id, name, connected: true };
    sbRooms[code] = {
      code, scorerId: socket.id,
      players: players || [{id:1,name:'Player 1',score:0,active:true},{id:2,name:'Player 2',score:0,active:true},{id:3,name:'Player 3',score:0,active:true},{id:4,name:'Player 4',score:0,active:true}],
      target: target || 11,
      stakePerPoint: stakePerPoint || 0.10,
      winnerId: null, dealerStartId: 1,
      members: [member]
    };
    socket.join('sb_' + code);
    socket.data.sbCode = code;
    socket.emit('sb_created', { code });
    io.to('sb_' + code).emit('sb_update', sbSummary(sbRooms[code]));
    console.log(`SB room ${code} created by ${name}`);
  });

  socket.on('sb_join', ({ code, name }) => {
    const room = sbRooms[code];
    if (!room) { socket.emit('sb_error', { msg: 'Scoreboard not found. Check the code.' }); return; }
    // Add to members list
    const existingMember = room.members.find(m => m.name === name);
    if (existingMember) {
      existingMember.id = socket.id; existingMember.connected = true;
    } else {
      room.members.push({ id: socket.id, name, connected: true });
    }
    // Also add as a player if not already in players list and space available
    const existingPlayer = room.players.find(p => p.name === name);
    if (!existingPlayer && room.players.filter(p => p.active).length < 4) {
      const newId = Math.max(...room.players.map(p => p.id), 0) + 1;
      room.players.push({ id: newId, name, score: 0, active: true });
    }
    socket.join('sb_' + code);
    socket.data.sbCode = code;
    socket.emit('sb_joined', { code, isScorer: room.scorerId === socket.id });
    io.to('sb_' + code).emit('sb_update', sbSummary(room));
    io.to('sb_' + code).emit('sb_member_joined', { name });
    console.log(`${name} joined SB room ${code}`);
  });

  // Scorer updates a player score
  socket.on('sb_score_change', ({ playerId, delta }) => {
    const code = socket.data.sbCode;
    const room = sbRooms[code];
    if (!room || room.scorerId !== socket.id) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    player.score = Math.max(0, player.score + delta);
    // Check for winner
    if (player.score >= room.target) {
      player.score = room.target;
      room.winnerId = playerId;
    }
    io.to('sb_' + code).emit('sb_update', sbSummary(room));
  });

  // Scorer updates player name
  socket.on('sb_name_change', ({ playerId, name }) => {
    const code = socket.data.sbCode;
    const room = sbRooms[code];
    if (!room || room.scorerId !== socket.id) return;
    const player = room.players.find(p => p.id === playerId);
    if (player) { player.name = name; io.to('sb_' + code).emit('sb_update', sbSummary(room)); }
  });

  // Scorer starts new game
  socket.on('sb_new_game', ({ dealerStartId }) => {
    const code = socket.data.sbCode;
    const room = sbRooms[code];
    if (!room || room.scorerId !== socket.id) return;
    room.players.forEach(p => { p.score = 0; });
    room.winnerId = null;
    room.dealerStartId = dealerStartId || room.players[0].id;
    io.to('sb_' + code).emit('sb_update', sbSummary(room));
  });

  // Scorer passes scorer role to another member
  socket.on('sb_pass_scorer', ({ toName }) => {
    const code = socket.data.sbCode;
    const room = sbRooms[code];
    if (!room || room.scorerId !== socket.id) return;
    const member = room.members.find(m => m.name === toName && m.connected);
    if (!member) { socket.emit('sb_error', { msg: `${toName} is not connected.` }); return; }
    room.scorerId = member.id;
    io.to('sb_' + code).emit('sb_update', sbSummary(room));
    io.to('sb_' + code).emit('sb_scorer_changed', { newScorerName: toName });
  });

  // Winner claims scorer role after winning
  socket.on('sb_claim_scorer', () => {
    const code = socket.data.sbCode;
    const room = sbRooms[code];
    if (!room) return;
    room.scorerId = socket.id;
    io.to('sb_' + code).emit('sb_update', sbSummary(room));
    const me = room.members.find(m => m.id === socket.id);
    io.to('sb_' + code).emit('sb_scorer_changed', { newScorerName: me ? me.name : 'Someone' });
  });

  // Set player count (scorer only)
  socket.on('sb_set_players', ({ count }) => {
    const code = socket.data.sbCode;
    const room = sbRooms[code];
    if (!room || room.scorerId !== socket.id) return;
    const current = room.players.filter(p => p.active).length;
    if (count < current) {
      let removed = 0;
      for (let i = room.players.length - 1; i >= 0 && removed < current - count; i--) {
        if (room.players[i].active) { room.players[i].active = false; removed++; }
      }
    } else {
      for (let i = 0; i < room.players.length && room.players.filter(p=>p.active).length < count; i++) {
        room.players[i].active = true;
      }
    }
    io.to('sb_' + code).emit('sb_update', sbSummary(room));
  });

  // Add a manual player (scorer only)
  socket.on('sb_add_player', ({ name }) => {
    const code = socket.data.sbCode;
    const room = sbRooms[code];
    if (!room || room.scorerId !== socket.id) return;
    const newId = Math.max(...room.players.map(p => p.id)) + 1;
    room.players.push({ id: newId, name: name || `Player ${room.players.length+1}`, score: 0, active: true });
    io.to('sb_' + code).emit('sb_update', sbSummary(room));
  });

  // ── Disconnect from SB ──
  socket.on('disconnect', () => {
    const code = socket.data.sbCode;
    if (code && sbRooms[code]) {
      const room = sbRooms[code];
      const member = room.members.find(m => m.id === socket.id);
      if (member) {
        member.connected = false;
        // If scorer disconnected, auto-pass to next connected member
        if (room.scorerId === socket.id) {
          const next = room.members.find(m => m.connected && m.id !== socket.id);
          if (next) {
            room.scorerId = next.id;
            io.to('sb_' + code).emit('sb_scorer_changed', { newScorerName: next.name, auto: true });
          }
        }
        io.to('sb_' + code).emit('sb_update', sbSummary(room));
      }
      // Clean up empty SB rooms after 2 hours
      if (room.members.every(m => !m.connected)) {
        setTimeout(() => {
          if (sbRooms[code] && sbRooms[code].members.every(m => !m.connected)) {
            delete sbRooms[code];
            console.log(`SB room ${code} cleaned up`);
          }
        }, 2 * 60 * 60 * 1000);
      }
    }
    // Game room disconnect
    const gameCode = socket.data.roomCode;
    const gameRoom = rooms[gameCode];
    if (gameRoom) {
      const player = gameRoom.players.find(p => p.id === socket.id);
      if (player) {
        player.connected = false;
        player.disconnectedAt = Date.now();
        console.log(`${player.name} disconnected from room ${gameCode}`);
        io.to(gameCode).emit('player_disconnected', { name: player.name, code: gameCode });
        io.to(gameCode).emit('room_update', roomSummary(gameRoom));

        // If disconnected player was the host, schedule host transfer after 30s
        if (gameRoom.hostId === socket.id) {
          setTimeout(() => {
            const room = rooms[gameCode];
            if (!room) return;
            // Check if original host is still disconnected
            const host = room.players.find(p => p.id === socket.id);
            if (host && !host.connected) {
              // Find next connected human player to become host
              const nextHost = room.players.find(p => p.connected && !p.isCpu && p.id !== socket.id);
              if (nextHost) {
                room.hostId = nextHost.id;
                io.to(gameCode).emit('host_transferred', { name: nextHost.name });
                io.to(gameCode).emit('room_update', roomSummary(room));
                console.log(`Host transferred to ${nextHost.name} in room ${gameCode}`);
              } else {
                // No connected human players — end the game
                io.to(gameCode).emit('game_ended', { msg: 'Game ended — all human players disconnected.' });
                delete rooms[gameCode];
                broadcastActiveGames();
                console.log(`Room ${gameCode} ended — no human players remaining`);
              }
            }
          }, 30 * 1000); // 30 seconds
        }
      }
      if (gameRoom.players.every(p => !p.connected)) {
        setTimeout(() => {
          if (rooms[gameCode] && rooms[gameCode].players.every(p => !p.connected)) {
            delete rooms[gameCode];
            broadcastActiveGames();
          }
        }, 30 * 60 * 1000);
      }
    }
  });



  // ── Rejoin room after disconnect ──
  socket.on('rejoin_room', ({ code, name }) => {
    const room = rooms[code];
    if (!room) { socket.emit('rejoin_failed', { msg: 'Room no longer exists. Ask the host to start a new game.' }); return; }
    // Find their slot by name (disconnected or even still marked connected if they refreshed)
    const player = room.players.find(p => p.name === name && !p.isCpu);
    if (!player) { socket.emit('rejoin_failed', { msg: `Could not find a player named "${name}" in room ${code}.` }); return; }
    // Update their socket id to the new connection
    const wasHost = room.hostId === player.id;
    player.id = socket.id;
    player.connected = true;
    player.disconnectedAt = null;
    // If this player was the host, update hostId to their new socket
    if (wasHost) room.hostId = socket.id;
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('rejoin_success', {
      code,
      phase: room.phase,
      isHost: wasHost
    });
    io.to(code).emit('room_update', roomSummary(room));
    io.to(code).emit('player_rejoined', { name: player.name });
    // Re-send their cards if mid-deal
    if ((room.phase === 'building') && !player.submitted) {
      socket.emit('your_cards', {
        dealCards: player.dealCards,
        dealNumber: room.currentDeal,
        carryPoints: room.carryPoints,
        fourOfAKindValue: player.fourOfAKindValue || null
      });
    }
    console.log(`${name} rejoined room ${code} (phase: ${room.phase})`);
  });
});

// ── Start ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Crash server running on port ${PORT}`));
