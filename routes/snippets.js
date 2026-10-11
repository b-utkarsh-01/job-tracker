const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Snippet = require('../models/Snippet');
const Trash = require('../models/Trash');
const History = require('../models/History');
const { getRetentionExpiresAt } = require('../utils/retention');

// Resume links are rendered as clickable links, so only http/https is allowed.
function isSafeUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(str).protocol);
  } catch {
    return false;
  }
}

const str = (v) => (typeof v === 'string' ? v : '');

const validIds = (ids) => Array.isArray(ids)
  ? ids.filter(id => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)).slice(0, 1000)
  : [];

router.get('/', async (req, res) => {
  try {
    res.json(await Snippet.find().sort({ createdAt: 1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const type = req.body.type === 'note' ? 'note' : 'mail';
    const doc = {
      type,
      title: str(req.body.title),
      subject: str(req.body.subject),
      body: str(req.body.body),
      bodyHtml: str(req.body.bodyHtml),
      resumeLink: str(req.body.resumeLink).trim(),
      resumeNote: str(req.body.resumeNote)
    };

    if (type === 'mail' && !doc.subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (type === 'note' && !doc.title.trim() && !doc.body.trim()) {
      return res.status(400).json({ error: 'Note is empty' });
    }
    if (doc.resumeLink && !isSafeUrl(doc.resumeLink)) {
      return res.status(400).json({ error: 'Resume link must be an http/https link' });
    }

    // New notes go on top, like a phone notes app
    if (type === 'note') {
      const top = await Snippet.findOne({ type: 'note' }).sort({ order: 1 }).select('order');
      doc.order = (top ? (top.order || 0) : 0) - 1;
    }

    const snippet = await Snippet.create(doc);
    res.status(201).json(snippet);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /reorder  body: { ids: [...] } -> saves the drag-and-drop order.
// Must stay ABOVE '/:id' or Express treats "reorder" as an id.
router.patch('/reorder', async (req, res) => {
  try {
    const ids = validIds(req.body.ids);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    await Snippet.bulkWrite(ids.map((id, i) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order: i } },
        timestamps: false // moving a note should not change its "edited" date
      }
    })));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /bulk-delete  body: { ids: [...] }
router.post('/bulk-delete', async (req, res) => {
  try {
    const ids = validIds(req.body.ids);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });

    const snippets = await Snippet.find({ _id: { $in: ids } });
    const expiresAt = await getRetentionExpiresAt();

    for (const s of snippets) {
      const name = s.subject || s.title || (s.type === 'mail' ? 'Mail template' : 'Note');
      await Trash.create({
        entityType: 'snippet',
        originalId: s._id,
        title: name,
        subtitle: `${s.type === 'mail' ? 'Mail' : 'Note'}${s.resumeLink ? ' · Has resume' : ''}`,
        data: s.toObject(),
        expiresAt
      });
      await History.create({
        entityType: 'snippet',
        entityId: s._id,
        action: 'delete',
        title: name,
        description: `Moved ${s.type} "${name}" to Trash`,
        snapshot: s.toObject()
      }).catch(e => console.error('History save error:', e.message));
    }

    const result = await Snippet.deleteMany({ _id: { $in: ids } });
    res.json({ ok: true, deleted: result.deletedCount, trashed: true, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await Snippet.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const updates = {};
    ['title', 'subject', 'body', 'bodyHtml', 'resumeLink', 'resumeNote'].forEach(f => {
      if (req.body[f] !== undefined) updates[f] = str(req.body[f]);
    });

    if (updates.resumeLink !== undefined) {
      updates.resumeLink = updates.resumeLink.trim();
      if (updates.resumeLink && !isSafeUrl(updates.resumeLink)) {
        return res.status(400).json({ error: 'Resume link must be an http/https link' });
      }
    }

    // Record history
    const name = existing.subject || existing.title || 'Snippet';
    await History.create({
      entityType: 'snippet',
      entityId: existing._id,
      action: 'update',
      title: name,
      description: `Updated ${existing.type}: "${name}"`,
      snapshot: existing.toObject()
    }).catch(e => console.error('History save error:', e.message));

    const snippet = await Snippet.findByIdAndUpdate(
      req.params.id, updates, { new: true, runValidators: true }
    );
    res.json(snippet);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const snippet = await Snippet.findById(req.params.id);
    if (!snippet) return res.status(404).json({ error: 'Not found' });

    const expiresAt = await getRetentionExpiresAt();
    const name = snippet.subject || snippet.title || (snippet.type === 'mail' ? 'Mail template' : 'Note');

    await Trash.create({
      entityType: 'snippet',
      originalId: snippet._id,
      title: name,
      subtitle: `${snippet.type === 'mail' ? 'Mail' : 'Note'}${snippet.resumeLink ? ' · Has resume' : ''}`,
      data: snippet.toObject(),
      expiresAt
    });

    await History.create({
      entityType: 'snippet',
      entityId: snippet._id,
      action: 'delete',
      title: name,
      description: `Moved ${snippet.type} "${name}" to Trash`,
      snapshot: snippet.toObject()
    }).catch(e => console.error('History save error:', e.message));

    await Snippet.findByIdAndDelete(req.params.id);
    res.json({ ok: true, trashed: true, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;