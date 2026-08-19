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

    res.json({
      total: apps.length,
      byStatus,
      bySource,
      weeks,
      overdueFollowups
    });
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
      status: req.body.status || 'Applied'
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
    const allowed = ['company', 'role', 'source', 'status', 'notes', 'dateApplied', 'portalLink'];
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