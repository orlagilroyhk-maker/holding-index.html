// Front-end logic. Fetches questions, runs the one-at-a-time flow, submits
// answers, and shows the result. Scoring is done server-side; this file only
// records choices and renders what comes back.

const state = {
  name: "Do You Do This Too?",
  questions: [],
  index: 0,
  answers: {},        // { questionId: 'A' | 'B' }
  responseId: null,
  result: null,
};

const $ = (sel) => document.querySelector(sel);
const screens = {
  intro: $("#screen-intro"),
  question: $("#screen-question"),
  results: $("#screen-results"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  window.scrollTo(0, 0);
}

// ---- Anonymous response id (random, not a fingerprint) -------------------
function getResponseId() {
  let id = localStorage.getItem("dydtt_response_id");
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      "r-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("dydtt_response_id", id);
  }
  return id;
}

// ---- Media rendering (optional, safe) ------------------------------------
function safeUrl(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

function renderMedia(q) {
  const el = $("#q-media");
  el.innerHTML = "";
  const img = safeUrl(q.image);
  const video = safeUrl(q.video);

  if (img) {
    const el2 = document.createElement("img");
    el2.src = img;
    el2.alt = q.imageAlt || q.title;
    el2.loading = "lazy";
    el.appendChild(el2);
  }
  if (video) {
    if (/youtube\.com|youtu\.be|vimeo\.com|player\./i.test(video)) {
      const iframe = document.createElement("iframe");
      iframe.src = toEmbed(video);
      iframe.title = q.title;
      iframe.allow = "accelerometer; encrypted-media; picture-in-picture";
      iframe.setAttribute("allowfullscreen", "");
      iframe.loading = "lazy";
      el.appendChild(iframe);
    } else {
      const v = document.createElement("video");
      v.src = video;
      v.controls = true;
      v.playsInline = true;
      v.setAttribute("aria-label", q.title);
      el.appendChild(v);
    }
  }
}

function toEmbed(url) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return url;
}

// ---- Question flow -------------------------------------------------------
function renderQuestion() {
  const total = state.questions.length;
  const q = state.questions[state.index];
  if (!q) return;

  $("#progress-count").textContent = `Question ${state.index + 1} of ${total}`;
  const pct = Math.round((state.index / total) * 100);
  $("#progress-fill").style.width = pct + "%";
  $("#progress-bar").setAttribute("aria-valuenow", String(pct));

  $("#back-btn").disabled = state.index === 0;
  $("#q-title").textContent = q.title;
  renderMedia(q);

  const cards = $("#q-cards");
  cards.innerHTML = "";
  for (const side of ["A", "B"]) {
    const answer = side === "A" ? q.answerA : q.answerB;
    const btn = document.createElement("button");
    btn.className = "card";
    btn.dataset.side = side;
    btn.type = "button";
    if (state.answers[q.id] === side) btn.classList.add("chosen");
    btn.innerHTML = `<span class="letter" aria-hidden="true">${side}</span><span class="answer"></span>`;
    btn.querySelector(".answer").textContent = answer;
    btn.setAttribute("aria-label", `Answer ${side}: ${answer}`);
    btn.addEventListener("click", () => choose(q.id, side, btn));
    cards.appendChild(btn);
  }
}

function choose(qid, side, btn) {
  state.answers[qid] = side;
  // brief visual acknowledgement, then advance
  document.querySelectorAll("#q-cards .card").forEach((c) => c.classList.remove("chosen"));
  btn.classList.add("chosen");

  const advance = () => {
    if (state.index < state.questions.length - 1) {
      state.index += 1;
      renderQuestion();
    } else {
      submit();
    }
  };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(advance, reduce ? 60 : 260);
}

function goBack() {
  if (state.index > 0) {
    state.index -= 1;
    renderQuestion();
  }
}

// ---- Submit & results ----------------------------------------------------
async function submit() {
  $("#progress-fill").style.width = "100%";
  try {
    const res = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseId: state.responseId, answers: state.answers }),
    });
    state.result = await res.json();
  } catch (e) {
    state.result = { matches: 0, total: 0, sameBrainPercent: 0, aggregates: [] };
  }
  localStorage.setItem("dydtt_completed", "1");
  showResult();
}

function showResult() {
  const r = state.result || {};
  const pct = r.sameBrainPercent || 0;
  const total = r.total || 0;
  const matches = r.matches || 0;

  animateRing(pct);
  $("#score-headline").textContent =
    `You and I answered the same on ${matches} of ${total} question${total === 1 ? "" : "s"}.`;
  $(".score-ring").setAttribute("aria-label",
    `${pct}% same-brain score. You matched my answer on ${matches} of ${total} questions.`);

  // A/B tally
  let a = 0, b = 0;
  for (const v of Object.values(state.answers)) { if (v === "A") a++; else if (v === "B") b++; }
  $("#count-a").textContent = a;
  $("#count-b").textContent = b;

  renderFacts(r.aggregates || []);
  showScreen("results");
}

function animateRing(pct) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const ring = $("#ring-val");
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference);
  const pctEl = $("#score-pct");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  requestAnimationFrame(() => {
    ring.style.strokeDashoffset = String(circumference * (1 - pct / 100));
  });

  if (reduce) { pctEl.innerHTML = `${pct}<small>%</small>`; return; }
  let cur = 0;
  const step = () => {
    cur += Math.max(1, Math.round(pct / 30));
    if (cur >= pct) cur = pct;
    pctEl.innerHTML = `${cur}<small>%</small>`;
    if (cur < pct) requestAnimationFrame(step);
  };
  step();
}

function renderFacts(aggregates) {
  // Pick a few interesting, well-populated stats to show.
  const facts = aggregates
    .filter((a) => a.enabled && a.totalAnswered >= 1)
    .map((a) => {
      const side = a.percentB >= a.percentA ? "B" : "A";
      const pct = side === "B" ? a.percentB : a.percentA;
      return { title: a.title, side, pct, weight: Math.abs(a.percentB - 50) };
    })
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 3);

  const wrap = $("#facts");
  const list = $("#facts-list");
  list.innerHTML = "";
  if (!facts.length) { wrap.hidden = true; return; }
  for (const f of facts) {
    const div = document.createElement("div");
    div.className = "fact";
    div.innerHTML = `<strong>${f.pct}%</strong> of people answered ${f.side} for `;
    div.appendChild(document.createTextNode(`“${f.title}”.`));
    list.appendChild(div);
  }
  wrap.hidden = false;
}

// ---- Sharing -------------------------------------------------------------
function shareText(withAnswers) {
  const r = state.result || {};
  let text = `I got a ${r.sameBrainPercent || 0}% same-brain score on “${state.name}”. Do you do this too?`;
  if (withAnswers) {
    const lines = state.questions.map((q, i) => {
      const side = state.answers[q.id];
      const ans = side === "A" ? q.answerA : side === "B" ? q.answerB : "—";
      return `${i + 1}. ${q.title}: ${side || "—"} (${ans})`;
    });
    text += "\n\nMy answers:\n" + lines.join("\n");
  }
  return text;
}

async function share(withAnswers) {
  const text = shareText(withAnswers);
  const shareData = { title: state.name, text, url: window.location.origin };
  if (navigator.share) {
    try { await navigator.share(shareData); return; } catch { /* cancelled */ }
  }
  try {
    await navigator.clipboard.writeText(text + "\n" + window.location.origin);
    toast("Copied to clipboard");
  } catch {
    toast("Copy this: " + text);
  }
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// ---- Boot ----------------------------------------------------------------
async function start() {
  if (!state.questions.length) {
    try {
      const res = await fetch("/api/questions");
      const data = await res.json();
      state.name = data.name || state.name;
      state.questions = data.questions || [];
    } catch {
      toast("Could not load questions. Please refresh.");
      return;
    }
  }
  if (!state.questions.length) { toast("No questions available yet."); return; }
  state.index = 0;
  state.answers = {};
  showScreen("question");
  renderQuestion();
}

function bind() {
  state.responseId = getResponseId();
  $("#start-btn").addEventListener("click", start);
  $("#back-btn").addEventListener("click", goBack);
  $("#restart-btn").addEventListener("click", () => { showScreen("intro"); });
  $("#share-btn").addEventListener("click", () => share(false));
  $("#share-detail-btn").addEventListener("click", () => share(true));

  // Keyboard shortcuts on the question screen: A / B / arrow keys.
  document.addEventListener("keydown", (e) => {
    if (!screens.question.classList.contains("active")) return;
    const q = state.questions[state.index];
    if (!q) return;
    if (e.key.toLowerCase() === "a") $('#q-cards .card[data-side="A"]')?.click();
    else if (e.key.toLowerCase() === "b") $('#q-cards .card[data-side="B"]')?.click();
    else if (e.key === "ArrowLeft") goBack();
  });
}

bind();
