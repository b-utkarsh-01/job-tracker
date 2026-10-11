const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ['application', 'link', 'snippet', 'task'],
    required: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  action: {
    type: String,
    enum: ['create', 'update', 'delete', 'restore', 'rollback'],
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    default: 'Untitled'
  },
  description: {
    type: String,
    required: true,
    trim: true,
    default: 'Activity logged'
  },
  field: {
    type: String,
    trim: true,
    default: ''
  },
  oldValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  snapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, { timestamps: true });

HistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model('History', HistorySchema);
