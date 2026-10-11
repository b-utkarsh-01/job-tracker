const express = require('express');
const router = express.Router();
const Task = require('../models/Task.js');
const Trash = require('../models/Trash');
const History = require('../models/History');
const { getRetentionExpiresAt } = require('../utils/retention');

// GET all tasks
router.get('/', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ date: 1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create a task
router.post('/', async (req, res) => {
  try {
    const task = new Task({
      title: req.body.title,
      date: req.body.date,
      notes: req.body.notes || ''
    });
    await task.save();
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function formatTaskVal(field, v) {
  if (v === null || v === undefined) return '';
  if (field === 'done') return v ? 'Completed' : 'Pending';
  if (field === 'date') {
    try {
      const d = new Date(v);
      return !isNaN(d.getTime()) ? d.toLocaleDateString() : String(v);
    } catch { return String(v); }
  }
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return '(empty)';
  return s.length > 50 ? s.slice(0, 47) + '...' : s;
}

// PATCH update (toggle done, edit title/date/notes)
router.patch('/:id', async (req, res) => {
  try {
    const existing = await Task.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const allowed = ['title', 'date', 'done', 'notes'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const TASK_LABELS = {
      title: 'Title',
      done: 'Status',
      date: 'Date',
      notes: 'Notes'
    };

    const changes = [];
    ['title', 'date', 'done', 'notes'].forEach(key => {
      if (updates[key] !== undefined) {
        const oldVal = existing[key];
        const newVal = updates[key];
        let diff = false;
        if (key === 'date') {
          const dOld = oldVal ? new Date(oldVal).toISOString().split('T')[0] : '';
          const dNew = newVal ? new Date(newVal).toISOString().split('T')[0] : '';
          diff = dOld !== dNew;
        } else if (key === 'done') {
          diff = Boolean(oldVal) !== Boolean(newVal);
        } else {
          diff = String(oldVal ?? '').trim() !== String(newVal ?? '').trim();
        }
        if (diff) {
          changes.push({
            field: key,
            label: TASK_LABELS[key] || key,
            oldValue: oldVal,
            newValue: newVal
          });
        }
      }
    });

    if (changes.length > 0) {
      const taskTitle = (updates.title || existing.title || 'Task').trim() || 'Task';
      const desc = changes.map(c => `${c.label}: "${formatTaskVal(c.field, c.oldValue)}" → "${formatTaskVal(c.field, c.newValue)}"`).join(', ');
      await History.create({
        entityType: 'task',
        entityId: existing._id,
        action: 'update',
        title: taskTitle,
        description: desc,
        field: changes.length === 1 ? changes[0].field : '',
        oldValue: changes.length === 1 ? changes[0].oldValue : null,
        newValue: changes.length === 1 ? changes[0].newValue : null,
        snapshot: existing.toObject()
      }).catch(e => console.error('History save error:', e.message));
    }

    const task = await Task.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });

    const expiresAt = await getRetentionExpiresAt();
    const taskTitle = (task.title || 'Untitled task').trim() || 'Untitled task';

    await Trash.create({
      entityType: 'task',
      originalId: task._id,
      title: taskTitle,
      subtitle: `Reminder/Task for ${new Date(task.date).toLocaleDateString()}`,
      data: task.toObject(),
      expiresAt
    });

    await History.create({
      entityType: 'task',
      entityId: task._id,
      action: 'delete',
      title: taskTitle,
      description: `Moved task "${taskTitle}" to Trash`,
      snapshot: task.toObject()
    }).catch(e => console.error('History save error:', e.message));

    await Task.findByIdAndDelete(req.params.id);
    res.json({ ok: true, trashed: true, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;