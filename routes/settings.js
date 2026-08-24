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
router.patch('/:key', async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });

    const doc = await Settings.findOneAndUpdate(
      { key: req.params.key },
      { value },
      { new: true, upsert: true }
    );
    res.json({ key: doc.key, value: doc.value });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
