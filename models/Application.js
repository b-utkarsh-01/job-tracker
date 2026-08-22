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
  'Naukri',
  'Internshala',
  'HiringCafe',
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
  portalLink: { type: String, trim: true }, // candidate/application status portal URL
  priority: { type: Boolean, default: false }, // starred / dream company

  // Optional calendar event: an interview slot or an OA/task deadline
  eventDate: { type: Date, default: null },
  eventLabel: { type: String, trim: true, default: '' },

  nextFollowupDate: { type: Date, default: threeDaysFromNow },
  followedUpLast: { type: Boolean, default: null },
  followupCount: { type: Number, default: 0 }
}, { timestamps: true });

ApplicationSchema.statics.STATUS_VALUES = STATUS_VALUES;
ApplicationSchema.statics.SOURCE_VALUES = SOURCE_VALUES;

module.exports = mongoose.model('Application', ApplicationSchema);