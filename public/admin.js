// Admin dashboard logic. Talks to /api/admin/* which is protected by HTTP
// Basic Auth (the browser prompts once when you open /admin and reuses the
// credentials for these requests).

const $ = (s) => document.querySelector(s);
let questions = [];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (res.status === 401) { location.reload(); throw new Error("Unauthorized"); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// ---- Load & render everything --------------------------------------------
async function refresh() {
  const [stats, qs] = await Promise.all([
    api("/api/admin/stats"),
    api("/api/admin/questions"),
  ]);
  questions = qs.questions;
  renderOverview(stats);
  renderResults(stats.questions);
  renderManage(questions);
}

function renderOverview(stats) {
  $("#stat-total").textContent = stats.totalResponses;
  $("#stat-avg").textContent = stats.averageSameBrain + "%";
  $("#stat-questions").textContent = questions.filter((q) => q.enabled).length;

  const max = Math.max(1, ...stats.distribution.map((b) => b.count));
  const dist = $("#dist");
  dist.innerHTML = "";
  for (const b of stats.distribution) {
    const wrap = document.createElement("div");
    wrap.className = "bar-wrap";
    const h = Math.round((b.count / max) * 100);
    wrap.innerHTML =
      `<div class="bar-num">${b.count || ""}</div>` +
      `<div class="bar" style="height:${b.count ? Math.max(4, h) : 0}%" title="${b.label}%: ${b.count}"></div>` +
      `<div class="bar-label">${b.label}</div>`;
    dist.appendChild(wrap);
  }
}

function renderResults(list) {
  const wrap = $("#results-list");
  wrap.innerHTML = "";
  if (!list.length) { wrap.innerHTML = '<p class="subtle">No questions yet.</p>'; return; }
  for (const q of list) {
    const div = document.createElement("div");
    div.className = "qr" + (q.enabled ? "" : " disabled");
    const creatorTag = q.creatorAnswer
      ? `<span class="tag">Your answer: ${q.creatorAnswer}</span>`
      : `<span class="tag">No creator answer</span>`;
    const aStar = q.creatorAnswer === "A" ? ' <span class="star" title="your answer">★</span>' : "";
    const bStar = q.creatorAnswer === "B" ? ' <span class="star" title="your answer">★</span>' : "";
    div.innerHTML = `
      <div class="qr-title">${esc(q.title)}${q.enabled ? "" : " (disabled)"}</div>
      <div class="qr-meta">${q.totalAnswered} response${q.totalAnswered === 1 ? "" : "s"} ${creatorTag}</div>
      <div class="bar2">
        <div class="seg segA ${q.percentA ? "" : "zero"}" style="flex:${q.percentA}">${q.percentA ? q.percentA + "%" : ""}</div>
        <div class="seg segB ${q.percentB ? "" : "zero"}" style="flex:${q.percentB}">${q.percentB ? q.percentB + "%" : ""}</div>
      </div>
      <div class="qr-legend">
        <span><b>A${aStar}:</b> ${esc(q.answerA)} — ${q.countA} (${q.percentA}%)</span>
        <span><b>B${bStar}:</b> ${esc(q.answerB)} — ${q.countB} (${q.percentB}%)</span>
      </div>`;
    wrap.appendChild(div);
  }
}

function renderManage(list) {
  const wrap = $("#manage-list");
  wrap.innerHTML = "";
  list.forEach((q, i) => {
    const row = document.createElement("div");
    row.className = "mrow" + (q.enabled ? "" : " disabled");
    row.innerHTML = `
      <div class="grip">
        <button data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
        <button data-act="down" ${i === list.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
      </div>
      <div class="mtitle"><b>${esc(q.title)}</b><small>${q.creatorAnswer ? "Your answer: " + q.creatorAnswer : "no creator answer"} · ${q.enabled ? "enabled" : "disabled"}</small></div>
      <div class="mactions">
        <button data-act="edit">Edit</button>
        <button data-act="toggle">${q.enabled ? "Disable" : "Enable"}</button>
        <button data-act="delete" title="Delete">✕</button>
      </div>`;
    row.querySelector('[data-act="up"]').addEventListener("click", () => move(i, -1));
    row.querySelector('[data-act="down"]').addEventListener("click", () => move(i, 1));
    row.querySelector('[data-act="edit"]').addEventListener("click", () => openEdit(q));
    row.querySelector('[data-act="toggle"]').addEventListener("click", () => toggle(q));
    row.querySelector('[data-act="delete"]').addEventListener("click", () => del(q));
    wrap.appendChild(row);
  });
}

// ---- Actions -------------------------------------------------------------
async function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= questions.length) return;
  const ids = questions.map((q) => q.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await api("/api/admin/reorder", { method: "POST", body: JSON.stringify({ order: ids }) });
  await refresh();
}

async function toggle(q) {
  await api(`/api/admin/questions/${encodeURIComponent(q.id)}`, {
    method: "PUT",
    body: JSON.stringify({ ...q, enabled: !q.enabled }),
  });
  toast(q.enabled ? "Question disabled" : "Question enabled");
  await refresh();
}

async function del(q) {
  if (!confirm(`Delete “${q.title}”? This cannot be undone. (Disable it instead to keep its responses.)`)) return;
  await api(`/api/admin/questions/${encodeURIComponent(q.id)}`, { method: "DELETE" });
  toast("Question deleted");
  await refresh();
}

// ---- Edit / add dialog ---------------------------------------------------
const dialog = $("#edit-dialog");
let editingId = null;

function openEdit(q) {
  editingId = q ? q.id : null;
  $("#edit-title").textContent = q ? "Edit question" : "Add question";
  $("#f-id").value = q ? q.id : "";
  $("#f-id").disabled = !!q; // don't change an existing id
  $("#f-title").value = q ? q.title : "";
  $("#f-answerA").value = q ? q.answerA : "";
  $("#f-answerB").value = q ? q.answerB : "";
  $("#f-image").value = q ? q.image : "";
  $("#f-video").value = q ? q.video : "";
  $("#f-creator").value = q && q.creatorAnswer ? q.creatorAnswer : "";
  $("#f-enabled").value = q ? String(q.enabled) : "true";
  dialog.showModal();
}

$("#add-btn").addEventListener("click", () => openEdit(null));

$("#edit-form").addEventListener("submit", async (e) => {
  const action = e.submitter && e.submitter.value;
  if (action !== "save") return; // cancel
  e.preventDefault();

  const payload = {
    id: $("#f-id").value.trim(),
    title: $("#f-title").value.trim(),
    answerA: $("#f-answerA").value.trim(),
    answerB: $("#f-answerB").value.trim(),
    image: $("#f-image").value.trim(),
    video: $("#f-video").value.trim(),
    creatorAnswer: $("#f-creator").value || null,
    enabled: $("#f-enabled").value === "true",
  };
  if (!payload.id || !payload.title || !payload.answerA || !payload.answerB) {
    toast("Please fill in id, title and both answers");
    return;
  }

  try {
    if (editingId) {
      payload.displayOrder = questions.find((q) => q.id === editingId)?.displayOrder ?? 0;
      await api(`/api/admin/questions/${encodeURIComponent(editingId)}`, {
        method: "PUT", body: JSON.stringify(payload),
      });
    } else {
      payload.displayOrder = questions.length + 1;
      await api("/api/admin/questions", { method: "POST", body: JSON.stringify(payload) });
    }
    dialog.close();
    toast("Saved");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

refresh().catch((e) => toast(e.message));
