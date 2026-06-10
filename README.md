# 🐔 ANIRACERS — play online with friends (free hosting guide)

A LEGO-Racers-style kart game. Up to **5 players**: chicken, dog, sheep, cat, frog.
One person hosts a room, friends join with a 4-letter code, everyone presses **READY**,
and the host starts the race.

## What's in this repo

| File | What it is |
|---|---|
| `index.html` | The whole game (offline vs AI + online multiplayer) |
| `server.js` + `package.json` | Serves the game over HTTP **and** runs the WebSocket lobby/relay — one server, one port |
| `render.yaml` | One-click config for free hosting on Render |
| `Dockerfile` | Optional: run the server anywhere as a container |

---

## 🚀 Get playing on the internet (~5 minutes, all free)

### Step 1 — Put this repo on GitHub
1. Create a GitHub account (free) → **New repository** → name it `aniracers`, Public.
2. Easiest upload (no git needed): on the empty repo page click **"uploading an existing file"**,
   drag in ALL the files from this folder, **Commit**.

### Step 2 — Deploy on Render (free) — game AND server in ONE deploy
1. Go to **render.com** → sign up with your GitHub account.
2. **New + → Web Service** → pick your `aniracers` repo.
3. Render reads `render.yaml` automatically (Node, free plan, `npm install`, `node server.js`).
   If asked manually: Runtime **Node**, Build `npm install`, Start `node server.js`, Instance **Free**.
4. Deploy. You get a URL like `https://aniracers-server.onrender.com` —
   **that URL IS the game.** It serves the page and hosts the multiplayer relay on the
   same address, so the server field in the lobby is filled in automatically.

### Step 3 — Play!
1. Open your Render URL → **🌐 PLAY ONLINE** (server address is pre-filled).
2. Name + animal → **CREATE ROOM**.
3. Click **📋 COPY INVITE** — this copies a magic link that already contains the
   server address AND the room code. Send it to your friends (WhatsApp etc).
4. Friends click the link → the lobby opens pre-filled → they type a name, pick an
   animal, press **JOIN**.
5. Everyone presses **I'M READY!** (✅ appears next to ready players, ⌛ for waiting).
6. When ALL players are ready, the host's START buttons unlock (Castle / Beach). GO!

> The server refuses to start the race until everyone is ready — enforced server-side.

---

## ⚠️ Good to know
- **Render free tier sleeps** after ~15 min of inactivity. The first person connecting
  may wait ~30–50 seconds while it wakes up. After that it's fast for the whole session.
- **https pages need wss://** — GitHub Pages is https, so always use the `wss://` form
  of your Render URL. (Plain `ws://` only works when opening the HTML file locally.)
- Room codes are 4 letters; rooms vanish when the last player leaves; max 5 per room.

## 🏠 Play on your home network instead (no internet hosting)
```bash
npm install
node server.js            # http://localhost:8080
```
Open `http://localhost:8080` in your browser — the game AND the relay are both there.
Friends on the same Wi-Fi open `http://YOUR-LAN-IP:8080` (server field auto-fills).

## 🐳 Docker alternative (any VPS / cloud)
```bash
docker build -t aniracers-server .
docker run -d -p 8080:8080 --restart unless-stopped aniracers-server
```

## How the netcode works (short version)
Each player simulates only their own kart and broadcasts position ~12×/sec; remote karts
are interpolated (with snap detection for warp teleports). Weapons and hazards travel as
events, and each player's own game decides hits on their own kart (victim-authoritative) —
the server is just a dumb relay, which is why the free tier is plenty.
