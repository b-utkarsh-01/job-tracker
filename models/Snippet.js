const mongoose = require('mongoose');

// One document per saved item in the "Mails & notes" box.
// type 'mail' -> subject + body + optional resume link / resume note
// type 'note' -> optional title + body (plain note)
// Default is 'mail' so items saved before `type` existed show up as mails.
// No length limits on any field: the UI wraps / scrolls long content.
const SnippetSchema = new mongoose.Schema({
  type: { type: String, enum: ['mail', 'note'], default: 'mail' },
  title: { type: String, trim: true, default: '' },
  subject: { type: String, trim: true, default: '' },
  body: { type: String, default: '' },
  resumeLink: { type: String, trim: true, default: '' },
  resumeNote: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Snippet', SnippetSchema);