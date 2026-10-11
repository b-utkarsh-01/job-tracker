const mongoose = require('mongoose');

const TrashSchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ['application', 'link', 'snippet', 'task'],
    required: true
  },
  originalId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    default: 'Untitled'
  },
  subtitle: {
    type: String,
    trim: true,
    default: ''
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  deletedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

TrashSchema.index({ expiresAt: 1 });
TrashSchema.index({ deletedAt: -1 });

module.exports = mongoose.model('Trash', TrashSchema);
