# Do You Do This Too?

A small, polished, mobile-first web app for a light-hearted A/B questionnaire that
compares everyday habits between friends. You answer a series of “do you do A or B?”
questions, then see how many of your answers matched the creator’s answers (a
**same-brain score**) alongside anonymous aggregate stats.

> **This is not a medical or diagnostic tool.** It is not an ADHD test, screening
> tool or diagnostic questionnaire. It never diagnoses anything, never calculates an
> ADHD probability, and never labels anyone. The “same-brain score” is just a fun
> count of matching answers.

## What’s in the box

| Concern | File(s) |
| --- | --- |
| Questionnaire content (seed) | `data/questions.json` |
| UI (pages, styles, behaviour) | `public/` |
| Scoring logic | `lib/scoring.js` |
| Storage (SQLite) | `lib/db.js` |
| HTTP server + API | `server.js` |
| Admin dashboard | `public/admin.html`, `public/admin.js`, `public/admin.css` |

The pieces are intentionally separate so you can edit content, look, scoring and
storage independently.

## Tech

- **Node.js + Express** — one small server, no framework on the front end.
- **libSQL / SQLite** (via `@libsql/client`) — a single local file in development,
  and a free [Turso](https://turso.tech) cloud database in production. Same code
  either way; you switch by setting environment variables.
- **Vanilla HTML/CSS/JS** front end — no build step.

---

## Run it locally

You need [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
cp .env.example .env      # then edit .env and set ADMIN_PASSWORD
npm start
```

Open <http://localhost:3000>. The admin dashboard is at <http://localhost:3000/admin>.

For auto-reload while developing: `npm run dev`.

On the **first run**, the database (`data/responses.db`) is created and seeded with
the five sample questions from `data/questions.json` so you can try the whole flow
straight away.

---

## Change the questions

There are two ways, and they work together:

### 1. The seed file (bulk editing before launch)

Edit `data/questions.json`. Each question supports:

| Field | Meaning |
| --- | --- |
| `id` | Short unique key (letters, numbers, `-`, `_`). Used to store answers. |
| `title` | The question text. |
| `answerA` | Text for the A card. |
| `answerB` | Text for the B card. |
| `image` | Optional image URL (`""` for none). |
| `video` | Optional video URL (`""` for none). |
| `creatorAnswer` | **Your** answer: `"A"`, `"B"`, or `null`. Never shown to respondents. |
| `enabled` | `true`/`false` — disabled questions are hidden from the quiz. |
| `displayOrder` | Number controlling order (low to high). |

The seed file is **only read to populate an empty database**. To re-seed after
editing it, stop the app, delete `data/responses.db` (this also deletes stored
responses), and start again.

### 2. The admin page (live editing, any time)

Once running, go to `/admin` → **Manage questions** to add, edit, disable, delete
and reorder questions, and to change your own creator answer — no code or restart
needed. This is the recommended way to manage questions after launch.

> **A and B have no built-in meaning.** Nothing assumes A or B represents anything.
> You can swap the two answer cards or reorder questions freely; scoring only ever
> compares a respondent’s answer to *your saved answer* for that question.

## Set your creator answers

Your answer to each question is the `creatorAnswer` field. Set it in
`data/questions.json` before first run, or change it any time from
**/admin → Manage questions → Edit**. It is stored server-side and is **never** sent
to respondents’ browsers.

## Add images and videos

Set the `image` and/or `video` field on a question (in the seed file or the admin
editor). Both are optional and the layout looks good with neither.

- **Images:** any public `https://` image URL. Alt text falls back to the question title.
- **Videos:** a YouTube or Vimeo link (auto-converted to a privacy-light embed), or a
  direct video file URL (e.g. `https://…/clip.mp4`) which is shown in an accessible
  `<video>` player with controls. Only `http(s)` URLs are allowed.

For captions/transcripts on direct video files, host a `.vtt` track alongside the
video or add a transcript in the question text.

## Configure the database

The app talks to one database interface (libSQL) in two modes:

- **Local development (default):** a SQLite file at `data/responses.db`. Nothing to
  configure. To change the location, set `DB_PATH` (relative to the project root):
  ```
  DB_PATH=./data/responses.db
  ```
- **Production:** a free **Turso** cloud database, so your data survives restarts and
  redeploys. Set two environment variables (leave `DB_PATH` unused):
  ```
  DATABASE_URL=libsql://your-db-name-you.turso.io
  DATABASE_AUTH_TOKEN=your-turso-auth-token
  ```
  Getting these takes about two minutes — see **Deploy it (free)** below.

The database stores, per response: a **random anonymous response ID**, the A/B
answers, the completion timestamp, and the same-brain percentage. No names, emails,
phone numbers, dates of birth or health information are collected.

## Set the admin password

The `/admin` area uses HTTP Basic Auth. Set these in `.env` (local) or as environment
variables on your host:

```
ADMIN_PASSWORD=a-long-private-password   # required to enable /admin
ADMIN_USER=admin                         # optional, defaults to "admin"
```

If `ADMIN_PASSWORD` is not set, the admin area is disabled entirely. Choose a long,
unique password and don’t commit your real `.env`.

## View results

Go to `/admin` and sign in. You’ll see:

- **Overview:** total completed questionnaires, average same-brain score, and a
  distribution chart of scores.
- **Results by question:** for every question, total and percentage of A vs B
  responses, with your own answer marked (★).
- **Manage questions:** add / edit / disable / delete / reorder, and change your
  creator answer.

---

## Deploy it (free)

This deploys for **free** and keeps your collected responses safe, using two free
services: **Turso** (the cloud database) and **Render** (runs the app). No credit
card required. Total time: about 10 minutes.

### Step 1 — Create the free database (Turso)

1. Sign up at <https://turso.tech> (free “Starter” plan).
2. Install the CLI and create a database. On Mac/Linux:
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth login
   turso db create do-you-do-this-too
   ```
   (No terminal? You can also create the database from the Turso web dashboard.)
3. Get the two values you’ll need:
   ```bash
   turso db show do-you-do-this-too --url          # → DATABASE_URL  (libsql://…)
   turso db tokens create do-you-do-this-too       # → DATABASE_AUTH_TOKEN
   ```
   Keep these two strings handy for the next step.

### Step 2 — Deploy the app (Render)

1. Push this repo to your own GitHub account (or fork it).
2. Sign up at <https://render.com> (free plan) and click **New + → Blueprint**.
3. Connect this repository. Render reads the included `render.yaml` and creates the
   web service automatically.
4. When prompted, fill in the three environment variables:
   - `ADMIN_PASSWORD` — a long, private password for your `/admin` area.
   - `DATABASE_URL` — the `libsql://…` URL from Step 1.
   - `DATABASE_AUTH_TOKEN` — the token from Step 1.
5. Click **Apply / Deploy**. When it finishes, Render gives you a public URL like
   `https://do-you-do-this-too.onrender.com`. Share that link — the admin dashboard
   is at `…/admin`.

That’s it. Your questions and everyone’s responses live in Turso, so they’re never
lost when the app restarts.

> **Free-plan note:** Render’s free web service “sleeps” after ~15 minutes of no
> traffic, so the very first visit after a quiet spell can take ~30–50 seconds to
> wake up. Your data is unaffected (it’s in Turso). If you later want it always-on
> and instant, upgrading Render to a paid instance is the only change needed — no
> code changes.

### Deploying somewhere else

It’s a standard Node app (`npm install`, then `npm start`, reads `PORT` from the
environment), so [Railway](https://railway.app), [Fly.io](https://fly.io) or a small
VPS work too. Just set `ADMIN_PASSWORD`, `DATABASE_URL` and `DATABASE_AUTH_TOKEN`
(and optionally `ADMIN_USER`). You can point `DATABASE_URL` at the same Turso
database from any host.

---

## Privacy & scope

See `/privacy` in the app. In short: entertainment only; not medical or diagnostic;
responses are anonymous and used only to compute results and aggregate stats; no
identifying or health information is intentionally collected; no accounts, logins,
ads, tracking pixels or analytics. A single random ID is kept in the browser to avoid
double-counting the same device — it is not a fingerprint.

## License

MIT.
