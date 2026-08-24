# Job Application Tracker

A full-stack MERN-style web application for tracking job applications, managing follow-ups, and visualizing job search analytics. Built with Node.js, Express, MongoDB (via Mongoose), and a vanilla JavaScript frontend.

**Live motivation:** When you are applying to 30+ companies across different platforms, it is easy to lose track of who responded, who needs a follow-up, and where you stand. This tool solves that with an auto-resetting 3-day follow-up cycle and a visual stats dashboard.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Database Schema](#database-schema)
5. [API Design](#api-design)
6. [Follow-Up Cycle Mechanism](#follow-up-cycle-mechanism)
7. [Frontend Architecture](#frontend-architecture)
8. [Stats and Analytics](#stats-and-analytics)
9. [Key Design Decisions](#key-design-decisions)
10. [Security Considerations](#security-considerations)
11. [Prerequisites](#prerequisites)
12. [Installation](#installation)
13. [MongoDB Atlas Setup](#mongodb-atlas-setup)
14. [Running the App](#running-the-app)
15. [Deployment to Render](#deployment-to-render)
16. [Keyboard Shortcuts](#keyboard-shortcuts)
17. [Known Limitations](#known-limitations)

---

## Tech Stack

| Layer | Technology | Why This Choice |
|---|---|---|
| Runtime | Node.js (>= 18) | Non-blocking I/O, large ecosystem |
| Server | Express 4 | Lightweight, minimal boilerplate for REST APIs |
| Database | MongoDB (Atlas cloud) | Flexible document schema, free tier available |
| ODM | Mongoose 8 | Schema validation, middleware, static methods |
| Frontend | Vanilla JavaScript | No framework overhead, single-page simplicity |
| Charts | Chart.js | Lightweight, doughnut/bar/line chart support |
| Config | dotenv | 12-factor app pattern for secrets management |
| Dev tool | Nodemon | Auto-restart on file changes during development |
| PWA | Service Worker + Manifest | Installable as a home-screen app on mobile/desktop |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                   │
│                                                         │
│  index.html  ──►  app.js  ──►  Chart.js (graphs)       │
│       │              │                                  │
│       │              ├── fetch() to REST API            │
│       │              ├── localStorage (theme, notify)   │
│       │              └── DOM rendering (no framework)   │
│       │                                                 │
│  style.css (CSS variables for dark/light themes)        │
│  sw.js + manifest.json (PWA support)                    │
└───────────────────────┬─────────────────────────────────┘
                        │  HTTP (JSON)
                        ▼
┌─────────────────────────────────────────────────────────┐
│                    SERVER (Express)                      │
│                                                         │
│  server.js                                              │
│    ├── Loads .env via dotenv                            │
│    ├── Connects to MongoDB via Mongoose                 │
│    ├── Serves static files from /public                 │
│    ├── Mounts route modules:                            │
│    │     /api/applications  →  routes/applications.js   │
│    │     /api/tasks         →  routes/tasks.js          │
│    └── Runs one-time follow-up date normalization       │
│                                                         │
│  routes/applications.js                                 │
│    ├── GET    /            → list all (sorted by due)   │
│    ├── GET    /stats       → aggregated analytics       │
│    ├── GET    /calendar    → events with dates          │
│    ├── POST   /            → create new application     │
│    ├── PATCH  /:id         → update fields              │
│    ├── PATCH  /:id/followup → answer follow-up prompt   │
│    └── DELETE /:id         → remove application         │
│                                                         │
│  routes/tasks.js                                        │
│    ├── GET    /            → list all tasks             │
│    ├── POST   /            → create task                │
│    ├── PATCH  /:id         → toggle done / edit         │
│    └── DELETE /:id         → remove task                │
└───────────────────────┬─────────────────────────────────┘
                        │  Mongoose driver
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  MongoDB Atlas (Cloud)                   │
│                                                         │
│  Database: job_tracker                                  │
│    ├── applications collection                          │
│    └── tasks collection                                 │
└─────────────────────────────────────────────────────────┘
```

**Request flow:**
1. User interacts with the UI (adds application, changes status, answers follow-up).
2. `app.js` makes a `fetch()` call to the relevant `/api/...` endpoint.
3. Express route handler validates input, queries MongoDB via Mongoose, and returns JSON.
4. Frontend re-fetches the full list (`loadApps()`) and re-renders the table.

There is no client-side state management library. The source of truth is always the server. Every mutation is followed by a full reload of the data from the API, which keeps things simple and avoids stale-state bugs.

---

## Project Structure

```
job-application-tracker/
├── server.js                    # Entry point: Express setup, MongoDB connection, middleware
├── package.json                 # Dependencies, scripts, engine requirements
├── .env                         # Secrets (MONGODB_URI, PORT) — NOT committed
├── .env.example                 # Template for .env
├── .gitignore                   # Ignores node_modules/ and .env
│
├── models/
│   ├── Application.js           # Mongoose schema + static constants for Application
│   └── Task.js                  # Mongoose schema for Task
│
├── routes/
│   ├── applications.js          # REST routes for applications + stats + calendar
│   └── tasks.js                 # REST routes for tasks
│
└── public/                      # Static frontend (served by Express)
    ├── index.html               # Single HTML page with all sections
    ├── app.js                   # All frontend logic (~3000 lines)
    ├── style.css                # Styles with CSS variables for theming
    ├── sw.js                    # Service worker for PWA offline caching
    └── manifest.json            # PWA manifest (installable app metadata)
```

---

## Database Schema

### Application Schema (`models/Application.js`)

Each document represents one job application.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `company` | String (required) | — | Company name, e.g. "Google" |
| `role` | String | — | Job title, e.g. "Frontend Engineer" |
| `source` | Enum | `"Wellfound"` | Where you found the job (see SOURCE_VALUES) |
| `dateApplied` | Date | `Date.now` | When you applied |
| `status` | Enum | `"Applied"` | Current stage (see STATUS_VALUES) |
| `notes` | String | — | Free-text notes, supports URLs (auto-linkified) |
| `portalLink` | String | — | URL to the company's candidate status portal |
| `priority` | Boolean | `false` | Star/dream-company flag |
| `eventDate` | Date | `null` | Optional: interview slot or OA deadline date |
| `eventLabel` | String | `""` | Optional: label for the event, e.g. "Technical Interview" |
| `nextFollowupDate` | Date | `today + 3 days` | When the next follow-up is due |
| `followedUpLast` | Boolean | `null` | Whether the last follow-up was answered "Yes" |
| `followupCount` | Number | `0` | Total number of follow-up cycles completed |
| `createdAt` | Date | auto | Mongoose `timestamps: true` |
| `updatedAt` | Date | auto | Mongoose `timestamps: true` |

**Status values:** `Applied`, `Under Consideration`, `OA/Task Pending`, `Interview Scheduled`, `Interviewed`, `Offer`, `Rejected`, `No Response`, `Ghosted`

**Source values:** `Wellfound`, `Naukri`, `Internshala`, `HiringCafe`, `Company site`, `Cold email`, `LinkedIn`, `Referral`, `Other`

### Task Schema (`models/Task.js`)

Each document represents one to-do task.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `title` | String (required) | — | Task description, e.g. "Fill Google form" |
| `date` | Date (required) | — | When the task is due |
| `done` | Boolean | `false` | Whether the task is completed |
| `notes` | String | `""` | Optional notes |
| `createdAt` | Date | auto | Timestamps |
| `updatedAt` | Date | auto | Timestamps |

---

## API Design

### Applications

#### `GET /api/applications`

Returns all applications sorted by `nextFollowupDate` ascending (earliest due first).

**Response:**
```json
[
  {
    "_id": "66a1b2c3d4e5f6a7b8c9d0e1",
    "company": "Google",
    "role": "SDE-2",
    "source": "LinkedIn",
    "dateApplied": "2026-08-15T00:00:00.000Z",
    "status": "Interview Scheduled",
    "notes": "System design round on 25th",
    "portalLink": "https://careers.google.com/status/abc",
    "priority": true,
    "eventDate": "2026-08-25T10:00:00.000Z",
    "eventLabel": "Technical Phone Screen",
    "nextFollowupDate": "2026-08-23T00:00:00.000Z",
    "followedUpLast": true,
    "followupCount": 3,
    "createdAt": "2026-08-15T08:30:00.000Z",
    "updatedAt": "2026-08-20T14:00:00.000Z"
  }
]
```

#### `GET /api/applications/stats`

Returns aggregated analytics for the dashboard. No request parameters needed.

**Response:**
```json
{
  "total": 45,
  "byStatus": {
    "Applied": 12,
    "OA/Task Pending": 5,
    "Interview Scheduled": 3,
    "Interviewed": 4,
    "Offer": 1,
    "Rejected": 8,
    "No Response": 7,
    "Ghosted": 3,
    "Under Consideration": 2
  },
  "bySource": {
    "LinkedIn": 15,
    "Referral": 8,
    "Wellfound": 6,
    "Naukri": 5,
    "Company site": 4,
    "Cold email": 3,
    "Internshala": 2,
    "HiringCafe": 1,
    "Other": 1
  },
  "weeks": [
    { "label": "7/28", "count": 5 },
    { "label": "8/4", "count": 8 }
  ],
  "overdueFollowups": 6,
  "funnel": {
    "applied": 45,
    "responded": 19,
    "interview": 8,
    "offer": 1
  },
  "sourceSuccess": {
    "Referral": { "total": 8, "interviewed": 5, "pct": 63 }
  },
  "avgResponseDays": 5,
  "responseTimeByCompany": [
    { "company": "Stripe", "avgDays": 2 },
    { "company": "Google", "avgDays": 7 }
  ],
  "priorityCount": 10,
  "nonPriorityCount": 35
}
```

**How stats are computed (important for interviews):**

- **`byStatus` / `bySource`:** Simple group-by counts across all documents.
- **`weeks`:** Last 8 calendar weeks. For each week, count applications where `dateApplied` falls within that week's range.
- **`overdueFollowups`:** Applications where `status` is NOT `Rejected` or `Offer` AND `nextFollowupDate <= now`.
- **`funnel`:** A conversion pipeline: `Applied` (all) -> `Responded` (anything past "Applied") -> `Interview` (reached interview stage) -> `Offer`.
- **`sourceSuccess`:** For each source, what percentage of applications reached at least an interview stage.
- **`avgResponseDays`:** Average days between `dateApplied` and `updatedAt` for applications that have moved past "Applied" status.

#### `GET /api/applications/calendar`

Returns applications that have an `eventDate` set, sorted by date. Used for a calendar/events view.

**Response:**
```json
[
  {
    "id": "66a1b2c3d4e5f6a7b8c9d0e1",
    "company": "Google",
    "role": "SDE-2",
    "eventDate": "2026-08-25T10:00:00.000Z",
    "eventLabel": "Technical Phone Screen",
    "status": "Interview Scheduled"
  }
]
```

#### `POST /api/applications`

Creates a new application.

**Request body:**
```json
{
  "company": "Google",
  "role": "SDE-2",
  "source": "LinkedIn",
  "notes": "Referred by John",
  "portalLink": "https://...",
  "priority": true,
  "eventDate": "2026-08-25T10:00:00.000Z",
  "eventLabel": "OA Round"
}
```

Only `company` is required. Everything else has defaults. Returns the created document with status `201`.

#### `PATCH /api/applications/:id`

Updates specific fields on an application. Uses an allowlist to prevent arbitrary field modification.

**Allowed fields:** `company`, `role`, `source`, `status`, `notes`, `dateApplied`, `portalLink`, `priority`, `eventDate`, `eventLabel`

**Request body (partial update):**
```json
{
  "status": "Interview Scheduled",
  "notes": "Scheduled for Aug 25"
}
```

Returns the updated document.

#### `PATCH /api/applications/:id/followup`

Answers the follow-up prompt and rolls the cycle forward.

**Request body:**
```json
{
  "answered": true
}
```

**What happens internally:**
1. `followedUpLast` is set to the boolean value (`true` = yes, `false` = no).
2. `followupCount` is incremented by 1.
3. `nextFollowupDate` is reset to `today + 3 days` (normalized to midnight).

This means whether the user followed up or not, the next reminder is scheduled 3 days from now. The `followedUpLast` and `followupCount` fields track the history.

#### `DELETE /api/applications/:id`

Deletes an application. Returns `{ "ok": true }`.

---

### Tasks

#### `GET /api/tasks`

Returns all tasks sorted by date ascending.

#### `POST /api/tasks`

**Request body:**
```json
{
  "title": "Apply to Stripe",
  "date": "2026-08-23T00:00:00.000Z",
  "notes": "Use referral link"
}
```

#### `PATCH /api/tasks/:id`

**Allowed fields:** `title`, `date`, `done`, `notes`

Common use case — toggle task completion:
```json
{ "done": true }
```

#### `DELETE /api/tasks/:id`

Deletes a task. Returns `{ "ok": true }`.

---

## Follow-Up Cycle Mechanism

This is the core differentiating feature of the application. Here is exactly how it works:

```
 Application Created
        │
        ▼
 nextFollowupDate = today + 3 days (normalized to midnight)
        │
        │  ... 3 days pass ...
        │
        ▼
 nextFollowupDate <= today?
        │
    ┌───┴───┐
    │       │
   NO      YES
    │       │
    ▼       ▼
 Show     Show "Followed up?"
 date     Yes / No prompt
              │
         ┌────┴────┐
         │         │
        Yes        No
         │         │
         ▼         ▼
     followedUpLast = true/false
     followupCount += 1
     nextFollowupDate = today + 3 days (RESET)
              │
              ▼
         Cycle repeats
              │
              ▼
         Stops ONLY when status = "Rejected" or "Offer"
```

**Key implementation details:**

1. **Midnight normalization:** `nextFollowupDate` is always set to `00:00:00.000` of the target day. This ensures that on the due date, the follow-up shows as "due" for the entire day, not just after the exact time it was created. This was a bug fix — originally the time-of-day was preserved, which caused the "due" indicator to appear late in the day.

2. **Backend enforcement:** The follow-up logic lives in `routes/applications.js`. The `PATCH /:id/followup` endpoint handles the cycle reset. The frontend simply sends `{ answered: true/false }` and reloads the data.

3. **Sorting:** Applications are sorted by `nextFollowupDate` ascending, so overdue items appear at the top.

4. **Browser notifications:** The frontend checks every 60 seconds if any applications are overdue. If `Notification.permission === 'granted'`, it sends a browser notification. Notifications are deduplicated using a `localStorage` key of `{appId}:{nextFollowupDate}` so the same follow-up is not notified twice.

5. **Termination:** Once an application's status is set to `Offer` or `Rejected`, the follow-up prompt stops appearing (the frontend skips these statuses in `isOverdue()`).

---

## Frontend Architecture

The frontend is a single `index.html` page with all logic in `app.js`. There is no build step, no bundler, no framework.

### Key patterns:

**Data flow:**
- `loadApps()` fetches `GET /api/applications` and stores the result in the global `apps` array.
- `loadStats()` fetches `GET /api/applications/stats` and passes the result to chart renderers.
- Every mutation (add, update, delete, follow-up) is followed by calling `loadApps()` to re-sync with the server.
- `render()` is the main render function that applies filters, search, sorting, and pagination to `apps` and rebuilds the table DOM.

**Theming:**
- CSS variables (`--ink`, `--bg`, `--card`, `--line`, etc.) are defined in `style.css`.
- A `.dark` class on `<body>` overrides these variables.
- Theme preference is persisted in `localStorage` under `jt-theme`.
- Charts are re-rendered on theme change to pick up the new CSS variable colors.

**Pagination:**
- Client-side pagination with `PAGE_SIZE = 8`.
- `currentPage` tracks the active page; `render()` slices the filtered list.

**Notifications:**
- Uses the browser `Notification` API.
- Permission is requested via a button in the notification panel.
- Follow-up reminders are checked every 60 seconds via `setInterval`.
- Deduplication via `localStorage` key: `{appId}:{nextFollowupDate}`.

**Keyboard shortcuts:**
- `N` — Focus new application form
- `/` — Focus search box
- `D` — Toggle dark mode
- `R` — Refresh data
- `?` — Show shortcut help
- `Escape` — Close any open panel/modal

**Inline editing:**
- Status changes happen via a `<select>` dropdown directly in the table row. Changing the dropdown triggers a `PATCH` request immediately — no save button needed.
- Notes are clickable and open a textarea for inline editing.
- Star/priority is toggled via a button click that sends a `PATCH` request.

**Charts (Chart.js):**

| Chart | Type | Data Source |
|---|---|---|
| By Status | Doughnut | `stats.byStatus` |
| By Source | Bar | `stats.bySource` |
| Applications per Week | Line | `stats.weeks` |
| Conversion Funnel | Horizontal bar | `stats.funnel` |
| Interview Rate by Source | Bar | `stats.sourceSuccess` |

Charts are destroyed and re-created on every render cycle (`charts.status.destroy()` etc.) to avoid memory leaks. A debounced `resize` listener re-renders charts when the window size changes.

---

## Stats and Analytics

The `/api/applications/stats` endpoint computes several derived metrics:

### Conversion Funnel

Tracks how far applications typically progress:

```
Applied (all) ──► Responded (past "Applied") ──► Interview (reached interview) ──► Offer
```

- **Responded** = status is one of: `Under Consideration`, `OA/Task Pending`, `Interview Scheduled`, `Interviewed`, `Offer`
- **Interview** = status is one of: `Interview Scheduled`, `Interviewed`, `Offer`
- **Offer** = status is `Offer`

### Source Success Rate

For each source, calculate what percentage of applications reached at least an interview stage. This helps identify which platforms yield the best results.

### Average Response Time

For applications that have moved past "Applied", calculate the number of days between `dateApplied` and `updatedAt` (last status change). Grouped by company and also averaged overall.

### Weekly Activity

Applications per week for the last 8 calendar weeks. Uses `dateApplied` to bucket applications into week ranges starting from Sunday.

---

## Key Design Decisions

### Why no frontend framework?

The UI is relatively simple — one table, some charts, a form. Using vanilla JS avoids build-tool complexity (Webpack, Vite, etc.) and keeps the project easy to understand and deploy. The `app.js` file is large (~3000 lines) but each section is clearly separated with comment headers.

### Why full reload after every mutation?

After any create/update/delete/follow-up, the frontend calls `loadApps()` which fetches the entire list from the server. This is a deliberate simplicity-over-performance tradeoff. For a personal-use tool with tens or low hundreds of applications, the network overhead is negligible, and it eliminates an entire class of client-state-synchronization bugs.

### Why PATCH instead of PUT?

The update endpoint uses `PATCH` because it only modifies the fields included in the request body. The server uses an allowlist of field names to filter the input, so clients cannot modify internal fields like `followupCount` or `nextFollowupDate` through the general update endpoint (those are only modified through the dedicated `/followup` endpoint).

### Why normalize dates to midnight?

The `threeDaysFromNow()` function sets hours, minutes, and seconds to `0, 0, 0, 0`. This was a bug fix: previously, if an application was created at 2:30 PM, the follow-up would only show as "due" after 2:30 PM on the target day, not at the start of the day. Normalizing to midnight ensures the follow-up prompt appears immediately at the start of the due date.

### Why client-side stats computation?

The stats endpoint does all aggregation in JavaScript (after fetching all documents from MongoDB) rather than using MongoDB's aggregation pipeline. This is simpler to understand and maintain, and performs well for the expected data volume (hundreds, not millions, of documents).

---

## Security Considerations

1. **`.env` is gitignored** — The MongoDB URI containing credentials is never committed to version control.
2. **Mongoose validation** — The schema uses `enum` constraints for `status` and `source`, so invalid values are rejected at the database level.
3. **Input allowlisting** — The PATCH endpoint only accepts specific field names, preventing clients from modifying protected fields.
4. **No authentication** — This is a personal-use tool. For multi-user use, you would need to add authentication middleware.
5. **CORS enabled** — `cors()` middleware is used, which is appropriate for development and single-user deployment. For production multi-user use, you would want to restrict the allowed origins.

---

## Prerequisites

| Requirement | Version | Check Command |
|---|---|---|
| Node.js | >= 18 | `node --version` |
| npm | >= 9 (bundled with Node) | `npm --version` |
| MongoDB Atlas account | Free tier (M0) | [Sign up](https://www.mongodb.com/atlas) |

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/job-application-tracker.git
cd job-application-tracker
```

### 2. Install dependencies

```bash
npm install
```

This installs:
- **express** — HTTP server and routing
- **mongoose** — MongoDB object-document mapper
- **dotenv** — Loads `.env` variables into `process.env`
- **cors** — Enables cross-origin requests
- **nodemon** (dev dependency) — Auto-restarts server on file changes

### 3. Create the `.env` file

```bash
cp .env.example .env
```

Or manually create `.env` in the project root:

```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/job_tracker?retryWrites=true&w=majority
PORT=3000
```

See the [MongoDB Atlas Setup](#mongodb-atlas-setup) section below for how to get this URI.

### 4. Start the server

Development mode (auto-restart on changes):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### 5. Open in browser

```
http://localhost:3000
```

---

## MongoDB Atlas Setup

Step-by-step guide to get your connection string:

### Step 1: Create a free account

Go to [https://www.mongodb.com/atlas](https://www.mongodb.com/atlas) and sign up.

### Step 2: Create a cluster

1. Click **"Build a Database"**
2. Select **M0 Sandbox** (free, no credit card required)
3. Choose a cloud provider and region close to you
4. Click **"Create"**

### Step 3: Create a database user

1. Go to **Database Access** in the left sidebar
2. Click **"Add New Database User"**
3. Authentication method: **Password (SCRAM)**
4. Set a username (e.g., `trackerUser`) and a strong password
5. Privileges: **Read and write to any database**
6. Click **"Add User"**

### Step 4: Whitelist your IP

1. Go to **Network Access** in the left sidebar
2. Click **"Add IP Address"**
3. Click **"Allow Access from Anywhere"** (adds `0.0.0.0/0`)
4. Click **"Confirm"**

Wait 1-2 minutes for the rule to propagate.

### Step 5: Get the connection string

1. Go to **Database** in the left sidebar
2. Click **"Connect"** on your cluster
3. Select **"Connect your application"**
4. Set Driver to **Node.js**, Version to **4.1 or later**
5. Copy the connection string

### Step 6: Update your `.env`

The copied string looks like:
```
mongodb+srv://trackerUser:MySecure123!@cluster0.abc123.mongodb.net/?retryWrites=true&w=majority
```

Insert your database name (`job_tracker`) before the `?`:
```
MONGODB_URI=mongodb+srv://trackerUser:MySecure123!@cluster0.abc123.mongodb.net/job_tracker?retryWrites=true&w=majority
```

You do **not** need to manually create the `job_tracker` database. MongoDB creates it automatically when the first document is inserted.

---

## Deployment to Render

1. Push the project to a GitHub repository (`.env` is excluded by `.gitignore`)
2. Go to [render.com](https://render.com) -> **New** -> **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Under **Environment Variables**, add:
   - `MONGODB_URI` = your full Atlas connection string
6. Click **Deploy**

Render provides a live URL. Environment variables are configured through Render's dashboard, not through a `.env` file.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `N` | Open new application form and focus the company field |
| `/` | Focus the search box |
| `D` | Toggle dark/light mode |
| `R` | Refresh all data from server |
| `?` | Show keyboard shortcut help |
| `Escape` | Close any open panel or modal |

---

## Known Limitations

1. **No authentication** — Anyone with the URL can view and modify data. Suitable for personal use only.
2. **No pagination on server** — The API returns all documents. Fine for hundreds of records, but would need server-side pagination at scale.
3. **Client-side filtering** — Search and filter happen in the browser after all data is loaded. A large dataset would benefit from server-side filtering.
4. **No real-time updates** — If the app is open in multiple tabs, changes in one tab are not reflected in another until a manual refresh.
5. **No data export** — No CSV/PDF export functionality yet.
6. **Service worker is basic** — The PWA service worker caches static assets but does not implement offline-first data access.

---

> Built with Node.js, Express, MongoDB, and vanilla JavaScript.
