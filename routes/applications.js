const express = require('express');
const router = express.Router();
const Application = require('../models/Application');

function threeDaysFromNow() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d;
}

// GET all applications
router.get('/', async (req, res) => {
  try {
    const apps = await Application.find().sort({ nextFollowupDate: 1 });
    res.json(apps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET stats for graphs
router.get('/stats', async (req, res) => {
  try {
    const apps = await Application.find();

    const byStatus = {};
    Application.STATUS_VALUES.forEach(s => (byStatus[s] = 0));
    apps.forEach(a => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });

    const bySource = {};
    Application.SOURCE_VALUES.forEach(s => (bySource[s] = 0));
    apps.forEach(a => { bySource[a.source] = (bySource[a.source] || 0) + 1; });

    // applications per week (last 8 weeks)
    const weeks = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - i * 7 - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const count = apps.filter(a => a.dateApplied >= weekStart && a.dateApplied < weekEnd).length;
      weeks.push({ label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`, count });
    }

    const overdueFollowups = apps.filter(a =>
      !['Rejected', 'Offer'].includes(a.status) && new Date(a.nextFollowupDate) <= now
    ).length;

    // Conversion funnel: how far applications typically progress.
    // "Responded" = anything past the raw Applied stage (something happened).
    // "Interview" = reached or passed an interview stage.
    // "Offer" = final positive outcome.
    const respondedStatuses = ['Under Consideration', 'OA/Task Pending', 'Interview Scheduled', 'Interviewed', 'Offer'];
    const interviewStatuses = ['Interview Scheduled', 'Interviewed', 'Offer'];
    const funnel = {
      applied: apps.length,
      responded: apps.filter(a => respondedStatuses.includes(a.status)).length,
      interview: apps.filter(a => interviewStatuses.includes(a.status)).length,
      offer: apps.filter(a => a.status === 'Offer').length
    };

    // Source-wise success rate: of everything applied through a source,
    // what % reached at least an interview stage.
    const sourceSuccess = {};
    Application.SOURCE_VALUES.forEach(s => { sourceSuccess[s] = { total: 0, interviewed: 0, pct: 0 }; });
    apps.forEach(a => {
      const bucket = sourceSuccess[a.source];
      if (!bucket) return;
      bucket.total += 1;
      if (interviewStatuses.includes(a.status)) bucket.interviewed += 1;
    });
    Object.values(sourceSuccess).forEach(b => {
      b.pct = b.total ? Math.round((b.interviewed / b.total) * 100) : 0;
    });

    // Average response time: days between applying and the last status
    // change (updatedAt), for applications that have moved past "Applied".
    // Grouped by company so slow/fast responders are visible.
    const responded = apps.filter(a => a.status !== 'Applied' && a.dateApplied && a.updatedAt);
    const byCompanyDays = {};
    responded.forEach(a => {
      const days = Math.max(0, Math.round((new Date(a.updatedAt) - new Date(a.dateApplied)) / (1000 * 60 * 60 * 24)));
      if (!byCompanyDays[a.company]) byCompanyDays[a.company] = [];
      byCompanyDays[a.company].push(days);
    });
    const responseTimeByCompany = Object.entries(byCompanyDays)
      .map(([company, days]) => ({
        company,
        avgDays: Math.round(days.reduce((s, d) => s + d, 0) / days.length)
      }))
      .sort((a, b) => a.avgDays - b.avgDays);
    const avgResponseDays = responseTimeByCompany.length
      ? Math.round(responseTimeByCompany.reduce((s, c) => s + c.avgDays, 0) / responseTimeByCompany.length)
      : null;

    res.json({
      total: apps.length,
      byStatus,
      bySource,
      weeks,
      overdueFollowups,
      funnel,
      sourceSuccess,
      avgResponseDays,
      responseTimeByCompany
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET calendar events (interview slots / OA deadlines)
router.get('/calendar', async (req, res) => {
  try {
    const apps = await Application.find({ eventDate: { $ne: null } }).sort({ eventDate: 1 });
    res.json(apps.map(a => ({
      id: a._id,
      company: a.company,
      role: a.role,
      eventDate: a.eventDate,
      eventLabel: a.eventLabel,
      status: a.status
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create new application
router.post('/', async (req, res) => {
  try {
    const app = new Application({
      company: req.body.company,
      role: req.body.role,
      source: req.body.source,
      dateApplied: req.body.dateApplied || Date.now(),
      notes: req.body.notes,
      portalLink: req.body.portalLink,
      status: req.body.status || 'Applied',
      priority: !!req.body.priority,
      eventDate: req.body.eventDate || null,
      eventLabel: req.body.eventLabel || ''
    });
    await app.save();
    res.status(201).json(app);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH update status / notes / role etc.
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['company', 'role', 'source', 'status', 'notes', 'dateApplied', 'portalLink', 'priority', 'eventDate', 'eventLabel'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    const app = await Application.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!app) return res.status(404).json({ error: 'Not found' });
    res.json(app);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH answer the "did you follow up?" prompt -> rolls the cycle forward 3 days
router.patch('/:id/followup', async (req, res) => {
  try {
    const { answered } = req.body; // boolean: true = yes, false = no
    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Not found' });

    app.followedUpLast = !!answered;
    app.followupCount += 1;
    app.nextFollowupDate = threeDaysFromNow();
    await app.save();
    res.json(app);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await Application.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;