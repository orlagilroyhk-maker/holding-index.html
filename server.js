// HTTP layer — Express. Serves the static frontend and a small JSON API.
// Kept thin: scoring lives in lib/scoring.js, storage in lib/db.js.

import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import * as store from "./lib/db.js";
import { score } from "./lib/scoring.js";

// Load .env if present (tiny parser — avoids an extra dependency).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(__dirname, ".env"));

const app = express();
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const PUBLIC_DIR = path.join(__dirname, "public");

const QUESTIONNAIRE_NAME = "Do You Do This Too?";

// ---- Public API ----------------------------------------------------------

// Questions for the quiz — never includes the creator's answers.
app.get("/api/questions", (req, res) => {
  res.json({ name: QUESTIONNAIRE_NAME, questions: store.getPublicQuestions() });
});

// Anonymous aggregate stats (per-question A/B percentages).
app.get("/api/aggregates", (req, res) => {
  res.json({ aggregates: store.getAggregates() });
});

// Submit a completed questionnaire. Scoring happens here, server-side.
app.post("/api/responses", (req, res) => {
  const body = req.body || {};
  const responseId = typeof body.responseId === "string" ? body.responseId.slice(0, 64) : "";
  const rawAnswers = body.answers && typeof body.answers === "object" ? body.answers : {};

  if (!responseId) return res.status(400).json({ error: "Missing responseId" });

  // Sanitise answers to { questionId: 'A' | 'B' } only.
  const answers = {};
  for (const [qid, val] of Object.entries(rawAnswers)) {
    if (val === "A" || val === "B") answers[String(qid)] = val;
  }

  const questions = store.getEnabledQuestions();
  const { matches, total, sameBrainPercent } = score(answers, questions);
  const completedAt = new Date().toISOString();

  const stored = store.saveResponse({ responseId, answers, matches, total, sameBrainPercent, completedAt });

  res.json({
    name: QUESTIONNAIRE_NAME,
    duplicate: !stored,
    matches,
    total,
    sameBrainPercent,
    aggregates: store.getAggregates(),
  });
});

// ---- Admin (HTTP Basic Auth) ---------------------------------------------

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: "Admin is not configured. Set ADMIN_PASSWORD in your environment.",
    });
  }
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, pass] = Buffer.from(encoded, "base64").toString("utf8").split(":");
    if (user === ADMIN_USER && pass === ADMIN_PASSWORD) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Admin", charset="UTF-8"');
  res.status(401).json({ error: "Authentication required" });
}

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  res.json({ ...store.getStats(), questions: store.getAggregates() });
});

app.get("/api/admin/questions", requireAdmin, (req, res) => {
  res.json({ questions: store.getAllQuestions() });
});

app.post("/api/admin/questions", requireAdmin, (req, res) => {
  const q = req.body || {};
  if (!q.id || !q.title) return res.status(400).json({ error: "id and title are required" });
  res.json({ question: store.upsertQuestion(q) });
});

app.put("/api/admin/questions/:id", requireAdmin, (req, res) => {
  const q = { ...(req.body || {}), id: req.params.id };
  if (!q.title) return res.status(400).json({ error: "title is required" });
  res.json({ question: store.upsertQuestion(q) });
});

app.delete("/api/admin/questions/:id", requireAdmin, (req, res) => {
  const ok = store.deleteQuestion(req.params.id);
  res.json({ deleted: ok });
});

app.post("/api/admin/reorder", requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.order) ? req.body.order.map(String) : [];
  store.reorderQuestions(ids);
  res.json({ ok: true });
});

// Protect the admin HTML page itself with the same auth.
app.get(["/admin", "/admin.html"], requireAdmin, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

// ---- Static files & pages ------------------------------------------------

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.listen(PORT, () => {
  console.log(`\n  ${QUESTIONNAIRE_NAME}`);
  console.log(`  Running at http://localhost:${PORT}`);
  console.log(`  Admin at   http://localhost:${PORT}/admin`);
  if (!ADMIN_PASSWORD) console.log("  ⚠  ADMIN_PASSWORD not set — /admin is disabled until you set it.\n");
  else console.log("");
});

// ---- Tiny .env loader (no dependency) ------------------------------------

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
