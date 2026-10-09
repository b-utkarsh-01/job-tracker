const mongoose = require('mongoose');

// One document per user-customized link.
// `section` controls which S/A/B/C panel it shows up in; `order` controls
// position inside that panel. `isDefault` marks seeded links we pre-created
// so the UI can treat them slightly differently (for example, never delete the
// seed row itself — instead the user toggles the link off).
const LinkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    icon: { type: String, trim: true, default: 'default' },
    section: {
      type: String,
      enum: ['S', 'A', 'B', 'C'],
      default: 'C'
    },
    order: { type: Number, default: 0 },
    isCustom: { type: Boolean, default: true }
  },
  { timestamps: true }
);

LinkSchema.index({ section: 1, order: 1 });

module.exports = mongoose.model('Link', LinkSchema);
