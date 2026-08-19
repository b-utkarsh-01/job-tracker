const mongoose = require('mongoose');

const STATUS_VALUES = [
  'Applied',
  'Under Consideration',
  'OA/Task Pending',
  'Interview Scheduled',
  'Interviewed',
  'Offer',
  'Rejected',
  'No Response',
  'Ghosted'
];

const SOURCE_VALUES = [
  'Wellfound',
  'Company site',
  'Cold email',
  'LinkedIn',
  'Referral',
  'Other'
];

function threeDaysFromNow() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d;
}

const ApplicationSchema = new mongoose.Schema({
  company: { type: String, required: true, trim: true },
  role: { type: String, trim: true },
  source: { type: String, enum: SOURCE_VALUES, default: 'Wellfound' },
  dateApplied: { type: Date, default: Date.now },
  status: { type: String, enum: STATUS_VALUES, default: 'Applied' },
  notes: { type: String, trim: true },

  // Follow-up cycle: instead of a one-off date, this rolls forward 3 days
  // every time the user answers the "did you follow up?" prompt.
  nextFollowupDate: { type: Date, default: threeDaysFromNow },
  followedUpLast: { type: Boolean, default: null }, // null = not answered yet
  followupCount: { type: Number, default: 0 }
}, { timestamps: true });

ApplicationSchema.statics.STATUS_VALUES = STATUS_VALUES;
ApplicationSchema.statics.SOURCE_VALUES = SOURCE_VALUES;

module.exports = mongoose.model('Application', ApplicationSchema);
