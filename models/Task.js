const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true }, // e.g. "Fill Google form", "Apply to Stripe"
  date: { type: Date, required: true },
  done: { type: Boolean, default: false },
  notes: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Task', TaskSchema);
