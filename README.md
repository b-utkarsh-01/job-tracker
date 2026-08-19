# Job Application Tracker

MongoDB-backed tracker: companies, sources, status, and a follow-up cycle that
resets every 3 days (instead of a fixed date) via a Yes/No prompt. Includes
status/source/weekly stat graphs.

## Run locally

1. `npm install`
2. Copy `.env.example` to `.env` and put your real MongoDB URI in it:
   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/job_tracker
   ```
   **Never commit `.env` to git** — it's already in `.gitignore`.
3. `npm run dev` (or `npm start`)
4. Open http://localhost:3000

## Deploy to Render

1. Push this project to a GitHub repo (`.env` will be excluded automatically).
2. On Render: **New → Web Service**, connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Under **Environment**, add:
   - `MONGODB_URI` = your Atlas connection string
   - (Render sets `PORT` automatically, no need to add it)
6. Deploy. Render will give you a live URL.

## How the follow-up cycle works

- Every application gets a `nextFollowupDate`, starting 3 days after you add it.
- Once that date passes, the row shows a **Yes/No "Followed up?"** prompt instead of a date.
- Whichever you pick, `nextFollowupDate` rolls forward another 3 days — so it
  keeps nudging you every 3 days until the application is marked **Rejected** or **Offer**.

## Status options

Applied · OA/Task Pending · Interview Scheduled · Interviewed · Offer · Rejected · No Response · Ghosted

## Security note

The MongoDB URI you shared in chat contains a live username/password. Since
it's now in this conversation's history, consider rotating the database
password in Atlas (Database Access → Edit user → Edit password) once you're
set up, especially before making any repo containing it public.
