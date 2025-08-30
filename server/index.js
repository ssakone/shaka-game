// Minimal WebSocket + matchmaking/rooms server (no external deps)
// Usage: node server/index.js

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// --- In-memory state ---
/** @type {Map<string, Client>} */
const clients = new Map();
/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {string[]} */
const queue = [];

// Types (JSDoc)
/**
 * @typedef {Object} Client
 * @property {string} id
 * @property {import('net').Socket} socket
 * @property {boolean} online
 * @property {string | null} roomId
 * @property {boolean} ready
 * @property {number} lastSeen
 * @property {string | null} nick
 * @property {Set<number>} foundNumbers
 */

/**
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} code
 * @property {string} hostId
 * @property {string[]} members
 * @property {boolean} started
 * @property {number | null} seed
 * @property {number | null} startAt
 * @property {number} currentTarget
 */

// --- Helpers ---
function genId(len = 16) {
  return crypto.randomBytes(len).toString('hex');
}

function genRoomCode() {
  // 5-char alnum code
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  if ([...rooms.values()].some(r => r.code === code)) return genRoomCode();
  return code;
}

function uNow() {
  return Date.now();
}

function listMembers(room) {
  return room.members.map(id => {
    const c = clients.get(id);
    return {
      id,
      nick: c?.nick || null,
      ready: !!c?.ready,
      online: !!c?.online,
      isHost: id === room.hostId,
    };
  });
}

function broadcastRoom(room, msg, excludeId = null) {
  for (const id of room.members) {
    if (excludeId && excludeId === id) continue;
    const c = clients.get(id);
    if (c?.online) sendJson(c.socket, msg);
  }
}

function removeFromArray(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
}

// --- Minimal WS framing ---
function createAcceptValue(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
    .digest('base64');
}

function sendData(socket, dataBuffer, opcode = 0x1) {
  // Server-to-client frames are not masked
  const payloadLength = dataBuffer.length;
  let header;

  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN + opcode
    header[1] = payloadLength; // no mask bit
  } else if (payloadLength < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    // Write 64-bit length; we only support up to 2^53-1 realistically
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payloadLength, 6);
  }

  socket.write(Buffer.concat([header, dataBuffer]));
}

function sendText(socket, text) {
  sendData(socket, Buffer.from(text));
}

function sendJson(socket, obj) {
  try {
    sendText(socket, JSON.stringify(obj));
  } catch (e) {
    // ignore
  }
}

function readFrames(bufferState, chunk, onFrame) {
  // Simple frame parser for masked text frames (client->server). No fragmentation.
  bufferState.buffer = Buffer.concat([bufferState.buffer, chunk]);
  const buf = bufferState.buffer;
  let offset = 0;
  while (buf.length - offset >= 2) {
    const byte1 = buf[offset];
    const byte2 = buf[offset + 1];
    const fin = (byte1 & 0x80) === 0x80;
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) === 0x80;
    let payloadLen = byte2 & 0x7f;
    let headerLen = 2;
    if (payloadLen === 126) {
      if (buf.length - offset < 4) break;
      payloadLen = buf.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (buf.length - offset < 10) break;
      // High 32 bits ignored for our purposes
      const high = buf.readUInt32BE(offset + 2);
      const low = buf.readUInt32BE(offset + 6);
      if (high !== 0) {
        // Too large; drop
        return false;
      }
      payloadLen = low;
      headerLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    const totalLen = headerLen + maskLen + payloadLen;
    if (buf.length - offset < totalLen) break;
    let payload = buf.slice(offset + headerLen + maskLen, offset + totalLen);
    if (masked) {
      const mask = buf.slice(offset + headerLen, offset + headerLen + 4);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }
    if (!fin) {
      // For simplicity: ignore/close on fragmented frames
      return false;
    }
    onFrame({ opcode, payload });
    offset += totalLen;
  }
  bufferState.buffer = buf.slice(offset);
  return true;
}

function sendClose(socket, code = 1000) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(code, 0);
  sendData(socket, buf, 0x8);
  try { socket.end(); } catch {}
}

// --- Server logic ---
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', clients: clients.size, rooms: rooms.size }));
    return;
  }
  if (req.url === '/debug') {
    const debugInfo = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      clients: {
        total: clients.size,
        online: Array.from(clients.values()).filter(c => c.online).length,
        list: Array.from(clients.entries()).map(([id, client]) => ({
          id,
          online: client.online,
          roomId: client.roomId,
          ready: client.ready,
          nick: client.nick
        }))
      },
      rooms: {
        total: rooms.size,
        list: Array.from(rooms.values()).map(room => ({
          id: room.id,
          code: room.code,
          started: room.started,
          members: room.members.length,
          membersList: listMembers(room)
        }))
      },
      queue: {
        length: queue.length,
        players: queue.map(id => {
          const client = clients.get(id);
          return {
            id,
            online: client?.online || false,
            nick: client?.nick || null
          };
        })
      }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(debugInfo, null, 2));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server running');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (!key || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  const accept = createAcceptValue(key.toString());
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
  ];
  socket.write(headers.concat('\r\n').join('\r\n'));

  const bufferState = { buffer: Buffer.alloc(0) };

  // Associate this raw socket with a temporary client until hello
  /** @type {Client} */
  let client = null;

  const heartbeat = setInterval(() => {
    try {
      sendData(socket, Buffer.alloc(0), 0x9); // ping
    } catch {
      clearInterval(heartbeat);
    }
  }, 20000);

  socket.on('data', (chunk) => {
    const ok = readFrames(bufferState, chunk, ({ opcode, payload }) => {
      if (opcode === 0x1) {
        // text
        let msg;
        try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
        handleMessage(msg);
      } else if (opcode === 0x8) {
        // close
        try { socket.end(); } catch {}
      } else if (opcode === 0x9) {
        // ping -> pong
        sendData(socket, payload, 0xA);
      } else if (opcode === 0xA) {
        // pong - ignore
      }
    });
    if (!ok) {
      sendClose(socket, 1002);
    }
  });

  socket.on('end', cleanup);
  socket.on('close', cleanup);
  socket.on('error', cleanup);

  function cleanup() {
    clearInterval(heartbeat);
    if (client) {
      client.online = false;
      client.lastSeen = uNow();
      // inform room
      if (client.roomId && rooms.has(client.roomId)) {
        const room = rooms.get(client.roomId);
        broadcastRoom(room, { type: 'room:state', roomId: room.id, members: listMembers(room) });
      }
    }
    try { socket.destroy(); } catch {}
  }

  function handleMessage(msg) {
    const t = msg && msg.type;
    if (t === 'hello') {
      // Accept a client-provided sessionId (device id) if unique; otherwise generate.
      let id = null;
      if (msg.sessionId && typeof msg.sessionId === 'string') {
        const candidate = msg.sessionId.trim().slice(0, 64);
        id = clients.has(candidate) ? candidate : candidate; // accept new or existing
      } else {
        id = genId(8);
      }
      if (clients.has(id)) {
        // reconnect
        const existing = clients.get(id);
        // Close the previous socket if different to avoid duplicate connections on same id
        if (existing.socket && existing.socket !== socket) {
          try { sendClose(existing.socket, 1000); } catch {}
        }
        existing.socket = socket;
        existing.online = true;
        existing.nick = msg.nick || existing.nick || null;
        if (!existing.foundNumbers) existing.foundNumbers = new Set();
        client = existing;
      } else {
        client = {
          id,
          socket,
          online: true,
          roomId: null,
          ready: false,
          lastSeen: uNow(),
          nick: msg.nick || null,
          foundNumbers: new Set(),
        };
        clients.set(id, client);
      }
      sendJson(socket, { type: 'hello', sessionId: client.id });
      // If in a room, resend state to help resume
      if (client.roomId && rooms.has(client.roomId)) {
        const room = rooms.get(client.roomId);
        sendJson(socket, { type: 'room:joined', roomId: room.id, code: room.code, members: listMembers(room), hostId: room.hostId });
        if (room.started && room.seed && room.startAt) {
          // Send game resume data with current state
          const opponentNumbers = room.members
            .filter(memberId => memberId !== client.id)
            .map(memberId => Array.from(clients.get(memberId)?.foundNumbers || []))
            .flat();

          const scores = room.members.map(id => ({
            id,
            score: (clients.get(id)?.foundNumbers?.size) || 0
          }));
            
          sendJson(socket, { 
            type: 'game:resume', 
            roomId: room.id, 
            seed: room.seed, 
            startAt: room.startAt,
            currentTarget: room.currentTarget,
            myFoundNumbers: Array.from(client.foundNumbers),
            opponentFoundNumbers: opponentNumbers,
            scores
          });
        }
      }
    }
    else if (!client) {
      // Must say hello first
      sendJson(socket, { type: 'error', message: 'must hello first' });
    }
    else if (t === 'queue:join') {
      if (!queue.includes(client.id)) {
        queue.push(client.id);
        console.log(`➕ Joueur ${client.id} (${client.nick || 'sans nom'}) rejoint la queue`);
      } else {
        console.log(`⚠️ Joueur ${client.id} déjà dans la queue`);
      }
      tryMatchmake();
      sendJson(socket, { type: 'queue:ok' });
    }
    else if (t === 'queue:leave') {
      removeFromArray(queue, client.id);
      console.log(`➖ Joueur ${client.id} (${client.nick || 'sans nom'}) quitte la queue`);
      sendJson(socket, { type: 'queue:left' });
    }
    else if (t === 'room:create') {
      // leave queue/room first
      removeFromArray(queue, client.id);
      if (client.roomId) leaveRoom(client);
      // Set nick from message if provided
      if (msg.nick && typeof msg.nick === 'string') {
        client.nick = msg.nick.trim().substring(0, 20) || null;
      }
      const room = createRoom(client);
      sendJson(socket, { type: 'room:created', roomId: room.id, code: room.code, hostId: room.hostId, members: listMembers(room) });
    }
    else if (t === 'room:join') {
      // data: code
      const code = (msg.code || '').toString().trim().toUpperCase();
      const room = [...rooms.values()].find(r => r.code === code);
      if (!room) return sendJson(socket, { type: 'room:error', message: 'code invalide' });
      if (room.started) return sendJson(socket, { type: 'room:error', message: 'partie déjà commencée' });
      if (!room.members.includes(client.id) && room.members.length >= 2) return sendJson(socket, { type: 'room:error', message: 'salle pleine' });
      // Set nick from message if provided
      if (msg.nick && typeof msg.nick === 'string') {
        client.nick = msg.nick.trim().substring(0, 20) || null;
      }
      // leave from previous if any
      removeFromArray(queue, client.id);
      if (client.roomId && client.roomId !== room.id) leaveRoom(client);
      if (!room.members.includes(client.id)) room.members.push(client.id);
      client.roomId = room.id;
      client.ready = false;
      broadcastRoom(room, { type: 'room:joined', roomId: room.id, code: room.code, hostId: room.hostId, members: listMembers(room) });
    }
    else if (t === 'room:leave') {
      if (client.roomId) {
        const room = rooms.get(client.roomId);
        leaveRoom(client);
        if (room) broadcastRoom(room, { type: 'room:state', roomId: room.id, members: listMembers(room) });
      }
      sendJson(socket, { type: 'room:left' });
    }
    else if (t === 'room:ready') {
      if (!client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room) return;
      client.ready = !!msg.ready;
      broadcastRoom(room, { type: 'room:state', roomId: room.id, members: listMembers(room) });
    }
    else if (t === 'room:start') {
      if (!client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room) return;
      if (room.hostId !== client.id) return sendJson(socket, { type: 'room:error', message: 'seul l’hôte peut lancer' });
      if (room.members.length !== 2) return sendJson(socket, { type: 'room:error', message: 'il faut 2 joueurs' });
      const allReady = room.members.every(id => clients.get(id)?.ready);
      if (!allReady) return sendJson(socket, { type: 'room:error', message: 'tout le monde doit être prêt' });
      room.started = true;
      room.seed = crypto.randomBytes(4).readUInt32BE(0);
      room.startAt = uNow() + 1500;
      room.currentTarget = 1; // Initialize target for this game
      
      // Clear found numbers for all players at game start
      room.members.forEach(memberId => {
        const member = clients.get(memberId);
        if (member) member.foundNumbers.clear();
      });
      
      broadcastRoom(room, { type: 'game:start', roomId: room.id, seed: room.seed, startAt: room.startAt });
    }
    else if (t === 'game:progress') {
      if (!client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || !room.started) return;
      
      const foundNumber = typeof msg.found === 'number' ? msg.found : 0;
      
      // Only process if the client found the current target number
      if (foundNumber === room.currentTarget) {
        // Record that this client found this number
        client.foundNumbers.add(foundNumber);
        
        room.currentTarget++; // Advance to next target for both players
        
        // Compute server-authoritative scores and broadcast progression
        const scores = room.members.map(id => ({
          id,
          score: (clients.get(id)?.foundNumbers?.size) || 0
        }));
        broadcastRoom(room, { 
          type: 'game:progress', 
          from: client.id, 
          found: foundNumber, 
          currentTarget: room.currentTarget,
          scores
        });
        
        // Check for game completion
        if (room.currentTarget > 100) {
          room.started = false; // stop
          // Clear found numbers for both players when game ends
          room.members.forEach(memberId => {
            const member = clients.get(memberId);
            if (member) member.foundNumbers.clear();
          });
          broadcastRoom(room, { type: 'game:over', winner: client.id });
        }
      }
      // If wrong number sent, ignore (shouldn't happen with proper client logic)
    }
  }
});

function tryMatchmake() {
  console.log(`🔍 Tentative de matchmaking avec ${queue.length} joueurs en queue:`, queue);
  
  while (queue.length >= 2) {
    // Remove duplicates and offline users first
    cleanQueue();
    
    if (queue.length < 2) break;
    
    const a = queue.shift();
    const ca = clients.get(a);
    
    if (!ca?.online) {
      console.log(`⚠️ Joueur ${a} hors ligne, retiré de la queue`);
      continue;
    }
    
    // Find a valid opponent
    let b = null;
    let cb = null;
    
    for (let i = 0; i < queue.length; i++) {
      const candidate = queue[i];
      const candidateClient = clients.get(candidate);
      
      if (candidate !== a && candidateClient?.online) {
        b = candidate;
        cb = candidateClient;
        queue.splice(i, 1); // Remove from queue
        break;
      }
    }
    
    if (!b || !cb) {
      console.log(`⚠️ Pas d'adversaire valide trouvé pour ${a}, remis en queue`);
      queue.unshift(a); // Put back in queue
      break;
    }
    
    console.log(`✅ Match trouvé: ${a} vs ${b}`);
    
    // create room
    const room = createRoom(ca);
    room.members.push(cb.id);
    cb.roomId = room.id;
    ca.ready = false; cb.ready = false;
    
    broadcastRoom(room, { type: 'match:found', roomId: room.id, code: room.code, hostId: room.hostId, members: listMembers(room) });
    broadcastRoom(room, { type: 'room:joined', roomId: room.id, code: room.code, hostId: room.hostId, members: listMembers(room) });
  }
  
  console.log(`📊 Queue après matchmaking: ${queue.length} joueurs restants:`, queue);
}

function cleanQueue() {
  // Remove duplicates and offline clients
  const validQueue = [];
  const seen = new Set();
  
  for (const clientId of queue) {
    if (!seen.has(clientId)) {
      const client = clients.get(clientId);
      if (client?.online) {
        validQueue.push(clientId);
        seen.add(clientId);
      } else {
        console.log(`🧹 Nettoyage: client ${clientId} retiré (hors ligne ou inexistant)`);
      }
    }
  }
  
  queue.length = 0;
  queue.push(...validQueue);
}

function createRoom(hostClient) {
  const room = {
    id: genId(6),
    code: genRoomCode(),
    hostId: hostClient.id,
    members: [hostClient.id],
    started: false,
    seed: null,
    startAt: null,
    currentTarget: 1,
  };
  rooms.set(room.id, room);
  hostClient.roomId = room.id;
  hostClient.ready = false;
  return room;
}

function leaveRoom(client) {
  const room = client.roomId ? rooms.get(client.roomId) : null;
  if (!room) { client.roomId = null; client.ready = false; client.foundNumbers?.clear(); return; }
  removeFromArray(room.members, client.id);
  client.roomId = null;
  client.ready = false;
  client.foundNumbers?.clear();
  if (room.members.length === 0) {
    rooms.delete(room.id);
  } else {
    // Reassign host if needed
    if (!room.members.includes(room.hostId)) {
      room.hostId = room.members[0];
    }
  }
}

server.listen(PORT, () => {
  console.log(`✅ WebSocket server listening on port ${PORT}`);
});
