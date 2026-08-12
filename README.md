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
- **SQLite** (via `better-sqlite3`) — a single file on disk, zero external services.
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

By default the SQLite file lives at `data/responses.db`. To change it, set `DB_PATH`
(absolute or relative to the project root) in `.env` or your host’s environment:

```
DB_PATH=/var/data/dydtt.db
```

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

## Deploy it

It’s a standard Node web app; any host that runs Node works. General steps:

1. Push this repo to your host (or connect it to GitHub).
2. Set environment variables: `ADMIN_PASSWORD` (and optionally `ADMIN_USER`,
   `PORT`, `DB_PATH`).
3. Build/start command: `npm install` then `npm start`.
4. Make sure the SQLite file lives on **persistent** storage. On hosts with an
   ephemeral filesystem, attach a persistent disk/volume and point `DB_PATH` at it,
   otherwise stored responses reset on redeploy.

Good low-cost fits: a small VPS, [Render](https://render.com),
[Railway](https://railway.app), or [Fly.io](https://fly.io) (each supports a
persistent volume for the database). A serverless/static-only host is not ideal here
because of the SQLite file and admin API.

---

## Privacy & scope

See `/privacy` in the app. In short: entertainment only; not medical or diagnostic;
responses are anonymous and used only to compute results and aggregate stats; no
identifying or health information is intentionally collected; no accounts, logins,
ads, tracking pixels or analytics. A single random ID is kept in the browser to avoid
double-counting the same device — it is not a fingerprint.

## License

MIT.
