// Storage layer — SQLite via better-sqlite3. Zero external services, one file
// on disk. Kept separate from scoring and the HTTP layer.
//
// Questions live in the database so the /admin page can add, edit, disable and
// reorder them. On first run (empty questions table) the database is seeded
// from data/questions.json so you have something to edit.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DB_PATH = process.env.DB_PATH
  ? path.resolve(ROOT, process.env.DB_PATH)
  : path.join(ROOT, "data", "responses.db");

// Ensure the folder exists.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    answerA       TEXT NOT NULL,
    answerB       TEXT NOT NULL,
    image         TEXT DEFAULT '',
    video         TEXT DEFAULT '',
    creatorAnswer TEXT,                       -- 'A' | 'B' | NULL
    enabled       INTEGER NOT NULL DEFAULT 1, -- 0 | 1
    displayOrder  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS responses (
    responseId       TEXT PRIMARY KEY,        -- random anonymous id from the browser
    answers          TEXT NOT NULL,           -- JSON: { questionId: 'A'|'B' }
    matches          INTEGER NOT NULL,
    total            INTEGER NOT NULL,
    sameBrainPercent INTEGER NOT NULL,
    completedAt      TEXT NOT NULL            -- ISO timestamp
  );
`);

// ---- Seeding -------------------------------------------------------------

function seedIfEmpty() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM questions").get();
  if (n > 0) return;

  const seedPath = path.join(ROOT, "data", "questions.json");
  if (!fs.existsSync(seedPath)) return;

  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const list = Array.isArray(raw) ? raw : raw.questions || [];
  const insert = db.prepare(`
    INSERT INTO questions (id, title, answerA, answerB, image, video, creatorAnswer, enabled, displayOrder)
    VALUES (@id, @title, @answerA, @answerB, @image, @video, @creatorAnswer, @enabled, @displayOrder)
  `);
  const tx = db.transaction((items) => {
    items.forEach((q, i) => {
      insert.run({
        id: String(q.id),
        title: String(q.title || ""),
        answerA: String(q.answerA || ""),
        answerB: String(q.answerB || ""),
        image: String(q.image || ""),
        video: String(q.video || ""),
        creatorAnswer: q.creatorAnswer === "A" || q.creatorAnswer === "B" ? q.creatorAnswer : null,
        enabled: q.enabled === false ? 0 : 1,
        displayOrder: Number.isFinite(q.displayOrder) ? q.displayOrder : i + 1,
      });
    });
  });
  tx(list);
  console.log(`Seeded ${list.length} question(s) from data/questions.json`);
}

seedIfEmpty();

// ---- Question queries ----------------------------------------------------

const rowToQuestion = (r) => ({
  id: r.id,
  title: r.title,
  answerA: r.answerA,
  answerB: r.answerB,
  image: r.image || "",
  video: r.video || "",
  creatorAnswer: r.creatorAnswer || null,
  enabled: r.enabled === 1,
  displayOrder: r.displayOrder,
});

export function getEnabledQuestions() {
  return db
    .prepare("SELECT * FROM questions WHERE enabled = 1 ORDER BY displayOrder ASC, rowid ASC")
    .all()
    .map(rowToQuestion);
}

export function getAllQuestions() {
  return db
    .prepare("SELECT * FROM questions ORDER BY displayOrder ASC, rowid ASC")
    .all()
    .map(rowToQuestion);
}

/** Public-safe questions for the quiz (never exposes creatorAnswer). */
export function getPublicQuestions() {
  return getEnabledQuestions().map(({ creatorAnswer, ...pub }) => pub);
}

export function upsertQuestion(q) {
  const existing = db.prepare("SELECT id FROM questions WHERE id = ?").get(q.id);
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
  if (existing) {
    db.prepare(`
      UPDATE questions SET title=@title, answerA=@answerA, answerB=@answerB,
        image=@image, video=@video, creatorAnswer=@creatorAnswer,
        enabled=@enabled, displayOrder=@displayOrder WHERE id=@id
    `).run(data);
  } else {
    db.prepare(`
      INSERT INTO questions (id, title, answerA, answerB, image, video, creatorAnswer, enabled, displayOrder)
      VALUES (@id, @title, @answerA, @answerB, @image, @video, @creatorAnswer, @enabled, @displayOrder)
    `).run(data);
  }
  return rowToQuestion(db.prepare("SELECT * FROM questions WHERE id = ?").get(data.id));
}

export function deleteQuestion(id) {
  return db.prepare("DELETE FROM questions WHERE id = ?").run(id).changes > 0;
}

export function reorderQuestions(orderedIds) {
  const stmt = db.prepare("UPDATE questions SET displayOrder = ? WHERE id = ?");
  const tx = db.transaction((ids) => {
    ids.forEach((id, i) => stmt.run(i + 1, id));
  });
  tx(orderedIds);
}

// ---- Response queries ----------------------------------------------------

/** Insert a response. Duplicate responseId is ignored (dedupe by browser id). */
export function saveResponse(r) {
  const info = db
    .prepare(`
      INSERT OR IGNORE INTO responses (responseId, answers, matches, total, sameBrainPercent, completedAt)
      VALUES (@responseId, @answers, @matches, @total, @sameBrainPercent, @completedAt)
    `)
    .run({
      responseId: r.responseId,
      answers: JSON.stringify(r.answers),
      matches: r.matches,
      total: r.total,
      sameBrainPercent: r.sameBrainPercent,
      completedAt: r.completedAt,
    });
  return info.changes > 0; // false if it was a duplicate
}

/**
 * Aggregate per-question A/B counts across all stored responses.
 * Returns anonymous counts only (safe to expose publicly).
 */
export function getAggregates() {
  const questions = getAllQuestions();
  const counts = Object.fromEntries(questions.map((q) => [q.id, { A: 0, B: 0 }]));

  const rows = db.prepare("SELECT answers FROM responses").all();
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
export function getStats() {
  const total = db.prepare("SELECT COUNT(*) AS n FROM responses").get().n;
  const avgRow = db.prepare("SELECT AVG(sameBrainPercent) AS avg FROM responses").get();
  const avg = avgRow.avg == null ? 0 : Math.round(avgRow.avg);

  // Distribution in 10-point buckets: 0-9, 10-19, ... 100.
  const buckets = Array.from({ length: 11 }, (_, i) => ({
    label: i === 10 ? "100" : `${i * 10}-${i * 10 + 9}`,
    count: 0,
  }));
  const rows = db.prepare("SELECT sameBrainPercent AS p FROM responses").all();
  for (const { p } of rows) {
    const idx = Math.min(10, Math.floor(p / 10));
    buckets[idx].count += 1;
  }

  return { totalResponses: total, averageSameBrain: avg, distribution: buckets };
}

export default db;
