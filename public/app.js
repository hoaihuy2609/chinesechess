const $ = (selector) => document.querySelector(selector);

const el = {
  lobby: $('#lobby-view'), game: $('#game-view'), name: $('#player-name'), code: $('#room-code'),
  create: $('#create-room'), join: $('#join-room'), board: $('#xiangqi-board'),
  roomCode: $('#room-code-display'), copyRoom: $('#copy-room'), leave: $('#leave-room'), status: $('#game-status'),
  redName: $('#red-player-name'), blackName: $('#black-player-name'), redClock: $('#red-clock'), blackClock: $('#black-clock'),
  redCard: $('#red-player-card'), blackCard: $('#black-player-card'), redYou: $('#red-you-tag'), blackYou: $('#black-you-tag'),
  moveList: $('#move-list'), moveCount: $('#move-count'), boardTip: $('#board-tip'),
  draw: $('#draw-button'), resign: $('#resign-button'), newGame: $('#new-game'), chat: $('#chat-messages'), chatForm: $('#chat-form'), chatInput: $('#chat-input'),
  voiceButton: $('#voice-button'), voiceButtonText: $('#voice-button-text'), voiceState: $('#voice-state'), voiceSignal: $('#voice-signal'), voiceDescription: $('#voice-description'), mute: $('#mute-button'), remoteAudio: $('#remote-audio'),
  connection: $('#connection-label'), connectionDot: $('.connection-dot'), toast: $('#toast-stack'),
  help: $('#help-button'), modal: $('#modal-backdrop'), modalClose: $('#modal-close'), modalOk: $('#modal-ok')
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
  try { return JSON.parse(sessionStorage.getItem(sessionKey)); } catch { return null; }
}

function saveRoom(roomId, name) {
  sessionStorage.setItem(sessionKey, JSON.stringify({ roomId, name }));
}

function clearSavedRoom() { sessionStorage.removeItem(sessionKey); }

function handleServerMessage(message) {
  if (message.type === 'room-state') {
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
  if (message.type === 'chat' && state.room) {
    state.room.messages.push(message.message);
    renderChat();
    return;
  }
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
  renderBoard();
  renderHistory();
  renderClocks();
  renderChat();
  renderVoice();
  renderActions();
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

function boardSvg() {
  const y = (row) => (6 + (88 * row) / 9).toFixed(3);
  const x = (col) => (6 + (88 * col) / 8).toFixed(3);
  const horizontals = Array.from({ length: 10 }, (_, i) => `<line x1="6" y1="${y(i)}" x2="94" y2="${y(i)}" />`).join('');
  const verticals = Array.from({ length: 9 }, (_, i) => `<line x1="${x(i)}" y1="${y(0)}" x2="${x(i)}" y2="${y(4)}" /><line x1="${x(i)}" y1="${y(5)}" x2="${x(i)}" y2="${y(9)}" />`).join('');
  return `<svg class="board-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${horizontals}${verticals}<line x1="39" y1="6" x2="61" y2="25.556"/><line x1="61" y1="6" x2="39" y2="25.556"/><line x1="39" y1="74.444" x2="61" y2="94"/><line x1="61" y1="74.444" x2="39" y2="94"/></svg><div class="river-band"><span>楚河</span><span>漢界</span></div>`;
}

function renderBoard() {
  const { room, you } = state;
  const targets = selected ? pseudoTargets(room.board, selected.x, selected.y) : [];
  const last = room.history.at(-1);
  let html = boardSvg();
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const piece = room.board[y][x];
      const isSelected = selected?.x === x && selected?.y === y;
      const target = targets.find((point) => point.x === x && point.y === y);
      const lastMove = last && ((last.from.x === x && last.from.y === y) || (last.to.x === x && last.to.y === y));
      const classes = ['square'];
      if (isSelected) classes.push('is-selected');
      if (target) classes.push(piece ? 'capture-target' : 'legal-target');
      const position = `left:calc(6% + (88% * ${x} / 8));top:calc(6% + (88% * ${y} / 9));`;
      const aria = piece ? `${pieceColorText(piece[0])} ${pieceNames[piece[1]]}` : `Ô ${files[x]}${10 - y}`;
      html += `<button class="${classes.join(' ')}" style="${position}" data-x="${x}" data-y="${y}" role="gridcell" aria-label="${aria}">${piece ? `<span class="piece ${piece[0] === 'b' ? 'black' : ''} ${lastMove ? 'last-move' : ''}">${labels[piece]}</span>` : ''}</button>`;
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

function renderHistory() {
  const history = state.room.history;
  el.moveCount.textContent = `${history.length} NƯỚC`;
  if (!history.length) { el.moveList.innerHTML = '<li class="empty-list">Nước đi sẽ hiện tại đây.</li>'; return; }
  el.moveList.innerHTML = history.slice().reverse().map((move, index) => {
    const number = history.length - index;
    const captured = move.captured ? ` × ${labels[move.captured]}` : '';
    return `<li><span class="move-index">${number}.</span><span>${move.color === 'r' ? 'Đỏ' : 'Đen'} ${labels[move.piece]} ${coord(move.from)} → ${coord(move.to)}${captured}</span></li>`;
  }).join('');
}

function coord(point) { return `${files[point.x]}${10 - point.y}`; }

function renderClocks() {
  if (!state.room) return;
  const room = state.room; let red = room.clocks.r; let black = room.clocks.b;
  if (room.status === 'active') {
    const elapsed = Math.max(0, Date.now() - room.turnStartedAt);
    if (room.turn === 'r') red = Math.max(0, red - elapsed); else black = Math.max(0, black - elapsed);
  }
  el.redClock.textContent = formatClock(red);
  el.blackClock.textContent = formatClock(black);
}

function formatClock(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000); const min = Math.floor(seconds / 60); const sec = String(seconds % 60).padStart(2, '0');
  return `${min}:${sec}`;
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

function renderChat() {
  const messages = state.room?.messages || [];
  if (!messages.length) { el.chat.innerHTML = '<p class="empty-chat">Chưa có lời nhắn nào.</p>'; return; }
  el.chat.innerHTML = '';
  for (const message of messages) {
    const line = document.createElement('p');
    line.className = `chat-line ${message.color === 'b' ? 'black' : ''}`;
    const sender = document.createElement('b'); sender.textContent = `${message.from}:`;
    line.append(sender, document.createTextNode(` ${message.text}`));
    el.chat.append(line);
  }
  if (!chatScrolled || el.chat.scrollTop + el.chat.clientHeight >= el.chat.scrollHeight - 48) el.chat.scrollTop = el.chat.scrollHeight;
  chatScrolled = true;
}

function hasOpponent() { return Boolean(state.room?.players.r && state.room?.players.b && state.you.color); }

function renderVoice() {
  const opponentAvailable = hasOpponent();
  el.voiceButton.disabled = !opponentAvailable;
  el.mute.disabled = !voice.stream;
  el.mute.textContent = voice.muted ? 'Bật mic' : 'Tắt mic';
  el.voiceButton.classList.toggle('active', Boolean(voice.stream));
  el.voiceButtonText.textContent = voice.stream ? 'Tắt voice chat' : 'Bật voice chat';
  el.voiceSignal.className = `voice-signal ${voice.remoteConnected ? 'connected' : voice.stream ? 'connecting' : ''}`;
  if (!opponentAvailable) {
    el.voiceDescription.textContent = state.you.color ? 'Vào đủ hai người để bật voice chat.' : 'Khán giả không thể tham gia voice chat.';
    el.voiceState.textContent = 'Chưa kết nối';
  } else if (voice.remoteConnected) {
    el.voiceDescription.textContent = 'Âm thanh đang truyền trực tiếp, không cần rời bàn cờ.';
    el.voiceState.textContent = voice.muted ? 'Đã tắt mic của bạn' : 'Đang trò chuyện';
  } else if (voice.stream) {
    el.voiceDescription.textContent = 'Đang ghép kênh âm thanh với đối thủ…';
    el.voiceState.textContent = voice.muted ? 'Mic đang tắt' : 'Đang chờ đối thủ';
  } else {
    el.voiceDescription.textContent = 'Voice chỉ truyền âm thanh giữa hai kỳ thủ.';
    el.voiceState.textContent = 'Sẵn sàng bật';
  }
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
el.chatForm.addEventListener('submit', (event) => { event.preventDefault(); const text = el.chatInput.value.trim(); if (text && send({ type: 'chat', text })) el.chatInput.value = ''; });
el.help.addEventListener('click', () => el.modal.classList.remove('is-hidden'));
el.modalClose.addEventListener('click', () => el.modal.classList.add('is-hidden'));
el.modalOk.addEventListener('click', () => el.modal.classList.add('is-hidden'));
el.modal.addEventListener('click', (event) => { if (event.target === el.modal) el.modal.classList.add('is-hidden'); });
window.addEventListener('beforeunload', () => { shutdownVoice(true); });
setInterval(renderClocks, 500);
connect();
