const socket = io();
const params = new URLSearchParams(location.search);
const playerName = params.get("name");
const action = params.get("action");
const code = params.get("code");
const rounds = params.get("rounds") || 3;

if (!playerName) location.href = "/";

// ── Waiting Room ──
const waitingRoom = document.getElementById("waitingRoom");
const gameArea = document.getElementById("gameArea");
const gameOver = document.getElementById("gameOver");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const waitingPlayerList = document.getElementById("waitingPlayerList");
const startBtn = document.getElementById("startBtn");
const waitError = document.getElementById("waitError");

let isHost = action === "create";

if (action === "create") {
  socket.emit("create_room", { playerName });
} else {
  socket.emit("join_room", { playerName, code });
}

socket.on("room_created", ({ code }) => {
  roomCodeDisplay.textContent = code;
  document.getElementById("hostControls").style.display = "block";
  document.getElementById("waitMsg").style.display = "none";
});

socket.on("room_joined", ({ code }) => {
  roomCodeDisplay.textContent = code;
});

socket.on("player_list", (players) => {
  waitingPlayerList.innerHTML = "";
  players.forEach((p, i) => {
    const li = document.createElement("li");
    if (i === 0) li.classList.add("host-tag");
    li.textContent = p.name;
    waitingPlayerList.appendChild(li);
  });
  updatePlayerList(players);
});

socket.on("error", (msg) => { waitError.textContent = msg; });
socket.on("kicked", () => { alert("You were kicked by the host."); location.href = "/"; });

startBtn.onclick = () => socket.emit("start_game", { rounds });

document.getElementById("copyBtn").onclick = () => {
  navigator.clipboard.writeText(roomCodeDisplay.textContent);
  const btn = document.getElementById("copyBtn");
  btn.textContent = "✅";
  setTimeout(() => (btn.textContent = "📋"), 1500);
};

// ── Audio ──
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
document.addEventListener("click", () => audioCtx.state === "suspended" && audioCtx.resume(), { once: true });
document.addEventListener("keydown", () => audioCtx.state === "suspended" && audioCtx.resume(), { once: true });

function playSuccessSound() {
  if (audioCtx.state === "suspended") audioCtx.resume();
  [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]].forEach(([freq, when]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = "triangle";
    gain.gain.setValueAtTime(0.35, audioCtx.currentTime + when);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + when + 0.35);
    osc.start(audioCtx.currentTime + when);
    osc.stop(audioCtx.currentTime + when + 0.35);
  });
}

// ── Game refs ──
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const drawTools = document.getElementById("drawTools");
const playerList = document.getElementById("playerList");
const chatBox = document.getElementById("chatBox");
const guessInput = document.getElementById("guessInput");
const wordDisplay = document.getElementById("wordDisplay");
const timerDisplay = document.getElementById("timerDisplay");
const timerRing = document.getElementById("timerRing");
const roundBadge = document.getElementById("roundBadge");
const drawerLabel = document.getElementById("drawerLabel");
const wordModal = document.getElementById("wordModal");
const wordChoicesEl = document.getElementById("wordChoices");
const eraserBtn = document.getElementById("eraserBtn");
const fillBtn = document.getElementById("fillBtn");
const transitionOverlay = document.getElementById("transitionOverlay");

const RING_CIRC = 113;
const ROUND_TIME = 30;

let isDrawing = false;
let amDrawer = false;
let activeTool = "pencil"; // pencil | eraser | fill
let lastX = 0, lastY = 0;
let currentDrawer = "";
let currentColor = "#000000";
let strokeHistory = []; // for undo: array of ImageData snapshots

// ── Color swatches ──
const SWATCHES = ["#000000","#ffffff","#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#6b7280","#92400e","#0ea5e9"];
const swatchContainer = document.getElementById("colorSwatches");
SWATCHES.forEach(c => {
  const s = document.createElement("div");
  s.className = "swatch";
  s.style.background = c;
  if (c === "#000000") s.classList.add("active");
  s.onclick = () => setColor(c);
  swatchContainer.appendChild(s);
});

colorPicker.oninput = () => setColor(colorPicker.value);

function setColor(c) {
  currentColor = c;
  colorPicker.value = c;
  setTool("pencil");
  document.querySelectorAll(".swatch").forEach(x => x.classList.remove("active"));
  const match = [...swatchContainer.children].find(s => s.style.background === c || rgbToHex(s.style.background) === c);
  if (match) match.classList.add("active");
}

function rgbToHex(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return "#" + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, "0")).join("");
}

function setTool(tool) {
  activeTool = tool;
  eraserBtn.classList.toggle("active", tool === "eraser");
  fillBtn.classList.toggle("active", tool === "fill");
  canvas.style.cursor = tool === "fill" ? "crosshair" : "crosshair";
}

eraserBtn.onclick = () => setTool(activeTool === "eraser" ? "pencil" : "eraser");
fillBtn.onclick = () => setTool(activeTool === "fill" ? "pencil" : "fill");

// ── Socket events ──
socket.on("game_started", () => {
  waitingRoom.style.display = "none";
  gameArea.style.display = "flex";
});

socket.on("waiting_for_word", ({ drawer }) => {
  currentDrawer = drawer;
  drawerLabel.textContent = `${drawer} is choosing…`;
  wordDisplay.textContent = "";
  clearCanvas();
  strokeHistory = [];
  const choosingEl = document.getElementById("transitionChoosing");
  choosingEl.textContent = `⏳ ${drawer} is choosing a word…`;
  choosingEl.style.display = "block";
  transitionOverlay.style.display = "flex";
});

socket.on("word_choices", (choices) => {
  wordChoicesEl.innerHTML = "";
  choices.forEach(w => {
    const btn = document.createElement("button");
    btn.className = "word-choice-btn";
    btn.textContent = w;
    btn.onclick = () => {
      socket.emit("choose_word", { word: w });
      wordModal.style.display = "none";
    };
    wordChoicesEl.appendChild(btn);
  });
  wordModal.style.display = "flex";
});

socket.on("turn_start", ({ drawer, wordLength, maskedWord, timeLeft, round, maxRounds }) => {
  transitionOverlay.style.display = "none";
  const choosingEl = document.getElementById("transitionChoosing");
  choosingEl.style.display = "none";
  choosingEl.textContent = "";
  wordModal.style.display = "none";
  currentDrawer = drawer;
  amDrawer = drawer === playerName;
  drawTools.style.display = amDrawer ? "flex" : "none";
  canvas.style.cursor = amDrawer ? "crosshair" : "default";
  wordDisplay.textContent = amDrawer ? wordDisplay.textContent : maskedWord;
  drawerLabel.textContent = `✏️ ${drawer} is drawing`;
  roundBadge.textContent = `Round ${round} / ${maxRounds}`;
  updateTimer(timeLeft);
  strokeHistory = [];
  addChat(`🎨 ${drawer} is drawing — ${wordLength} letters`, "system");
  if (!amDrawer) socket.emit("request_canvas");
  guessInput.disabled = amDrawer;
  guessInput.placeholder = amDrawer ? "You are drawing!" : "Type your guess…";
});

socket.on("your_word", (word) => {
  wordDisplay.textContent = word;
});

socket.on("hint", ({ maskedWord }) => {
  if (!amDrawer) wordDisplay.textContent = maskedWord;
});

socket.on("timer", (t) => updateTimer(t));

socket.on("turn_end", ({ word, scores }) => {
  // Show transition overlay
  document.getElementById("transitionWord").textContent = word;
  const scoresEl = document.getElementById("transitionScores");
  scoresEl.innerHTML = "";
  [...scores].sort((a, b) => b.score - a.score).slice(0, 5).forEach(p => {
    const div = document.createElement("div");
    div.className = "ts-row";
    const name = document.createElement("span");
    name.textContent = p.name;
    const pts = document.createElement("span");
    pts.className = "ts-pts";
    pts.textContent = `${p.score} pts`;
    div.appendChild(name);
    div.appendChild(pts);
    scoresEl.appendChild(div);
  });
  transitionOverlay.style.display = "flex";

  updatePlayerList(scores);
  clearCanvas();
  strokeHistory = [];
  wordDisplay.textContent = "";
  drawerLabel.textContent = "";
  guessInput.disabled = false;
  guessInput.placeholder = "Type your guess…";
});

socket.on("correct_guess", ({ player, points, scores }) => {
  addChat(`✅ ${player} guessed it! +${points} pts`, "correct");
  updatePlayerList(scores, player);
  if (player === playerName) {
    playSuccessSound();
    guessInput.disabled = true;
    guessInput.placeholder = "You guessed it! 🎉";
  }
});

socket.on("chat_message", ({ name, text, system }) => {
  if (system) addChat(text, "system");
  else addChat(text, "msg", name);
});

socket.on("game_over", ({ scores }) => {
  transitionOverlay.style.display = "none";
  gameArea.style.display = "none";
  gameOver.style.display = "block";
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const medals = ["🥇", "🥈", "🥉"];
  const list = document.getElementById("finalScores");
  list.innerHTML = "";
  sorted.forEach((p, i) => {
    const li = document.createElement("li");
    const medal = document.createElement("span");
    medal.className = "medal";
    medal.textContent = medals[i] || "";
    const nameEl = document.createElement("span");
    nameEl.textContent = p.name;
    const pts = document.createElement("span");
    pts.className = "pts";
    pts.textContent = `${p.score} pts`;
    li.appendChild(medal);
    li.appendChild(nameEl);
    li.appendChild(pts);
    list.appendChild(li);
  });
});

// ── Canvas sync ──
socket.on("draw", ({ x0, y0, x1, y1, color, size }) => drawLine(x0, y0, x1, y1, color, size));
socket.on("clear_canvas", () => { clearCanvas(); strokeHistory = []; });
socket.on("canvas_state", (data) => data.forEach(d => drawLine(d.x0, d.y0, d.x1, d.y1, d.color, d.size)));
socket.on("fill_canvas", ({ x, y, color }) => floodFill(x, y, color, false));

// ── Drawing ──
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return [
    Math.round((src.clientX - rect.left) * (canvas.width / rect.width)),
    Math.round((src.clientY - rect.top) * (canvas.height / rect.height)),
  ];
}

canvas.addEventListener("mousedown", (e) => {
  if (!amDrawer) return;
  const [x, y] = getPos(e);
  if (activeTool === "fill") {
    saveSnapshot();
    floodFill(x, y, currentColor, true);
    return;
  }
  isDrawing = true;
  saveSnapshot();
  [lastX, lastY] = [x, y];
});

canvas.addEventListener("mousemove", (e) => {
  if (!isDrawing || !amDrawer || activeTool === "fill") return;
  const [x, y] = getPos(e);
  const color = activeTool === "eraser" ? "#ffffff" : currentColor;
  const size = activeTool === "eraser" ? +brushSize.value * 3 : +brushSize.value;
  const data = { x0: lastX, y0: lastY, x1: x, y1: y, color, size };
  drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size);
  socket.emit("draw", data);
  [lastX, lastY] = [x, y];
});

canvas.addEventListener("mouseup", () => (isDrawing = false));
canvas.addEventListener("mouseleave", () => (isDrawing = false));

document.getElementById("clearBtn").onclick = () => {
  saveSnapshot();
  clearCanvas();
  socket.emit("clear_canvas");
};

// Undo
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && amDrawer) {
    e.preventDefault();
    undoStroke();
  }
});
document.getElementById("undoBtn").onclick = () => { if (amDrawer) undoStroke(); };

function saveSnapshot() {
  if (strokeHistory.length > 30) strokeHistory.shift();
  strokeHistory.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function undoStroke() {
  if (!strokeHistory.length) return;
  const snap = strokeHistory.pop();
  ctx.putImageData(snap, 0, 0);
  // Sync undo to others by sending current canvas as full state
  socket.emit("undo_canvas", { dataUrl: canvas.toDataURL() });
}

socket.on("undo_canvas", ({ dataUrl }) => {
  const img = new Image();
  img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); };
  img.src = dataUrl;
});

function drawLine(x0, y0, x1, y1, color, size) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ── Flood Fill ──
function floodFill(startX, startY, fillColor, emit) {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const w = canvas.width;

  const idx = (x, y) => (y * w + x) * 4;
  const target = data.slice(idx(startX, startY), idx(startX, startY) + 4);
  const fill = hexToRgba(fillColor);

  if (colorsMatch(target, fill)) return;

  const stack = [[startX, startY]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= w || y < 0 || y >= canvas.height) continue;
    const i = idx(x, y);
    if (!colorsMatch(data.slice(i, i + 4), target)) continue;
    data[i] = fill[0]; data[i+1] = fill[1]; data[i+2] = fill[2]; data[i+3] = fill[3];
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
  ctx.putImageData(imgData, 0, 0);
  if (emit) socket.emit("fill_canvas", { x: startX, y: startY, color: fillColor });
}

function hexToRgba(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return [r, g, b, 255];
}

function colorsMatch(a, b) {
  return a[0]===b[0] && a[1]===b[1] && a[2]===b[2] && a[3]===b[3];
}

// ── Timer ring ──
function updateTimer(t) {
  timerDisplay.textContent = t;
  const offset = RING_CIRC - (t / ROUND_TIME) * RING_CIRC;
  timerRing.style.strokeDashoffset = offset;
  timerRing.classList.toggle("urgent", t <= 10);
  timerDisplay.style.color = t <= 10 ? "var(--accent2)" : "var(--text)";
}

// ── Chat ──
document.getElementById("guessForm").onsubmit = (e) => {
  e.preventDefault();
  const text = guessInput.value.trim();
  if (!text || amDrawer) return;
  socket.emit("guess", { text });
  guessInput.value = "";
};

function addChat(text, type, name = "") {
  const div = document.createElement("div");
  div.className = type;
  if (name) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "name";
    nameSpan.textContent = name + ": ";
    const textNode = document.createTextNode(text);
    div.appendChild(nameSpan);
    div.appendChild(textNode);
  } else {
    div.textContent = text;
  }
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ── Player list ──
function updatePlayerList(players, justGuessed = "") {
  playerList.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    const isDrawing = p.name === currentDrawer;
    const guessed = p.name === justGuessed;
    if (isDrawing) li.classList.add("drawing");
    if (guessed) li.classList.add("guessed");

    const nameEl = document.createElement("span");
    nameEl.className = "p-name";
    nameEl.textContent = (isDrawing ? "✏️ " : "") + p.name;

    const scoreEl = document.createElement("span");
    scoreEl.className = "p-score";
    scoreEl.textContent = `${p.score} pts`;

    li.appendChild(nameEl);
    li.appendChild(scoreEl);

    // Kick button (host only, can't kick self)
    if (isHost && p.name !== playerName) {
      const kickBtn = document.createElement("button");
      kickBtn.className = "kick-btn";
      kickBtn.textContent = "✕";
      kickBtn.title = `Kick ${p.name}`;
      kickBtn.onclick = () => socket.emit("kick_player", { name: p.name });
      li.appendChild(kickBtn);
    }

    playerList.appendChild(li);
  });
}
