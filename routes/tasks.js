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

// PATCH update (toggle done, edit title/date/notes)
router.patch('/:id', async (req, res) => {
  try {
    const existing = await Task.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const allowed = ['title', 'date', 'done', 'notes'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // History log
    await History.create({
      entityType: 'task',
      entityId: existing._id,
      action: 'update',
      title: existing.title,
      description: `Task "${existing.title}" updated`,
      snapshot: existing.toObject()
    }).catch(e => console.error('History save error:', e.message));

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