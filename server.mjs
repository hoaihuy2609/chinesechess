import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, 'public');
const port = Number(process.env.PORT || 4173);
const rooms = new Map();
const clients = new Set();

const INITIAL_BOARD = [
  ['br', 'bh', 'be', 'ba', 'bk', 'ba', 'be', 'bh', 'br'],
  [null, null, null, null, null, null, null, null, null],
  [null, 'bc', null, null, null, null, null, 'bc', null],
  ['bp', null, 'bp', null, 'bp', null, 'bp', null, 'bp'],
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
  ['rp', null, 'rp', null, 'rp', null, 'rp', null, 'rp'],
  [null, 'rc', null, null, null, null, null, 'rc', null],
  [null, null, null, null, null, null, null, null, null],
  ['rr', 'rh', 're', 'ra', 'rk', 'ra', 're', 'rh', 'rr']
];

const pieceColor = (piece) => piece?.[0] || null;
const enemyOf = (color) => (color === 'r' ? 'b' : 'r');
const cloneBoard = (board) => board.map((row) => [...row]);
const inBounds = (x, y) => x >= 0 && x < 9 && y >= 0 && y < 10;
const inPalace = (color, x, y) => x >= 3 && x <= 5 && (color === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2);

function findKing(board, color) {
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      if (board[y][x] === `${color}k`) return { x, y };
    }
  }
  return null;
}

function lineCount(board, from, to) {
  if (from.x !== to.x && from.y !== to.y) return -1;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  let total = 0;
  while (x !== to.x || y !== to.y) {
    if (board[y][x]) total += 1;
    x += dx;
    y += dy;
  }
  return total;
}

function pieceCanReach(board, from, to) {
  const piece = board[from.y]?.[from.x];
  if (!piece || !inBounds(to.x, to.y)) return false;
  const color = piece[0];
  const type = piece[1];
  const target = board[to.y][to.x];
  if (target && target[0] === color) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  if (type === 'r') return (dx === 0 || dy === 0) && lineCount(board, from, to) === 0;
  if (type === 'c') {
    if (dx !== 0 && dy !== 0) return false;
    const screens = lineCount(board, from, to);
    return target ? screens === 1 : screens === 0;
  }
  if (type === 'h') {
    if (!((ax === 1 && ay === 2) || (ax === 2 && ay === 1))) return false;
    const leg = ax === 2 ? { x: from.x + Math.sign(dx), y: from.y } : { x: from.x, y: from.y + Math.sign(dy) };
    return !board[leg.y][leg.x];
  }
  if (type === 'e') {
    if (ax !== 2 || ay !== 2) return false;
    if ((color === 'r' && to.y < 5) || (color === 'b' && to.y > 4)) return false;
    return !board[from.y + dy / 2][from.x + dx / 2];
  }
  if (type === 'a') return ax === 1 && ay === 1 && inPalace(color, to.x, to.y);
  if (type === 'k') {
    if (target === `${enemyOf(color)}k` && dx === 0 && lineCount(board, from, to) === 0) return true;
    return ax + ay === 1 && inPalace(color, to.x, to.y);
  }
  if (type === 'p') {
    const forward = color === 'r' ? -1 : 1;
    if (dy === forward && dx === 0) return true;
    const crossed = color === 'r' ? from.y <= 4 : from.y >= 5;
    return crossed && dy === 0 && ax === 1;
  }
  return false;
}

function squareIsAttacked(board, square, attackingColor) {
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      if (pieceColor(board[y][x]) === attackingColor && pieceCanReach(board, { x, y }, square)) return true;
    }
  }
  return false;
}

function validateMove(board, color, from, to) {
  if (!inBounds(from.x, from.y) || !inBounds(to.x, to.y)) return { ok: false, reason: 'Nước đi nằm ngoài bàn cờ.' };
  const piece = board[from.y][from.x];
  if (pieceColor(piece) !== color) return { ok: false, reason: 'Bạn chỉ có thể đi quân của mình.' };
  if (!pieceCanReach(board, from, to)) return { ok: false, reason: 'Quân này không thể đi như vậy.' };

  const next = cloneBoard(board);
  const captured = next[to.y][to.x];
  next[to.y][to.x] = piece;
  next[from.y][from.x] = null;
  const ownKing = findKing(next, color);
  if (!ownKing || squareIsAttacked(next, ownKing, enemyOf(color))) return { ok: false, reason: 'Nước này làm Tướng của bạn bị chiếu.' };
  return { ok: true, board: next, piece, captured };
}

function hasLegalMove(board, color) {
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      if (pieceColor(board[y][x]) !== color) continue;
      for (let ty = 0; ty < 10; ty += 1) {
        for (let tx = 0; tx < 9; tx += 1) {
          if (validateMove(board, color, { x, y }, { x: tx, y: ty }).ok) return true;
        }
      }
    }
  }
  return false;
}

function createRoomCode() {
  let code;
  do code = randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  while (rooms.has(code));
  return code;
}

function newRoom(name) {
  const now = Date.now();
  return {
    id: createRoomCode(),
    board: cloneBoard(INITIAL_BOARD),
    turn: 'r',
    status: 'waiting',
    winner: null,
    finishReason: null,
    players: { r: null, b: null },
    history: [],
    messages: [],
    clocks: { r: 600000, b: 600000 },
    turnStartedAt: now,
    createdAt: now,
    updatedAt: now,
    drawOffer: null
  };
}

function advanceClock(room) {
  if (room.status !== 'active') return false;
  const now = Date.now();
  const elapsed = now - room.turnStartedAt;
  if (elapsed <= 0) return false;
  room.clocks[room.turn] = Math.max(0, room.clocks[room.turn] - elapsed);
  room.turnStartedAt = now;
  if (room.clocks[room.turn] === 0) {
    room.status = 'finished';
    room.winner = enemyOf(room.turn);
    room.finishReason = 'Hết giờ';
    return true;
  }
  return false;
}

function clientState(room, client) {
  const color = client.color || null;
  return {
    type: 'room-state',
    room: {
      id: room.id,
      board: room.board,
      turn: room.turn,
      status: room.status,
      winner: room.winner,
      finishReason: room.finishReason,
      players: room.players,
      history: room.history.slice(-16),
      messages: room.messages.slice(-40),
      clocks: room.clocks,
      turnStartedAt: room.turnStartedAt,
      check: room.status === 'active' && Boolean(findKing(room.board, room.turn) && squareIsAttacked(room.board, findKing(room.board, room.turn), enemyOf(room.turn))),
      drawOffer: room.drawOffer
    },
    you: { color, name: client.name || 'Khách' }
  };
}

function send(client, payload) {
  if (!client.socket.destroyed) client.socket.write(encodeFrame(JSON.stringify(payload)));
}

function broadcast(room, payloadFactory = (client) => clientState(room, client)) {
  for (const client of clients) if (client.roomId === room.id) send(client, payloadFactory(client));
}

function broadcastState(room) {
  advanceClock(room);
  broadcast(room);
}

function roomNotice(room, text, kind = 'info') {
  broadcast(room, () => ({ type: 'notice', text, kind }));
}

function resetGame(room) {
  room.board = cloneBoard(INITIAL_BOARD);
  room.turn = 'r';
  room.status = room.players.r && room.players.b ? 'active' : 'waiting';
  room.winner = null;
  room.finishReason = null;
  room.history = [];
  room.clocks = { r: 600000, b: 600000 };
  room.turnStartedAt = Date.now();
  room.drawOffer = null;
  room.updatedAt = Date.now();
}

function leaveRoom(client, announce = true) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  if (client.color && room.players[client.color]) {
    const name = room.players[client.color].name;
    room.players[client.color] = null;
    if (room.status === 'active') {
      room.status = 'waiting';
      room.drawOffer = null;
    }
    if (announce) roomNotice(room, `${name} đã rời phòng.`, 'muted');
  }
  client.roomId = null;
  client.color = null;
  room.updatedAt = Date.now();
  if (!room.players.r && !room.players.b) rooms.delete(room.id);
  else broadcastState(room);
}

function joinRoom(client, room, name) {
  leaveRoom(client, false);
  let color = !room.players.r ? 'r' : !room.players.b ? 'b' : null;
  client.roomId = room.id;
  client.color = color;
  client.name = name;
  if (color) {
    room.players[color] = { name, connected: true };
    if (room.players.r && room.players.b) {
      resetGame(room);
      roomNotice(room, 'Đủ hai kỳ thủ. Ván mới bắt đầu!', 'success');
    }
  }
  room.updatedAt = Date.now();
  send(client, clientState(room, client));
  if (color) {
    roomNotice(room, `${name} ${color === 'r' ? 'cầm quân Đỏ' : 'cầm quân Đen'} đã vào bàn.`, 'info');
    broadcastState(room);
  } else {
    roomNotice(room, `${name} đang xem trận đấu.`, 'muted');
  }
}

function sanitizeName(value) {
  const name = String(value || '').replace(/[<>]/g, '').trim().slice(0, 20);
  return name || 'Kỳ thủ';
}

function handleMessage(client, message) {
  if (!message || typeof message.type !== 'string') return;
  const name = sanitizeName(message.name || client.name);

  if (message.type === 'create') {
    const room = newRoom(name);
    rooms.set(room.id, room);
    joinRoom(client, room, name);
    return;
  }
  if (message.type === 'join') {
    const room = rooms.get(String(message.roomId || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    if (!room) return send(client, { type: 'error', text: 'Không tìm thấy phòng này. Kiểm tra lại mã mời nhé.' });
    joinRoom(client, room, name);
    return;
  }

  const room = rooms.get(client.roomId);
  if (!room) return send(client, { type: 'error', text: 'Bạn chưa ở trong phòng nào.' });

  if (message.type === 'leave') {
    leaveRoom(client);
    return;
  }

  if (message.type === 'move') {
    if (!client.color || room.status !== 'active') return;
    if (client.color !== room.turn) return send(client, { type: 'error', text: 'Chưa đến lượt của bạn.' });
    if (advanceClock(room)) return broadcastState(room);
    const from = message.from;
    const to = message.to;
    if (!from || !to) return;
    const result = validateMove(room.board, client.color, from, to);
    if (!result.ok) return send(client, { type: 'error', text: result.reason });

    room.board = result.board;
    room.history.push({ from, to, piece: result.piece, captured: result.captured, color: client.color, at: Date.now() });
    const opponent = enemyOf(client.color);
    const opponentKing = findKing(room.board, opponent);
    room.drawOffer = null;
    if (!opponentKing) {
      room.status = 'finished';
      room.winner = client.color;
      room.finishReason = 'Bắt Tướng';
    } else if (!hasLegalMove(room.board, opponent)) {
      room.status = 'finished';
      room.winner = client.color;
      room.finishReason = squareIsAttacked(room.board, opponentKing, client.color) ? 'Chiếu bí' : 'Hết nước đi';
    } else {
      room.turn = opponent;
      room.turnStartedAt = Date.now();
    }
    room.updatedAt = Date.now();
    broadcastState(room);
    return;
  }

  if (message.type === 'resign' && client.color && room.status === 'active') {
    room.status = 'finished';
    room.winner = enemyOf(client.color);
    room.finishReason = `${room.players[client.color]?.name || 'Kỳ thủ'} xin thua`;
    room.updatedAt = Date.now();
    broadcastState(room);
    return;
  }

  if (message.type === 'new-game' && client.color && room.status === 'finished') {
    resetGame(room);
    roomNotice(room, 'Bàn cờ đã được xếp lại cho ván mới.', 'success');
    broadcastState(room);
    return;
  }

  if (message.type === 'offer-draw' && client.color && room.status === 'active') {
    room.drawOffer = client.color;
    broadcastState(room);
    return;
  }

  if (message.type === 'respond-draw' && client.color && room.drawOffer && room.drawOffer !== client.color) {
    if (message.accept) {
      room.status = 'finished';
      room.winner = null;
      room.finishReason = 'Hai bên đồng ý hòa';
    }
    room.drawOffer = null;
    broadcastState(room);
    return;
  }

  if (message.type === 'chat') {
    const text = String(message.text || '').replace(/[<>]/g, '').trim().slice(0, 240);
    if (!text) return;
    room.messages.push({ id: randomUUID(), from: client.name || 'Kỳ thủ', color: client.color, text, at: Date.now() });
    room.messages = room.messages.slice(-80);
    broadcast(room, () => ({ type: 'chat', message: room.messages.at(-1) }));
    return;
  }

  if (message.type === 'signal' && client.color && (message.signal?.description || message.signal?.candidate)) {
    for (const other of clients) {
      if (other.roomId === room.id && other !== client && other.color && other.color !== client.color) send(other, { type: 'signal', signal: message.signal });
    }
  }
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  const length = payload.length;
  if (length < 126) return Buffer.concat([Buffer.from([0x81, length]), payload]);
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function parseFrames(client) {
  let data = client.buffer;
  while (data.length >= 2) {
    const first = data[0];
    const opcode = first & 0x0f;
    const masked = (data[1] & 0x80) !== 0;
    let length = data[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (data.length < 4) break;
      length = data.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (data.length < 10) break;
      const large = data.readBigUInt64BE(2);
      if (large > 65536n) return client.socket.destroy();
      length = Number(large);
      offset = 10;
    }
    if (!masked) return client.socket.destroy();
    if (data.length < offset + 4 + length) break;
    const mask = data.subarray(offset, offset + 4);
    const payload = Buffer.alloc(length);
    const start = offset + 4;
    for (let i = 0; i < length; i += 1) payload[i] = data[start + i] ^ mask[i % 4];
    data = data.subarray(start + length);
    if (opcode === 0x8) return client.socket.end();
    if (opcode === 0x9) client.socket.write(Buffer.from([0x8a, length, ...payload]));
    if (opcode === 0x1) {
      try { handleMessage(client, JSON.parse(payload.toString('utf8'))); } catch { send(client, { type: 'error', text: 'Dữ liệu không hợp lệ.' }); }
    }
  }
  client.buffer = data;
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  const requested = new URL(req.url, `http://${req.headers.host}`).pathname;
  const relative = requested === '/' ? '/index.html' : requested;
  const filePath = path.resolve(publicRoot, `.${relative}`);
  if (!filePath.startsWith(publicRoot)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Không tìm thấy trang này.');
  }
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, `http://${req.headers.host}`).pathname !== '/ws' || !req.headers['sec-websocket-key']) return socket.destroy();
  const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const client = { id: randomUUID(), socket, buffer: Buffer.alloc(0), roomId: null, color: null, name: 'Kỳ thủ' };
  clients.add(client);
  send(client, { type: 'hello', id: client.id });
  socket.on('data', (chunk) => { client.buffer = Buffer.concat([client.buffer, chunk]); parseFrames(client); });
  socket.on('close', () => { clients.delete(client); leaveRoom(client); });
  socket.on('error', () => {});
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (advanceClock(room)) broadcastState(room);
    if (Date.now() - room.updatedAt > 6 * 60 * 60 * 1000) rooms.delete(room.id);
  }
}, 1000).unref();

server.listen(port, () => console.log(`Cờ Tướng Nói Chuyện đang chạy tại http://localhost:${port}`));
