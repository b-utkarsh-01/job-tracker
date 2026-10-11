const express = require('express');
const router = express.Router();
const History = require('../models/History');
const Trash = require('../models/Trash');
const Application = require('../models/Application');
const Link = require('../models/Link');
const Snippet = require('../models/Snippet');
const Task = require('../models/Task');

// GET /api/history - get recent audit trail
router.get('/', async (req, res) => {
  try {
    const items = await History.find().sort({ createdAt: -1 }).limit(100);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/history/:id/rollback - revert a change
router.post('/:id/rollback', async (req, res) => {
  try {
    const entry = await History.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'History item not found' });

    let restoredDoc = null;

    if (entry.action === 'update') {
      let updateData = {};
      if (entry.field) {
        updateData[entry.field] = entry.oldValue;
        // If snippet body or bodyHtml was rolled back, ensure both are restored from snapshot
        if (entry.entityType === 'snippet' && (entry.field === 'body' || entry.field === 'bodyHtml') && entry.snapshot) {
          updateData.body = entry.snapshot.body || '';
          updateData.bodyHtml = entry.snapshot.bodyHtml || '';
        }
      } else if (entry.snapshot) {
        updateData = { ...entry.snapshot };
      }

      // Always strip immutable / internal fields from updateData
      delete updateData._id;
      delete updateData.__v;
      delete updateData.createdAt;
      delete updateData.updatedAt;

      if (entry.entityType === 'application') {
        restoredDoc = await Application.findByIdAndUpdate(entry.entityId, updateData, { new: true });
      } else if (entry.entityType === 'link') {
        restoredDoc = await Link.findByIdAndUpdate(entry.entityId, updateData, { new: true });
      } else if (entry.entityType === 'snippet') {
        restoredDoc = await Snippet.findByIdAndUpdate(entry.entityId, updateData, { new: true });
      } else if (entry.entityType === 'task') {
        restoredDoc = await Task.findByIdAndUpdate(entry.entityId, updateData, { new: true });
      }

      if (!restoredDoc) {
        return res.status(404).json({ error: 'Original item could not be found to rollback' });
      }
    } else if (entry.action === 'delete') {
      if (!entry.snapshot) {
        return res.status(400).json({ error: 'No snapshot available for rollback' });
      }

      if (entry.entityType === 'application') {
        const existing = await Application.findById(entry.entityId);
        restoredDoc = existing || await Application.create(entry.snapshot);
      } else if (entry.entityType === 'link') {
        const existing = await Link.findById(entry.entityId);
        restoredDoc = existing || await Link.create(entry.snapshot);
      } else if (entry.entityType === 'snippet') {
        const existing = await Snippet.findById(entry.entityId);
        restoredDoc = existing || await Snippet.create(entry.snapshot);
      } else if (entry.entityType === 'task') {
        const existing = await Task.findById(entry.entityId);
        restoredDoc = existing || await Task.create(entry.snapshot);
      }

      // Also remove from trash if it was there
      await Trash.findOneAndDelete({ originalId: entry.entityId });
    } else if (entry.action === 'restore') {
      // Rolling back a restore = move back to trash
      // We can soft delete again if needed
      return res.status(400).json({ error: 'Cannot directly rollback a restore; you can delete the item if desired' });
    }

    // Log the rollback action
    await History.create({
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: 'rollback',
      title: entry.title,
      description: `Rolled back: ${entry.description}`,
      snapshot: restoredDoc ? (restoredDoc.toObject ? restoredDoc.toObject() : restoredDoc) : null
    });

    res.json({
      ok: true,
      message: `Rolled back: ${entry.description}`,
      entityType: entry.entityType,
      restoredDoc
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/history - clear history log
router.delete('/', async (req, res) => {
  try {
    const result = await History.deleteMany({});
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
