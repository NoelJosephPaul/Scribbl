const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const WORDS = [
  "apple","banana","car","dog","elephant","flower","guitar","house","island","jungle",
  "kite","lion","mountain","notebook","ocean","piano","queen","rainbow","sun","tree",
  "umbrella","violin","waterfall","yacht","zebra","bridge","castle","dragon",
  "eagle","forest","ghost","hammer","igloo","jellyfish","knight","lantern","mirror",
  "ninja","owl","penguin","rocket","snake","tornado","unicorn","volcano","wizard",
  "anchor","balloon","cactus","diamond","feather","globe","helmet","iceberg",
  "jacket","kettle","lemon","magnet","noodle","orange","parrot","ribbon","scissors",
  "airport","backpack","barbecue","binoculars","bookshelf",
  "bowling","campfire","candle","cannon","captain","carnival","carousel",
  "chimney","compass","cowboy","crystal",
  "curtain","dagger","dartboard","detective","dumbbell","dungeon","escalator",
  "factory","ferris wheel","fishbowl","flashlight","fountain","frying pan",
  "gravestone","greenhouse","hammock","handcuffs","hourglass",
  "hurricane","icicle","joystick","kayak","ladder",
  "lighthouse","lollipop","lumberjack","magnifying glass","mailbox","mansion",
  "megaphone","mermaid","microscope","mousetrap","mummy","mushroom","parachute",
  "pirate","plunger","podium","popcorn","pretzel",
  "pumpkin","pyramid","rowboat","saddle","scarecrow","scuba diver",
  "shipwreck","skateboard","skeleton","slingshot","snowglobe",
  "stapler","stethoscope","stopwatch","submarine","surfboard",
  "telescope","thermometer","tightrope","tombstone","treasure chest",
  "trampoline","treehouse","trophy","tugboat","tunnel","typewriter","vending machine",
  "walrus","wheelbarrow","whirlpool","windmill","wrecking ball",
];

const ROUND_TIME = 30;
const WORD_PICK_TIME = 15; // seconds to pick a word before auto-pick

const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function pick3Words() {
  const shuffled = [...WORDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function getRoom(code) { return rooms[code]; }

function masked(word) { return word.split("").map(c => /[a-zA-Z]/.test(c) ? "_" : c).join(" ").trim(); }

function getScores(room) {
  return room.players.map((s) => ({ name: s.playerName, score: s.score || 0 }));
}

function startTurn(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;

  clearInterval(room.timer);
  clearTimeout(room.pickTimeout);

  room.currentWord = "";
  room.guessedPlayers = new Set();
  room.timeLeft = ROUND_TIME;
  room.drawingData = [];

  const drawerSocket = room.players[room.drawerIndex];
  if (!drawerSocket) return nextTurn(roomCode);

  const choices = pick3Words();
  room.wordChoices = choices;

  io.to(roomCode).emit("waiting_for_word", { drawer: drawerSocket.playerName });
  drawerSocket.emit("word_choices", choices);

  room.hintRevealed = [];
  // Auto-pick first word if drawer doesn't choose in time
  room.pickTimeout = setTimeout(() => {
    if (!room.currentWord) chooseWord(roomCode, choices[0]);
  }, WORD_PICK_TIME * 1000);
}

function chooseWord(roomCode, word) {
  const room = getRoom(roomCode);
  if (!room) return;

  clearTimeout(room.pickTimeout);
  room.currentWord = word;
  room.wordChoices = [];
  room.hintRevealed = [];

  // Build hint indices: only letter positions, excluding spaces/hyphens
  const letterIndices = [];
  for (let i = 0; i < word.length; i++) {
    if (/[a-zA-Z]/.test(word[i])) letterIndices.push(i);
  }
  // Shuffle letter indices for random reveal order
  const shuffledIndices = [...letterIndices].sort(() => Math.random() - 0.5);
  // Reveal ~40% of letters as hints, spaced evenly over the round
  const hintCount = Math.max(1, Math.floor(letterIndices.length * 0.4));
  const hintSlots = shuffledIndices.slice(0, hintCount);
  const hintInterval = Math.floor(ROUND_TIME / (hintCount + 1));

  const drawerSocket = room.players[room.drawerIndex];

  io.to(roomCode).emit("turn_start", {
    drawer: drawerSocket.playerName,
    wordLength: word.length,
    maskedWord: masked(word),
    timeLeft: ROUND_TIME,
    round: room.round,
    maxRounds: room.maxRounds,
  });

  drawerSocket.emit("your_word", word);

  let elapsed = 0;
  let nextHint = 0;
  room.timer = setInterval(() => {
    room.timeLeft--;
    elapsed++;
    io.to(roomCode).emit("timer", room.timeLeft);

    // Reveal a hint letter at each hint slot
    if (nextHint < hintSlots.length && elapsed >= hintInterval * (nextHint + 1)) {
      room.hintRevealed.push(hintSlots[nextHint]);
      nextHint++;
      const hintMasked = buildHintMasked(word, room.hintRevealed);
      io.to(roomCode).emit("hint", { maskedWord: hintMasked });
    }

    if (room.timeLeft <= 0) nextTurn(roomCode);
  }, 1000);
}

function buildHintMasked(word, revealed) {
  return word.split("").map((c, i) => {
    if (!/[a-zA-Z]/.test(c)) return c;
    return revealed.includes(i) ? c : "_";
  }).join(" ").trim();
}

function nextTurn(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  clearInterval(room.timer);
  clearTimeout(room.pickTimeout);

  io.to(roomCode).emit("turn_end", { word: room.currentWord, scores: getScores(room) });

  room.drawerIndex++;
  if (room.drawerIndex >= room.players.length) {
    room.drawerIndex = 0;
    room.round++;
  }

  if (room.round > room.maxRounds) {
    io.to(roomCode).emit("game_over", { scores: getScores(room) });
    delete rooms[roomCode];
    return;
  }

  setTimeout(() => startTurn(roomCode), 4000);
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ playerName }) => {
    let code;
    do { code = generateCode(); } while (rooms[code]);

    rooms[code] = {
      code, players: [], drawerIndex: 0, round: 1, maxRounds: 3,
      currentWord: "", wordChoices: [], guessedPlayers: new Set(),
      drawingData: [], started: false, timer: null, pickTimeout: null,
      timeLeft: 0, hintRevealed: [],
    };

    socket.playerName = playerName;
    socket.roomCode = code;
    socket.score = 0;
    socket.isHost = true;
    rooms[code].players.push(socket);
    socket.join(code);

    socket.emit("room_created", { code });
    io.to(code).emit("player_list", getScores(rooms[code]));
  });

  socket.on("join_room", ({ playerName, code }) => {
    code = code.toUpperCase();
    const room = getRoom(code);
    if (!room) return socket.emit("error", "Room not found.");
    if (room.started) return socket.emit("error", "Game already started.");

    socket.playerName = playerName;
    socket.roomCode = code;
    socket.score = 0;
    room.players.push(socket);
    socket.join(code);

    socket.emit("room_joined", { code });
    io.to(code).emit("player_list", getScores(room));
    io.to(code).emit("chat_message", { system: true, text: `${playerName} joined!` });
  });

  socket.on("start_game", ({ rounds }) => {
    const room = getRoom(socket.roomCode);
    if (!room || !socket.isHost || room.started) return;
    if (room.players.length < 2) return socket.emit("error", "Need at least 2 players.");

    room.maxRounds = Math.min(Math.max(parseInt(rounds) || 3, 1), 10);
    room.started = true;

    for (let i = room.players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
    }

    io.to(room.code).emit("game_started");
    startTurn(room.code);
  });

  socket.on("stop_game", () => {
    const room = getRoom(socket.roomCode);
    if (!room || !socket.isHost) return;
    clearInterval(room.timer);
    clearTimeout(room.pickTimeout);
    io.to(room.code).emit("game_stopped");
    delete rooms[room.code];
  });

  socket.on("choose_word", ({ word }) => {
    const room = getRoom(socket.roomCode);
    if (!room || !room.wordChoices.includes(word)) return;
    if (room.players[room.drawerIndex] !== socket) return;
    chooseWord(socket.roomCode, word);
  });

  socket.on("fill_canvas", (data) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.players[room.drawerIndex] !== socket) return;
    socket.to(socket.roomCode).emit("fill_canvas", data);
  });

  socket.on("undo_canvas", (data) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.players[room.drawerIndex] !== socket) return;
    socket.to(socket.roomCode).emit("undo_canvas", data);
  });

  socket.on("draw", (data) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.players[room.drawerIndex] !== socket) return;
    room.drawingData.push(data);
    socket.to(socket.roomCode).emit("draw", data);
  });

  socket.on("kick_player", ({ name }) => {
    const room = getRoom(socket.roomCode);
    if (!room || !socket.isHost) return;
    const target = room.players.find(p => p.playerName === name && p.id !== socket.id);
    if (!target) return;
    target.emit("kicked");
    target.disconnect(true);
  });

  socket.on("clear_canvas", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.players[room.drawerIndex] !== socket) return;
    room.drawingData = [];
    io.to(socket.roomCode).emit("clear_canvas");
  });

  socket.on("guess", ({ text }) => {
    const room = getRoom(socket.roomCode);
    if (!room || !room.started || !room.currentWord) return;

    const drawer = room.players[room.drawerIndex];
    if (socket === drawer) return;
    if (room.guessedPlayers.has(socket.id)) return;

    // Block duplicate guesses
    const lastGuess = socket._lastGuess || "";
    if (text.trim().toLowerCase() === lastGuess) return;
    socket._lastGuess = text.trim().toLowerCase();

    if (text.trim().toLowerCase() === room.currentWord.toLowerCase()) {
      const guessRank = room.guessedPlayers.size;
      room.guessedPlayers.add(socket.id);

      const rankBonus = [200, 150, 120, 100];
      const base = rankBonus[Math.min(guessRank, rankBonus.length - 1)];
      const points = Math.max(50, Math.round((room.timeLeft / ROUND_TIME) * base));
      socket.score = (socket.score || 0) + points;
      drawer.score = (drawer.score || 0) + 20;

      io.to(socket.roomCode).emit("correct_guess", { player: socket.playerName, points, scores: getScores(room) });

      if (room.guessedPlayers.size >= room.players.length - 1) nextTurn(socket.roomCode);
    } else {
      // Censor if message contains the correct word
      const censored = text.replace(new RegExp(room.currentWord, "gi"), "***");
      io.to(socket.roomCode).emit("chat_message", { name: socket.playerName, text: censored });
    }
  });

  socket.on("request_canvas", () => {
    const room = getRoom(socket.roomCode);
    if (room) socket.emit("canvas_state", room.drawingData);
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket.roomCode);
    if (!room) return;

    room.players = room.players.filter((s) => s.id !== socket.id);
    io.to(socket.roomCode).emit("player_list", getScores(room));
    io.to(socket.roomCode).emit("chat_message", { system: true, text: `${socket.playerName} left.` });

    if (room.players.length === 0) {
      clearInterval(room.timer);
      clearTimeout(room.pickTimeout);
      delete rooms[socket.roomCode];
    } else if (room.started && room.players[room.drawerIndex]?.id === socket.id) {
      nextTurn(socket.roomCode);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
