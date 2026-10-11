const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');

// GET all settings
router.get('/', async (req, res) => {
  try {
    const all = await Settings.find();
    const obj = {};
    all.forEach(s => { obj[s.key] = s.value; });
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single setting by key
router.get('/:key', async (req, res) => {
  try {
    const doc = await Settings.findOne({ key: req.params.key });
    if (!doc) return res.json({ value: null });
    res.json({ key: doc.key, value: doc.value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH upsert a setting (create or update)
// Only whitelisted keys are allowed to prevent arbitrary key injection.
const ALLOWED_KEYS = ['weeklyGoal', 'uiCustomization', 'retentionPolicy'];
router.patch('/:key', async (req, res) => {
  try {
    const key = req.params.key;
    if (!ALLOWED_KEYS.includes(key)) {
      return res.status(400).json({ error: `Unknown setting: ${key}. Allowed: ${ALLOWED_KEYS.join(', ')}` });
    }
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    // Validate value type per key
    if (key === 'weeklyGoal') {
      const num = Number(value);
      if (!Number.isFinite(num) || num < 1 || num > 100) {
        return res.status(400).json({ error: 'weeklyGoal must be a number between 1 and 100' });
      }
    } else if (key === 'retentionPolicy') {
      if (typeof value !== 'object' || value === null) {
        return res.status(400).json({ error: 'retentionPolicy must be an object' });
      }
      const hours = Number(value.hours);
      if (!Number.isFinite(hours) || hours < 0) {
        return res.status(400).json({ error: 'retentionPolicy.hours must be non-negative' });
      }
    } else if (key === 'uiCustomization') {
      if (typeof value !== 'object' || value === null) {
        return res.status(400).json({ error: 'uiCustomization must be an object' });
      }
    }

    const doc = await Settings.findOneAndUpdate(
      { key },
      { value },
      { new: true, upsert: true }
    );
    res.json({ key: doc.key, value: doc.value });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
