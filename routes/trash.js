const express = require('express');
const router = express.Router();
const Trash = require('../models/Trash');
const History = require('../models/History');
const Application = require('../models/Application');
const Link = require('../models/Link');
const Snippet = require('../models/Snippet');
const Task = require('../models/Task');
const { purgeExpiredTrash } = require('../utils/retention');

// GET /api/trash - list all items currently in trash
router.get('/', async (req, res) => {
  try {
    await purgeExpiredTrash();
    const items = await Trash.find().sort({ deletedAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trash/:id/restore - restore item back to its original collection
router.post('/:id/restore', async (req, res) => {
  try {
    const item = await Trash.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Trash item not found or already purged' });

    const data = item.data;
    let restoredDoc = null;
    const cleanData = { ...data };
    delete cleanData._id;
    delete cleanData.__v;
    delete cleanData.createdAt;
    delete cleanData.updatedAt;

    if (item.entityType === 'application') {
      // Check if application with same ID already exists
      const existing = await Application.findById(item.originalId);
      if (existing) {
        // App already exists (edge case) -> update it
        restoredDoc = await Application.findByIdAndUpdate(item.originalId, cleanData, { new: true });
      } else {
        restoredDoc = await Application.create(data);
      }
    } else if (item.entityType === 'link') {
      const existing = await Link.findById(item.originalId);
      if (existing) {
        restoredDoc = await Link.findByIdAndUpdate(item.originalId, cleanData, { new: true });
      } else {
        restoredDoc = await Link.create(data);
      }
    } else if (item.entityType === 'snippet') {
      const existing = await Snippet.findById(item.originalId);
      if (existing) {
        restoredDoc = await Snippet.findByIdAndUpdate(item.originalId, cleanData, { new: true });
      } else {
        restoredDoc = await Snippet.create(data);
      }
    } else if (item.entityType === 'task') {
      const existing = await Task.findById(item.originalId);
      if (existing) {
        restoredDoc = await Task.findByIdAndUpdate(item.originalId, cleanData, { new: true });
      } else {
        restoredDoc = await Task.create(data);
      }
    } else {
      return res.status(400).json({ error: `Unknown entity type: ${item.entityType}` });
    }

    // Log history
    await History.create({
      entityType: item.entityType,
      entityId: item.originalId,
      action: 'restore',
      title: item.title,
      description: `Restored ${item.entityType} "${item.title}" from Trash`,
      snapshot: data
    });

    // Remove from trash
    await Trash.findByIdAndDelete(req.params.id);

    res.json({ ok: true, restoredDoc, title: item.title, entityType: item.entityType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/trash/:id - permanently delete single item
router.delete('/:id', async (req, res) => {
  try {
    const item = await Trash.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true, message: `Permanently deleted "${item.title}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/trash - empty entire trash
router.delete('/', async (req, res) => {
  try {
    const result = await Trash.deleteMany({});
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
