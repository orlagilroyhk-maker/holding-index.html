// Storage layer — libSQL (@libsql/client).
//
// One code path for both environments:
//   • Local dev  → a SQLite file on disk  (url: file:./data/responses.db)
//   • Production → a free Turso cloud database (url: libsql://…, auth token)
//
// Configure with env vars:
//   DATABASE_URL         e.g. libsql://your-db.turso.io   (or file:./data/responses.db)
//   DATABASE_AUTH_TOKEN  Turso auth token (only for libsql:// URLs)
//   DB_PATH              local file path when no DATABASE_URL is set (default ./data/responses.db)
//
// Questions live in the database so /admin can add, edit, disable and reorder
// them. On first run (empty questions table) they are seeded from
// data/questions.json.

import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function buildClient() {
  const url = process.env.DATABASE_URL;
  if (url) {
    return createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  }
  // Local file fallback.
  const rel = process.env.DB_PATH || "./data/responses.db";
  const abs = path.resolve(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return createClient({ url: "file:" + abs });
}

const db = buildClient();

const run = (sql, args = []) => db.execute({ sql, args });
const all = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const get = async (sql, args = []) => (await db.execute({ sql, args })).rows[0] || null;

// ---- Schema + seeding ----------------------------------------------------

export async function initDb() {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS questions (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        answerA       TEXT NOT NULL,
        answerB       TEXT NOT NULL,
        image         TEXT DEFAULT '',
        video         TEXT DEFAULT '',
        creatorAnswer TEXT,
        enabled       INTEGER NOT NULL DEFAULT 1,
        displayOrder  INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS responses (
        responseId       TEXT PRIMARY KEY,
        answers          TEXT NOT NULL,
        matches          INTEGER NOT NULL,
        total            INTEGER NOT NULL,
        sameBrainPercent INTEGER NOT NULL,
        completedAt      TEXT NOT NULL
      )`,
    ],
    "write"
  );
  await seedIfEmpty();
}

async function seedIfEmpty() {
  const row = await get("SELECT COUNT(*) AS n FROM questions");
  if (row && row.n > 0) return;

  const seedPath = path.join(ROOT, "data", "questions.json");
  if (!fs.existsSync(seedPath)) return;

  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const list = Array.isArray(raw) ? raw : raw.questions || [];
  if (!list.length) return;

  const stmts = list.map((q, i) => ({
    sql: `INSERT INTO questions (id, title, answerA, answerB, image, video, creatorAnswer, enabled, displayOrder)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      String(q.id),
      String(q.title || ""),
      String(q.answerA || ""),
      String(q.answerB || ""),
      String(q.image || ""),
      String(q.video || ""),
      q.creatorAnswer === "A" || q.creatorAnswer === "B" ? q.creatorAnswer : null,
      q.enabled === false ? 0 : 1,
      Number.isFinite(q.displayOrder) ? q.displayOrder : i + 1,
    ],
  }));
  await db.batch(stmts, "write");
  console.log(`Seeded ${list.length} question(s) from data/questions.json`);
}

// ---- Question queries ----------------------------------------------------

const rowToQuestion = (r) => ({
  id: r.id,
  title: r.title,
  answerA: r.answerA,
  answerB: r.answerB,
  image: r.image || "",
  video: r.video || "",
  creatorAnswer: r.creatorAnswer || null,
  enabled: Number(r.enabled) === 1,
  displayOrder: Number(r.displayOrder),
});

export async function getEnabledQuestions() {
  const rows = await all(
    "SELECT * FROM questions WHERE enabled = 1 ORDER BY displayOrder ASC, rowid ASC"
  );
  return rows.map(rowToQuestion);
}

export async function getAllQuestions() {
  const rows = await all("SELECT * FROM questions ORDER BY displayOrder ASC, rowid ASC");
  return rows.map(rowToQuestion);
}

/** Public-safe questions for the quiz (never exposes creatorAnswer). */
export async function getPublicQuestions() {
  const qs = await getEnabledQuestions();
  return qs.map(({ creatorAnswer, ...pub }) => pub);
}

export async function upsertQuestion(q) {
  const data = {
    id: String(q.id),
    title: String(q.title || ""),
    answerA: String(q.answerA || ""),
    answerB: String(q.answerB || ""),
    image: String(q.image || ""),
    video: String(q.video || ""),
    creatorAnswer: q.creatorAnswer === "A" || q.creatorAnswer === "B" ? q.creatorAnswer : null,
    enabled: q.enabled === false || q.enabled === 0 ? 0 : 1,
    displayOrder: Number.isFinite(Number(q.displayOrder)) ? Number(q.displayOrder) : 0,
  };
  const existing = await get("SELECT id FROM questions WHERE id = ?", [data.id]);
  if (existing) {
    await run(
      `UPDATE questions SET title=?, answerA=?, answerB=?, image=?, video=?,
        creatorAnswer=?, enabled=?, displayOrder=? WHERE id=?`,
      [data.title, data.answerA, data.answerB, data.image, data.video,
       data.creatorAnswer, data.enabled, data.displayOrder, data.id]
    );
  } else {
    await run(
      `INSERT INTO questions (id, title, answerA, answerB, image, video, creatorAnswer, enabled, displayOrder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.id, data.title, data.answerA, data.answerB, data.image, data.video,
       data.creatorAnswer, data.enabled, data.displayOrder]
    );
  }
  const saved = await get("SELECT * FROM questions WHERE id = ?", [data.id]);
  return rowToQuestion(saved);
}

export async function deleteQuestion(id) {
  const res = await run("DELETE FROM questions WHERE id = ?", [id]);
  return Number(res.rowsAffected) > 0;
}

export async function reorderQuestions(orderedIds) {
  const stmts = orderedIds.map((id, i) => ({
    sql: "UPDATE questions SET displayOrder = ? WHERE id = ?",
    args: [i + 1, String(id)],
  }));
  if (stmts.length) await db.batch(stmts, "write");
}

// ---- Response queries ----------------------------------------------------

/** Insert a response. Duplicate responseId is ignored (dedupe by browser id). */
export async function saveResponse(r) {
  const res = await run(
    `INSERT OR IGNORE INTO responses (responseId, answers, matches, total, sameBrainPercent, completedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [r.responseId, JSON.stringify(r.answers), r.matches, r.total, r.sameBrainPercent, r.completedAt]
  );
  return Number(res.rowsAffected) > 0; // false if it was a duplicate
}

/**
 * Aggregate per-question A/B counts across all stored responses.
 * Anonymous counts only (safe to expose publicly).
 */
export async function getAggregates() {
  const questions = await getAllQuestions();
  const counts = Object.fromEntries(questions.map((q) => [q.id, { A: 0, B: 0 }]));

  const rows = await all("SELECT answers FROM responses");
  for (const row of rows) {
    let answers;
    try {
      answers = JSON.parse(row.answers);
    } catch {
      continue;
    }
    for (const [qid, val] of Object.entries(answers)) {
      if (!counts[qid]) continue;
      if (val === "A") counts[qid].A += 1;
      else if (val === "B") counts[qid].B += 1;
    }
  }

  return questions.map((q) => {
    const c = counts[q.id] || { A: 0, B: 0 };
    const totalAnswered = c.A + c.B;
    return {
      id: q.id,
      title: q.title,
      answerA: q.answerA,
      answerB: q.answerB,
      enabled: q.enabled,
      creatorAnswer: q.creatorAnswer,
      countA: c.A,
      countB: c.B,
      totalAnswered,
      percentA: totalAnswered ? Math.round((c.A / totalAnswered) * 100) : 0,
      percentB: totalAnswered ? Math.round((c.B / totalAnswered) * 100) : 0,
    };
  });
}

/** Overall stats for the admin dashboard. */
export async function getStats() {
  const totalRow = await get("SELECT COUNT(*) AS n FROM responses");
  const total = totalRow ? Number(totalRow.n) : 0;
  const avgRow = await get("SELECT AVG(sameBrainPercent) AS avg FROM responses");
  const avg = avgRow && avgRow.avg != null ? Math.round(Number(avgRow.avg)) : 0;

  // Distribution in 10-point buckets: 0-9, 10-19, ... 100.
  const buckets = Array.from({ length: 11 }, (_, i) => ({
    label: i === 10 ? "100" : `${i * 10}-${i * 10 + 9}`,
    count: 0,
  }));
  const rows = await all("SELECT sameBrainPercent AS p FROM responses");
  for (const { p } of rows) {
    const idx = Math.min(10, Math.floor(Number(p) / 10));
    buckets[idx].count += 1;
  }

  return { totalResponses: total, averageSameBrain: avg, distribution: buckets };
}

export default db;
