require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const applicationsRouter = require('./routes/applications');
const tasksRouter = require('./routes/tasks');
const settingsRouter = require('./routes/settings');
const linksRouter = require('./routes/links');
const Application = require('./models/Application');
const Link = require('./models/Link');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// ============================================================
// Simple in-memory rate limiter
// ============================================================
const rateLimitStore = new Map();
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_MAX = 120;             // max requests per window
function rateLimiter(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const record = rateLimitStore.get(key);
  if (!record || now - record.start > RATE_WINDOW_MS) {
    rateLimitStore.set(key, { start: now, count: 1 });
    return next();
  }
  record.count++;
  if (record.count > RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
}
// Evict stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore) {
    if (now - record.start > RATE_WINDOW_MS * 2) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment. Set it in your .env file (local) or Render env vars (production).');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(rateLimiter);
// Serve public files, but force reload for the sidebar scripts so a normal
// refresh always gets the latest version (avoids stale icon rendering).
const publicMiddleware = express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    const name = path.basename(filePath);
    if (name === 'joblinks.js' || name === 'joblinks-icons.js') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
});
app.use(publicMiddleware);

app.use('/api/applications', applicationsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/links', linksRouter);

// One-time cleanup: existing applications may have a nextFollowupDate that
// still carries the exact time-of-day they were created at (a past bug),
// which silently delayed "Follow-up Due" until that same clock time each
// day. Normalize every stored date to midnight so today's due items show
// up immediately, without waiting for a fresh Yes/No answer.
// Uses a Settings document to track whether cleanup already ran, so it
// only executes once across server restarts.
async function normalizeFollowupDates() {
  const Settings = require('./models/Settings');
  const flag = await Settings.findOne({ key: 'followupDatesNormalized' });
  if (flag && flag.value === true) return; // already done

  const apps = await Application.find({});
  let fixed = 0;
  for (const a of apps) {
    if (!a.nextFollowupDate) continue;
    const d = new Date(a.nextFollowupDate);
    if (d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0) {
      d.setHours(0, 0, 0, 0);
      a.nextFollowupDate = d;
      await a.save();
      fixed++;
    }
  }
  // Mark as done so it never runs again
  await Settings.findOneAndUpdate(
    { key: 'followupDatesNormalized' },
    { value: true },
    { upsert: true }
  );
  if (fixed) console.log(`Normalized nextFollowupDate on ${fixed} existing application(s).`);
}

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await normalizeFollowupDates().catch(err => console.error('Follow-up date cleanup failed:', err.message));
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });