require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const applicationsRouter = require('./routes/applications');
const tasksRouter = require('./routes/tasks');
const Application = require('./models/Application');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment. Set it in your .env file (local) or Render env vars (production).');
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/applications', applicationsRouter);
app.use('/api/tasks', tasksRouter);

// One-time cleanup: existing applications may have a nextFollowupDate that
// still carries the exact time-of-day they were created at (a past bug),
// which silently delayed "Follow-up Due" until that same clock time each
// day. Normalize every stored date to midnight so today's due items show
// up immediately, without waiting for a fresh Yes/No answer.
async function normalizeFollowupDates() {
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