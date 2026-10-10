const STATUSES = ['Applied', 'Mail Not Found', 'Under Consideration', 'OA/Task Pending', 'Interview Scheduled', 'Interviewed', 'Offer', 'Rejected', 'No Response', 'Ghosted'];

// Statuses hidden in the default "Active" view. "All" still shows everything.
const CLOSED_STATUSES = ['Rejected', 'Ghosted', 'No Response'];

const API = '/api/applications';
const PAGE_SIZE = 8;

// ============================================================
// STATE
// ============================================================

let apps = [];            // snippets.js reads this global too
let filter = 'Active';
let searchTerm = '';
let currentPage = 1;

let sortCol = 'date';
let sortDir = 'desc';

let charts = {};
let lastStats = null;     // last /stats response, reused when charts redraw

let weeklyGoal = 5;       // default, loaded from DB on startup

let pendingUndo = null;   // deleted app(s) kept for the Undo toast
let undoTimer = null;

// ============================================================
// RISK / COLD DETECTION
// ============================================================

function getRisk(app) {
  if (['Rejected', 'Offer'].includes(app.status)) return null;
  const lastChange = new Date(app.updatedAt || app.createdAt);
  const daysSince = Math.floor((new Date() - lastChange) / (1000 * 60 * 60 * 24));
  if (daysSince >= 10) return { level: 'hot', label: 'Going cold', days: daysSince };
  if (daysSince >= 5) return { level: 'warm', label: daysSince + 'd stale', days: daysSince };
  return { level: 'cool', label: 'Active', days: daysSince };
}

function riskHtml(app) {
  const r = getRisk(app);
  if (!r) return '';
  return '<span class="kanban-card-risk"><span class="risk-dot risk-' + r.level + '"></span><span class="risk-label risk-label-' + r.level + '">' + r.label + '</span></span>';
}

// ============================================================
// CONFETTI
// ============================================================

function fireConfetti() {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  const colors = ['#0F6B5C', '#B8791A', '#C13F2B', '#7C3AED', '#2563EB', '#059669', '#F59E0B', '#EC4899'];
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 0.8 + 's';
    piece.style.animationDuration = (2 + Math.random() * 1.5) + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (6 + Math.random() * 8) + 'px';
    container.appendChild(piece);
  }
  setTimeout(() => { container.innerHTML = ''; }, 4000);
}

// ============================================================
// FOLLOW-UP REMINDERS (bell + browser notifications)
// ============================================================

const NOTIFICATION_KEY = 'jt-notified-followups';
const NOTIFICATION_CHECK_MS = 60 * 1000;

// App-level switch. Browser permission alone is not enough:
// reminders are on only if the user turned them on here.
const REMINDERS_KEY = 'jt-reminders';

function remindersOn() {
  return ('Notification' in window) &&
    Notification.permission === 'granted' &&
    localStorage.getItem(REMINDERS_KEY) === 'on';
}

function getNotifiedFollowups() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATION_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveNotifiedFollowups(data) {
  // Prune keys older than 30 days to prevent localStorage bloat
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const pruned = {};
  for (const [key, timestamp] of Object.entries(data)) {
    if (now - timestamp < THIRTY_DAYS) pruned[key] = timestamp;
  }
  localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(pruned));
}

function isOverdue(app) {
  if (['Rejected', 'Offer'].includes(app.status)) return false;
  return new Date(app.nextFollowupDate) <= new Date();
}

function getDueApps() {
  return apps.filter(isOverdue);
}

function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  const count = getDueApps().length;
  badge.textContent = count > 99 ? '99+' : count;
  badge.classList.toggle('hidden', count === 0);
}

// Jump to one application in the Applications list (used by the bell panel,
// OS notifications and the calendar).
function jumpToCompany(company) {
  searchTerm = company.toLowerCase();
  const searchBox = document.getElementById('searchBox');
  if (searchBox) searchBox.value = company;
  filter = 'All';
  currentPage = 1;
  render();
  document.getElementById('applicationsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// The bell only lists what is due. Turning reminders on/off lives in Settings.
function renderNotificationPanel() {
  const panel = document.getElementById('notificationPanel');
  if (!panel) return;

  const due = getDueApps();
  // const permission = ('Notification' in window) ? Notification.permission : 'unsupported';

  let html = `<div class="panel-title">Follow-ups due${due.length ? ` · ${due.length}` : ''}</div>`;

  if (due.length) {
    html += due.slice(0, 8).map(a => `
      <div class="notification-item" data-jump-company="${esc(a.company)}" title="View in Applications list">
        <div class="notification-company">${esc(a.company)}</div>
        <div class="notification-role">${esc(a.role || 'Follow-up required')}</div>
      </div>
    `).join('');
    if (due.length > 8) html += `<div class="panel-muted">+ ${due.length - 8} more due</div>`;
  } else {
    html += `<div class="panel-muted">Nothing needs a follow-up right now. 🎉</div>`;
  }
  const canEnable = ('Notification' in window) && Notification.permission !== 'denied' && !remindersOn();
  if (canEnable) {
    html += `
      <div class="notification-actions">
        <button type="button" id="openNotifSettings">Turn on browser reminders →</button>
      </div>`;
  }

  panel.innerHTML = html;

  panel.querySelectorAll('[data-jump-company]').forEach(item => {
    item.onclick = () => {
      jumpToCompany(item.dataset.jumpCompany);
      closeNotificationPanel();
    };
  });

  document.getElementById('openNotifSettings')
    ?.addEventListener('click', () => openSettings('notifications'));
}

function toggleNotificationPanel() {
  const panel = document.getElementById('notificationPanel');
  if (!panel) return;
  renderNotificationPanel();
  panel.classList.toggle('hidden');
}

function closeNotificationPanel() {
  document.getElementById('notificationPanel')?.classList.add('hidden');
}

function checkFollowupNotifications(forcePanelUpdate = false) {
  updateNotificationBadge();

  if (!remindersOn()) {
    if (forcePanelUpdate) renderNotificationPanel();
    return;
  }

  const notified = getNotifiedFollowups();
  let changed = false;

  getDueApps().forEach(a => {
    // One notification per application per follow-up cycle
    const key = `${a._id}:${a.nextFollowupDate}`;
    if (notified[key]) return;

    const notif = new Notification('Job Tracker — Follow-up due', {
      body: `${a.company}${a.role ? ` · ${a.role}` : ''} needs a follow-up.`,
      tag: `followup-${a._id}`
    });

    notif.onclick = () => {
      window.focus();
      jumpToCompany(a.company);
      notif.close();
    };

    notified[key] = Date.now();
    changed = true;
  });

  if (changed) saveNotifiedFollowups(notified);
  if (forcePanelUpdate) renderNotificationPanel();
}

function initNotifications() {
  const bell = document.getElementById('notificationBell');
  if (bell) bell.onclick = toggleNotificationPanel;

  updateNotificationBadge();
  renderNotificationPanel();
  checkFollowupNotifications();

  // Check every minute. The page needs to be open for this simple version.
  setInterval(() => checkFollowupNotifications(), NOTIFICATION_CHECK_MS);

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.bell-wrap');
    if (wrap && !wrap.contains(e.target)) closeNotificationPanel();
  });
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeNotificationPanel();
    closeSettingsFn();
    if (pendingConfirmResolver) pendingConfirmResolver(false);
    document.getElementById('snoozeModal')?.classList.add('hidden');
    document.getElementById('csvImportModal')?.classList.add('hidden');
    return;
  }

  // Don't hijack browser shortcuts (Ctrl+R reload, Ctrl+D bookmark...)
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // Don't trigger global shortcuts while the user is typing.
  if (isTypingTarget(e.target)) return;

  const key = e.key.toLowerCase();

  if (key === 'n') {
    e.preventDefault();
    document.getElementById('formBody').style.display = '';
    document.getElementById('toggleForm').textContent = 'Hide';
    document.getElementById('f-company').focus();
  } else if (e.key === '/') {
    e.preventDefault();
    document.getElementById('searchBox').focus();
  } else if (key === 'd') {
    e.preventDefault();
    setTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
  } else if (key === 'r') {
    e.preventDefault();
    Promise.all([loadApps(), loadStats()]).then(() => showToast('Refreshed', 'success'));
  } else if (e.key === '?') {
    e.preventDefault();
    openSettings('shortcuts');
  }
});

// Click outside snooze modal to close
document.getElementById('snoozeModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'snoozeModal') e.target.classList.add('hidden');
});

initNotifications();

// ============================================================
// THEME  (dark | light | auto = follow the system)
// ============================================================

const THEME_KEY = 'jt-theme';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsDarkBtn = document.getElementById('settingsDarkBtn');
const settingsLightBtn = document.getElementById('settingsLightBtn');
const settingsAutoBtn = document.getElementById('settingsAutoBtn');
const settingsNotifBtn = document.getElementById('settingsNotifBtn');
const notifStatus = document.getElementById('notifStatus');

function getThemeMode() {
  const saved = localStorage.getItem(THEME_KEY);
  return (saved === 'dark' || saved === 'light') ? saved : 'auto';
}

function syncSettingsThemeUI() {
  if (!settingsDarkBtn || !settingsLightBtn || !settingsAutoBtn) return;
  const mode = getThemeMode();
  settingsDarkBtn.classList.toggle('theme-btn-selected', mode === 'dark');
  settingsLightBtn.classList.toggle('theme-btn-selected', mode === 'light');
  settingsAutoBtn.classList.toggle('theme-btn-selected', mode === 'auto');
}

function applyTheme() {
  const mode = getThemeMode();
  const dark = mode === 'dark' || (mode === 'auto' && systemDark.matches);
  document.body.classList.toggle('dark', dark);
  syncSettingsThemeUI();
  if (lastStats) renderCharts(lastStats); // chart text/grid colors follow the theme
}

function setTheme(mode) {
  if (mode === 'dark' || mode === 'light') localStorage.setItem(THEME_KEY, mode);
  else localStorage.removeItem(THEME_KEY);
  applyTheme();
}

// OS theme changed while the app is open -> follow it (only matters in auto)
systemDark.addEventListener('change', applyTheme);

if (settingsDarkBtn) settingsDarkBtn.onclick = () => setTheme('dark');
if (settingsLightBtn) settingsLightBtn.onclick = () => setTheme('light');
if (settingsAutoBtn) settingsAutoBtn.onclick = () => setTheme('auto');

applyTheme();

// ============================================================
// SETTINGS MODAL (left = sections, right = selected section)
// To add a section: one [data-settings-tab] button + one
// [data-settings-pane] block in index.html. No JS change needed.
// ============================================================

function showSettingsTab(name) {
  if (!settingsModal) return;
  settingsModal.querySelectorAll('[data-settings-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.settingsTab === name);
  });
  settingsModal.querySelectorAll('[data-settings-pane]').forEach(p => {
    p.classList.toggle('hidden', p.dataset.settingsPane !== name);
  });
}

function openSettings(tab) {
  if (!settingsModal) return;
  closeNotificationPanel();
  if (typeof tab === 'string') showSettingsTab(tab);
  syncSettingsThemeUI();
  syncSettingsNotifUI();
  settingsModal.classList.remove('hidden');
}

function closeSettingsFn() {
  settingsModal?.classList.add('hidden');
}

if (settingsBtn) settingsBtn.onclick = () => openSettings();
document.getElementById('closeSettings')?.addEventListener('click', closeSettingsFn);

settingsModal?.addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') closeSettingsFn();
});

settingsModal?.querySelectorAll('[data-settings-tab]').forEach(btn => {
  btn.addEventListener('click', () => showSettingsTab(btn.dataset.settingsTab));
});

// function syncSettingsNotifUI() {
//   if (!settingsNotifBtn || !notifStatus) return;
//   const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
//   if (perm === 'granted') {
//     settingsNotifBtn.textContent = '✅ Reminders on';
//     settingsNotifBtn.className = 'confirm-btn confirm-add';
//     notifStatus.textContent = 'Browser reminders are enabled.';
//   } else if (perm === 'denied') {
//     settingsNotifBtn.textContent = 'Blocked';
//     settingsNotifBtn.className = 'confirm-btn confirm-cancel';
//     notifStatus.textContent = 'Notifications are blocked. Allow them in your browser site settings.';
//   } else if (perm === 'unsupported') {
//     settingsNotifBtn.textContent = 'Not supported';
//     settingsNotifBtn.className = 'confirm-btn confirm-cancel';
//     notifStatus.textContent = 'This browser does not support notifications.';
//   } else {
//     settingsNotifBtn.textContent = 'Enable reminders';
//     settingsNotifBtn.className = 'confirm-btn confirm-add';
//     notifStatus.textContent = 'Reminders are off.';
//   }
// }

function syncSettingsNotifUI() {
  if (!settingsNotifBtn || !notifStatus) return;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const on = remindersOn();

  settingsNotifBtn.setAttribute('aria-checked', on ? 'true' : 'false');
  settingsNotifBtn.disabled = perm === 'unsupported' || perm === 'denied';
  settingsNotifBtn.title = on ? 'Turn off reminders' : 'Turn on reminders';

  if (perm === 'unsupported') {
    notifStatus.textContent = 'This browser does not support notifications.';
  } else if (perm === 'denied') {
    notifStatus.textContent = 'Notifications are blocked. Allow them in your browser site settings.';
  } else {
    notifStatus.textContent = on ? 'Reminders are on.' : 'Reminders are off.';
  }
}

if (settingsNotifBtn) {
  settingsNotifBtn.onclick = async () => {
    if (!('Notification' in window)) {
      showToast('This browser does not support notifications', 'error');
      return;
    }
    if (Notification.permission === 'denied') {
      showToast('Notifications are blocked. Enable them in browser settings.', 'error');
      return;
    }

    // Already on -> turn off
    if (remindersOn()) {
      localStorage.setItem(REMINDERS_KEY, 'off');
      syncSettingsNotifUI();
      renderNotificationPanel();
      showToast('Reminders turned off', 'success');
      return;
    }

    // Off -> ask the browser if needed, then turn on
    const result = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

    if (result === 'granted') {
      localStorage.setItem(REMINDERS_KEY, 'on');
      showToast('Browser reminders enabled', 'success');
      checkFollowupNotifications(true);
    }
    syncSettingsNotifUI();
    renderNotificationPanel();
  };
}

// ============================================================
// SEARCH
// ============================================================

document.getElementById('searchBox').oninput = (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  currentPage = 1;
  render();
};

// ============================================================
// HTML HELPERS
// ============================================================

// Safe for both element content and double-quoted attributes.
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML.replace(/"/g, '&quot;');
}

function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s]+)/g, (url) => {
    const clean = url.replace(/[.,;)]+$/, '');
    return `<a href="${clean}" target="_blank" rel="noopener">Open link ↗</a>`;
  });
}

// ============================================================
// TOAST
// ============================================================

let toastTimer = null;

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
  }, 1800);
}

// Toast with an Undo button that calls onUndo
function showUndoToast(msg, onUndo, durationMs = 5000) {
  const t = document.getElementById('toast');

  // Clear older timers so they don't hide this toast early
  clearTimeout(toastTimer);
  clearTimeout(undoTimer);

  t.textContent = msg;
  t.className = 'toast show undo-toast';

  const undoBtn = document.createElement('button');
  undoBtn.className = 'undo-btn';
  undoBtn.textContent = 'Undo';
  t.appendChild(undoBtn);

  undoBtn.onclick = () => {
    t.classList.remove('show');
    clearTimeout(undoTimer);
    onUndo();
  };

  undoTimer = setTimeout(() => {
    t.classList.remove('show');
    pendingUndo = null;
  }, durationMs);
}

// ============================================================
// CONFIRM DIALOG (replaces the browser's native confirm())
// Returns a Promise<boolean>. Also used by snippets.js.
// ============================================================

let pendingConfirmResolver = null;

function askConfirm(message, opts = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmYes');
    const cancelBtn = document.getElementById('confirmCancel');
    if (!modal) { resolve(true); return; }

    msgEl.textContent = message;
    modal.classList.remove('hidden');

    yesBtn.textContent = opts.confirmText || 'Delete';
    yesBtn.className = 'confirm-btn ' + (opts.confirmClass || 'confirm-danger');

    const cleanup = (result) => {
      modal.classList.add('hidden');
      yesBtn.onclick = null;
      cancelBtn.onclick = null;
      yesBtn.textContent = 'Delete';
      yesBtn.className = 'confirm-btn confirm-danger';
      pendingConfirmResolver = null;
      resolve(result);
    };

    pendingConfirmResolver = cleanup;
    yesBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}

// ============================================================
// SNOOZE MODAL
// ============================================================

function showSnoozeModal(appId) {
  const modal = document.getElementById('snoozeModal');
  if (!modal) return;

  let selectedDays = 3;
  const options = modal.querySelectorAll('.snooze-option');
  const confirmBtn = document.getElementById('snoozeConfirmBtn');
  const cancelBtn = document.getElementById('snoozeCancelBtn');
  const customRow = document.getElementById('snoozeCustomRow');
  const customInput = document.getElementById('snoozeCustomDays');

  // Reset selection to 3 days
  options.forEach(opt => {
    const isCustom = opt.dataset.days === 'custom';
    opt.classList.toggle('snooze-option-selected', !isCustom && parseInt(opt.dataset.days, 10) === 3);
    opt.onclick = () => {
      options.forEach(o => o.classList.remove('snooze-option-selected'));
      opt.classList.add('snooze-option-selected');
      if (isCustom) {
        customRow.classList.remove('hidden');
        selectedDays = parseInt(customInput.value, 10) || 30;
        customInput.focus();
      } else {
        customRow.classList.add('hidden');
        selectedDays = parseInt(opt.dataset.days, 10);
      }
    };
  });

  customRow?.classList.add('hidden');

  if (customInput) {
    customInput.oninput = () => {
      selectedDays = parseInt(customInput.value, 10) || 30;
    };
  }

  modal.classList.remove('hidden');

  const cleanup = async (confirmed) => {
    modal.classList.add('hidden');
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    if (!confirmed) return;

    await fetch(`${API}/${appId}/followup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answered: false, days: selectedDays })
    });
    const label = selectedDays === 1 ? '1 day' : selectedDays + ' days';
    showToast(`Snoozed for ${label}`, 'success');
    await loadApps();
    await loadStats();
  };

  confirmBtn.onclick = () => cleanup(true);
  cancelBtn.onclick = () => cleanup(false);
}

// ============================================================
// LOAD APPLICATIONS + STATS
// ============================================================

async function loadApps() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    apps = await res.json();
  } catch (err) {
    console.error('Failed to load applications:', err);
    showToast('Failed to load data', 'error');
    return;
  }

  render();
  renderNotificationPanel();
  checkFollowupNotifications();
  renderCalendar();      // keeps the "Follow-ups due" chips in sync
  renderWeeklyGoal();
  renderKanban();

  // Refresh the "Fill {company} / {role} from" dropdown (snippets.js)
  if (typeof renderSnippetFill === 'function') renderSnippetFill();
}

async function loadStats() {
  renderStatsSkeleton();

  try {
    const res = await fetch(API + '/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = await res.json();
    renderStatCards(stats);
    renderCharts(stats);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function renderStatsSkeleton() {
  const statsEl = document.getElementById('stats');
  if (!statsEl || statsEl.children.length > 0) return;
  const card = '<div class="stat"><div class="skeleton-num"></div><div class="skeleton-label"></div></div>';
  statsEl.innerHTML = card.repeat(6);
}

// ============================================================
// WEEKLY GOAL
// ============================================================

function renderWeeklyGoal() {
  const goalBar = document.getElementById('goalBar');
  const goalInput = document.getElementById('goalInput');
  const goalCount = document.getElementById('goalCount');
  const goalPct = document.getElementById('goalPct');
  const goalRingFill = document.getElementById('goalRingFill');
  if (!goalBar) return;

  // Week starts on Monday
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const thisWeekCount = apps.filter(a => new Date(a.dateApplied || a.createdAt) >= weekStart).length;
  const pct = weeklyGoal > 0 ? Math.min(100, Math.round((thisWeekCount / weeklyGoal) * 100)) : 0;

  if (goalRingFill) goalRingFill.style.strokeDasharray = pct + ', 100';

  goalBar.style.width = pct + '%';
  goalBar.className = 'goal-bar' + (pct < 50 ? ' goal-behind' : '');

  if (goalCount) goalCount.innerHTML = `<strong>${thisWeekCount}</strong> / ${weeklyGoal}`;
  if (goalPct) goalPct.textContent = pct + '%';
  if (goalInput) goalInput.value = weeklyGoal;
}

document.getElementById('editGoalBtn')?.addEventListener('click', () => {
  const inputGroup = document.getElementById('goalInputGroup');
  const display = document.getElementById('goalDisplay');
  const goalInput = document.getElementById('goalInput');
  inputGroup?.classList.toggle('hidden');
  display?.classList.toggle('hidden');
  if (goalInput) goalInput.value = weeklyGoal;
  document.getElementById('editGoalBtn').textContent =
    inputGroup?.classList.contains('hidden') ? 'Edit' : 'Cancel';
});

document.getElementById('saveGoalBtn')?.addEventListener('click', () => {
  const goalInput = document.getElementById('goalInput');
  const val = parseInt(goalInput?.value, 10);
  if (val >= 1 && val <= 100) {
    weeklyGoal = val;
    // Saved in DB for cross-device sync
    fetch('/api/settings/weeklyGoal', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: val })
    });
    showToast('Weekly goal set to ' + val, 'success');
  } else {
    showToast('Goal must be between 1 and 100', 'error');
  }
  document.getElementById('goalInputGroup')?.classList.add('hidden');
  document.getElementById('goalDisplay')?.classList.remove('hidden');
  document.getElementById('editGoalBtn').textContent = 'Edit';
  renderWeeklyGoal();
});

// ============================================================
// STAT CARDS
// ============================================================

function renderStatCards(stats) {
  const active = STATUSES
    .filter(s => !CLOSED_STATUSES.includes(s))
    .reduce((sum, s) => sum + (stats.byStatus[s] || 0), 0);

  document.getElementById('stats').innerHTML = `
    <div class="stat stat-clickable" data-stat-filter="All">
      <div class="n">${stats.total}</div>
      <div class="l">Total</div>
    </div>

    <div class="stat active stat-clickable" data-stat-filter="Active">
      <div class="n">${active}</div>
      <div class="l">Active</div>
    </div>

    <div class="stat pending stat-clickable" data-stat-filter="OA/Task Pending">
      <div class="n">${stats.byStatus['OA/Task Pending'] || 0}</div>
      <div class="l">Task pending</div>
    </div>

    <div class="stat overdue stat-clickable" data-stat-filter="Follow-up Due">
      <div class="n">${stats.overdueFollowups}</div>
      <div class="l">Follow-up due</div>
    </div>

    <div class="stat priority stat-clickable" data-stat-filter="Priority">
      <div class="n">${stats.priorityCount || 0}</div>
      <div class="l">⭐ Favourites</div>
    </div>

    <div class="stat stat-clickable" data-stat-filter="NonPriority">
      <div class="n">${stats.nonPriorityCount || 0}</div>
      <div class="l">Non-favourites</div>
    </div>
  `;

  document.querySelectorAll('.stat-clickable').forEach(card => {
    card.onclick = () => {
      filter = card.dataset.statFilter;
      currentPage = 1;
      render();
      document.getElementById('applicationsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

// ============================================================
// CHARTS
// ============================================================

function chartColors() {
  const styles = getComputedStyle(document.body);
  return {
    text: styles.getPropertyValue('--ink').trim(),
    soft: styles.getPropertyValue('--ink-soft').trim(),
    grid: styles.getPropertyValue('--line').trim()
  };
}

function renderCharts(stats) {
  lastStats = stats;

  const chartsGrid = document.getElementById('chartsGrid');
  const emptyState = document.getElementById('chartsEmptyState');

  // Nothing added yet: show a friendly empty state instead of blank charts.
  if (chartsGrid && emptyState) {
    const hasData = !!stats.total;
    emptyState.classList.toggle('hidden', hasData);
    chartsGrid.querySelectorAll('.chart-box').forEach(box => {
      box.classList.toggle('hidden', !hasData);
    });
    if (!hasData) return;
  }

  const c = chartColors();
  const isNarrow = window.innerWidth < 680;

  const palette = [
    '#0F6B5C', '#B8791A', '#C13F2B', '#4A5568', '#7C9885',
    '#D4A574', '#8E6C88', '#5B7C99', '#9333EA', '#2563EB'
  ];

  // ---- Status chart ----
  if (charts.status) charts.status.destroy();
  charts.status = new Chart(document.getElementById('statusChart'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(stats.byStatus),
      datasets: [{ data: Object.values(stats.byStatus), backgroundColor: palette }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: isNarrow ? 8 : 9 }, boxWidth: 8, padding: 6, color: c.soft }
        },
        title: { display: true, text: 'By status', font: { size: 11 }, color: c.text }
      }
    }
  });

  // ---- Source chart ----
  if (charts.source) charts.source.destroy();
  charts.source = new Chart(document.getElementById('sourceChart'), {
    type: 'bar',
    data: {
      labels: Object.keys(stats.bySource),
      datasets: [{ data: Object.values(stats.bySource), backgroundColor: '#0F6B5C' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'By source', font: { size: 11 }, color: c.text }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: c.soft, font: { size: isNarrow ? 8 : 10 } },
          grid: { color: c.grid }
        },
        x: {
          ticks: {
            color: c.soft,
            font: { size: isNarrow ? 7 : 10 },
            maxRotation: 60,
            minRotation: isNarrow ? 60 : 0,
            autoSkip: false
          },
          grid: { color: c.grid }
        }
      }
    }
  });

  // ---- Weekly chart ----
  if (charts.weekly) charts.weekly.destroy();
  charts.weekly = new Chart(document.getElementById('weeklyChart'), {
    type: 'line',
    data: {
      labels: stats.weeks.map(w => w.label),
      datasets: [{
        data: stats.weeks.map(w => w.count),
        borderColor: '#0F6B5C',
        backgroundColor: '#0F6B5C33',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Applications per week', font: { size: 11 }, color: c.text }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: c.soft, font: { size: isNarrow ? 8 : 10 } },
          grid: { color: c.grid }
        },
        x: {
          ticks: { color: c.soft, font: { size: isNarrow ? 7 : 10 }, maxRotation: 45 },
          grid: { color: c.grid }
        }
      }
    }
  });

  // ---- Conversion funnel: Applied -> Responded -> Interview -> Offer ----
  if (charts.funnel) charts.funnel.destroy();
  const f = stats.funnel || { applied: 0, responded: 0, interview: 0, offer: 0 };
  charts.funnel = new Chart(document.getElementById('funnelChart'), {
    type: 'bar',
    data: {
      labels: ['Applied', 'Responded', 'Interview', 'Offer'],
      datasets: [{
        data: [f.applied, f.responded, f.interview, f.offer],
        backgroundColor: ['#4A5568', '#B8791A', '#0F6B5C', '#0F6B5C'],
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Conversion funnel', font: { size: 11 }, color: c.text },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = f.applied ? Math.round((ctx.parsed.x / f.applied) * 100) : 0;
              return `${ctx.parsed.x} (${pct}% of applied)`;
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1, color: c.soft, font: { size: isNarrow ? 8 : 10 } }, grid: { color: c.grid } },
        y: { ticks: { color: c.soft, font: { size: isNarrow ? 9 : 11 } }, grid: { display: false } }
      }
    }
  });

  // ---- Source-wise interview rate ----
  if (charts.success) charts.success.destroy();
  const ss = stats.sourceSuccess || {};
  const successLabels = Object.keys(ss).filter(k => ss[k].total > 0);
  charts.success = new Chart(document.getElementById('successChart'), {
    type: 'bar',
    data: {
      labels: successLabels,
      datasets: [{ data: successLabels.map(k => ss[k].pct), backgroundColor: '#0F6B5C' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Interview rate by source', font: { size: 11 }, color: c.text },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const k = successLabels[ctx.dataIndex];
              return `${ss[k].pct}% (${ss[k].interviewed} of ${ss[k].total})`;
            }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { color: c.soft, font: { size: isNarrow ? 8 : 10 }, callback: v => v + '%' }, grid: { color: c.grid } },
        x: { ticks: { color: c.soft, font: { size: isNarrow ? 7 : 10 }, maxRotation: 60, minRotation: isNarrow ? 60 : 0 }, grid: { color: c.grid } }
      }
    }
  });

  renderResponseTime(stats);
}

function renderResponseTime(stats) {
  const overallEl = document.getElementById('responseOverall');
  const listEl = document.getElementById('responseList');
  if (!overallEl || !listEl) return;

  overallEl.textContent = (stats.avgResponseDays === null || stats.avgResponseDays === undefined)
    ? '—'
    : `${stats.avgResponseDays} day${stats.avgResponseDays === 1 ? '' : 's'}`;

  const rows = stats.responseTimeByCompany || [];
  if (!rows.length) {
    listEl.innerHTML = `<div style="font-size:10.5px;color:var(--ink-soft)">No responses tracked yet.</div>`;
    return;
  }
  listEl.innerHTML = rows.map(r => `
    <div class="response-row">
      <span class="rc">${esc(r.company)}</span>
      <span>${r.avgDays}d</span>
    </div>
  `).join('');
}

// Redraw charts on resize and once web fonts are ready
let resizeTimer;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (lastStats) renderCharts(lastStats);
  }, 200);
});

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    if (lastStats) renderCharts(lastStats);
  });
}

// ============================================================
// FILTERS
// ============================================================

function renderFilters() {
  // "Active" is the default view (hides Rejected / Ghosted / No Response).
  const cats = ['Active', 'All', 'Follow-up Due', ...STATUSES];

  document.getElementById('filters').innerHTML = cats
    .map(c => `<button data-f="${c}" class="${filter === c ? 'active' : ''}">${c}</button>`)
    .join('');

  document.querySelectorAll('#filters button').forEach(b => {
    b.onclick = () => {
      filter = b.dataset.f;
      currentPage = 1;
      render();
    };
  });
}

// ============================================================
// KANBAN / PIPELINE VIEW
// ============================================================

function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const kanbanStatuses = [
    'Applied', 'Mail Not Found', 'Under Consideration', 'OA/Task Pending',
    'Interview Scheduled', 'Interviewed', 'Offer'
  ];

  const colColors = {
    'Applied': '#4A5568',
    'Mail Not Found': '#8E6C88',
    'Under Consideration': '#0F6B5C',
    'OA/Task Pending': '#B8791A',
    'Interview Scheduled': '#7C3AED',
    'Interviewed': '#2563EB',
    'Offer': '#059669'
  };

  let html = '';

  kanbanStatuses.forEach(status => {
    const items = apps.filter(a => a.status === status);
    const accent = colColors[status] || '#4A5568';
    const cardsHtml = items.length === 0
      ? '<div class="kanban-empty">Drop here</div>'
      : items.map(kanbanCard).join('');
    html += `<div class="kanban-col" style="border-top: 3px solid ${accent}">
      <div class="kanban-col-header">
        <span class="kanban-col-title" style="color:${accent}">${status}</span>
        <span class="kanban-col-count">${items.length}</span>
      </div>
      <div class="kanban-cards" data-drop-status="${status}">
        ${cardsHtml}
      </div>
    </div>`;
  });

  // Rejected / No Response / Ghosted combined
  const closedItems = apps.filter(a => CLOSED_STATUSES.includes(a.status));
  const closedCardsHtml = closedItems.length === 0
    ? '<div class="kanban-empty">Drop here</div>'
    : closedItems.map(kanbanCard).join('');
  html += `<div class="kanban-col" style="border-top: 3px solid #C13F2B">
    <div class="kanban-col-header">
      <span class="kanban-col-title" style="color:#C13F2B">Closed</span>
      <span class="kanban-col-count">${closedItems.length}</span>
    </div>
    <div class="kanban-cards" data-drop-status="Rejected">
      ${closedCardsHtml}
    </div>
  </div>`;

  board.innerHTML = html;

  initKanbanDragDrop();
}

function kanbanCard(a) {
  const applied = a.dateApplied
    ? new Date(a.dateApplied).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const priorityStar = a.priority ? '<span class="kanban-card-priority">★</span> ' : '';
  const dateSpan = applied ? `<span class="kanban-card-date">${applied}</span>` : '';
  const mailSpan = a.mailCount ? `<span class="kanban-card-source">✉ ×${a.mailCount}</span>` : '';
  return `<div class="kanban-card" draggable="true" data-app-id="${a._id}">
    <div class="kanban-card-company">
      ${priorityStar}${esc(a.company)}
    </div>
    <div class="kanban-card-role">${esc(a.role || '')}</div>
    <div class="kanban-card-meta">
      <span class="kanban-card-source">${esc(a.source)}</span>
      ${mailSpan}
      ${dateSpan}
      ${riskHtml(a)}
    </div>
  </div>`;
}

let draggedAppId = null;

function initKanbanDragDrop() {
  const cards = document.querySelectorAll('.kanban-card[draggable]');
  const dropZones = document.querySelectorAll('.kanban-cards');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedAppId = card.dataset.appId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedAppId = null;
      document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
    });
  });

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.closest('.kanban-col').classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) {
        zone.closest('.kanban-col').classList.remove('drag-over');
      }
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.closest('.kanban-col').classList.remove('drag-over');
      const newStatus = zone.dataset.dropStatus;
      const id = draggedAppId;
      if (!id || !newStatus) return;

      const app = apps.find(a => a._id === id);
      if (!app || app.status === newStatus) return;
      // Dropping a closed card back on "Closed" keeps its exact status
      if (newStatus === 'Rejected' && CLOSED_STATUSES.includes(app.status)) return;

      await fetch(API + '/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (newStatus === 'Offer') fireConfetti();

      showToast(app.company + ' → ' + newStatus, 'success');
      await loadApps();
      await loadStats();
    });
  });
}

// ============================================================
// APPLICATIONS TABLE
// ============================================================

let bulkSelectedIds = [];
let isPrinting = false;

function render() {
  renderFilters();
  renderTable();
  updateBulkBar();
}

function renderTable() {
  let list = apps.slice();

  // Filter
  if (filter === 'Follow-up Due') {
    list = list.filter(isOverdue);
  } else if (filter === 'Priority') {
    list = list.filter(a => a.priority);
  } else if (filter === 'NonPriority') {
    list = list.filter(a => !a.priority);
  } else if (filter === 'Active') {
    // Searching looks through everything, so a rejected company is still findable.
    if (!searchTerm) list = list.filter(a => !CLOSED_STATUSES.includes(a.status));
  } else if (filter !== 'All') {
    list = list.filter(a => a.status === filter);
  }

  // Search (includes notes)
  if (searchTerm) {
    list = list.filter(a =>
      (a.company || '').toLowerCase().includes(searchTerm) ||
      (a.role || '').toLowerCase().includes(searchTerm) ||
      (a.notes || '').toLowerCase().includes(searchTerm)
    );
  }

  // Sort (click a column header)
  list.sort((a, b) => {
    let va, vb;
    switch (sortCol) {
      case 'company':
        va = (a.company || '').toLowerCase();
        vb = (b.company || '').toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      case 'status':
        va = STATUSES.indexOf(a.status);
        vb = STATUSES.indexOf(b.status);
        return sortDir === 'asc' ? va - vb : vb - va;
      case 'source':
        va = (a.source || '').toLowerCase();
        vb = (b.source || '').toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      case 'date':
      default:
        va = new Date(a.createdAt || a.dateApplied);
        vb = new Date(b.createdAt || b.dateApplied);
        return sortDir === 'asc' ? va - vb : vb - va;
    }
  });

  const wrap = document.getElementById('tableWrap');
  const total = list.length;

  if (total === 0) {
    wrap.innerHTML = `
      <div class="empty">
        ${apps.length ? 'No applications match this view.' : 'No applications here yet. Add your first one above.'}
      </div>
    `;
    return;
  }

  // When printing, show ALL items without pagination
  const totalPages = isPrinting ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (!isPrinting && currentPage > totalPages) currentPage = totalPages;
  const pageItems = isPrinting
    ? list
    : list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const sortClass = (col) => (sortCol !== col ? 'sortable' : 'sortable sort-' + sortDir);
  const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const allOnPageSelected = pageItems.every(a => bulkSelectedIds.includes(a._id));

  wrap.innerHTML = `
    <div class="result-count">
      ${isPrinting
        ? 'All ' + total + ' application' + (total === 1 ? '' : 's') + ' (print view)'
        : total + ' application' + (total === 1 ? '' : 's') + ' · page ' + currentPage + ' of ' + totalPages}
    </div>

    <table>
      <thead>
        <tr>
          <th class="bulk-th" colspan="2">
            <input type="checkbox" class="bulk-check" id="selectAll" title="Select all on this page"
              ${allOnPageSelected ? 'checked' : ''}>
          </th>
          <th class="${sortClass('company')}" data-sort="company">Company / Role</th>
          <th class="${sortClass('source')}" data-sort="source">Source</th>
          <th class="${sortClass('date')}" data-sort="date">Applied</th>
          <th class="${sortClass('status')}" data-sort="status">Status</th>
          <th>Follow-up (every 3d)</th>
          <th>Notes</th>
        </tr>
      </thead>

      <tbody>
        ${pageItems.map(a => {
          const applied = a.dateApplied ? shortDate(a.dateApplied) : '—';
          const skip = ['Rejected', 'Offer'].includes(a.status);
          const isSelected = bulkSelectedIds.includes(a._id);
          const risk = getRisk(a);
          const mails = a.mailCount || 0;

          let followupHtml;
          if (skip) {
            followupHtml = '<span class="followup ok">—</span>';
          } else if (isOverdue(a)) {
            followupHtml = `
              <div class="followup-prompt">
                <span class="followup overdue">Followed up?</span>
                <div class="radio-row">
                  <label><input type="radio" name="fu-${a._id}" value="yes"> Yes</label>
                  <label><input type="radio" name="fu-${a._id}" value="no"> No</label>
                  <button class="snooze-btn" data-snooze="${a._id}" title="Remind me later">⏰ Snooze</button>
                </div>
              </div>
            `;
          } else {
            followupHtml = `<span class="followup ok">next check ${shortDate(a.nextFollowupDate)}</span>`;
          }

          return `
            <tr data-id="${a._id}" ${isSelected ? 'class="bulk-selected"' : ''}>
              <td class="cell-del">
                <button data-del="${a._id}" title="Delete" class="delete-job">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </td>
              <td class="cell-check">
                <input type="checkbox" class="bulk-check" data-bulk-id="${a._id}" ${isSelected ? 'checked' : ''}>
              </td>

              <td data-label="Company">
                <div class="company-row">
                  <button class="star-btn ${a.priority ? 'starred' : ''}" data-star="${a._id}" title="Toggle priority">${a.priority ? '★' : '☆'}</button>
                  <div class="company editable-cell" data-inline-field="company" data-inline-id="${a._id}">${esc(a.company)}</div>
                </div>

                <div class="role editable-cell" data-inline-field="role" data-inline-id="${a._id}">${esc(a.role || '')}</div>

                ${a.eventDate ? `
                  <div class="cal-event-label">
                    📅 ${esc(a.eventLabel || 'Event')} · ${shortDate(a.eventDate)}
                  </div>
                ` : ''}

                ${a.portalLink ? `
                  <a class="portal-link" href="${esc(a.portalLink)}" target="_blank" rel="noopener">Track status ↗</a>
                ` : ''}

                <div>
                  <div class="mail-chip ${mails ? 'has-mails' : ''}" title="Cold mails sent">
                    <button type="button" data-mail="${a._id}" data-delta="-1" aria-label="One less mail">−</button>
                    <span class="mail-chip-label">✉ ${mails}${mails && a.lastMailedAt ? ' · ' + shortDate(a.lastMailedAt) : ''}</span>
                    <button type="button" data-mail="${a._id}" data-delta="1" aria-label="Mail sent">+</button>
                  </div>
                </div>

                ${risk ? `
                  <div style="margin-top:4px"><span class="risk-dot risk-${risk.level}"></span><span class="risk-label risk-label-${risk.level}">${risk.label}</span></div>
                ` : ''}
              </td>

              <td data-label="Source">${esc(a.source)}</td>

              <td data-label="Applied">${applied}</td>

              <td data-label="Status">
                <select class="status-select" data-id="${a._id}">
                  ${STATUSES.map(s => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </td>

              <td data-label="Follow-up">${followupHtml}</td>

              <td class="notes" data-label="Notes" data-notes-id="${a._id}">
                ${a.notes ? linkify(a.notes) : '<span style="opacity:0.5">— click to add —</span>'}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>

    ${totalPages > 1 ? renderPagination(totalPages) : ''}
  `;

  // ---- Sort headers ----
  wrap.querySelectorAll('th.sortable').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.sort;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }
      render();
    };
  });

  // ---- Bulk checkboxes ----
  const setSelected = (id, on) => {
    if (on) {
      if (!bulkSelectedIds.includes(id)) bulkSelectedIds.push(id);
    } else {
      bulkSelectedIds = bulkSelectedIds.filter(x => x !== id);
    }
  };

  const selectAllEl = document.getElementById('selectAll');
  if (selectAllEl) {
    selectAllEl.onchange = () => {
      wrap.querySelectorAll('[data-bulk-id]').forEach(cb => {
        cb.checked = selectAllEl.checked;
        cb.closest('tr')?.classList.toggle('bulk-selected', cb.checked);
        setSelected(cb.dataset.bulkId, cb.checked);
      });
      updateBulkBar();
    };
  }

  wrap.querySelectorAll('[data-bulk-id]').forEach(cb => {
    cb.onchange = () => {
      cb.closest('tr')?.classList.toggle('bulk-selected', cb.checked);
      setSelected(cb.dataset.bulkId, cb.checked);
      updateBulkBar();
    };
  });

  // ---- Status change ----
  wrap.querySelectorAll('.status-select').forEach(sel => {
    sel.onchange = async () => {
      await fetch(`${API}/${sel.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: sel.value })
      });

      showToast('Status updated', 'success');
      if (sel.value === 'Offer') fireConfetti();

      await loadApps();
      await loadStats();
    };
  });

  // ---- Priority star ----
  wrap.querySelectorAll('[data-star]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.star;
      const app = apps.find(a => a._id === id);
      if (!app) return;
      const newVal = !app.priority;

      await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newVal })
      });

      showToast(newVal ? 'Marked as priority' : 'Priority removed', 'success');
      await loadApps();
      await loadStats();
    };
  });

  // ---- Cold mail counter (+ / −) ----
  wrap.querySelectorAll('[data-mail]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.mail;
      const app = apps.find(a => a._id === id);
      if (!app) return;

      const delta = parseInt(btn.dataset.delta, 10);
      const current = app.mailCount || 0;
      const mailCount = Math.max(0, current + delta);
      if (mailCount === current) return;

      const body = { mailCount };
      if (delta > 0) body.lastMailedAt = new Date().toISOString();

      await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      showToast(delta > 0 ? `Mail #${mailCount} logged` : 'Mail count reduced', 'success');
      await loadApps();
    };
  });

  // ---- Inline edit (double-click company / role) ----
  wrap.querySelectorAll('[data-inline-field]').forEach(cell => {
    cell.ondblclick = () => {
      if (cell.querySelector('input')) return; // already editing
      const id = cell.dataset.inlineId;
      const field = cell.dataset.inlineField;
      const appData = apps.find(a => a._id === id);
      if (!appData) return;

      const currentVal = appData[field] || '';
      cell.innerHTML = '<input class="inline-edit" type="text" value="' + esc(currentVal) + '">';
      const input = cell.querySelector('input');
      input.focus();
      input.select();

      let cancelled = false;
      input.onblur = async () => {
        const newVal = input.value.trim();
        // Company can't be empty; unchanged or cancelled = just restore
        if (cancelled || newVal === currentVal || (field === 'company' && !newVal)) {
          cell.textContent = currentVal;
          return;
        }
        await fetch(API + '/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: newVal })
        });
        showToast((field === 'company' ? 'Company' : 'Role') + ' updated', 'success');
        await loadApps();
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { cancelled = true; input.blur(); }
      };
    };
  });

  // ---- Notes: open modal when clicking the notes cell ----
  wrap.querySelectorAll('[data-notes-id]').forEach(cell => {
    cell.onclick = (e) => {
      if (e.target.closest('a')) return; // let "Open link" work normally
      openNotesModal(cell.dataset.notesId);
    };
  });

  // ---- Delete (with undo) ----
  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.del;
      const deletedApp = apps.find(a => a._id === id);
      const label = deletedApp ? deletedApp.company : 'this application';
      const confirmed = await askConfirm(`Delete ${label}?`);
      if (!confirmed) return;

      await fetch(`${API}/${id}`, { method: 'DELETE' });
      bulkSelectedIds = bulkSelectedIds.filter(x => x !== id);

      await loadApps();
      await loadStats();

      if (deletedApp) {
        pendingUndo = [deletedApp];
        showUndoToast('Deleted ' + label, undoDelete);
      }
    };
  });

  // ---- Follow-up yes / no ----
  wrap.querySelectorAll('input[type=radio]').forEach(radio => {
    radio.onchange = async (e) => {
      const id = e.target.name.replace('fu-', '');
      const answered = e.target.value === 'yes';

      await fetch(`${API}/${id}/followup`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answered })
      });

      showToast(answered ? 'Nice — next check in 3 days' : 'Noted — next check in 3 days', 'success');

      await loadApps();
      await loadStats();
    };
  });

  // ---- Snooze follow-up ----
  wrap.querySelectorAll('[data-snooze]').forEach(btn => {
    btn.onclick = () => showSnoozeModal(btn.dataset.snooze);
  });

  // ---- Pagination ----
  wrap.querySelectorAll('.pagination button[data-page]').forEach(btn => {
    btn.onclick = () => {
      currentPage = parseInt(btn.dataset.page, 10);
      renderTable();
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function renderPagination(totalPages) {
  const pages = [];

  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  return `
    <div class="pagination">
      <button data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>‹</button>
      ${pages.map(p => p === '...'
        ? '<span style="padding:0 4px;color:var(--ink-soft)">…</span>'
        : `<button data-page="${p}" class="${p === currentPage ? 'active' : ''}">${p}</button>`
      ).join('')}
      <button data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>›</button>
    </div>
  `;
}

// ============================================================
// UNDO DELETE
// ============================================================

// Body used to re-create an application on Undo
function restoreBody(d) {
  return {
    company: d.company, role: d.role, source: d.source,
    dateApplied: d.dateApplied, notes: d.notes,
    portalLink: d.portalLink, status: d.status,
    priority: d.priority, eventDate: d.eventDate, eventLabel: d.eventLabel,
    mailCount: d.mailCount, lastMailedAt: d.lastMailedAt,
    createdAt: d.createdAt
  };
}

// Re-creates whatever is in pendingUndo (one or many applications)
async function undoDelete() {
  if (!pendingUndo) return;
  const items = pendingUndo;
  pendingUndo = null;

  for (const d of items) {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(restoreBody(d))
    });
  }

  showToast(
    items.length === 1 ? 'Restored ' + items[0].company : `Restored ${items.length} applications`,
    'success'
  );
  await loadApps();
  await loadStats();
  await loadCalendar();
}

// ============================================================
// NOTES MODAL (per-application notes)
// Opens read-only; "Edit" enables editing, then the button becomes "Save".
// ============================================================

let notesModalAppId = null;
let notesIsEditMode = false;

const notesModal = document.getElementById('notesModal');
const notesTextarea = document.getElementById('notesModalTextarea');
const notesModalSave = document.getElementById('notesModalSave');
const notesModalCancel = document.getElementById('notesModalCancel');

function setNotesReadOnly(readonly) {
  notesTextarea.readOnly = readonly;
  notesTextarea.style.background = readonly ? 'var(--slate-soft)' : 'var(--bg)';
  notesTextarea.style.cursor = readonly ? 'default' : 'text';
  notesModalSave.textContent = readonly ? 'Edit' : 'Save';
}

function openNotesModal(id) {
  const app = apps.find(a => a._id === id);
  if (!app || !notesModal) return;

  notesModalAppId = id;
  notesTextarea.value = app.notes || '';

  // Empty notes: go straight to editing, nothing to read yet
  notesIsEditMode = !app.notes;
  setNotesReadOnly(!notesIsEditMode);

  notesModal.classList.remove('hidden');
  notesModal.classList.add('notes-modal-open');
  if (notesIsEditMode) notesTextarea.focus();
}

function closeNotesModal() {
  if (!notesModal) return;
  notesModalAppId = null;
  notesIsEditMode = false;
  notesModal.classList.add('hidden');
  notesModal.classList.remove('notes-modal-open');
}

async function saveNotesFromModal() {
  if (!notesModalAppId) return;

  const id = notesModalAppId;
  const newNotes = notesTextarea.value.trim();
  const app = apps.find(a => a._id === id);
  const currentNotes = app ? (app.notes || '') : '';

  closeNotesModal();
  if (newNotes === currentNotes) return;

  await fetch(`${API}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: newNotes })
  });

  showToast('Notes updated', 'success');
  await loadApps();
}

if (notesModal) {
  notesModalSave.onclick = () => {
    if (!notesIsEditMode) {
      notesIsEditMode = true;
      setNotesReadOnly(false);
      notesTextarea.focus();
    } else {
      saveNotesFromModal();
    }
  };

  notesModalCancel.onclick = closeNotesModal;

  notesModal.onclick = (e) => {
    if (e.target.id === 'notesModal') closeNotesModal();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !notesModal.classList.contains('hidden')) closeNotesModal();
  });

  // Ctrl+Enter / Cmd+Enter saves while editing
  notesTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && notesIsEditMode) {
      e.preventDefault();
      saveNotesFromModal();
    }
  });
}

// ============================================================
// BULK ACTIONS
// ============================================================

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const countEl = document.getElementById('bulkCount');
  if (!bar || !countEl) return;
  bar.classList.toggle('hidden', bulkSelectedIds.length === 0);
  countEl.textContent = bulkSelectedIds.length + ' selected';
}

document.getElementById('bulkApplyBtn')?.addEventListener('click', async () => {
  const newStatus = document.getElementById('bulkStatusSelect')?.value;
  if (!newStatus || !bulkSelectedIds.length) {
    showToast('Select a status first', 'error');
    return;
  }
  try {
    await Promise.all(bulkSelectedIds.map(id =>
      fetch(API + '/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
    ));
    showToast('Updated ' + bulkSelectedIds.length + ' applications to ' + newStatus, 'success');
    if (newStatus === 'Offer') fireConfetti();
  } catch (err) {
    console.error('Bulk update failed:', err);
    showToast('Some updates failed', 'error');
  } finally {
    bulkSelectedIds = [];
    document.getElementById('bulkStatusSelect').value = '';
    await loadApps();
    await loadStats();
  }
});

document.getElementById('bulkCancelBtn')?.addEventListener('click', () => {
  bulkSelectedIds = [];
  render();
});

document.getElementById('bulkDeleteBtn')?.addEventListener('click', async () => {
  if (!bulkSelectedIds.length) {
    showToast('No applications selected', 'error');
    return;
  }
  const count = bulkSelectedIds.length;
  const countLabel = `${count} application${count > 1 ? 's' : ''}`;
  const confirmed = await askConfirm(`Delete ${countLabel}?`);
  if (!confirmed) return;

  // Keep a copy for undo
  const deletedApps = bulkSelectedIds
    .map(id => apps.find(a => a._id === id))
    .filter(Boolean);

  await Promise.all(bulkSelectedIds.map(id =>
    fetch(`${API}/${id}`, { method: 'DELETE' })
  ));

  bulkSelectedIds = [];
  await loadApps();
  await loadStats();

  if (deletedApps.length) {
    pendingUndo = deletedApps;
    showUndoToast(`Deleted ${countLabel}`, undoDelete);
  }
});

// ============================================================
// DUPLICATE WARNING (add form)
// ============================================================

// Returns { exact, company }: an app with the same company + role, or
// (if there is no exact match) one with just the same company.
function findDuplicate(company, role) {
  const c = (company || '').toLowerCase().trim();
  const r = (role || '').toLowerCase().trim();
  if (!c) return { exact: null, company: null };

  const sameCompany = apps.filter(a => (a.company || '').toLowerCase().trim() === c);
  const exact = r ? sameCompany.find(a => (a.role || '').toLowerCase().trim() === r) : null;
  return { exact: exact || null, company: exact ? null : (sameCompany[0] || null) };
}

function duplicateMessage(dup) {
  if (dup.exact) {
    return '🔴 "' + dup.exact.company + ' — ' + (dup.exact.role || 'No role') + '" already exists (' + dup.exact.status + '). Add duplicate?';
  }
  return '⚠️ "' + dup.company.company + '" already exists (' + dup.company.status + '). Add another entry?';
}

function checkDuplicate() {
  const warning = document.getElementById('duplicateWarning');
  if (!warning) return;

  const dup = findDuplicate(
    document.getElementById('f-company').value,
    document.getElementById('f-role').value
  );

  warning.classList.remove('show', 'dup-company', 'dup-exact');
  if (!dup.exact && !dup.company) return;

  warning.classList.add('show', dup.exact ? 'dup-exact' : 'dup-company');
  warning.textContent = duplicateMessage(dup);
}

document.getElementById('f-company')?.addEventListener('input', checkDuplicate);
document.getElementById('f-role')?.addEventListener('input', checkDuplicate);

// ============================================================
// PRINT
// ============================================================

document.getElementById('printBtn')?.addEventListener('click', () => {
  // Temporarily show ALL applications (no pagination) for print
  isPrinting = true;
  renderTable();

  setTimeout(() => {
    window.print();
    isPrinting = false;
    renderTable();
  }, 100);
});

// ============================================================
// ADD APPLICATION
// ============================================================

document.getElementById('addBtn').onclick = async () => {
  const company = document.getElementById('f-company').value.trim();

  if (!company) {
    showToast('Company name needed', 'error');
    return;
  }

  const body = {
    company,
    role: document.getElementById('f-role').value.trim(),
    source: document.getElementById('f-source').value,
    dateApplied: document.getElementById('f-date').value || undefined,
    notes: document.getElementById('f-notes').value.trim(),
    portalLink: document.getElementById('f-portal').value.trim(),
    priority: document.getElementById('f-priority').checked,
    eventDate: document.getElementById('f-eventdate').value || undefined,
    eventLabel: document.getElementById('f-eventlabel').value.trim()
  };

  // Company already exists -> ask before adding again
  const dup = findDuplicate(body.company, body.role);
  if (dup.exact || dup.company) {
    const ok = await askConfirm(duplicateMessage(dup), {
      confirmText: dup.exact ? 'Yes, Add Duplicate' : 'Add Anyway',
      confirmClass: dup.exact ? 'confirm-danger' : 'confirm-add'
    });
    if (!ok) return;
  }

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    showToast('Could not add application', 'error');
    return;
  }

  ['f-company', 'f-role', 'f-date', 'f-notes', 'f-portal', 'f-eventdate', 'f-eventlabel']
    .forEach(id => { document.getElementById(id).value = ''; });

  document.getElementById('f-priority').checked = false;
  document.getElementById('starToggle').classList.remove('starred');
  document.getElementById('starToggle').textContent = '☆ Priority';
  document.getElementById('f-source').value = 'Wellfound';
  document.getElementById('duplicateWarning')?.classList.remove('show');

  showToast('Added', 'success');

  await loadApps();
  await loadStats();
  await loadCalendar();
};

// Enter in the company field = quick add
document.getElementById('f-company').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('addBtn').click();
  }
});

// Show / hide the add form
document.getElementById('toggleForm').onclick = () => {
  const body = document.getElementById('formBody');
  const btn = document.getElementById('toggleForm');
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  btn.textContent = hidden ? 'Hide' : 'Show';
};

// Mobile floating "+" button
document.getElementById('fab')?.addEventListener('click', () => {
  document.getElementById('formBody').style.display = '';
  document.getElementById('toggleForm').textContent = 'Hide';
  document.getElementById('f-company').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => document.getElementById('f-company').focus(), 300);
});

// Priority star in the add form
document.getElementById('starToggle')?.addEventListener('click', () => {
  const checkbox = document.getElementById('f-priority');
  const btn = document.getElementById('starToggle');
  checkbox.checked = !checkbox.checked;
  btn.classList.toggle('starred', checkbox.checked);
  btn.textContent = checkbox.checked ? '★ Priority' : '☆ Priority';
});

// Interview / OA deadline fields in the add form
document.getElementById('toggleAdvanced')?.addEventListener('click', () => {
  const fields = document.getElementById('advancedFields');
  const btn = document.getElementById('toggleAdvanced');
  const nowHidden = fields.classList.toggle('hidden');
  btn.textContent = nowHidden ? '+ Interview / OA deadline date' : '− Hide interview / OA deadline date';
});

// ============================================================
// CSV EXPORT / IMPORT
// ============================================================

const CSV_COLUMNS = ['company', 'role', 'source', 'dateApplied', 'status', 'notes', 'portalLink'];
const VALID_SOURCES = ['Wellfound', 'Naukri', 'Internshala', 'HiringCafe', 'Company site', 'Cold email', 'LinkedIn', 'Referral', 'Other'];

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = (value === undefined || value === null) ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportCsv() {
  if (!apps.length) {
    showToast('Nothing to export yet', 'error');
    return;
  }
  const header = CSV_COLUMNS.join(',');
  const rows = apps.map(a => CSV_COLUMNS.map(col => {
    if (col === 'dateApplied') return csvEscape(a.dateApplied ? new Date(a.dateApplied).toISOString().slice(0, 10) : '');
    return csvEscape(a[col]);
  }).join(','));

  downloadCsv(`applications-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows].join('\n'));
  showToast(`Exported ${apps.length} applications`, 'success');
}

// CSV parser: handles quoted fields with embedded commas, quotes and
// line breaks (multi-line notes exported by exportCsv).
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  const src = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n') {
      row.push(cur); cur = '';
      rows.push(row); row = [];
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  rows.push(row);

  const filled = rows.filter(r => r.some(cell => cell.trim() !== ''));
  if (!filled.length) return [];

  const header = filled[0].map(h => h.trim());
  return filled.slice(1).map(cells => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  });
}

async function importCsv(file) {
  const rows = parseCsv(await file.text());
  const validRows = rows.filter(r => r.company);

  if (!validRows.length) {
    showToast('No valid rows found (need a "company" column)', 'error');
    return;
  }

  let imported = 0;
  for (const row of validRows) {
    const body = {
      company: row.company,
      role: row.role || '',
      source: VALID_SOURCES.includes(row.source) ? row.source : 'Other',
      dateApplied: row.dateApplied || undefined,
      notes: row.notes || '',
      portalLink: row.portalLink || '',
      status: STATUSES.includes(row.status) ? row.status : 'Applied'
    };
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) imported++;
    } catch (e) { /* skip failed row, keep going */ }
  }

  showToast(`Imported ${imported} of ${validRows.length} rows`, imported ? 'success' : 'error');
  await loadApps();
  await loadStats();
}

document.getElementById('exportCsvBtn')?.addEventListener('click', exportCsv);

// Import CSV — show the help dialog first
document.getElementById('importCsvBtn')?.addEventListener('click', () => {
  document.getElementById('csvImportModal')?.classList.remove('hidden');
});

document.getElementById('closeCsvImport')?.addEventListener('click', () => {
  document.getElementById('csvImportModal')?.classList.add('hidden');
});

document.getElementById('csvImportModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'csvImportModal') e.target.classList.add('hidden');
});

document.getElementById('csvImportFileBtn')?.addEventListener('click', () => {
  document.getElementById('importCsvFile').click();
});

document.getElementById('csvDownloadTemplate')?.addEventListener('click', () => {
  const template = 'company,role,source,dateApplied,status,notes,portalLink\nGoogle,SWE Intern,LinkedIn,2026-08-10,Interview Scheduled,sent resume,https://careers.google.com/apply\nMeta,Backend Dev,Referral,2026-08-12,Applied,follow up next week,\nAmazon,SD Intern,Wellfound,2026-08-14,OA/Task Pending,OA due Friday,';
  downloadCsv('application-tracker-template.csv', template);
  showToast('Template downloaded', 'success');
});

document.getElementById('importCsvFile')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('csvImportModal')?.classList.add('hidden');
  showToast('Importing...', 'success');
  await importCsv(file);
  e.target.value = '';
});

// ============================================================
// CALENDAR (interview slots / OA deadlines + follow-ups + reminders)
// ============================================================

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let calendarEvents = [];
let calendarTasks = [];
let calCursor = new Date(); // month currently shown
let calSelectedDate = ymd(new Date());

async function loadCalendar() {
  try {
    const res = await fetch(API + '/calendar');
    calendarEvents = res.ok ? await res.json() : [];
  } catch (e) { calendarEvents = []; }

  try {
    const res2 = await fetch('/api/tasks');
    calendarTasks = res2.ok ? await res2.json() : [];
  } catch (e) { calendarTasks = []; }

  renderCalendar();
}

function eventsOnDate(dateStr) {
  return calendarEvents.filter(ev => ev.eventDate && ymd(new Date(ev.eventDate)) === dateStr);
}

function tasksOnDate(dateStr) {
  return calendarTasks.filter(t => t.date && ymd(new Date(t.date)) === dateStr);
}

// Follow-up dates come straight from the live applications list so the
// calendar always matches what's actually due. Rejected/Offer are excluded.
function followupsOnDate(dateStr) {
  return apps.filter(a =>
    a.nextFollowupDate &&
    !['Rejected', 'Offer'].includes(a.status) &&
    ymd(new Date(a.nextFollowupDate)) === dateStr
  );
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calLabel');
  if (!grid || !label) return;

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  label.textContent = calCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const startOffset = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = ymd(new Date());

  let html = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="cal-dow">${d}</div>`).join('');

  for (let i = 0; i < startOffset; i++) {
    html += `<div class="cal-day"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = ymd(new Date(year, month, day));
    const classes = ['cal-day', 'in-month'];
    if (dateStr === todayStr) classes.push('today');
    if (dateStr === calSelectedDate) classes.push('selected');

    // Small preview chips (max 2 visible, "+N more" beyond that).
    const dayFollowups = followupsOnDate(dateStr);
    const dayEvents = eventsOnDate(dateStr);
    const dayTasks = tasksOnDate(dateStr);

    const allItems = [
      ...dayFollowups.map(a => ({ text: `Follow up: ${a.company}`, cls: 'chip-followup' })),
      ...dayEvents.map(ev => ({ text: `${ev.company}${ev.eventLabel ? ' · ' + ev.eventLabel : ''}`, cls: 'chip-event' })),
      ...dayTasks.map(t => ({ text: t.title, cls: 'chip-task' + (t.done ? ' chip-done' : '') }))
    ];
    const visible = allItems.slice(0, 2);
    const extra = allItems.length - visible.length;

    const chipsHtml = visible.map(it => `<div class="cal-chip ${it.cls}">${esc(it.text)}</div>`).join('')
      + (extra > 0 ? `<div class="cal-chip-more">+${extra} more</div>` : '');

    const dotsHtml = [
      dayFollowups.length ? '<span class="cal-dot dot-followup" title="Follow-up due"></span>' : '',
      dayEvents.length ? '<span class="cal-dot dot-event" title="Event / Interview"></span>' : '',
      dayTasks.length ? '<span class="cal-dot dot-task" title="Reminder / To-do"></span>' : ''
    ].join('');

    html += `
      <div class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="cal-day-num">${day}</span>
        <div class="cal-day-chips">${chipsHtml}</div>
        <div class="cal-day-dots">${dotsHtml}</div>
      </div>
    `;
  }

  grid.innerHTML = html;

  grid.querySelectorAll('.cal-day.in-month').forEach(cell => {
    cell.onclick = () => {
      calSelectedDate = cell.dataset.date;
      renderCalendar();
    };
  });

  renderCalendarDayEvents();
}

function renderCalendarDayEvents() {
  const wrap = document.getElementById('calendarDayEvents');
  if (!wrap) return;

  const muted = (text) => `<div style="font-size:11px;color:var(--ink-soft)">${text}</div>`;

  if (!calSelectedDate) {
    wrap.innerHTML = muted('Tap any day to see or add reminders — coral = follow-up due, amber = interview/OA event, teal = your reminder.');
    return;
  }

  const dayEvents = eventsOnDate(calSelectedDate);
  const dayTasks = tasksOnDate(calSelectedDate);
  const dayFollowups = followupsOnDate(calSelectedDate);

  const dateParts = calSelectedDate.split('-');
  const dateObj = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));
  const dateFmt = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const isToday = calSelectedDate === ymd(new Date());

  let html = `
    <div class="cal-day-events-head">
      <span class="cal-day-events-title">📅 ${esc(dateFmt)}</span>
      ${isToday ? '<span class="cal-day-events-badge">Today</span>' : ''}
    </div>
  `;

  const hasAnyItems = dayFollowups.length > 0 || dayEvents.length > 0 || dayTasks.length > 0;

  if (!hasAnyItems) {
    html += `<div class="cal-empty-day">No follow-ups or events for this date.</div>`;
  }

  if (dayFollowups.length) {
    html += `<div class="cal-section-label cal-section-followup">Follow-ups due</div>`;
    html += dayFollowups.map(a => `
      <div class="cal-event-item cal-followup-item" data-jump-company="${esc(a.company)}" title="View in Applications list">
        <div>
          <div class="cal-event-company">${esc(a.company)}${a.role ? ' · ' + esc(a.role) : ''}</div>
          <div class="cal-followup-status">${esc(a.status)}</div>
        </div>
      </div>
    `).join('');
  }

  if (dayEvents.length) {
    html += `<div class="cal-section-label">Application events</div>`;
    html += dayEvents.map(ev => `
      <div class="cal-event-item">
        <div>
          <div class="cal-event-company">${esc(ev.company)}${ev.role ? ' · ' + esc(ev.role) : ''}</div>
          <div class="cal-event-label">${esc(ev.eventLabel || 'Event')}</div>
        </div>
      </div>
    `).join('');
  }

  if (dayTasks.length) {
    html += `<div class="cal-section-label">Reminders / to-dos</div>`;
    html += dayTasks.map(t => `
      <div class="cal-task-item ${t.done ? 'done' : ''}">
        <input class="cal-task-checkbox" type="checkbox" data-task-toggle="${t._id}" ${t.done ? 'checked' : ''}>
        <span class="cal-task-title">${esc(t.title)}</span>
        <button class="cal-task-del-btn" data-task-del="${t._id}" title="Delete">✕</button>
      </div>
    `).join('');
  }

  html += `
    <div class="cal-add-task">
      <input type="text" id="calNewTask" placeholder="Add reminder / to-do...">
      <button id="calAddTaskBtn" type="button">+ Add</button>
    </div>
  `;

  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-jump-company]').forEach(item => {
    item.onclick = () => jumpToCompany(item.dataset.jumpCompany);
  });

  wrap.querySelectorAll('[data-task-toggle]').forEach(cb => {
    cb.onchange = async () => {
      await fetch(`/api/tasks/${cb.dataset.taskToggle}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: cb.checked })
      });
      await loadCalendar();
    };
  });

  wrap.querySelectorAll('[data-task-del]').forEach(btn => {
    btn.onclick = async () => {
      const task = calendarTasks.find(t => t._id === btn.dataset.taskDel);
      const confirmed = await askConfirm(`Delete "${task ? task.title : 'this reminder'}"?`);
      if (!confirmed) return;

      await fetch(`/api/tasks/${btn.dataset.taskDel}`, { method: 'DELETE' });
      showToast('Reminder deleted', 'success');
      await loadCalendar();
    };
  });

  const input = document.getElementById('calNewTask');
  const submitTask = async () => {
    const title = input.value.trim();
    if (!title) return;
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, date: calSelectedDate })
    });
    showToast('Reminder added', 'success');
    await loadCalendar();
  };
  document.getElementById('calAddTaskBtn').onclick = submitTask;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitTask(); }
  });
}

document.getElementById('calPrev')?.addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById('calNext')?.addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  renderCalendar();
});

document.getElementById('calToday')?.addEventListener('click', () => {
  calCursor = new Date();
  calSelectedDate = ymd(new Date());
  renderCalendar();
});

// ============================================================
// PWA INSTALL PROMPT
// ============================================================

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('installBtn')?.classList.remove('hidden');
});

document.getElementById('installBtn')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') showToast('App installed', 'success');
  deferredInstallPrompt = null;
  document.getElementById('installBtn')?.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  document.getElementById('installBtn')?.classList.add('hidden');
  deferredInstallPrompt = null;
});

// ============================================================
// SETTINGS FROM DB (weekly goal)
// ============================================================

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    if (settings.weeklyGoal !== undefined && settings.weeklyGoal !== null) {
      weeklyGoal = parseInt(settings.weeklyGoal, 10) || 5;
      renderWeeklyGoal();
    }
  } catch (e) { /* ignore — use default */ }
}

// ============================================================
// START
// ============================================================

loadApps();
loadStats();
loadCalendar();
loadSettings();