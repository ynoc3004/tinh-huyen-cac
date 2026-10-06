import { Chess } from "/vendor/chess.js";
import { PIECE_DEFS } from "/vendor/pieces.js";
import { TECHS, TECH_GROUPS, TECH_BY_KEY, PLAIN, BOTS, SPEECH } from "/bi-canh-data.js?v=20261006-3";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => "&#" + c.charCodeAt(0) + ";");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pickOne = list => list[Math.floor(Math.random() * list.length)];
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const REALMS = ["Phàm Nhân", "Luyện Khí", "Trúc Cơ", "Kim Đan", "Nguyên Anh", "Hóa Thần"];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : Number(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} },
};

// ===== Quân cờ dùng chung (một lần cho cả hai bàn) =====
document.body.insertAdjacentHTML("afterbegin", `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${PIECE_DEFS}
  <radialGradient id="chk"><stop offset="0" stop-color="#e0463a" stop-opacity=".95"/><stop offset="1" stop-color="#e0463a" stop-opacity="0"/></radialGradient></defs></svg>`);

// ===== Âm thanh tổng hợp, mặc định tắt =====
let soundOn = store.get("bicanh.sound", 0) === 1, actx = null;
function tone(freq, dur, type = "sine", vol = 0.06, when = 0) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + when, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.03);
  } catch (e) { /* trình duyệt không cho phát tiếng */ }
}
const sfx = {
  move: mv => (mv && mv.captured ? tone(150, 0.13, "square", 0.045) : tone(240, 0.07, "triangle", 0.07)),
  good() { tone(523, 0.2, "sine", 0.07); tone(784, 0.32, "sine", 0.07, 0.13); },
  bad() { tone(120, 0.22, "sawtooth", 0.035); },
  end(win) { if (win) { tone(523, 0.2, "sine", 0.07); tone(659, 0.2, "sine", 0.07, 0.14); tone(784, 0.4, "sine", 0.07, 0.28); } else tone(200, 0.4, "triangle", 0.06); },
};
const renderSound = () => { const b = $("sound-toggle"); b.textContent = "Âm thanh: " + (soundOn ? "bật" : "tắt"); b.setAttribute("aria-pressed", String(soundOn)); };
$("sound-toggle").onclick = () => { soundOn = !soundOn; store.set("bicanh.sound", soundOn ? 1 : 0); renderSound(); if (soundOn) sfx.good(); };

// ===== Bàn cờ =====
const FILES = "abcdefgh";
class Board {
  constructor(host, game) {
    this.host = host; this.game = game; this.flip = false; this.last = null; this.sel = null; this.targets = []; this.hint = null; this.drag = null;
    host.innerHTML = `<svg class="board" viewBox="0 0 800 800" role="img" aria-label="Bàn cờ"><g class="sqs"></g><g class="hls"></g><g class="pcs"></g><g class="ghost"></g></svg>`;
    this.svg = host.querySelector("svg");
    this.svg.addEventListener("pointerdown", e => this.down(e));
    this.svg.addEventListener("pointermove", e => this.move(e));
    this.svg.addEventListener("pointerup", e => this.up(e));
    this.svg.addEventListener("pointercancel", () => this.cancelDrag());
  }
  xy(sq) {
    const f = FILES.indexOf(sq[0]), r = Number(sq[1]) - 1;
    return [(this.flip ? 7 - f : f) * 100, (this.flip ? r : 7 - r) * 100];
  }
  squareAt(e) {
    const b = this.svg.getBoundingClientRect(), c = Math.floor((e.clientX - b.left) / b.width * 8), r = Math.floor((e.clientY - b.top) / b.height * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return FILES[this.flip ? 7 - c : c] + ((this.flip ? r : 7 - r) + 1);
  }
  render() {
    const chess = this.game.chess();
    if (!chess) return;
    let sq = "", hl = "", pc = "";
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const f = this.flip ? 7 - col : col, r = this.flip ? row : 7 - row, light = (f + r) % 2 === 1;
      sq += `<rect class="sq ${light ? "l" : "d"}" x="${col * 100}" y="${row * 100}" width="100" height="100"/>`;
      if (row === 7) sq += `<text class="co ${light ? "l" : "d"}" x="${col * 100 + 94}" y="${row * 100 + 92}" text-anchor="end">${FILES[f]}</text>`;
      if (col === 0) sq += `<text class="co ${light ? "l" : "d"}" x="6" y="${row * 100 + 20}">${r + 1}</text>`;
    }
    const box = s => { const [x, y] = this.xy(s); return [x, y]; };
    if (this.last) for (const s of [this.last.from, this.last.to]) { const [x, y] = box(s); hl += `<rect class="hl-last" x="${x}" y="${y}" width="100" height="100"/>`; }
    if (this.sel) { const [x, y] = box(this.sel); hl += `<rect class="hl-sel" x="${x}" y="${y}" width="100" height="100"/>`; }
    if (chess.inCheck()) {
      for (const rowArr of chess.board()) for (const p of rowArr) if (p && p.type === "k" && p.color === chess.turn()) { const [x, y] = box(p.square); hl += `<circle cx="${x + 50}" cy="${y + 50}" r="56" fill="url(#chk)"/>`; }
    }
    if (this.hint) {
      const [x, y] = box(this.hint.from); hl += `<rect class="hl-hint" x="${x}" y="${y}" width="100" height="100"/>`;
      if (this.hint.to) { const [tx, ty] = box(this.hint.to); hl += `<circle class="hl-hint-ring" cx="${tx + 50}" cy="${ty + 50}" r="40"/>`; }
    }
    for (const t of this.targets) {
      const [x, y] = box(t.to);
      hl += t.capture ? `<circle class="ring" cx="${x + 50}" cy="${y + 50}" r="44"/>` : `<circle class="dot" cx="${x + 50}" cy="${y + 50}" r="15"/>`;
    }
    for (const rowArr of chess.board()) for (const p of rowArr) {
      if (!p) continue;
      const [x, y] = box(p.square);
      pc += `<g class="pc${this.drag && this.drag.from === p.square ? " lift" : ""}" data-sq="${p.square}" style="transform:translate(${x}px,${y}px)"><use href="#${p.color}${p.type.toUpperCase()}" transform="scale(2.2222)"/></g>`;
    }
    this.svg.querySelector(".sqs").innerHTML = sq;
    this.svg.querySelector(".hls").innerHTML = hl;
    this.svg.querySelector(".pcs").innerHTML = pc;
    this.svg.setAttribute("aria-label", "Bàn cờ: " + chess.fen());
  }
  slide(from, to) {
    if (reduce.matches) return;
    const el = this.svg.querySelector(`.pc[data-sq="${to}"]`);
    if (!el || !el.animate) return;
    const [fx, fy] = this.xy(from), [tx, ty] = this.xy(to);
    el.animate([{ transform: `translate(${fx}px,${fy}px)` }, { transform: `translate(${tx}px,${ty}px)` }], { duration: 170, easing: "ease-out" });
  }
  shake() {
    this.svg.classList.remove("shake"); void this.svg.getBoundingClientRect(); this.svg.classList.add("shake");
    setTimeout(() => this.svg.classList.remove("shake"), 400);
  }
  select(sq) {
    this.sel = sq;
    this.targets = sq ? this.game.chess().moves({ square: sq, verbose: true }).map(m => ({ to: m.to, capture: !!m.captured || m.flags.includes("e") })) : [];
  }
  clearSel() { this.sel = null; this.targets = []; }
  down(e) {
    if (e.button > 0) return;
    const chess = this.game.chess(), sq = this.squareAt(e);
    if (!chess || !sq) return;
    if (this.sel && this.targets.some(t => t.to === sq)) { this.attempt(this.sel, sq); return; }
    const p = chess.get(sq);
    if (p && this.game.canMove(p.color)) {
      this.select(sq);
      this.drag = { from: sq, id: e.pointerId, moved: false };
      this.svg.setPointerCapture(e.pointerId);
      this.render();
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "pc");
      g.innerHTML = `<use href="#${p.color}${p.type.toUpperCase()}" transform="scale(2.2222)"/>`;
      this.svg.querySelector(".ghost").appendChild(g);
      this.drag.ghost = g;
      this.ghostTo(e);
    } else { this.clearSel(); this.render(); }
  }
  ghostTo(e) {
    const b = this.svg.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * 800 - 50, y = (e.clientY - b.top) / b.height * 800 - 50;
    this.drag.ghost.style.transform = `translate(${x}px,${y}px)`;
  }
  move(e) { if (this.drag) { this.drag.moved = true; this.ghostTo(e); } }
  up(e) {
    if (!this.drag) return;
    const { from, moved } = this.drag, to = this.squareAt(e);
    this.cancelDrag();
    if (moved && to && to !== from && this.targets.some(t => t.to === to)) this.attempt(from, to);
    else this.render();
  }
  cancelDrag() {
    if (!this.drag) return;
    if (this.drag.ghost) this.drag.ghost.remove();
    this.drag = null;
  }
  askPromotion(color) {
    return new Promise(res => {
      const d = document.createElement("div");
      d.className = "promo";
      d.innerHTML = `<div role="group" aria-label="Chọn quân phong cấp">${["q", "r", "b", "n"].map(t => `<button type="button" data-t="${t}" aria-label="${{ q: "Hậu", r: "Xe", b: "Tượng", n: "Mã" }[t]}"><svg viewBox="0 0 45 45"><use href="#${color}${t.toUpperCase()}"/></svg></button>`).join("")}</div>`;
      d.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { d.remove(); res(b.dataset.t); } });
      this.host.appendChild(d);
      d.querySelector("button").focus();
    });
  }
  async attempt(from, to) {
    const chess = this.game.chess(), moves = chess.moves({ square: from, verbose: true }).filter(m => m.to === to);
    if (!moves.length) { this.render(); return false; }
    const promotion = moves.some(m => m.promotion) ? await this.askPromotion(chess.get(from).color) : undefined;
    this.clearSel();
    const ok = await this.game.onMove({ from, to, promotion });
    this.render();
    return ok;
  }
}

// ===== Stockfish chạy ngay trong trình duyệt =====
class Engine {
  constructor() { this.w = null; this.listeners = []; this.ready = null; this.chain = Promise.resolve(); }
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try { this.w = new Worker("/vendor/stockfish/stockfish-19-lite-single.js"); } catch (e) { reject(e); return; }
      this.w.onerror = () => reject(new Error("worker"));
      this.w.onmessage = e => { const line = String(e.data); this.listeners = this.listeners.filter(l => !l(line)); };
      this.wait(/^uciok/).then(() => { this.send("isready"); return this.wait(/^readyok/); }).then(resolve, reject);
      this.send("uci");
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }
  send(c) { this.w.postMessage(c); }
  wait(re, ms = 30000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), ms);
      this.listeners.push(line => { if (re.test(line)) { clearTimeout(t); res(line); return true; } return false; });
    });
  }
  newGame() { if (this.w) this.send("ucinewgame"); }
  think(fen, o) {
    const run = async () => {
      await this.start();
      if (o.elo) { this.send("setoption name UCI_LimitStrength value true"); this.send(`setoption name UCI_Elo value ${o.elo}`); }
      else { this.send("setoption name UCI_LimitStrength value false"); this.send(`setoption name Skill Level value ${o.skill ?? 20}`); }
      this.send("position fen " + fen);
      this.send("go" + (o.depth ? ` depth ${o.depth}` : "") + ` movetime ${o.movetime || 500}`);
      const m = (await this.wait(/^bestmove/, 60000)).split(" ")[1];
      return !m || m === "(none)" ? null : m;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}
const engine = new Engine();

// ===== Cảnh giới của người chơi =====
let me = { realm: "Phàm Nhân", tier: 1, rating: null, known: false };
async function loadMe() {
  try {
    const j = await (await fetch("/api/realm")).json();
    const tu = Array.isArray(j) ? null : j.tu_vi;
    if (tu && tu.realm) me = { realm: tu.realm, tier: Number(tu.tier) || 1, rating: tu.rating, known: true };
  } catch (e) { /* dùng mức khởi đầu */ }
  $("realm-bar").innerHTML = me.known
    ? `<b>${esc(me.realm)} tầng ${esc(me.tier)}</b><span>Căn cơ ${esc(me.rating)} điểm. Câu đố và đối thủ đều lấy mức này làm gốc.</span>`
    : `<b>${esc(me.realm)}</b><span>Chưa có rating nên đang dùng mức khởi đầu. Bấm Đồng bộ ván cờ ở trang chủ để Bí Cảnh theo đúng cảnh giới của bạn.</span>`;
}
const myLine = () => `${me.realm}${me.known ? " tầng " + me.tier : ""}`;
const colorName = c => (c === "w" ? "Trắng" : "Đen");
const strip = (id, who, what) => { $(id).innerHTML = `<span class="who">${esc(who)}</span><span class="what">${esc(what)}</span>`; };
const say = (id, text, kind = "") => { const el = $(id); el.textContent = text; el.className = "status" + (kind ? " " + kind : ""); };
function applyUci(chess, uci) { return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); }

// ===== Tham ngộ: giải câu đố =====
let bias = store.get("bicanh.bias", 0);
const setBias = v => { bias = Math.max(-250, Math.min(250, Math.round(v))); store.set("bicanh.bias", bias); };
let dailyGoal = store.get("bicanh.goal", 10), todayCount = 0;
const pz = { p: null, chess: null, idx: 0, user: "w", mistakes: 0, hints: 0, hintStep: 0, over: false, usedSol: false, busy: false, seen: [], theme: "", token: 0, t0: 0, sample: false, avail: {} };
const pzGame = { chess: () => pz.chess, canMove: c => !!pz.p && !pz.over && !pz.busy && c === pz.user && pz.idx >= 1, onMove: m => pzOnMove(m) };
const pzBoard = new Board($("pz-board"), pzGame);

function renderGoal() {
  const done = todayCount >= dailyGoal, pct = Math.min(100, Math.round(todayCount / dailyGoal * 100));
  $("pz-goal").className = "goal" + (done ? " done" : "");
  $("pz-goal").innerHTML = `Bế quan hôm nay: <b>${todayCount}/${dailyGoal}</b> câu${done ? ". Hoàn thành mục tiêu, tu vi thêm vững." : ""} <button type="button" class="link" id="goal-edit" style="margin:0 0 0 .5rem">đổi mục tiêu</button>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${dailyGoal}" aria-valuenow="${Math.min(todayCount, dailyGoal)}" aria-label="Tiến độ bế quan hôm nay"><i style="width:${pct}%"></i></div>`;
  $("goal-edit").onclick = () => { const opts = [5, 10, 20, 30], next = opts[(opts.indexOf(dailyGoal) + 1) % opts.length]; dailyGoal = next; store.set("bicanh.goal", next); renderGoal(); };
}
function renderStats(s) {
  todayCount = s.today; renderGoal();
  $("pz-stats").innerHTML = `Chuỗi <b>${s.streak}</b> ngày liên tục, tổng cộng <b>${s.total}</b> câu đã giải.` +
    (s.recent.length ? `<span class="dots" aria-label="Kết quả gần đây">${s.recent.map(ok => `<i class="${ok ? "ok" : ""}"></i>`).join("")}</span>` : "");
}
function pzButtons() {
  const live = !!pz.p && !pz.over && pz.idx >= 1;
  $("pz-hint").disabled = !live || pz.busy;
  $("pz-solution").disabled = !live || pz.busy;
}
function renderFocus() {
  const t = TECH_BY_KEY[pz.theme], el = $("pz-focus");
  el.hidden = !t;
  if (t) el.innerHTML = `Đang luyện: <b>${esc(t.name)}</b> (${esc(t.plain)}). ${esc(t.essence)}`;
}
async function loadPuzzle() {
  const my = ++pz.token;
  pz.p = null; pzButtons();
  $("pz-teach").innerHTML = "";
  say("pz-status", "Đang chọn câu đố...");
  const qs = new URLSearchParams({ realm: me.realm, tier: me.tier, bias, theme: pz.theme, exclude: pz.seen.slice(-40).join(",") });
  let p;
  try {
    const r = await fetch("/api/bi-canh/puzzle?" + qs);
    if (!r.ok) throw new Error(r.status);
    p = await r.json();
  } catch (e) { say("pz-status", "Không lấy được câu đố. Kiểm tra cửa sổ chạy uvicorn còn mở không.", "bad"); return; }
  if (my !== pz.token) return;
  pz.seen.push(p.id);
  Object.assign(pz, { p, chess: new Chess(p.fen), idx: 0, mistakes: 0, hints: 0, hintStep: 0, over: false, usedSol: false, busy: true });
  pz.user = pz.chess.turn() === "w" ? "b" : "w";
  Object.assign(pzBoard, { flip: pz.user === "b", last: null, hint: null }); pzBoard.clearSel(); pzBoard.render();
  strip("pz-top", "Đối thủ", `cầm quân ${colorName(pz.user === "w" ? "b" : "w")}`);
  strip("pz-bottom", "Ta", `cầm quân ${colorName(pz.user)}, ${myLine()}`);
  say("pz-status", "Đối phương vừa đi, chuẩn bị...");
  $("pz-meta").innerHTML = `Mức nhắm tới khoảng <b>${esc(p.target)}</b> điểm. Điểm thật của câu đố hiện sau khi bạn giải xong.`;
  renderGauge(false);
  await sleep(reduce.matches ? 50 : 650);
  if (my !== pz.token) return;
  const mv = applyUci(pz.chess, p.moves[0]);
  pzBoard.last = mv; pz.idx = 1; pz.busy = false; pz.t0 = performance.now();
  pzBoard.render(); pzBoard.slide(mv.from, mv.to); sfx.move(mv);
  say("pz-status", `Đến lượt bạn: tìm nước đi tốt nhất cho ${colorName(pz.user)}.`);
  pzButtons();
}
async function pzOnMove(m) {
  if (!pz.p || pz.over || pz.busy) return false;
  const uci = m.from + m.to + (m.promotion || "");
  let mate = false;
  try { const probe = new Chess(pz.chess.fen()); probe.move({ from: m.from, to: m.to, promotion: m.promotion }); mate = probe.isCheckmate(); } catch (e) { return false; }
  if (uci !== pz.p.moves[pz.idx] && !mate) {
    pz.mistakes++;
    say("pz-status", "Chưa đúng, thử nước khác.", "bad");
    pzBoard.shake(); sfx.bad();
    return false;
  }
  const my = pz.token, mv = pz.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  pzBoard.last = mv; pzBoard.hint = null; pz.hintStep = 0; pz.idx++;
  pzBoard.render(); pzBoard.slide(mv.from, mv.to); sfx.move(mv);
  if (mate || pz.idx >= pz.p.moves.length) { finishPuzzle(true); return true; }
  pz.busy = true; pzButtons();
  say("pz-status", "Đúng rồi!", "good");
  await sleep(reduce.matches ? 50 : 500);
  if (my !== pz.token) return true;
  const reply = applyUci(pz.chess, pz.p.moves[pz.idx]);
  pz.idx++; pzBoard.last = reply; pzBoard.render(); pzBoard.slide(reply.from, reply.to); sfx.move(reply);
  if (pz.idx >= pz.p.moves.length) { finishPuzzle(true); return true; }
  pz.busy = false; pzButtons();
  say("pz-status", "Tiếp tục: tìm nước tốt nhất.");
  return true;
}
function renderGauge(done) {
  const p = pz.p, [lo, hi] = p.band, min = lo - 200, max = hi + 200, pct = v => Math.max(0, Math.min(100, (v - min) / (max - min) * 100));
  $("pz-gauge").innerHTML = `<div class="bar" aria-hidden="true"><div class="band" style="left:${pct(lo)}%;width:${pct(hi) - pct(lo)}%"></div>
    <div class="mk t" style="left:${pct(p.target)}%"></div>${done ? `<div class="mk p" style="left:${pct(p.rating)}%"></div>` : ""}</div>
    <p>Dải của ${esc(me.realm)}: ${lo} đến ${hi}. Mức nhắm tới ${esc(p.target)}${done ? `, câu này ${esc(p.rating)}` : ""}. Độ lệch thích nghi ${bias > 0 ? "+" : ""}${bias}.</p>`;
}
async function finishPuzzle(solved) {
  const my = pz.token;
  pz.over = true; pz.busy = false; pzButtons();
  const clean = solved && !pz.usedSol;
  if (!clean) setBias(bias - 45);
  else if (pz.mistakes === 0 && pz.hints === 0) setBias(bias + 35);
  else if (pz.mistakes <= 2 && pz.hints <= 1) setBias(bias + 10);
  if (clean) { say("pz-status", pz.mistakes === 0 && pz.hints === 0 ? "Giải xong, không sai nước nào!" : "Giải xong!", "good"); sfx.good(); }
  else say("pz-status", "Đáp án đã hiện. Câu sau sẽ dịu hơn một chút.");
  const p = pz.p, others = p.themes.filter(k => !TECH_BY_KEY[k] && PLAIN[k]).map(k => PLAIN[k]);
  $("pz-meta").innerHTML = (p.url ? `Câu <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.id)}</a> trên Lichess` : `Câu mẫu ${esc(p.id)}`) +
    `, điểm <b>${esc(p.rating)}</b>.` + (others.length ? ` Thêm: ${esc(others.slice(0, 3).join(", "))}.` : "");
  $("pz-teach").innerHTML = p.themes.filter(k => TECH_BY_KEY[k]).slice(0, 3).map(k => {
    const t = TECH_BY_KEY[k];
    return `<div class="teach"><b>${esc(t.name)}</b> <span>(${esc(t.plain)})</span><p>${esc(t.essence)}</p></div>`;
  }).join("");
  renderGauge(true);
  try {
    const r = await fetch("/api/bi-canh/result", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puzzle_id: p.id, rating: p.rating, realm: me.realm, solved: clean, mistakes: pz.mistakes, hints: pz.hints, seconds: Math.round((performance.now() - pz.t0) / 100) / 10 }) });
    if (r.ok) renderStats(await r.json());
  } catch (e) { /* mất mạng nội bộ thì bỏ qua nhật ký */ }
  if (clean && $("pz-auto").checked) { await sleep(2600); if (my === pz.token && activeTab === "puzzle") loadPuzzle(); }
  else $("pz-next").focus({ preventScroll: true });
}
function pzHint() {
  if (!pz.p || pz.over || pz.busy) return;
  const u = pz.p.moves[pz.idx];
  pz.hints++; pz.hintStep = Math.min(2, pz.hintStep + 1);
  pzBoard.hint = { from: u.slice(0, 2), to: pz.hintStep >= 2 ? u.slice(2, 4) : null };
  pzBoard.render();
  say("pz-status", pz.hintStep >= 2 ? "Quân cần đi và ô đến đã được tô." : "Quân cần đi đã được tô. Bấm Gợi ý lần nữa để thấy ô đến.");
}
async function pzSolution() {
  if (!pz.p || pz.over || pz.busy) return;
  const my = pz.token;
  pz.usedSol = true; pz.busy = true; pzButtons(); pzBoard.hint = null;
  say("pz-status", "Đang diễn lại đáp án...");
  while (pz.idx < pz.p.moves.length) {
    await sleep(reduce.matches ? 50 : 750);
    if (my !== pz.token) return;
    const mv = applyUci(pz.chess, pz.p.moves[pz.idx++]);
    pzBoard.last = mv; pzBoard.render(); pzBoard.slide(mv.from, mv.to); sfx.move(mv);
  }
  finishPuzzle(false);
}
function setTheme(key) {
  pz.theme = key; $("pz-theme").value = key; renderFocus();
}
async function initPuzzleTab() {
  let st = { count: 0, sample: true, themes: {} };
  try { st = await (await fetch("/api/bi-canh/status")).json(); } catch (e) { /* để mặc định */ }
  pz.sample = st.sample;
  pz.avail = st.sample ? { mate: st.count } : st.themes;
  $("pz-note").innerHTML = st.sample
    ? `<p class="note">Đang dùng bộ mẫu ${esc(st.count)} câu chiếu hết do chương trình sinh sẵn. Để có kho câu đố thật của Lichess (đủ mọi công pháp, mọi cảnh giới), chạy trong thư mục backend: <code>python import_puzzles.py --download</code></p>`
    : "";
  $("pz-theme").innerHTML = '<option value="">Tất cả công pháp</option>' + TECH_GROUPS.map(g =>
    '<optgroup label="' + esc(g.name) + '">' + TECHS.filter(t => t.group === g.key && (pz.avail[t.key] || 0) > 0)
      .map(t => '<option value="' + t.key + '">' + esc(t.name) + ' (' + esc(t.plain) + ')</option>').join("") + '</optgroup>').join("");
  $("pz-theme").onchange = () => { setTheme($("pz-theme").value); loadPuzzle(); };
  renderTechs();
  try { renderStats(await (await fetch("/api/bi-canh/stats")).json()); } catch (e) { renderGoal(); }
  loadPuzzle();
}
$("pz-next").onclick = loadPuzzle;
$("pz-hint").onclick = pzHint;
$("pz-solution").onclick = pzSolution;
$("pz-auto").checked = store.get("bicanh.auto", 0) === 1;
$("pz-auto").onchange = () => store.set("bicanh.auto", $("pz-auto").checked ? 1 : 0);

// ===== Công pháp các =====
function renderTechs() {
  const cards = group => TECHS.filter(t => t.group === group).map(t => {
    const n = pz.avail[t.key] || 0;
    return `<article class="tech${n ? "" : " off"}"><h3>${esc(t.name)}</h3><span class="plain">${esc(t.plain)}</span><p>${esc(t.essence)}</p>
      <span class="count">${n ? (pz.sample ? "Có trong bộ mẫu" : n.toLocaleString("vi-VN") + " câu trong kho") : "Cần nạp kho Lichess để luyện"}</span>
      <button type="button" class="act${n ? " main" : ""}" data-t="${t.key}"${n ? "" : " disabled"}>Luyện công pháp này</button></article>`;
  }).join("");
  $("tech-grid").innerHTML = `<section class="tech-group novice"><header><h2>♧ Đệ tử tạp dịch</h2><p>Nhập môn: bàn cờ, cách đi quân và luật chơi.</p></header>
    <a class="learn-link" href="/learn.html">Học cờ vua · 12 bài thực hành →</a></section>` +
    TECH_GROUPS.map(g => `<section class="tech-group ${g.key}"><header><h2>${g.icon} ${esc(g.name)}</h2><p>${esc(g.note)}</p></header><div class="techs">${cards(g.key)}</div></section>`).join("") +
    `<section class="tech-group lineage"><header><h2>✦ Công pháp chân truyền</h2><span class="coming">Sắp khai mở</span></header><p>Nơi lưu giữ công pháp chuyên sâu, sẽ được bổ sung sau.</p></section>`;
}
$("tech-grid").onclick = e => {
  const b = e.target.closest("button[data-t]");
  if (!b) return;
  setTheme(b.dataset.t); showTab("puzzle"); loadPuzzle();
};

// ===== Nhập nước đi bằng chữ (cho bàn phím và màn hình đọc) =====
function bindSan(formId, inputId, game, board) {
  $(formId).addEventListener("submit", async e => {
    e.preventDefault();
    const input = $(inputId), t = input.value.trim().replace(/[+#!?]/g, ""), chess = game.chess();
    if (!t || !chess) return;
    const all = chess.moves({ verbose: true }), plain = m => m.san.replace(/[+#]/g, "");
    let mv = all.find(m => plain(m) === t || m.from + m.to + (m.promotion || "") === t);
    if (!mv) { const c = all.filter(m => plain(m).toLowerCase() === t.toLowerCase()); if (c.length === 1) mv = c[0]; }
    if (!mv || !game.canMove(chess.turn())) { input.setCustomValidity("Không có nước đi đó"); input.reportValidity(); input.setCustomValidity(""); return; }
    const ok = await game.onMove({ from: mv.from, to: mv.to, promotion: mv.promotion });
    board.render();
    if (ok) { input.value = ""; board.slide(mv.from, mv.to); }
  });
}

// ===== Luận kiếm: đấu với bot =====
const bot = { chess: null, user: "w", level: 0, auto: true, thinking: false, over: false, token: 0, hints: 0, sel: "auto", color: "w" };
const botGame = { chess: () => bot.chess, canMove: c => !!bot.chess && !bot.over && !bot.thinking && c === bot.user && bot.chess.turn() === bot.user, onMove: m => botOnMove(m) };
const botBoard = new Board($("bot-board"), botGame);
let shift = store.get("bicanh.botshift", 0);
const autoLevel = () => Math.max(0, Math.min(5, REALMS.indexOf(me.realm) + shift));
const speak = kind => { $("bot-speech").textContent = "“" + pickOne(SPEECH[kind]) + "”"; };
function fillOpponents() {
  const au = BOTS[autoLevel()];
  $("bot-opps").innerHTML = `<button type="button" role="radio" class="opp auto" data-v="auto" aria-checked="${bot.sel === "auto"}"><b>Tự chọn theo cảnh giới của bạn</b><small>Hiện là ${esc(au.name)} (${esc(au.realm)}). Thắng thì đối thủ mạnh lên, thua thì dịu đi.</small></button>` +
    BOTS.map((b, i) => `<button type="button" role="radio" class="opp" data-v="${i}" aria-checked="${bot.sel === String(i)}"><b>${esc(b.name)}</b><small>${esc(b.realm)}, khoảng ${b.show} điểm</small></button>`).join("");
}
$("bot-opps").onclick = e => { const b = e.target.closest(".opp"); if (b) { bot.sel = b.dataset.v; fillOpponents(); } };
$("bot-colors").onclick = e => {
  const b = e.target.closest("button[data-c]");
  if (!b) return;
  bot.color = b.dataset.c;
  [...$("bot-colors").children].forEach(c => c.setAttribute("aria-checked", String(c === b)));
};
function botButtons() {
  const playing = !!bot.chess && !bot.over;
  $("bot-undo").disabled = !bot.chess || bot.thinking || bot.chess.history().length < (bot.user === "b" ? 3 : 2);
  $("bot-hint").disabled = !playing || bot.thinking || bot.chess.turn() !== bot.user;
  $("bot-resign").disabled = !playing;
  $("bot-pgn").disabled = !bot.chess || bot.chess.history().length === 0;
}
function renderBotStrips() {
  const b = BOTS[bot.level];
  strip("bot-top", b.name, `${b.realm}, khoảng ${b.show} điểm, quân ${colorName(bot.user === "w" ? "b" : "w")}`);
  strip("bot-bottom", "Ta", `${myLine()}, quân ${colorName(bot.user)}`);
}
function renderMoves() {
  const h = bot.chess.history();
  if (!h.length) { $("bot-moves").textContent = "Chưa có nước đi."; return; }
  let s = "";
  for (let i = 0; i < h.length; i += 2) s += `<b>${i / 2 + 1}.</b> ${esc(h[i])} ${esc(h[i + 1] || "")}  `;
  $("bot-moves").innerHTML = s;
  $("bot-moves").scrollTop = $("bot-moves").scrollHeight;
}
function checkEnd() {
  const c = bot.chess;
  if (!c.isGameOver()) return false;
  let text, result = 0;
  if (c.isCheckmate()) { const winner = c.turn() === "w" ? "b" : "w"; result = winner === bot.user ? 1 : -1; text = result === 1 ? "Chiếu hết! Bạn thắng." : "Chiếu hết. Đối thủ thắng ván này."; }
  else if (c.isStalemate()) text = "Hòa do hết nước đi hợp lệ.";
  else if (c.isThreefoldRepetition()) text = "Hòa do lặp lại thế cờ.";
  else if (c.isInsufficientMaterial()) text = "Hòa do không đủ quân chiếu hết.";
  else text = "Hòa theo luật 50 nước.";
  endGame(text, result);
  return true;
}
function endGame(text, result, kind) {
  bot.over = true;
  say("bot-status", text, result > 0 ? "good" : result < 0 ? "bad" : "");
  speak(kind || (result > 0 ? "botLose" : result < 0 ? "botWin" : "draw"));
  sfx.end(result > 0);
  if (bot.auto && result !== 0) {
    shift = Math.max(-2, Math.min(2, shift + result)); store.set("bicanh.botshift", shift); fillOpponents();
    $("bot-meta").textContent += result > 0 ? " Ván sau đối thủ sẽ mạnh hơn một bậc." : " Ván sau đối thủ sẽ dịu đi một bậc.";
  }
  botButtons();
}
async function newBotGame() {
  const my = ++bot.token;
  bot.user = bot.color === "r" ? (Math.random() < 0.5 ? "w" : "b") : bot.color;
  bot.auto = bot.sel === "auto"; bot.level = bot.auto ? autoLevel() : Number(bot.sel);
  Object.assign(bot, { chess: new Chess(), over: false, thinking: false, hints: 0 });
  Object.assign(botBoard, { flip: bot.user === "b", last: null, hint: null }); botBoard.clearSel(); botBoard.render(); renderMoves(); botButtons(); renderBotStrips();
  const b = BOTS[bot.level];
  $("bot-meta").innerHTML = `Bạn cầm quân <b>${colorName(bot.user)}</b>, đối thủ là <b>${esc(b.name)}</b> (${esc(b.realm)}).`;
  speak("start");
  say("bot-status", "Đang nạp Stockfish...");
  try { await engine.start(); engine.newGame(); }
  catch (e) { say("bot-status", "Trình duyệt này không chạy được Stockfish. Thử Chrome, Edge hoặc Firefox bản mới.", "bad"); return; }
  if (my !== bot.token) return;
  if (bot.chess.turn() !== bot.user) botReply(); else say("bot-status", "Đến lượt bạn.");
}
async function botReply() {
  const my = bot.token, b = BOTS[bot.level];
  bot.thinking = true; botButtons();
  say("bot-status", `${b.name} đang suy nghĩ...`);
  let uci;
  try { [uci] = await Promise.all([engine.think(bot.chess.fen(), { elo: b.elo, skill: b.skill, depth: b.depth, movetime: b.ms }), sleep(reduce.matches ? 0 : 350)]); }
  catch (e) { if (my === bot.token) { bot.thinking = false; say("bot-status", "Đối thủ gặp lỗi, hãy bấm Bắt đầu lại.", "bad"); } return; }
  if (my !== bot.token || bot.over) return;
  bot.thinking = false;
  if (!uci) { checkEnd(); return; }
  const mv = applyUci(bot.chess, uci);
  botBoard.last = mv; botBoard.hint = null; botBoard.render(); botBoard.slide(mv.from, mv.to); renderMoves(); sfx.move(mv);
  if (!checkEnd()) {
    say("bot-status", "Đến lượt bạn.");
    if (bot.chess.inCheck()) speak("check"); else if (mv.captured && Math.random() < 0.4) speak("capture");
  }
  botButtons();
}
async function botOnMove(m) {
  if (!bot.chess || bot.over || bot.thinking || bot.chess.turn() !== bot.user) return false;
  let mv;
  try { mv = bot.chess.move({ from: m.from, to: m.to, promotion: m.promotion }); } catch (e) { return false; }
  botBoard.last = mv; botBoard.hint = null; renderMoves(); sfx.move(mv);
  if (checkEnd()) return true;
  botReply();
  return true;
}
function botUndo() {
  if (!bot.chess || bot.thinking) return;
  const h = bot.chess.history().length, floor = bot.user === "b" ? 1 : 0;
  const n = Math.min(bot.chess.turn() === bot.user ? 2 : 1, h - floor);
  if (n <= 0) return;
  for (let i = 0; i < n; i++) bot.chess.undo();
  bot.over = false; bot.token++;
  const last = bot.chess.history({ verbose: true }).at(-1);
  Object.assign(botBoard, { last: last || null, hint: null }); botBoard.clearSel(); botBoard.render(); renderMoves();
  say("bot-status", bot.chess.turn() === bot.user ? "Đến lượt bạn." : "Đang chờ đối thủ.");
  botButtons();
  if (bot.chess.turn() !== bot.user) botReply();
}
async function botHint() {
  if (!bot.chess || bot.over || bot.thinking) return;
  const my = bot.token;
  bot.thinking = true; botButtons(); say("bot-status", "Đang tìm nước tốt nhất...");
  let uci;
  try { uci = await engine.think(bot.chess.fen(), { movetime: 800 }); } catch (e) { bot.thinking = false; say("bot-status", "Chưa lấy được gợi ý.", "bad"); botButtons(); return; }
  if (my !== bot.token) return;
  bot.thinking = false; bot.hints++;
  if (uci) { botBoard.hint = { from: uci.slice(0, 2), to: uci.slice(2, 4) }; botBoard.render(); }
  say("bot-status", "Nước gợi ý đã được tô trên bàn.");
  botButtons();
}
async function botPgn() {
  if (!bot.chess) return;
  try {
    bot.chess.setHeader("Event", "Bí Cảnh, Tĩnh Huyền Các");
    bot.chess.setHeader("White", bot.user === "w" ? "Ta" : BOTS[bot.level].name);
    bot.chess.setHeader("Black", bot.user === "b" ? "Ta" : BOTS[bot.level].name);
  } catch (e) { /* bỏ qua tiêu đề */ }
  const pgn = bot.chess.pgn();
  try { await navigator.clipboard.writeText(pgn); say("bot-status", "Đã chép PGN, dán vào Lichess hoặc Chess.com để phân tích."); }
  catch (e) { window.prompt("Chép PGN ở đây:", pgn); }
}
$("bot-new").onclick = newBotGame;
$("bot-undo").onclick = botUndo;
$("bot-hint").onclick = botHint;
$("bot-resign").onclick = () => { if (bot.chess && !bot.over) { bot.token++; bot.thinking = false; endGame("Bạn đã chấp thua ván này.", -1, "resign"); } };
$("bot-pgn").onclick = botPgn;
bindSan("pz-form", "pz-input", pzGame, pzBoard);
bindSan("bot-form", "bot-input", botGame, botBoard);

// ===== Chuyển chế độ và phím tắt =====
const TABS = ["puzzle", "bot", "tech"];
let activeTab = "puzzle";
function showTab(name) {
  activeTab = name;
  for (const t of TABS) { $("pane-" + t).hidden = t !== name; $("tab-" + t).setAttribute("aria-selected", String(t === name)); }
  history.replaceState(null, "", name === "puzzle" ? location.pathname + location.search : "#" + name);
  if (name === "bot" && !bot.chess) { bot.chess = new Chess(); bot.level = autoLevel(); botBoard.render(); botButtons(); renderBotStrips(); }
}
TABS.forEach(t => { $("tab-" + t).onclick = () => showTab(t); });
document.querySelector(".tabs").addEventListener("keydown", e => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const i = TABS.indexOf(e.target.id.replace("tab-", "")), n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
  showTab(n); $("tab-" + n).focus();
});
addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey || activeTab !== "puzzle") return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (["input", "select", "textarea", "button", "summary"].includes(tag) && e.key !== "h" && e.key !== "H" && e.key !== "n" && e.key !== "N") return;
  if (["input", "select", "textarea"].includes(tag)) return;
  if (e.key === "h" || e.key === "H") pzHint();
  else if (e.key === "n" || e.key === "N") loadPuzzle();
});

renderSound();
await loadMe();
bot.level = autoLevel();
fillOpponents();
speak("idle");
pzBoard.render();
strip("pz-top", "Đối thủ", ""); strip("pz-bottom", "Ta", myLine());
if (location.hash === "#bot") showTab("bot"); else if (location.hash === "#tech") showTab("tech");
initPuzzleTab();
