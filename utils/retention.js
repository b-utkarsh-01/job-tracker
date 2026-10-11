const Settings = require('../models/Settings');
const Trash = require('../models/Trash');

async function getRetentionExpiresAt() {
  try {
    const doc = await Settings.findOne({ key: 'retentionPolicy' });
    let hours = 24; // default 24 hours
    if (doc && doc.value) {
      if (typeof doc.value === 'number') {
        hours = doc.value;
      } else if (typeof doc.value === 'object' && doc.value.hours !== undefined) {
        hours = Number(doc.value.hours);
      }
    }
    if (isNaN(hours) || hours < 0) hours = 24;
    if (hours === 0) return null; // 0 = never auto-delete (manual only)
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  } catch (err) {
    console.error('Error fetching retention policy:', err.message);
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
}

async function purgeExpiredTrash() {
  try {
    const res = await Trash.deleteMany({
      expiresAt: { $ne: null, $lte: new Date() }
    });
    if (res.deletedCount > 0) {
      console.log(`[Trash] Purged ${res.deletedCount} expired items.`);
    }
  } catch (err) {
    console.error('[Trash] Failed to purge expired items:', err.message);
  }
}

module.exports = {
  getRetentionExpiresAt,
  purgeExpiredTrash
};
