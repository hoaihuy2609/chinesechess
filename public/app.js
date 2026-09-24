const $ = (selector) => document.querySelector(selector);

const el = {
  lobby: $('#lobby-view'), game: $('#game-view'), name: $('#player-name'), code: $('#room-code'),
  create: $('#create-room'), join: $('#join-room'), board: $('#xiangqi-board'),
  roomCode: $('#room-code-display'), copyRoom: $('#copy-room'), leave: $('#leave-room'), status: $('#game-status'),
  redName: $('#red-player-name'), blackName: $('#black-player-name'), redClock: $('#red-clock'), blackClock: $('#black-clock'),
  redCard: $('#red-player-card'), blackCard: $('#black-player-card'), redYou: $('#red-you-tag'), blackYou: $('#black-you-tag'),
  moveList: $('#move-list'), moveCount: $('#move-count'), boardTip: $('#board-tip'),
  draw: $('#draw-button'), resign: $('#resign-button'), newGame: $('#new-game'),
  voiceControls: $('#voice-controls'), voiceButton: $('#voice-button'), voiceButtonText: $('#voice-button-text'), voiceSignal: $('#voice-signal'), mute: $('#mute-button'), remoteAudio: $('#remote-audio'),
  connection: $('#connection-label'), connectionDot: $('.connection-dot'), toast: $('#toast-stack'),
  scoreR: $('#score-r'), scoreB: $('#score-b'), scoreDraw: $('#score-draw'),
  redWins: $('#red-wins'), blackWins: $('#black-wins'),
  redCaptured: $('#red-captured'), blackCaptured: $('#black-captured'),
  soundToggle: $('#sound-toggle')
};

const labels = {
  rr: '車', rh: '傌', re: '相', ra: '仕', rk: '帥', rc: '炮', rp: '兵',
  br: '車', bh: '馬', be: '象', ba: '士', bk: '將', bc: '砲', bp: '卒'
};
const pieceNames = { r: 'Xe', h: 'Mã', e: 'Tượng', a: 'Sĩ', k: 'Tướng', c: 'Pháo', p: 'Tốt' };
const files = 'abcdefghi';
const sessionKey = 'ky-dai-room';

let socket;
let reconnectTimer;
let state = { room: null, you: { color: null, name: 'Kỳ thủ' } };
let selected = null;
let pendingMove = false;
let chatScrolled = false;

let audioCtx = null;
let soundEnabled = localStorage.getItem('ky-dai-sound') !== '0';
let lastMoveTimestamp = 0;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}
window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('keydown', unlockAudio, { passive: true });

function playMoveSound() {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(380, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.07);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {}
}

function playCaptureSound() {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [0, 0.035].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const startFreq = i === 0 ? 460 : 320;
      const endFreq = i === 0 ? 160 : 110;
      osc.frequency.setValueAtTime(startFreq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + delay + 0.09);
      gain.gain.setValueAtTime(i === 0 ? 0.45 : 0.55, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.11);
    });
  } catch {}
}

function playCheckSound() {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [
      { delay: 0, freqs: [587.3, 880, 1174.7], vol: 0.48, dur: 0.9 },
      { delay: 0.11, freqs: [440, 659.3, 880, 1318.5], vol: 0.65, dur: 1.6 }
    ];

    notes.forEach((chord) => {
      const t = now + chord.delay;
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(chord.vol, t);
      masterGain.gain.exponentialRampToValueAtTime(0.001, t + chord.dur);
      masterGain.connect(ctx.destination);

      chord.freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.99, t + chord.dur);

        const amp = [0.55, 0.35, 0.2, 0.12][idx] || 0.1;
        gain.gain.setValueAtTime(amp, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + chord.dur);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t);
        osc.stop(t + chord.dur + 0.05);
      });
    });
  } catch {}
}

function updateSoundButton() {
  if (!el.soundToggle) return;
  el.soundToggle.textContent = soundEnabled ? '🔊' : '🔇';
  el.soundToggle.classList.toggle('muted', !soundEnabled);
  el.soundToggle.title = soundEnabled ? 'Âm thanh: Đang bật (Bấm để tắt)' : 'Âm thanh: Đang tắt (Bấm để bật)';
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('ky-dai-sound', soundEnabled ? '1' : '0');
  updateSoundButton();
  if (soundEnabled) playMoveSound();
}

const voice = {
  stream: null, pc: null, pendingCandidates: [], muted: false, remoteConnected: false, negotiating: false
};

function wsUrl() {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(wsUrl());
  setConnection('Đang kết nối…', '');
  socket.addEventListener('open', () => {
    setConnection('Đã sẵn sàng', 'online');
    const saved = getSavedRoom();
    if (saved) send({ type: 'join', roomId: saved.roomId, name: saved.name });
  });
  socket.addEventListener('message', (event) => {
    try { handleServerMessage(JSON.parse(event.data)); } catch { showToast('Không đọc được phản hồi từ máy chủ.', 'error'); }
  });
  socket.addEventListener('close', () => {
    setConnection('Mất kết nối — đang thử lại', 'offline');
    if (state.room) showToast('Kết nối tạm gián đoạn. Đang quay lại phòng…', 'error');
    reconnectTimer = setTimeout(connect, 1800);
  });
  socket.addEventListener('error', () => socket.close());
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast('Kết nối chưa sẵn sàng. Thử lại sau một chút nhé.', 'error');
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function setConnection(text, mode) {
  el.connection.textContent = text;
  el.connectionDot.className = `connection-dot ${mode}`;
}

function getName() {
  return el.name.value.trim().slice(0, 20) || 'Kỳ thủ';
}

function getSavedRoom() {
  try { return JSON.parse(localStorage.getItem(sessionKey)); } catch { return null; }
}

function saveRoom(roomId, name) {
  localStorage.setItem(sessionKey, JSON.stringify({ roomId, name }));
}

function clearSavedRoom() { localStorage.removeItem(sessionKey); }

function handleServerMessage(message) {
  if (message.type === 'room-state') {
    const history = message.room.history || [];
    const lastMove = history.at(-1);

    if (history.length === 0) {
      lastMoveTimestamp = 0;
    } else if (lastMove && lastMove.at && lastMove.at !== lastMoveTimestamp && state.room?.id === message.room.id) {
      lastMoveTimestamp = lastMove.at;
      if (lastMove.check || message.room.check) {
        playCheckSound();
      } else if (lastMove.captured) {
        playCaptureSound();
      } else {
        playMoveSound();
      }
    } else if (lastMove && !lastMoveTimestamp) {
      lastMoveTimestamp = lastMove.at;
    }

    state = message;
    selected = null;
    pendingMove = false;
    saveRoom(message.room.id, message.you.name);
    showGame();
    render();
    return;
  }
  if (message.type === 'error') {
    pendingMove = false;
    return showToast(message.text, 'error');
  }
  if (message.type === 'notice') return showToast(message.text, message.kind || 'info');
  if (message.type === 'signal') handleSignal(message.signal);
}

function showGame() {
  el.lobby.classList.add('is-hidden');
  el.game.classList.remove('is-hidden');
}

function showLobby() {
  el.game.classList.add('is-hidden');
  el.lobby.classList.remove('is-hidden');
}

function render() {
  if (!state.room) return;
  const { room, you } = state;
  el.roomCode.textContent = room.id;
  el.redName.textContent = room.players.r?.name || 'Đang chờ kỳ thủ';
  el.blackName.textContent = room.players.b?.name || 'Đang chờ kỳ thủ';
  el.redYou.classList.toggle('visible', you.color === 'r');
  el.blackYou.classList.toggle('visible', you.color === 'b');
  el.redCard.classList.toggle('current', room.status === 'active' && room.turn === 'r');
  el.blackCard.classList.toggle('current', room.status === 'active' && room.turn === 'b');
  renderStatus();
  renderScore();
  renderCaptured();
  renderBoard();
  renderHistory();
  renderClocks();
  renderVoice();
  renderActions();
  renderVictory();
}

function renderStatus() {
  const { room, you } = state;
  el.status.className = 'game-status';
  if (room.status === 'waiting') {
    el.status.textContent = you.color ? 'Đang chờ đối thủ vào bàn…' : 'Bạn đang xem trận đấu';
  } else if (room.status === 'finished') {
    el.status.classList.add('finished');
    el.status.textContent = room.winner ? `${room.winner === 'r' ? 'Đỏ' : 'Đen'} thắng • ${room.finishReason}` : `Hòa cờ • ${room.finishReason}`;
  } else if (room.check) {
    el.status.classList.add('your-turn');
    el.status.textContent = room.turn === you.color ? 'Tướng của bạn đang bị chiếu!' : 'Đối thủ đang bị chiếu';
  } else if (room.turn === you.color) {
    el.status.classList.add('your-turn');
    el.status.textContent = 'Đến lượt bạn — hãy đi nước cờ thật sắc';
  } else {
    const player = room.players[room.turn]?.name || 'Đối thủ';
    el.status.textContent = `${player} đang suy nghĩ…`;
  }
}

const pieceRank = { k: 0, r: 1, c: 2, h: 3, e: 4, a: 5, p: 6 };

function renderScore() {
  if (!state.room) return;
  const score = state.room.score || { r: 0, b: 0, draw: 0 };
  if (el.scoreR) el.scoreR.textContent = score.r ?? 0;
  if (el.scoreB) el.scoreB.textContent = score.b ?? 0;
  if (el.redWins) el.redWins.textContent = `${score.r ?? 0} ván`;
  if (el.blackWins) el.blackWins.textContent = `${score.b ?? 0} ván`;
  if (el.scoreDraw) {
    if (score.draw > 0) {
      el.scoreDraw.textContent = `(${score.draw} hòa)`;
      el.scoreDraw.classList.remove('is-hidden');
    } else {
      el.scoreDraw.classList.add('is-hidden');
    }
  }
}

function renderCaptured() {
  if (!state.room) return;
  const captured = state.room.captured || { r: [], b: [] };
  renderCapturedTray(el.redCaptured, captured.r || []);
  renderCapturedTray(el.blackCaptured, captured.b || []);
}

function renderCapturedTray(container, pieces) {
  if (!container) return;
  if (!pieces.length) {
    container.innerHTML = '<span class="captured-empty">Chưa mất</span>';
    return;
  }
  const sorted = [...pieces].sort((a, b) => (pieceRank[a[1]] ?? 99) - (pieceRank[b[1]] ?? 99));
  container.innerHTML = sorted.map((p) => {
    const isBlack = p[0] === 'b';
    return `<span class="captured-chip ${isBlack ? 'black' : 'red'}" title="${pieceColorText(p[0])} ${pieceNames[p[1]]}">${labels[p] || p}</span>`;
  }).join('');
}

function boardSvg() {
  const y = (row) => (6 + (88 * row) / 9).toFixed(3);
  const x = (col) => (6 + (88 * col) / 8).toFixed(3);
  const horizontals = Array.from({ length: 10 }, (_, i) => `<line x1="6" y1="${y(i)}" x2="94" y2="${y(i)}" />`).join('');
  const verticals = Array.from({ length: 9 }, (_, i) => `<line x1="${x(i)}" y1="${y(0)}" x2="${x(i)}" y2="${y(4)}" /><line x1="${x(i)}" y1="${y(5)}" x2="${x(i)}" y2="${y(9)}" />`).join('');
  return `<svg class="board-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${horizontals}${verticals}<line x1="39" y1="6" x2="61" y2="25.556"/><line x1="61" y1="6" x2="39" y2="25.556"/><line x1="39" y1="74.444" x2="61" y2="94"/><line x1="61" y1="74.444" x2="39" y2="94"/></svg><div class="river-band"><span>楚河</span><span>漢界</span></div>`;
}

function renderBoard() {
  const { room, you } = state;
  const flipped = you.color === 'b';
  const targets = selected ? pseudoTargets(room.board, selected.x, selected.y) : [];
  const last = room.history.at(-1);
  let html = boardSvg();
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const piece = room.board[y][x];
      const isSelected = selected?.x === x && selected?.y === y;
      const target = targets.find((point) => point.x === x && point.y === y);
      const lastTo = last && last.to.x === x && last.to.y === y;
      const lastFrom = last && last.from.x === x && last.from.y === y;
      const classes = ['square'];
      if (isSelected) classes.push('is-selected');
      if (target) classes.push(piece ? 'capture-target' : 'legal-target');
      if (lastFrom) classes.push('last-from');
      const dispX = flipped ? 8 - x : x;
      const dispY = flipped ? 9 - y : y;
      const position = `left:calc(6% + (88% * ${dispX} / 8));top:calc(6% + (88% * ${dispY} / 9));`;
      const aria = piece ? `${pieceColorText(piece[0])} ${pieceNames[piece[1]]}` : `Ô ${files[x]}${10 - y}`;
      html += `<button class="${classes.join(' ')}" style="${position}" data-x="${x}" data-y="${y}" role="gridcell" aria-label="${aria}">${piece ? `<span class="piece ${piece[0] === 'b' ? 'black' : ''} ${lastTo ? 'last-move' : ''}">${labels[piece]}</span>` : ''}</button>`;
    }
  }
  el.board.innerHTML = html;
  el.board.querySelectorAll('.square').forEach((square) => square.addEventListener('click', onSquareClick));
  if (room.status === 'waiting') el.boardTip.textContent = you.color ? 'Gửi mã phòng cho đối thủ để bắt đầu.' : 'Bạn đang theo dõi bàn cờ này.';
  else if (room.status === 'finished') el.boardTip.textContent = 'Một ván cờ đã khép lại. Có thể mở ván mới bất cứ lúc nào.';
  else if (you.color === room.turn) el.boardTip.textContent = selected ? 'Chọn một điểm sáng để đi quân, hoặc chọn quân khác.' : 'Chạm quân cờ, rồi chạm ô muốn đi.';
  else el.boardTip.textContent = 'Đến lượt đối thủ — bạn có thể quan sát nước đi tiếp theo.';
}

function onSquareClick(event) {
  const square = event.currentTarget;
  const x = Number(square.dataset.x);
  const y = Number(square.dataset.y);
  const { room, you } = state;
  const piece = room.board[y][x];
  if (!you.color) return showToast('Bạn đang xem trận này, chưa có quân để đi.', 'info');
  if (room.status !== 'active') return showToast(room.status === 'waiting' ? 'Cần đủ hai kỳ thủ để bắt đầu.' : 'Ván này đã kết thúc. Hãy mở ván mới nhé.', 'info');
  if (room.turn !== you.color) return showToast('Chưa đến lượt của bạn.', 'info');
  if (pendingMove) return;
  if (selected) {
    if (piece?.[0] === you.color) {
      selected = { x, y };
      renderBoard();
      return;
    }
    pendingMove = send({ type: 'move', from: selected, to: { x, y } });
    selected = null;
    renderBoard();
    return;
  }
  if (piece?.[0] === you.color) {
    selected = { x, y };
    renderBoard();
  } else showToast('Hãy chọn một quân của bạn trước.', 'info');
}

function pseudoTargets(board, fromX, fromY) {
  const origin = board[fromY][fromX];
  if (!origin) return [];
  const targets = [];
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 9; x += 1) {
    if (pseudoCanReach(board, { x: fromX, y: fromY }, { x, y })) targets.push({ x, y });
  }
  return targets;
}

function pseudoCanReach(board, from, to) {
  const piece = board[from.y]?.[from.x];
  if (!piece || (from.x === to.x && from.y === to.y)) return false;
  const color = piece[0]; const type = piece[1]; const target = board[to.y][to.x];
  if (target?.[0] === color) return false;
  const dx = to.x - from.x; const dy = to.y - from.y; const ax = Math.abs(dx); const ay = Math.abs(dy);
  if (type === 'r') return (dx === 0 || dy === 0) && lineCount(board, from, to) === 0;
  if (type === 'c') { if (dx && dy) return false; const screens = lineCount(board, from, to); return target ? screens === 1 : screens === 0; }
  if (type === 'h') { if (!((ax === 1 && ay === 2) || (ax === 2 && ay === 1))) return false; const leg = ax === 2 ? [from.x + Math.sign(dx), from.y] : [from.x, from.y + Math.sign(dy)]; return !board[leg[1]][leg[0]]; }
  if (type === 'e') return ax === 2 && ay === 2 && !(color === 'r' ? to.y < 5 : to.y > 4) && !board[from.y + dy / 2][from.x + dx / 2];
  if (type === 'a') return ax === 1 && ay === 1 && inPalace(color, to.x, to.y);
  if (type === 'k') return (target === `${color === 'r' ? 'b' : 'r'}k` && dx === 0 && lineCount(board, from, to) === 0) || (ax + ay === 1 && inPalace(color, to.x, to.y));
  if (type === 'p') { const forward = color === 'r' ? -1 : 1; const crossed = color === 'r' ? from.y <= 4 : from.y >= 5; return (dx === 0 && dy === forward) || (crossed && dy === 0 && ax === 1); }
  return false;
}

function lineCount(board, from, to) {
  if (from.x !== to.x && from.y !== to.y) return -1;
  const dx = Math.sign(to.x - from.x); const dy = Math.sign(to.y - from.y);
  let x = from.x + dx; let y = from.y + dy; let total = 0;
  while (x !== to.x || y !== to.y) { if (board[y][x]) total += 1; x += dx; y += dy; }
  return total;
}

function inPalace(color, x, y) { return x >= 3 && x <= 5 && (color === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2); }
function pieceColorText(color) { return color === 'r' ? 'Đỏ' : 'Đen'; }

function formatStopwatch(seconds) {
  const totalSec = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatThinkTime(sec) {
  const totalSec = Math.max(0, Math.floor(sec || 0));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `${m}p ${s}s` : `${m}p`;
}

function formatDuration(totalSec) {
  const s = Math.max(1, Math.floor(totalSec || 0));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  return remSec > 0 ? `${m} phút ${remSec} giây` : `${m} phút`;
}

function renderHistory() {
  const history = state.room?.history || [];
  el.moveCount.textContent = `${history.length} NƯỚC`;
  if (!history.length) { el.moveList.innerHTML = '<li class="empty-list">Nước đi sẽ hiện tại đây.</li>'; return; }
  el.moveList.innerHTML = history.slice().reverse().map((move, index) => {
    const number = history.length - index;
    const captured = move.captured ? ` × ${labels[move.captured] || move.captured}` : '';
    const timeText = move.thinkTime ? formatThinkTime(move.thinkTime) : '';
    return `<li><span class="move-index">${number}.</span><span class="move-text">${move.color === 'r' ? 'Đỏ' : 'Đen'} ${labels[move.piece] || move.piece} ${coord(move.from)} → ${coord(move.to)}${captured}</span><span class="move-time">${timeText}</span></li>`;
  }).join('');
}

function coord(point) { return `${files[point.x]}${10 - point.y}`; }

function renderClocks() {
  if (!state.room) {
    if (el.redClock) el.redClock.textContent = '00:00';
    if (el.blackClock) el.blackClock.textContent = '00:00';
    return;
  }

  const { room } = state;
  const history = room.history || [];

  if (room.status === 'active') {
    const now = Date.now();
    const elapsedSec = Math.max(0, Math.floor((now - (room.turnStartedAt || now)) / 1000));
    const activeText = formatStopwatch(elapsedSec);

    const lastRedMove = history.slice().reverse().find((m) => m.color === 'r');
    const lastBlackMove = history.slice().reverse().find((m) => m.color === 'b');

    if (room.turn === 'r') {
      if (el.redClock) el.redClock.textContent = activeText;
      if (el.blackClock) el.blackClock.textContent = lastBlackMove ? formatStopwatch(lastBlackMove.thinkTime) : '00:00';
    } else {
      if (el.blackClock) el.blackClock.textContent = activeText;
      if (el.redClock) el.redClock.textContent = lastRedMove ? formatStopwatch(lastRedMove.thinkTime) : '00:00';
    }
  } else if (room.status === 'finished') {
    const lastRedMove = history.slice().reverse().find((m) => m.color === 'r');
    const lastBlackMove = history.slice().reverse().find((m) => m.color === 'b');
    if (el.redClock) el.redClock.textContent = lastRedMove ? formatStopwatch(lastRedMove.thinkTime) : '00:00';
    if (el.blackClock) el.blackClock.textContent = lastBlackMove ? formatStopwatch(lastBlackMove.thinkTime) : '00:00';
  } else {
    if (el.redClock) el.redClock.textContent = '00:00';
    if (el.blackClock) el.blackClock.textContent = '00:00';
  }
}

function renderActions() {
  const { room, you } = state;
  const canAct = Boolean(you.color && room.status === 'active');
  el.newGame.classList.toggle('is-hidden', room.status !== 'finished' || !you.color);
  el.newGame.disabled = !you.color;
  el.resign.disabled = !canAct;
  if (room.drawOffer && room.drawOffer !== you.color) {
    el.draw.textContent = 'Đồng ý hòa'; el.draw.disabled = !canAct;
  } else if (room.drawOffer === you.color) {
    el.draw.textContent = 'Đã đề nghị hòa'; el.draw.disabled = true;
  } else { el.draw.textContent = 'Đề nghị hòa'; el.draw.disabled = !canAct; }
}

let victoryOverlay = null;

function renderVictory() {
  const { room, you } = state;
  if (room.status !== 'finished') {
    if (victoryOverlay) { victoryOverlay.remove(); victoryOverlay = null; }
    return;
  }
  if (victoryOverlay) return;

  const isDraw = room.winner === null;
  const isWinner = you.color && room.winner === you.color;
  const winnerName = room.winner ? (room.players[room.winner]?.name || (room.winner === 'r' ? 'Đỏ' : 'Đen')) : null;

  victoryOverlay = document.createElement('div');
  victoryOverlay.className = 'victory-overlay';

  if (isWinner || isDraw) spawnConfetti(victoryOverlay, isDraw ? 28 : 52);

  const banner = document.createElement('div');
  banner.className = 'victory-banner';

  const seal = document.createElement('div');
  seal.className = 'victory-seal';
  seal.textContent = isDraw ? '和' : '勝';

  const title = document.createElement('h2');
  title.className = 'victory-title';
  title.textContent = isDraw ? 'Hòa cờ!' : `${winnerName} thắng!`;

  const reason = document.createElement('p');
  reason.className = 'victory-reason';
  reason.textContent = room.finishReason || '';

  const start = room.gameStartedAt || room.createdAt || Date.now();
  const end = room.updatedAt || Date.now();
  const totalSec = Math.max(1, Math.round((end - start) / 1000));
  const durationText = formatDuration(totalSec);
  const totalMoves = room.history?.length || 0;

  let redTotalSec = 0;
  let blackTotalSec = 0;
  if (room.history && room.history.length > 0) {
    room.history.forEach((m) => {
      const sec = m.thinkTime || 0;
      if (m.color === 'r') redTotalSec += sec;
      else if (m.color === 'b') blackTotalSec += sec;
    });
  }

  const redTimeText = formatThinkTime(redTotalSec);
  const blackTimeText = formatThinkTime(blackTotalSec);

  const stats = document.createElement('div');
  stats.className = 'victory-stats';
  stats.innerHTML = `
    <span class="victory-stats-item">Thời gian: <b>${durationText}</b></span>
    <span class="victory-stats-sep">|</span>
    <span class="victory-stats-item"><b>${totalMoves} nước</b></span>
    <span class="victory-stats-sep">|</span>
    <span class="victory-stats-item">Đỏ: <b>${redTimeText}</b></span>
    <span class="victory-stats-sep">|</span>
    <span class="victory-stats-item">Đen: <b>${blackTimeText}</b></span>
  `;

  banner.append(seal, title, reason, stats);

  if (you.color) {
    const btn = document.createElement('button');
    btn.className = 'primary-button full-button victory-btn';
    btn.innerHTML = '<span>Chơi ván mới</span><i>→</i>';
    btn.addEventListener('click', () => {
      if (victoryOverlay) { victoryOverlay.remove(); victoryOverlay = null; }
      send({ type: 'new-game' });
    });
    banner.append(btn);
  }

  victoryOverlay.append(banner);
  victoryOverlay.addEventListener('click', (e) => { if (e.target === victoryOverlay) { victoryOverlay.remove(); victoryOverlay = null; } });
  document.body.append(victoryOverlay);
}

function spawnConfetti(container, count) {
  const colors = ['#f2c379', '#e09c54', '#efb350', '#d4a574', '#fff3d4', '#c8956a', '#e38a79'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-particle';
    const size = 4 + Math.random() * 7;
    p.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;background:${colors[Math.floor(Math.random() * colors.length)]};border-radius:${Math.random() > .45 ? '50%' : '2px'};animation-duration:${2.2 + Math.random() * 2.8}s;animation-delay:${Math.random() * 1.8}s;`;
    container.append(p);
  }
}

function hasOpponent() { return Boolean(state.room?.players.r && state.room?.players.b && state.you.color); }

function renderVoice() {
  const opponentAvailable = hasOpponent();
  el.voiceButton.disabled = !opponentAvailable;
  el.mute.disabled = !voice.stream;
  el.mute.textContent = voice.muted ? 'Bật mic' : 'Tắt mic';
  el.mute.classList.toggle('is-hidden', !voice.stream);
  el.voiceButton.classList.toggle('active', Boolean(voice.stream));
  el.voiceButtonText.textContent = voice.stream ? 'Tắt voice' : 'Bật voice';
  el.voiceSignal.className = `voice-signal ${voice.remoteConnected ? 'connected' : voice.stream ? 'connecting' : ''}`;

  let tip = 'Voice chat trực tiếp giữa hai kỳ thủ';
  if (!opponentAvailable) {
    tip = state.you.color ? 'Vào đủ hai người để bật voice chat' : 'Khán giả không thể tham gia voice chat';
  } else if (voice.remoteConnected) {
    tip = voice.muted ? 'Đang kết nối • Mic đang tắt' : 'Đang trò chuyện trực tiếp';
  } else if (voice.stream) {
    tip = 'Đang ghép nối âm thanh với đối thủ…';
  }
  if (el.voiceControls) el.voiceControls.title = tip;
  el.voiceButton.title = tip;
}

async function toggleVoice() {
  if (voice.stream) { shutdownVoice(true); renderVoice(); return; }
  if (!hasOpponent()) return;
  if (!navigator.mediaDevices?.getUserMedia) return showToast('Trình duyệt này không hỗ trợ voice chat.', 'error');
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    ensurePeer(); addLocalTracks(); renderVoice();
    if (state.you.color === 'r' || voice.pc.remoteDescription) await makeOffer();
  } catch (error) {
    voice.stream = null;
    showToast(error.name === 'NotAllowedError' ? 'Bạn chưa cho phép dùng micro.' : 'Không thể mở micro lúc này.', 'error');
    renderVoice();
  }
}

function ensurePeer() {
  if (voice.pc) return voice.pc;
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  voice.pc = peer;
  peer.addEventListener('icecandidate', ({ candidate }) => { if (candidate) send({ type: 'signal', signal: { candidate } }); });
  peer.addEventListener('track', ({ streams }) => {
    el.remoteAudio.srcObject = streams[0];
    el.remoteAudio.play().catch(() => {});
    voice.remoteConnected = true; renderVoice();
  });
  peer.addEventListener('connectionstatechange', () => {
    const connected = peer.connectionState === 'connected';
    voice.remoteConnected = connected || (voice.remoteConnected && peer.connectionState === 'connecting');
    if (['failed', 'closed'].includes(peer.connectionState)) voice.remoteConnected = false;
    renderVoice();
  });
  return peer;
}

function addLocalTracks() {
  if (!voice.stream || !voice.pc) return;
  const sent = voice.pc.getSenders().map((sender) => sender.track?.id);
  voice.stream.getTracks().forEach((track) => { if (!sent.includes(track.id)) voice.pc.addTrack(track, voice.stream); });
}

async function makeOffer() {
  const peer = ensurePeer();
  if (voice.negotiating || peer.signalingState !== 'stable') return;
  voice.negotiating = true;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({ type: 'signal', signal: { description: peer.localDescription } });
  } catch { showToast('Không thể khởi tạo kênh voice.', 'error'); }
  finally { voice.negotiating = false; }
}

async function handleSignal(signal) {
  try {
    const peer = ensurePeer();
    if (signal.description) {
      await peer.setRemoteDescription(signal.description);
      while (voice.pendingCandidates.length) await peer.addIceCandidate(voice.pendingCandidates.shift());
      if (signal.description.type === 'offer') {
        addLocalTracks();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({ type: 'signal', signal: { description: peer.localDescription } });
      }
    } else if (signal.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
      else voice.pendingCandidates.push(signal.candidate);
    }
  } catch { showToast('Voice chat cần kết nối lại, bạn thử tắt rồi bật mic nhé.', 'error'); }
}

function shutdownVoice(stopMedia) {
  if (voice.pc) { voice.pc.ontrack = null; voice.pc.close(); voice.pc = null; }
  if (stopMedia && voice.stream) voice.stream.getTracks().forEach((track) => track.stop());
  if (stopMedia) voice.stream = null;
  voice.pendingCandidates = []; voice.remoteConnected = false; voice.muted = false; voice.negotiating = false;
  el.remoteAudio.srcObject = null;
}

function toggleMute() {
  if (!voice.stream) return;
  voice.muted = !voice.muted;
  voice.stream.getAudioTracks().forEach((track) => { track.enabled = !voice.muted; });
  renderVoice();
}

function showToast(text, kind = 'info') {
  const toast = document.createElement('div'); toast.className = `toast ${kind}`; toast.textContent = text;
  el.toast.append(toast); setTimeout(() => toast.remove(), 4200);
}

function createRoom() {
  if (!send({ type: 'create', name: getName() })) return;
  el.create.disabled = true;
  setTimeout(() => { el.create.disabled = false; }, 700);
}

function joinRoom() {
  const code = el.code.value.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (code.length < 5) return showToast('Mã phòng có 5 ký tự — ví dụ ABCDE.', 'error');
  send({ type: 'join', roomId: code, name: getName() });
}

async function copyRoom() {
  try { await navigator.clipboard.writeText(state.room.id); showToast('Đã sao chép mã phòng. Gửi cho bạn của bạn nhé!', 'success'); }
  catch { showToast(`Mã phòng của bạn là ${state.room.id}`, 'info'); }
}

function leaveRoom() {
  if (state.room && !confirm('Rời bàn cờ này chứ?')) return;
  send({ type: 'leave' }); clearSavedRoom(); shutdownVoice(true); state = { room: null, you: { color: null, name: getName() } }; selected = null; showLobby();
}

el.create.addEventListener('click', createRoom);
el.join.addEventListener('click', joinRoom);
el.code.addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
el.copyRoom.addEventListener('click', copyRoom);
el.leave.addEventListener('click', leaveRoom);
el.voiceButton.addEventListener('click', toggleVoice);
el.mute.addEventListener('click', toggleMute);
el.resign.addEventListener('click', () => { if (confirm('Bạn muốn xin thua ván này?')) send({ type: 'resign' }); });
el.newGame.addEventListener('click', () => send({ type: 'new-game' }));
el.draw.addEventListener('click', () => {
  if (state.room?.drawOffer && state.room.drawOffer !== state.you.color) send({ type: 'respond-draw', accept: true });
  else send({ type: 'offer-draw' });
});
if (el.soundToggle) el.soundToggle.addEventListener('click', toggleSound);

window.addEventListener('beforeunload', () => { shutdownVoice(true); });
setInterval(renderClocks, 250);
updateSoundButton();
connect();
