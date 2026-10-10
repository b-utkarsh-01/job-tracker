const express = require('express');
const router = express.Router();
const Snippet = require('../models/Snippet');

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

    const snippet = await Snippet.create(doc);
    res.status(201).json(snippet);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const updates = {};
    ['title', 'subject', 'body', 'resumeLink', 'resumeNote'].forEach(f => {
      if (req.body[f] !== undefined) updates[f] = str(req.body[f]);
    });

    if (updates.resumeLink !== undefined) {
      updates.resumeLink = updates.resumeLink.trim();
      if (updates.resumeLink && !isSafeUrl(updates.resumeLink)) {
        return res.status(400).json({ error: 'Resume link must be an http/https link' });
      }
    }

    const snippet = await Snippet.findByIdAndUpdate(
      req.params.id, updates, { new: true, runValidators: true }
    );
    if (!snippet) return res.status(404).json({ error: 'Not found' });
    res.json(snippet);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Snippet.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;