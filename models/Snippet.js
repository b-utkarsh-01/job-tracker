const mongoose = require('mongoose');

// One document per saved item in the "Mails & notes" box.
// body     -> plain text (fallback + plain-text copy)
// bodyHtml -> formatted version (bold, lists, colours...) used for display + rich copy
// order    -> manual position of notes (drag to reorder); lower = earlier
const SnippetSchema = new mongoose.Schema({
  type: { type: String, enum: ['mail', 'note'], default: 'mail' },
  title: { type: String, trim: true, default: '' },
  subject: { type: String, trim: true, default: '' },
  body: { type: String, default: '' },
  bodyHtml: { type: String, default: '' },
  resumeLink: { type: String, trim: true, default: '' },
  resumeNote: { type: String, trim: true, default: '' },
  order: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Snippet', SnippetSchema);