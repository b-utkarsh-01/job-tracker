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

// ---------------- Job-site link buckets (S/A/B/C) ----------------
// Pre-ranked list: higher tiers tend to get replies / interviews faster for
// freshers and early-career candidates in India. Users can add their own links
// under any section.

const SITE_SECTIONS = [
  {
    tier: 'S',
    label: 'S · Best reply rate',
    description: 'Usually fastest replies for freshers (startups, referrals, direct hiring).',
    defaultLinks: [
      { name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/', icon: 'linkedin' },
      { name: 'Wellfound', url: 'https://wellfound.com/jobs/', icon: 'wellfound' },
      { name: 'Cutshort', url: 'https://cutshort.io/', icon: 'cutshort' },
      { name: 'Instahyre', url: 'https://instahyre.com/', icon: 'instahyre' }
    ]
  },
  {
    tier: 'A',
    label: 'A · Strong',
    description: 'High volume and still good chances — IT services, mid-market, freshers.',
    defaultLinks: [
      { name: 'Naukri', url: 'https://www.naukri.com/', icon: 'naukri' },
      { name: 'Foundit', url: 'https://www.foundit.in/', icon: 'foundit' },
      { name: 'Indeed India', url: 'https://in.indeed.com/', icon: 'indeed' }
    ]
  },
  {
    tier: 'B',
    label: 'B · Fresher / niche',
    description: 'Good for internships, campus hires, and tech-specific roles.',
    defaultLinks: [
      { name: 'Internshala', url: 'https://internshala.com/', icon: 'internshala' },
      { name: 'Hirist', url: 'https://www.hirist.com/', icon: 'hirist' },
      { name: 'Apna', url: 'https://www.apna.co/', icon: 'apna' }
    ]
  },
  {
    tier: 'C',
    label: 'C · Also try',
    description: 'Worth bookmarking if the role/company shows up there.',
    defaultLinks: [
      { name: 'Glassdoor', url: 'https://www.glassdoor.co.in/', icon: 'glassdoor' },
      { name: 'Shine', url: 'https://www.shine.com/', icon: 'shine' },
      { name: 'HiringCafe', url: 'https://www.hiringcafe.com/', icon: 'hiringcafe' }
    ]
  }
];

// Icon keys we have inline SVGs for. Anything else falls back to a plain
// generic bookmark icon so the sidebar still looks clean.
const KNOWN_ICONS = new Set([
  'linkedin', 'wellfound', 'cutshort', 'instahyre',
  'naukri', 'foundit', 'indeed',
  'internshala', 'hirist', 'apna',
  'glassdoor', 'shine', 'hiringcafe'
]);

function threeDaysFromNow() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(0, 0, 0, 0); // normalize to midnight so "due" triggers for the
                          // whole day, not just after the exact time-of-day
                          // the application was originally added
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
  followupCount: { type: Number, default: 0 },
  order: { type: Number, default: 0, index: true }
}, { timestamps: true });

ApplicationSchema.statics.STATUS_VALUES = STATUS_VALUES;
ApplicationSchema.statics.SITE_SECTIONS = SITE_SECTIONS;
ApplicationSchema.statics.KNOWN_ICONS = KNOWN_ICONS;
ApplicationSchema.statics.SOURCE_VALUES = SOURCE_VALUES;

module.exports = mongoose.model('Application', ApplicationSchema);