const express = require('express');
const router = express.Router();
const Link = require('../models/Link');
const Application = require('../models/Application');

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------

const ALLOWED_SCHEMES = ['http:', 'https:'];
function isSafeUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const parsed = new URL(str);
    return ALLOWED_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Normal section labels, in display order.
const SECTION_ORDER = ['S', 'A', 'B', 'C'];

// Seed the default link set exactly once. Keeps the defaults stable even if
// the server restarts, and lets custom user edits live alongside them.
async function seedDefaultLinksIfMissing() {
  const total = await Link.countDocuments();
  if (total > 0) return; // already seeded

  let order = 0;
  for (const section of Application.SITE_SECTIONS) {
    for (const link of section.defaultLinks) {
      await Link.create({
        name: link.name,
        url: link.url,
        icon: link.icon,
        section: section.tier,
        order: order++,
        isCustom: false
      });
    }
  }
}

// ---------------------------------------------------------------
// GET /api/links
// Returns links grouped by section, in the S/A/B/C order.
// ---------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    await seedDefaultLinksIfMissing();

    const links = await Link.find().sort({ section: 1, order: 1 });

    const grouped = {
      S: [],
      A: [],
      B: [],
      C: []
    };

    for (const link of links) {
      if (!grouped[link.section]) grouped[link.section] = [];
      grouped[link.section].push({
        _id: link._id,
        name: link.name,
        url: link.url,
        icon: link.icon,
        section: link.section,
        isCustom: link.isCustom,
        createdAt: link.createdAt
      });
    }

    res.json({
      sections: SECTION_ORDER.map(t => ({
        tier: t,
        links: grouped[t] || []
      })),
      sectionsMeta: Application.SITE_SECTIONS.map(s => ({
        tier: s.tier,
        label: s.label,
        description: s.description
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// POST /api/links
// Body: { name, url, icon?, section?, order? }
// If icon looks like a known key we keep it, otherwise default.
// ---------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { name, url, icon, section, order } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }

    if (!isSafeUrl(url)) {
      return res.status(400).json({ error: 'url must be a safe http/https link' });
    }

    const effectiveSection =
      section && ['S', 'A', 'B', 'C'].includes(section.toUpperCase())
        ? section.toUpperCase()
        : 'C';

    const effectiveIcon =
      icon && typeof icon === 'string'
        ? icon.toLowerCase().trim()
        : 'default';

    // Auto-assign order at the end of the chosen section if not provided.
    let finalOrder = Number(order);
    if (!Number.isFinite(finalOrder) || finalOrder < 0) {
      const max = await Link.findOne({ section: effectiveSection })
        .sort({ order: -1 })
        .select('order');
      finalOrder = (max && max.order != null ? max.order : -1) + 1;
    }

    const link = await Link.create({
      name: name.trim(),
      url: url.trim(),
      icon: effectiveIcon,
      section: effectiveSection,
      order: finalOrder,
      isCustom: true
    });

    res.status(201).json(link);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// PUT /api/links/:id
// Allowed edits: name, url, icon, section, order, archived
// ---------------------------------------------------------------
router.put('/:id', async (req, res) => {
  try {
    const link = await Link.findById(req.params.id);
    if (!link) return res.status(404).json({ error: 'Not found' });

    const allowed = ['name', 'url', 'icon', 'section', 'order'];
    const updates = {};

    allowed.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    if (updates.url !== undefined && !isSafeUrl(updates.url)) {
      return res.status(400).json({ error: 'url must be a safe http/https link' });
    }

    if (updates.section !== undefined) {
      if (!['S', 'A', 'B', 'C'].includes(updates.section.toUpperCase())) {
        return res.status(400).json({ error: 'section must be S, A, B, or C' });
      }
      updates.section = updates.section.toUpperCase();
    }

    if (updates.icon !== undefined && typeof updates.icon === 'string') {
      updates.icon = updates.icon.toLowerCase().trim();
    }

    const updated = await Link.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true }
    );

    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// DELETE /api/links/:id
// Only custom links can be removed. Default seeds are left in place so the
// sidebar never loses its base recommendations.
// ---------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const link = await Link.findById(req.params.id);
    if (!link) return res.status(404).json({ error: 'Not found' });

    if (!link.isCustom) {
      return res.status(400).json({ error: 'Default links cannot be deleted' });
    }

    await Link.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// Light helper so the sidebar never has to maintain its own icon SVGs.
// Returns a single SVG string for a known icon key, or a generic fallback.
const ICON_SVGS = {
  linkedin: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.32c0-1.07-.78-2.05-1.94-2.05h-1.73v-4.1h3.56c1.05 0 1.94-.78 1.94-1.94v-5.77c0-1.15-.89-2.04-2.04-2.04H7.91c-1.15 0-2.04.89-2.04 2.04v4.79h-3.56v5.32h3.56v.92z" fill="currentColor"/>
    <circle cx="12.64" cy="4.97" r="2.48" fill="currentColor"/>
  </svg>`,
  wellfound: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="currentColor"/>
    <circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.9"/>
  </svg>`,
  cutshort: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  </svg>`,
  instahyre: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
    <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  naukri: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  </svg>`,
  foundit: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
    <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  indeed: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10 10-4.49 10-10S17.51 2 12 2z" fill="currentColor"/>
    <path d="M12 6v9m0 0l-3-3m3 3l3-3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  internshala: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="currentColor"/>
    <path d="M10 10h4v4h-4z" fill="#fff"/>
  </svg>`,
  hirist: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 4l7 16 7-16M8 14h8M8 10h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  apna: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  glassdoor: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  </svg>`,
  shine: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2l2 5h5l-4 3 2 5-5-3-5 3 2-5-4-3h5z" fill="currentColor"/>
  </svg>`,
  hiringcafe: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 4h16v1.5H4V4zm0 7h16v1.5H4V11zm0 7h16v1.5H4v-1.5z" fill="currentColor"/>
  </svg>`,
  default: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 5h14l-1.5 9h-11L5 5zm3.5 4l5 3.5L15.5 13H7.5L5 9.5l2.5-1z" fill="currentColor"/>
  </svg>`
};

router.get('/icon/:key', (req, res) => {
  const key = (req.params.key || '').toLowerCase().trim() || 'default';
  const svg = ICON_SVGS[key] || ICON_SVGS.default;
  res.type('html').send(svg);
});

