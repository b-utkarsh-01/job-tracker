const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true, trim: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

// Ensure one doc per key
SettingsSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('Settings', SettingsSchema);
