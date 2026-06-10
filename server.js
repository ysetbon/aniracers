// AniRacers game + multiplayer relay server
// Run: npm install && node server.js   (default port 8080, override with PORT env)
// Serves the game (index.html) over HTTP and the lobby relay over WebSocket on the SAME port.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080;

const INDEX = path.join(__dirname, 'index.html');
const httpServer = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if(url === '/' || url === '/index.html'){
    fs.readFile(INDEX, (err, data) => {
      if(err){ res.writeHead(500); return res.end('index.html not found'); }
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(data);
    });
  } else if(url === '/healthz'){
    res.writeHead(200, {'Content-Type': 'text/plain'}); res.end('ok');
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ server: httpServer });

const rooms = new Map(); // code -> {code, host, started, players: Map(id -> {ws,name,animal})}
let nextId = 1;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({length:4}, () => ALPHA[Math.random()*ALPHA.length|0]).join('');

const roster = room => [...room.players.entries()].map(([id,p]) => ({id, name:p.name, animal:p.animal, ready:!!p.ready}));
function bc(room, msg, exceptId){
  const s = JSON.stringify(msg);
  for(const [id,p] of room.players)
    if(id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}

wss.on('connection', ws => {
  const myId = String(nextId++);
  let myRoom = null;

  ws.on('message', data => {
    let m; try{ m = JSON.parse(data); }catch(e){ return; }

    if(m.t === 'create'){
      let code; do{ code = makeCode(); }while(rooms.has(code));
      myRoom = { code, host: myId, started: false, players: new Map() };
      myRoom.players.set(myId, {ws, name: String(m.name||'RACER').slice(0,10), animal: m.animal||'chicken', ready:false});
      rooms.set(code, myRoom);
      ws.send(JSON.stringify({t:'room', code, you:myId, host:true, players:roster(myRoom)}));
    }
    else if(m.t === 'join'){
      const room = rooms.get(String(m.code||'').toUpperCase());
      if(!room)        return ws.send(JSON.stringify({t:'err', m:'Room not found'}));
      if(room.started) return ws.send(JSON.stringify({t:'err', m:'Race already started'}));
      if(room.players.size >= 5) return ws.send(JSON.stringify({t:'err', m:'Room is full (max 5)'}));
      room.players.set(myId, {ws, name: String(m.name||'RACER').slice(0,10), animal: m.animal||'chicken', ready:false});
      myRoom = room;
      ws.send(JSON.stringify({t:'room', code:room.code, you:myId, host:false, players:roster(room)}));
      bc(room, {t:'players', players:roster(room), host:room.host}, myId);
    }
    else if(m.t === 'ready' && myRoom && !myRoom.started){
      const p = myRoom.players.get(myId);
      if(p) p.ready = !!m.v;
      bc(myRoom, {t:'players', players:roster(myRoom), host:myRoom.host}); // includes sender
    }
    else if(m.t === 'start' && myRoom && myRoom.host === myId && !myRoom.started){
      if(![...myRoom.players.values()].every(p => p.ready))
        return ws.send(JSON.stringify({t:'err', m:'Not everyone is ready yet'}));
      myRoom.started = true;
      const msg = {t:'start', world: m.world === 'beach' ? 'beach' : 'castle', players: roster(myRoom)};
      bc(myRoom, msg);                              // everyone else
      ws.send(JSON.stringify(msg));                 // and the host
    }
    else if((m.t === 'st' || m.t === 'ev') && myRoom){
      m.id = myId;
      bc(myRoom, m, myId);                          // relay to the rest of the room
    }
  });

  ws.on('close', () => {
    if(!myRoom) return;
    myRoom.players.delete(myId);
    bc(myRoom, {t:'left', id: myId});
    if(myRoom.players.size === 0) rooms.delete(myRoom.code);
    else if(myRoom.host === myId){
      myRoom.host = [...myRoom.players.keys()][0];  // promote a new host
      bc(myRoom, {t:'players', players:roster(myRoom), host:myRoom.host});
    }
  });
});

httpServer.listen(PORT, () => {
  console.log('AniRacers: game + relay on http://0.0.0.0:' + PORT + '  (open in browser to play)');
});
