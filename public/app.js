const STATUSES = ['Applied','Under Consideration','OA/Task Pending','Interview Scheduled','Interviewed','Offer','Rejected','No Response','Ghosted'];
const API = '/api/applications';

let apps = [];
let filter = 'All';
let searchTerm = '';
let currentPage = 1;

const PAGE_SIZE = 8;
let charts = {};

// ============================================================
// SORT STATE
// ============================================================

let sortCol = 'date';
let sortDir = 'desc';

// ============================================================
// WEEKLY GOAL (persisted in DB for cross-device sync)
// ============================================================

let weeklyGoal = 5; // default, loaded from DB on startup

// ============================================================
// UNDO DELETE (soft-delete cache)
// ============================================================

let pendingUndo = null;
let undoTimer = null;

// ============================================================
// STATUS COLORS
// ============================================================

const STATUS_COLORS = {
  'Applied':                'status-applied',
  'Under Consideration':    'status-under-consideration',
  'OA/Task Pending':        'status-oa',
  'Interview Scheduled':    'status-interview-scheduled',
  'Interviewed':            'status-interviewed',
  'Offer':                  'status-offer',
  'Rejected':               'status-rejected',
  'No Response':            'status-no-response',
  'Ghosted':                'status-ghosted'
};

function statusBadge(status){
  const cls = STATUS_COLORS[status] || 'status-applied';
  return '<span class="status-badge ' + cls + '">' + esc(status) + '</span>';
}

// ============================================================
// RISK / COLD DETECTION
// ============================================================

function getRisk(app){
  if(['Rejected','Offer'].includes(app.status)) return null;
  const lastChange = new Date(app.updatedAt || app.createdAt);
  const now = new Date();
  const daysSince = Math.floor((now - lastChange) / (1000 * 60 * 60 * 24));
  if(daysSince >= 10) return { level: 'hot', label: 'Going cold', days: daysSince };
  if(daysSince >= 5) return { level: 'warm', label: daysSince + 'd stale', days: daysSince };
  return { level: 'cool', label: 'Active', days: daysSince };
}

function riskHtml(app){
  const r = getRisk(app);
  if(!r) return '';
  return '<span class="kanban-card-risk"><span class="risk-dot risk-' + r.level + '"></span><span class="risk-label risk-label-' + r.level + '">' + r.label + '</span></span>';
}

// ============================================================
// CONFETTI
// ============================================================

function fireConfetti(){
  const container = document.getElementById('confetti-container');
  if(!container) return;
  const colors = ['#0F6B5C','#B8791A','#C13F2B','#7C3AED','#2563EB','#059669','#F59E0B','#EC4899'];
  for(let i = 0; i < 50; i++){
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
  setTimeout(()=>{ container.innerHTML = ''; }, 4000);
}

// ============================================================
// NOTIFICATIONS + KEYBOARD SHORTCUTS
// ============================================================

const NOTIFICATION_KEY = 'jt-notified-followups';
const NOTIFICATION_CHECK_MS = 60 * 1000;


// ------------------------------------------------------------
// Notification localStorage helpers
// ------------------------------------------------------------

function getNotifiedFollowups(){
  try {
    return JSON.parse(
      localStorage.getItem(NOTIFICATION_KEY) || '{}'
    );
  } catch {
    return {};
  }
}

function saveNotifiedFollowups(data){
  localStorage.setItem(
    NOTIFICATION_KEY,
    JSON.stringify(data)
  );
}


// ------------------------------------------------------------
// Get applications whose follow-up is due
// ------------------------------------------------------------

function getDueApps(){
  return apps.filter(a =>
    !['Rejected','Offer'].includes(a.status) &&
    isOverdue(a)
  );
}


// ------------------------------------------------------------
// Notification bell badge
// ------------------------------------------------------------

function updateNotificationBadge(){

  const badge =
    document.getElementById('notificationBadge');

  if(!badge) return;

  const count = getDueApps().length;

  badge.textContent =
    count > 99 ? '99+' : count;

  badge.classList.toggle(
    'hidden',
    count === 0
  );
}


// ------------------------------------------------------------
// Notification panel
// ------------------------------------------------------------

function renderNotificationPanel(){

  const panel =
    document.getElementById('notificationPanel');

  if(!panel) return;

  const due = getDueApps();

  const permission =
    ('Notification' in window)
      ? Notification.permission
      : 'unsupported';


  let html = `
    <div class="panel-title">
      Follow-ups due
      ${due.length ? ` · ${due.length}` : ''}
    </div>
  `;


  // Permission information
  if(permission === 'default'){

    html += `
      <div class="panel-muted">
        Allow browser notifications so the tracker
        can remind you when a follow-up is due.
      </div>

      <div class="notification-actions">
        <button
          class="enable-btn"
          id="enableNotifications"
        >
          Enable reminders
        </button>
      </div>
    `;

  } else if(permission === 'denied'){

    html += `
      <div class="panel-muted">
        Browser notifications are blocked.
        Allow them in your browser site settings
        to receive reminders.
      </div>
    `;

  } else if(permission === 'unsupported'){

    html += `
      <div class="panel-muted">
        This browser does not support notifications.
      </div>
    `;

  } else if(permission === 'granted'){

    html += `
      <div class="panel-muted">
        Browser reminders are enabled.
      </div>
    `;
  }


  // Show due applications
  if(due.length){

    html += due
      .slice(0, 8)
      .map(a => `
        <div class="notification-item" data-jump-company="${esc(a.company)}" title="View in Applications list">

          <div class="notification-company">
            ${esc(a.company)}
          </div>

          <div class="notification-role">
            ${esc(a.role || 'Follow-up required')}
          </div>

        </div>
      `)
      .join('');


    if(due.length > 8){

      html += `
        <div class="panel-muted">
          + ${due.length - 8} more due
        </div>
      `;
    }

  } else {

    html += `
      <div
        class="panel-muted"
        style="margin-top:8px"
      >
        Nothing needs a follow-up right now. 🎉
      </div>
    `;
  }


  panel.innerHTML = html;


  // Jump to that application in the Applications list, same as the
  // calendar's follow-up-due items do.
  panel.querySelectorAll('[data-jump-company]').forEach(item => {
    item.onclick = () => {
      const company = item.dataset.jumpCompany;
      searchTerm = company.toLowerCase();
      const searchBox = document.getElementById('searchBox');
      if(searchBox) searchBox.value = company;
      filter = 'All';
      currentPage = 1;
      render();
      closeNotificationPanel();
      document.getElementById('applicationsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });


  // Enable notification button
  const enable =
    document.getElementById('enableNotifications');

  if(enable){

    enable.onclick = async ()=>{

      const result =
        await Notification.requestPermission();

      renderNotificationPanel();

      if(result === 'granted'){

        showToast(
          'Browser reminders enabled',
          'success'
        );

        checkFollowupNotifications(true);
      }
    };
  }
}


// ------------------------------------------------------------
// Open notification panel
// ------------------------------------------------------------

function openNotificationPanel(){

  const panel =
    document.getElementById('notificationPanel');

  if(!panel) return;

  renderNotificationPanel();

  panel.classList.toggle('hidden');
}


// ------------------------------------------------------------
// Close notification panel
// ------------------------------------------------------------

function closeNotificationPanel(){

  document
    .getElementById('notificationPanel')
    ?.classList.add('hidden');
}


// ------------------------------------------------------------
// Check and send browser notifications
// ------------------------------------------------------------

function checkFollowupNotifications(
  forcePanelUpdate = false
){

  updateNotificationBadge();


  // Browser doesn't support notifications
  if(
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ){

    if(forcePanelUpdate){
      renderNotificationPanel();
    }

    return;
  }


  const notified =
    getNotifiedFollowups();

  let changed = false;


  getDueApps().forEach(a => {

    /*
      Unique key:

      application ID + follow-up date

      Example:

      123abc:2026-08-23T10:00:00.000Z
    */

    const key =
      `${a._id}:${a.nextFollowupDate}`;


    // Already notified for this follow-up cycle
    if(notified[key]) return;


    // Browser notification
    const notif = new Notification(
      'Job Tracker — Follow-up due',
      {
        body:
          `${a.company}` +
          `${a.role ? ` · ${a.role}` : ''}` +
          ` needs a follow-up.`,

        tag: `followup-${a._id}`
      }
    );

    // Clicking the OS-level notification focuses the tab and jumps
    // straight to that application, same as clicking it inside the
    // in-app bell panel or the calendar.
    notif.onclick = () => {
      window.focus();
      searchTerm = a.company.toLowerCase();
      const searchBox = document.getElementById('searchBox');
      if(searchBox) searchBox.value = a.company;
      filter = 'All';
      currentPage = 1;
      render();
      document.getElementById('applicationsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      notif.close();
    };


    notified[key] = Date.now();

    changed = true;
  });


  if(changed){

    saveNotifiedFollowups(notified);
  }


  if(forcePanelUpdate){

    renderNotificationPanel();
  }
}


// ------------------------------------------------------------
// Initialize notification system
// ------------------------------------------------------------

function initNotifications(){

  const bell =
    document.getElementById('notificationBell');

  if(bell){

    bell.onclick =
      openNotificationPanel;
  }


  updateNotificationBadge();

  renderNotificationPanel();

  checkFollowupNotifications();


  /*
    Check every 1 minute.

    Browser page needs to be open for this
    simple version.
  */

  setInterval(
    () => checkFollowupNotifications(),
    NOTIFICATION_CHECK_MS
  );


  // Close panel when clicking outside
  document.addEventListener('click', (e)=>{

    const wrap =
      document.querySelector('.bell-wrap');

    const panel =
      document.getElementById('notificationPanel');

    if(
      panel &&
      wrap &&
      !wrap.contains(e.target)
    ){

      panel.classList.add('hidden');
    }
  });
}


// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

function isTypingTarget(target){

  if(!target) return false;

  const tag =
    target.tagName?.toLowerCase();

  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}


// ------------------------------------------------------------
// Shortcut help
// ------------------------------------------------------------

function showShortcutHelp(){

  document
    .getElementById('shortcutHelp')
    ?.classList.remove('hidden');
}


function closeShortcutHelp(){

  document
    .getElementById('shortcutHelp')
    ?.classList.add('hidden');
}


// ------------------------------------------------------------
// Global keyboard listener
// ------------------------------------------------------------

document.addEventListener(
  'keydown',
  (e)=>{

    // Escape
    if(e.key === 'Escape'){

      closeShortcutHelp();

      closeNotificationPanel();

      if(pendingConfirmResolver) pendingConfirmResolver(false);

      return;
    }


    /*
      Don't trigger global shortcuts while
      user is typing.
    */

    if(isTypingTarget(e.target)) return;


    const key =
      e.key.toLowerCase();


    // N = New application
    if(key === 'n'){

      e.preventDefault();

      const body =
        document.getElementById('formBody');

      body.style.display = '';

      document.getElementById(
        'toggleForm'
      ).textContent = 'Hide';

      document
        .getElementById('f-company')
        .focus();
    }


    // / = Search
    else if(e.key === '/'){

      e.preventDefault();

      document
        .getElementById('searchBox')
        .focus();
    }


    // D = Dark mode
    else if(key === 'd'){

      e.preventDefault();

      document
        .getElementById('darkToggle')
        .click();
    }


    // R = Refresh
    else if(key === 'r'){

      e.preventDefault();

      Promise
        .all([
          loadApps(),
          loadStats()
        ])
        .then(()=>{
          showToast(
            'Refreshed',
            'success'
          );
        });
    }


    // ? = Shortcut help
    else if(e.key === '?'){

      e.preventDefault();

      showShortcutHelp();
    }
  }
);


// Shortcut help close button
document
  .getElementById('closeShortcutHelp')
  ?.addEventListener(
    'click',
    closeShortcutHelp
  );


// Click outside shortcut modal
document
  .getElementById('shortcutHelp')
  ?.addEventListener(
    'click',
    (e)=>{

      if(
        e.target.id === 'shortcutHelp'
      ){

        closeShortcutHelp();
      }
    }
  );


// Initialize notifications
initNotifications();


// ============================================================
// DARK MODE
// ============================================================

function initDarkMode(){

  const saved =
    localStorage.getItem('jt-theme');

  if(saved === 'dark'){

    document.body.classList.add('dark');
  } else if(!saved){

    // First visit: follow OS preference
    if(window.matchMedia &&
       window.matchMedia('(prefers-color-scheme: dark)').matches){
      document.body.classList.add('dark');
    }
  }


  document.getElementById(
    'darkToggle'
  ).textContent =
    document.body.classList.contains('dark')
      ? '☀️'
      : '🌙';
}


document.getElementById(
  'darkToggle'
).onclick = ()=>{

  document.body.classList.toggle('dark');

  const isDark =
    document.body.classList.contains('dark');


  localStorage.setItem(
    'jt-theme',
    isDark ? 'dark' : 'light'
  );


  document.getElementById(
    'darkToggle'
  ).textContent =
    isDark ? '☀️' : '🌙';


  if(lastStats){

    renderCharts(lastStats);
  }
};


initDarkMode();


// ============================================================
// SEARCH
// ============================================================

document.getElementById(
  'searchBox'
).oninput = (e)=>{

  searchTerm =
    e.target.value
      .trim()
      .toLowerCase();

  currentPage = 1;

  render();
};

// Also check the placeholder matches our new search scope
setTimeout(()=>{
  const sb = document.getElementById('searchBox');
  if(sb) sb.placeholder = 'Search company, role, or notes...';
}, 0);


// ============================================================
// LINKIFY
// ============================================================

function linkify(text){

  const escaped =
    esc(text);

  return escaped.replace(
    /(https?:\/\/[^\s]+)/g,
    (url)=>{

      const clean =
        url.replace(/[.,;)]+$/, '');

      return `
        <a
          href="${clean}"
          target="_blank"
          rel="noopener"
        >
          Open link ↗
        </a>
      `;
    }
  );
}


// ============================================================
// TOAST
// ============================================================

function showToast(
  msg,
  type = 'success'
){

  const t =
    document.getElementById('toast');

  t.textContent = msg;

  t.className =
    'toast show ' + type;

  setTimeout(()=>{
    t.classList.remove('show');
  }, 1800);
}


// Show an undo toast with a button that calls onUndo
function showUndoToast(msg, onUndo, durationMs = 5000){

  const t =
    document.getElementById('toast');

  t.textContent = msg;
  t.className = 'toast show undo-toast';

  // Add undo button
  let undoBtn = t.querySelector('.undo-btn');
  if(!undoBtn){
    undoBtn = document.createElement('button');
    undoBtn.className = 'undo-btn';
    undoBtn.textContent = 'Undo';
    t.appendChild(undoBtn);
  }

  undoBtn.onclick = ()=>{
    t.classList.remove('show');
    clearTimeout(undoTimer);
    onUndo();
  };

  undoTimer = setTimeout(()=>{
    t.classList.remove('show');
    if(pendingUndo) pendingUndo = null;
  }, durationMs);
}


// ------------------------------------------------------------
// Reusable confirm dialog (replaces the browser's native confirm() with
// something styled consistently with the rest of the app). Returns a
// Promise<boolean> — true if the user confirmed, false if cancelled.
// ------------------------------------------------------------

let pendingConfirmResolver = null;

function askConfirm(message, opts = {}){
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmYes');
    const cancelBtn = document.getElementById('confirmCancel');
    if(!modal){ resolve(true); return; }

    msgEl.textContent = message;
    modal.classList.remove('hidden');

    // Dynamic button text and style
    yesBtn.textContent = opts.confirmText || 'Delete';
    if(opts.confirmClass){
      yesBtn.className = 'confirm-btn ' + opts.confirmClass;
    } else {
      yesBtn.className = 'confirm-btn confirm-danger';
    }

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
// LOAD APPLICATIONS
// ============================================================

async function loadApps(){

  const res =
    await fetch(API);

  apps =
    await res.json();

  render();

  updateNotificationBadge();

  renderNotificationPanel();

  checkFollowupNotifications();

  // Keep the calendar's "Follow-ups due" chips in sync with the latest
  // applications data (safe no-op if the calendar hasn't rendered yet).
  if(typeof renderCalendar === 'function') renderCalendar();

  // Update weekly goal progress
  renderWeeklyGoal();

  // Update kanban board
  renderKanban();
}


// ============================================================
// LOAD STATS
// ============================================================

async function loadStats(){

  // Show skeleton loading first
  renderStatsSkeleton();

  const res =
    await fetch(API + '/stats');

  const stats =
    await res.json();

  renderStatCards(stats);

  renderCharts(stats);
}


// ============================================================
// STATS SKELETON LOADING
// ============================================================

function renderStatsSkeleton(){
  const statsEl = document.getElementById('stats');
  if(!statsEl) return;
  if(statsEl.children.length > 0) return;
  statsEl.innerHTML = `
    <div class="stat"><div class="skeleton-num"></div><div class="skeleton-label"></div></div>
    <div class="stat"><div class="skeleton-num"></div><div class="skeleton-label"></div></div>
    <div class="stat"><div class="skeleton-num"></div><div class="skeleton-label"></div></div>
    <div class="stat"><div class="skeleton-num"></div><div class="skeleton-label"></div></div>
    <div class="stat"><div class="skeleton-num"></div><div class="skeleton-label"></div></div>
    <div class="stat"><div class="skeleton-num"></div><div class="skeleton-label"></div></div>
  `;
}


// ============================================================
// WEEKLY GOAL TRACKER
// ============================================================

function renderWeeklyGoal(){
  const goalBar = document.getElementById('goalBar');
  const goalText = document.getElementById('goalText');
  const goalInput = document.getElementById('goalInput');
  if(!goalBar || !goalText) return;

  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const thisWeekCount = apps.filter(a => {
    const d = new Date(a.dateApplied || a.createdAt);
    return d >= weekStart;
  }).length;

  const pct = weeklyGoal > 0 ? Math.min(100, Math.round((thisWeekCount / weeklyGoal) * 100)) : 0;
  goalBar.style.width = pct + '%';
  goalBar.className = 'goal-bar' + (pct >= 100 ? ' goal-complete' : '');
  goalText.innerHTML = `<strong>${thisWeekCount}</strong> / ${weeklyGoal} applied this week`;
  if(goalInput) goalInput.value = weeklyGoal;
}


// ============================================================
// STAT CARDS
// ============================================================

function renderStatCards(stats){

  const active =
    STATUSES
      .filter(
        s =>
          ![
            'Rejected',
            'Ghosted',
            'No Response'
          ].includes(s)
      )
      .reduce(
        (sum, s) =>
          sum +
          (stats.byStatus[s] || 0),
        0
      );


  document.getElementById(
    'stats'
  ).innerHTML = `

    <div class="stat stat-clickable" data-stat-filter="All">
      <div class="n">
        ${stats.total}
      </div>

      <div class="l">
        Total
      </div>
    </div>


    <div class="stat active">
      <div class="n">
        ${active}
      </div>

      <div class="l">
        Active
      </div>
    </div>


    <div class="stat pending stat-clickable" data-stat-filter="OA/Task Pending">
      <div class="n">
        ${stats.byStatus['OA/Task Pending'] || 0}
      </div>

      <div class="l">
        Task pending
      </div>
    </div>


    <div class="stat overdue stat-clickable" data-stat-filter="Follow-up Due">
      <div class="n">
        ${stats.overdueFollowups}
      </div>

      <div class="l">
        Follow-up due
      </div>
    </div>


    <div class="stat priority stat-clickable" data-stat-filter="Priority">
      <div class="n">
        ${stats.priorityCount || 0}
      </div>

      <div class="l">
        ⭐ Favourites
      </div>
    </div>


    <div class="stat stat-clickable" data-stat-filter="NonPriority">
      <div class="n">
        ${stats.nonPriorityCount || 0}
      </div>

      <div class="l">
        Non-favourites
      </div>
    </div>

  `;

  document
    .querySelectorAll('.stat-clickable')
    .forEach(card => {
      card.onclick = () => {
        filter = card.dataset.statFilter;
        currentPage = 1;
        render();
        document
          .getElementById('applicationsPanel')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
}


// ============================================================
// CHARTS
// ============================================================

let lastStats = null;


function chartColors(){

  const styles =
    getComputedStyle(document.body);

  return {

    text:
      styles
        .getPropertyValue('--ink')
        .trim(),

    soft:
      styles
        .getPropertyValue('--ink-soft')
        .trim(),

    grid:
      styles
        .getPropertyValue('--line')
        .trim()
  };
}


function renderCharts(stats){

  lastStats = stats;

  const chartsGrid = document.getElementById('chartsGrid');
  const emptyState = document.getElementById('chartsEmptyState');

  // Nothing added yet — degenerate/blank charts look broken to a new user.
  // Toggle a friendly CTA instead of drawing empty Chart.js instances.
  // The chart-box elements are hidden (not removed), so this is safe to
  // reverse the moment the first application is added.
  if(chartsGrid && emptyState){
    const hasData = !!stats.total;
    emptyState.classList.toggle('hidden', hasData);
    chartsGrid.querySelectorAll('.chart-box').forEach(box => {
      box.classList.toggle('hidden', !hasData);
    });
    if(!hasData) return;
  }

  const c =
    chartColors();

  const isNarrow =
    window.innerWidth < 680;


  const palette = [
    '#0F6B5C',
    '#B8791A',
    '#C13F2B',
    '#4A5568',
    '#7C9885',
    '#D4A574',
    '#8E6C88',
    '#5B7C99'
  ];


  // ---------------------------
  // Status chart
  // ---------------------------

  const statusCtx =
    document.getElementById(
      'statusChart'
    );


  if(charts.status){

    charts.status.destroy();
  }


  charts.status =
    new Chart(
      statusCtx,
      {

        type: 'doughnut',

        data: {

          labels:
            Object.keys(
              stats.byStatus
            ),

          datasets: [
            {
              data:
                Object.values(
                  stats.byStatus
                ),

              backgroundColor:
                palette
            }
          ]
        },


        options: {

          responsive: true,

          maintainAspectRatio: false,

          plugins: {

            legend: {

              position: 'bottom',

              labels: {

                font: {
                  size:
                    isNarrow
                      ? 8
                      : 9
                },

                boxWidth: 8,

                padding: 6,

                color: c.soft
              }
            },


            title: {

              display: true,

              text: 'By status',

              font: {
                size: 11
              },

              color: c.text
            }
          }
        }
      }
    );


  // ---------------------------
  // Source chart
  // ---------------------------

  const sourceCtx =
    document.getElementById(
      'sourceChart'
    );


  if(charts.source){

    charts.source.destroy();
  }


  charts.source =
    new Chart(
      sourceCtx,
      {

        type: 'bar',

        data: {

          labels:
            Object.keys(
              stats.bySource
            ),

          datasets: [

            {
              data:
                Object.values(
                  stats.bySource
                ),

              backgroundColor:
                '#0F6B5C'
            }

          ]
        },


        options: {

          responsive: true,

          maintainAspectRatio: false,

          plugins: {

            legend: {
              display: false
            },

            title: {

              display: true,

              text: 'By source',

              font: {
                size: 11
              },

              color: c.text
            }
          },


          scales: {

            y: {

              beginAtZero: true,

              ticks: {

                stepSize: 1,

                color: c.soft,

                font: {
                  size:
                    isNarrow
                      ? 8
                      : 10
                }
              },

              grid: {
                color: c.grid
              }
            },


            x: {

              ticks: {

                color: c.soft,

                font: {

                  size:
                    isNarrow
                      ? 7
                      : 10
                },

                maxRotation: 60,

                minRotation:
                  isNarrow
                    ? 60
                    : 0,

                autoSkip: false
              },

              grid: {
                color: c.grid
              }
            }
          }
        }
      }
    );


  // ---------------------------
  // Weekly chart
  // ---------------------------

  const weeklyCtx =
    document.getElementById(
      'weeklyChart'
    );


  if(charts.weekly){

    charts.weekly.destroy();
  }


  charts.weekly =
    new Chart(
      weeklyCtx,
      {

        type: 'line',

        data: {

          labels:
            stats.weeks.map(
              w => w.label
            ),

          datasets: [

            {
              data:
                stats.weeks.map(
                  w => w.count
                ),

              borderColor:
                '#0F6B5C',

              backgroundColor:
                '#0F6B5C33',

              tension: 0.3,

              fill: true
            }

          ]
        },


        options: {

          responsive: true,

          maintainAspectRatio: false,

          plugins: {

            legend: {
              display: false
            },

            title: {

              display: true,

              text:
                'Applications per week',

              font: {
                size: 11
              },

              color: c.text
            }
          },


          scales: {

            y: {

              beginAtZero: true,

              ticks: {

                stepSize: 1,

                color: c.soft,

                font: {

                  size:
                    isNarrow
                      ? 8
                      : 10
                }
              },

              grid: {
                color: c.grid
              }
            },


            x: {

              ticks: {

                color: c.soft,

                font: {

                  size:
                    isNarrow
                      ? 7
                      : 10
                },

                maxRotation: 45
              },

              grid: {
                color: c.grid
              }
            }
          }
        }
      }
    );


  // ---- Conversion funnel: Applied -> Responded -> Interview -> Offer ----
  const funnelCtx = document.getElementById('funnelChart');
  if(charts.funnel) charts.funnel.destroy();
  const f = stats.funnel || { applied: 0, responded: 0, interview: 0, offer: 0 };
  charts.funnel = new Chart(funnelCtx, {
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

  // ---- Source-wise success rate: % of applications via each source that reached interview ----
  const successCtx = document.getElementById('successChart');
  if(charts.success) charts.success.destroy();
  const ss = stats.sourceSuccess || {};
  const successLabels = Object.keys(ss).filter(k => ss[k].total > 0);
  charts.success = new Chart(successCtx, {
    type: 'bar',
    data: {
      labels: successLabels,
      datasets: [{
        data: successLabels.map(k => ss[k].pct),
        backgroundColor: '#0F6B5C'
      }]
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

// ---- Average response time (days between applying and last status change) ----
function renderResponseTime(stats){
  const overallEl = document.getElementById('responseOverall');
  const listEl = document.getElementById('responseList');
  if(!overallEl || !listEl) return;

  overallEl.textContent = (stats.avgResponseDays === null || stats.avgResponseDays === undefined)
    ? '—'
    : `${stats.avgResponseDays} day${stats.avgResponseDays === 1 ? '' : 's'}`;

  const rows = stats.responseTimeByCompany || [];
  if(!rows.length){
    listEl.innerHTML = `<div class="panel-muted" style="font-size:10.5px;color:var(--ink-soft)">No responses tracked yet.</div>`;
    return;
  }
  listEl.innerHTML = rows.map(r => `
    <div class="response-row">
      <span class="rc">${esc(r.company)}</span>
      <span class="rd">${r.avgDays}d</span>
    </div>
  `).join('');
}


// ============================================================
// CHART RESIZE
// ============================================================

let resizeTimer;


window.addEventListener(
  'resize',
  ()=>{

    clearTimeout(
      resizeTimer
    );

    resizeTimer =
      setTimeout(
        ()=>{
          if(lastStats){
            renderCharts(
              lastStats
            );
          }
        },
        200
      );
  }
);


if(
  document.fonts &&
  document.fonts.ready
){

  document.fonts.ready.then(
    ()=>{

      if(lastStats){

        renderCharts(
          lastStats
        );
      }
    }
  );
}


// ============================================================
// FILTERS
// ============================================================

function renderFilters(){

  const cats = [
    'All',
    'Follow-up Due',
    ...STATUSES
  ];


  document.getElementById(
    'filters'
  ).innerHTML =

    cats
      .map(
        c => `

          <button
            data-f="${c}"
            class="${filter === c ? 'active' : ''}"
          >
            ${c}
          </button>

        `
      )
      .join('');


  document
    .querySelectorAll(
      '#filters button'
    )
    .forEach(b => {

      b.onclick = ()=>{

        filter =
          b.dataset.f;

        currentPage = 1;

        render();
      };

    });
}


// ============================================================
// OVERDUE CHECK
// ============================================================

function isOverdue(app){

  if(
    ['Rejected','Offer']
      .includes(app.status)
  ){

    return false;
  }


  return (
    new Date(
      app.nextFollowupDate
    ) <= new Date()
  );
}


// ============================================================
// KANBAN / PIPELINE VIEW
// ============================================================

function renderKanban(){
  const board = document.getElementById('kanbanBoard');
  if(!board) return;

  const kanbanStatuses = [
    'Applied', 'Under Consideration', 'OA/Task Pending',
    'Interview Scheduled', 'Interviewed', 'Offer'
  ];
  // Also include Rejected/Ghosted in a separate column
  const rejectedStatuses = ['Rejected', 'No Response', 'Ghosted'];

  // Column accent colors
  const colColors = {
    'Applied': '#4A5568',
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
      : items.map(a => kanbanCard(a)).join('');
    html += `<div class="kanban-col" data-status="${status}" style="border-top: 3px solid ${accent}">
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
  const rejectedItems = apps.filter(a => rejectedStatuses.includes(a.status));
  const rejectedCardsHtml = rejectedItems.length === 0
    ? '<div class="kanban-empty">Drop here</div>'
    : rejectedItems.map(a => kanbanCard(a)).join('');
  html += `<div class="kanban-col" data-status="Rejected" style="border-top: 3px solid #C13F2B">
    <div class="kanban-col-header">
      <span class="kanban-col-title" style="color:#C13F2B">Closed</span>
      <span class="kanban-col-count">${rejectedItems.length}</span>
    </div>
    <div class="kanban-cards" data-drop-status="Rejected">
      ${rejectedCardsHtml}
    </div>
  </div>`;

  board.innerHTML = html;

  // Drag and drop
  initKanbanDragDrop();
}

function kanbanCard(a){
  const applied = a.dateApplied
    ? new Date(a.dateApplied).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const priorityStar = a.priority ? '<span class="kanban-card-priority">★</span> ' : '';
  const dateSpan = applied ? `<span class="kanban-card-date">${applied}</span>` : '';
  return `<div class="kanban-card" draggable="true" data-app-id="${a._id}">
    <div class="kanban-card-company">
      ${priorityStar}${esc(a.company)}
    </div>
    <div class="kanban-card-role">${esc(a.role || '')}</div>
    <div class="kanban-card-meta">
      <span class="kanban-card-source">${esc(a.source)}</span>
      ${dateSpan}
      ${riskHtml(a)}
    </div>
  </div>`;
}

let draggedAppId = null;

function initKanbanDragDrop(){
  const cards = document.querySelectorAll('.kanban-card[draggable]');
  const dropZones = document.querySelectorAll('.kanban-cards');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e)=>{
      draggedAppId = card.dataset.appId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', ()=>{
      card.classList.remove('dragging');
      draggedAppId = null;
      document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
    });
  });

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e)=>{
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.closest('.kanban-col').classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e)=>{
      if(!zone.contains(e.relatedTarget)){
        zone.closest('.kanban-col').classList.remove('drag-over');
      }
    });
    zone.addEventListener('drop', async (e)=>{
      e.preventDefault();
      zone.closest('.kanban-col').classList.remove('drag-over');
      const newStatus = zone.dataset.dropStatus;
      if(!draggedAppId || !newStatus) return;

      const app = apps.find(a => a._id === draggedAppId);
      if(!app || app.status === newStatus) return;

      await fetch(API + '/' + draggedAppId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      // Confetti on Offer!
      if(newStatus === 'Offer'){
        fireConfetti();
      }

      showToast(app.company + ' → ' + newStatus, 'success');
      await loadApps();
      await loadStats();
    });
  });
}


// ============================================================
// RENDER TABLE
// ============================================================

function renderTable(){

  let list =
    apps.slice();


  // Filter
  if(filter === 'Follow-up Due'){

    list =
      list.filter(a => isOverdue(a));

  } else if(filter === 'Priority'){

    list =
      list.filter(a => a.priority);

  } else if(filter === 'NonPriority'){

    list =
      list.filter(a => !a.priority);

  } else if(filter !== 'All'){

    list =
      list.filter(
        a =>
          a.status === filter
      );
  }


  // Search (includes notes)
  if(searchTerm){

    list =
      list.filter(
        a =>

          (a.company || '')
            .toLowerCase()
            .includes(searchTerm)

          ||

          (a.role || '')
            .toLowerCase()
            .includes(searchTerm)

          ||

          (a.notes || '')
            .toLowerCase()
            .includes(searchTerm)
      );
  }


  // Sort (click-to-sort by column)
  list.sort((a, b) => {
    let va, vb;
    switch(sortCol){
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
        va = new Date(b.createdAt || b.dateApplied);
        vb = new Date(a.createdAt || a.dateApplied);
        return sortDir === 'asc' ? vb - va : va - vb;
    }
  });


  const wrap =
    document.getElementById(
      'tableWrap'
    );


  const total =
    list.length;


  // Empty
  if(total === 0){

    wrap.innerHTML = `
      <div class="empty">
        No applications here yet.
        Add your first one above.
      </div>
    `;

    return;
  }


  // When printing, show ALL items without pagination
  const pageItems = isPrinting ? list : (() => {
    const totalPages =
      Math.max(
        1,
        Math.ceil(
          total / PAGE_SIZE
        )
      );

    if(
      currentPage >
      totalPages
    ){
      currentPage = totalPages;
    }

    const start =
      (currentPage - 1) *
      PAGE_SIZE;

    return list.slice(start, start + PAGE_SIZE);
  })();

  const totalPages = isPrinting ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Sort header helper
  function sortClass(col){
    if(sortCol !== col) return 'sortable';
    return 'sortable sort-' + sortDir;
  }

  // Bulk selection state
  const selectedIds = getSelectedIds();

  wrap.innerHTML = `

    <div class="result-count">

      ${isPrinting ? 'All ' + total + ' application' + (total === 1 ? '' : 's') + ' (print view)' : total + ' application' + (total === 1 ? '' : 's') + ' · page ' + currentPage + ' of ' + totalPages}

    </div>


    <table>

      <thead>

        <tr>

          <th class="bulk-th">
            <input type="checkbox" class="bulk-check" id="selectAll" title="Select all on this page"
              ${selectedIds.length === pageItems.length && pageItems.length > 0 ? 'checked' : ''}
            >
          </th>

          <th class="${sortClass('company')}" data-sort="company">
            Company / Role
          </th>

          <th class="${sortClass('source')}" data-sort="source">
            Source
          </th>

          <th class="${sortClass('date')}" data-sort="date">
            Applied
          </th>

          <th class="${sortClass('status')}" data-sort="status">
            Status
          </th>

          <th>
            Follow-up (every 3d)
          </th>

          <th>
            Notes
          </th>

          <th></th>

        </tr>

      </thead>


      <tbody>

        ${pageItems.map(a => {

          const applied =
            a.dateApplied

              ? new Date(
                  a.dateApplied
                ).toLocaleDateString(
                  'en-US',
                  {
                    month: 'short',
                    day: 'numeric'
                  }
                )

              : '—';


          const overdue =
            isOverdue(a);


          const skip =
            ['Rejected','Offer']
              .includes(a.status);

          const isSelected = selectedIds.includes(a._id);


          return `

            <tr
              data-id="${a._id}"
              ${isSelected ? 'class="bulk-selected"' : ''}
            >

              <td>
                <input type="checkbox" class="bulk-check" data-bulk-id="${a._id}"
                  ${isSelected ? 'checked' : ''}
                >
              </td>

              <td
                data-label="Company"
              >

                <div class="company-row">
                  <button class="star-btn ${a.priority ? 'starred' : ''}" data-star="${a._id}" title="Toggle priority">${a.priority ? '★' : '☆'}</button>
                  <div class="company editable-cell" data-inline-field="company" data-inline-id="${a._id}">
                    ${esc(a.company)}
                  </div>
                </div>

                <div class="role editable-cell" data-inline-field="role" data-inline-id="${a._id}">
                  ${esc(a.role || '')}
                </div>

                ${
                  a.eventDate

                    ? `
                      <div class="cal-event-label">
                        📅 ${esc(a.eventLabel || 'Event')} · ${new Date(a.eventDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                      </div>
                    `

                    : ''
                }

                ${
                  a.portalLink

                    ? `
                      <a
                        class="portal-link"
                        href="${esc(a.portalLink)}"
                        target="_blank"
                        rel="noopener"
                      >
                        Track status ↗
                      </a>
                    `

                    : ''
                }

                ${
                  (() => {
                    const r = getRisk(a);
                    if(!r) return '';
                    return '<div style="margin-top:4px"><span class="risk-dot risk-' + r.level + '"></span><span class="risk-label risk-label-' + r.level + '">' + r.label + '</span></div>';
                  })()
                }

              </td>


              <td data-label="Source">
                ${esc(a.source)}
              </td>


              <td data-label="Applied">
                ${applied}
              </td>


              <td data-label="Status">

                <select
                  class="status-select"
                  data-id="${a._id}"
                >

                  ${STATUSES.map(
                    s =>
                      `
                      <option
                        ${
                          s === a.status
                            ? 'selected'
                            : ''
                        }
                      >
                        ${s}
                      </option>
                      `
                  ).join('')}

                </select>

              </td>


              <td data-label="Follow-up">

                ${
                  skip

                    ? `
                      <span
                        class="followup ok"
                      >
                        —
                      </span>
                    `

                    : overdue

                      ? `

                        <div
                          class="followup-prompt"
                        >

                          <span
                            class="followup overdue"
                          >
                            Followed up?
                          </span>


                          <div
                            class="radio-row"
                          >

                            <label>

                              <input
                                type="radio"
                                name="fu-${a._id}"
                                value="yes"
                              >

                              Yes

                            </label>


                            <label>

                              <input
                                type="radio"
                                name="fu-${a._id}"
                                value="no"
                              >

                              No

                            </label>


                            <button
                              class="snooze-btn"
                              data-snooze="${a._id}"
                              title="Remind me later"
                            >
                              ⏰ Snooze
                            </button>

                          </div>

                        </div>

                      `

                      : `

                        <span
                          class="followup ok"
                        >

                          next check
                          ${
                            new Date(
                              a.nextFollowupDate
                            ).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric'
                              }
                            )
                          }

                        </span>

                      `
                }

              </td>


              <td
                class="notes"
                data-label="Notes"
                data-notes-id="${a._id}"
              >

                ${
                  a.notes

                    ? linkify(a.notes)

                    : `
                      <span
                        style="opacity:0.5"
                      >
                        — click to add —
                      </span>
                    `
                }

              </td>


              <td
                class="row-actions"
              >

                <button
                  data-edit="${a._id}"
                  title="Edit notes"
                >
                  ✎
                </button>


                <button
                  data-del="${a._id}"
                  title="Delete"
                >
                  ✕
                </button>

              </td>

            </tr>

          `;

        }).join('')}

      </tbody>

    </table>


    ${
      totalPages > 1
        ? renderPagination(totalPages)
        : ''
    }

  `;


  // ==========================================================
  // SORT HEADERS
  // ==========================================================

  wrap.querySelectorAll('th.sortable').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.sort;
      if(sortCol === col){
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }
      render();
    };
  });


  // ==========================================================
  // SELECT ALL CHECKBOX
  // ==========================================================

  const selectAllEl = document.getElementById('selectAll');
  if(selectAllEl){
    selectAllEl.onchange = ()=>{
      const checked = selectAllEl.checked;
      wrap.querySelectorAll('[data-bulk-id]').forEach(cb => {
        cb.checked = checked;
        const id = cb.dataset.bulkId;
        if(checked){
          if(!bulkSelectedIds.includes(id)) bulkSelectedIds.push(id);
        } else {
          bulkSelectedIds = bulkSelectedIds.filter(x => x !== id);
        }
      });
      updateBulkBar();
    };
  }


  // ==========================================================
  // BULK CHECKBOXES
  // ==========================================================

  wrap.querySelectorAll('[data-bulk-id]').forEach(cb => {
    cb.onchange = ()=>{
      const id = cb.dataset.bulkId;
      if(cb.checked){
        if(!bulkSelectedIds.includes(id)) bulkSelectedIds.push(id);
      } else {
        bulkSelectedIds = bulkSelectedIds.filter(x => x !== id);
      }
      updateBulkBar();
    };
  });


  // ==========================================================
  // STATUS CHANGE
  // ==========================================================

  wrap
    .querySelectorAll(
      '.status-select'
    )
    .forEach(sel => {

      sel.onchange =
        async ()=>{

          await fetch(
            `${API}/${sel.dataset.id}`,
            {
              method: 'PATCH',

              headers: {
                'Content-Type':
                  'application/json'
              },

              body:
                JSON.stringify({
                  status:
                    sel.value
                })
            }
          );


          showToast(
            'Status updated',
            'success'
          );

          // Confetti on Offer!
          if(sel.value === 'Offer') fireConfetti();


          await loadApps();

          await loadStats();
        };
    });


  // ==========================================================
  // PRIORITY STAR
  // ==========================================================

  wrap
    .querySelectorAll(
      '[data-star]'
    )
    .forEach(btn => {

      btn.onclick =
        async ()=>{

          const id = btn.dataset.star;
          const app = apps.find(a => a._id === id);
          const newVal = !app.priority;

          await fetch(
            `${API}/${id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ priority: newVal })
            }
          );

          showToast(
            newVal ? 'Marked as priority' : 'Priority removed',
            'success'
          );

          await loadApps();
          await loadStats();
        };
    });


  // ==========================================================
  // INLINE EDIT (company + role)
  // ==========================================================

  wrap
    .querySelectorAll('[data-inline-field]')
    .forEach(cell => {
      cell.ondblclick = ()=>{
        const id = cell.dataset.inlineId;
        const field = cell.dataset.inlineField;
        const appData = apps.find(a => a._id === id);
        if(!appData) return;
        const currentVal = appData[field] || '';
        cell.innerHTML = '<input class="inline-edit" type="text" value="' + esc(currentVal) + '">';
        const input = cell.querySelector('input');
        input.focus();
        input.select();
        const save = async ()=>{
          const newVal = input.value.trim();
          if(newVal !== currentVal){
            await fetch(API + '/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [field]: newVal })
            });
            showToast((field === 'company' ? 'Company' : 'Role') + ' updated', 'success');
            await loadApps();
          } else {
            cell.textContent = currentVal;
          }
        };
        input.onblur = save;
        input.onkeydown = (e)=>{
          if(e.key === 'Enter'){ e.preventDefault(); input.blur(); }
          if(e.key === 'Escape'){ cell.textContent = currentVal; }
        };
      };
    });


  // ==========================================================
  // EDIT NOTES
  // ==========================================================

  wrap
    .querySelectorAll(
      '[data-edit]'
    )
    .forEach(btn => {

      btn.onclick = ()=>{

        const id =
          btn.dataset.edit;


        const app =
          apps.find(
            a => a._id === id
          );


        const cell =
          wrap.querySelector(
            `[data-notes-id="${id}"]`
          );


        cell.innerHTML = `
          <textarea
            id="edit-${id}"
          >${app.notes || ''}</textarea>
        `;


        const ta =
          document.getElementById(
            `edit-${id}`
          );


        ta.focus();


        const saveEdit =
          async ()=>{

            await fetch(
              `${API}/${id}`,
              {
                method: 'PATCH',

                headers: {
                  'Content-Type':
                    'application/json'
                },

                body:
                  JSON.stringify({
                    notes:
                      ta.value.trim()
                  })
              }
            );


            await loadApps();
          };


        ta.onblur =
          saveEdit;


        ta.onkeydown =
          (e)=>{

            if(
              e.key === 'Enter' &&
              !e.shiftKey
            ){

              e.preventDefault();

              ta.blur();
            }
          };
      };
    });


  // ==========================================================
  // DELETE (with UNDO)
  // ==========================================================

  wrap
    .querySelectorAll(
      '[data-del]'
    )
    .forEach(btn => {

      btn.onclick =
        async ()=>{

          const app = apps.find(a => a._id === btn.dataset.del);
          const label = app ? app.company : 'this application';
          const confirmed = await askConfirm(`Delete ${label}?`);
          if(!confirmed) return;

          const id = btn.dataset.del;
          const deletedApp = apps.find(a => a._id === id);

          await fetch(
            `${API}/${id}`,
            {
              method: 'DELETE'
            }
          );

          showToast('Deleted', 'success');
          await loadApps();
          await loadStats();

          // Show undo toast for 5 seconds
          if(deletedApp){
            pendingUndo = deletedApp;
            showUndoToast('Deleted ' + label, async ()=>{
              if(!pendingUndo) return;
              const d = pendingUndo;
              await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  company: d.company, role: d.role, source: d.source,
                  dateApplied: d.dateApplied, notes: d.notes,
                  portalLink: d.portalLink, status: d.status,
                  priority: d.priority, eventDate: d.eventDate, eventLabel: d.eventLabel
                })
              });
              pendingUndo = null;
              showToast('Restored ' + label, 'success');
              await loadApps();
              await loadStats();
            });
          }
        };
    });


  // ==========================================================
  // FOLLOW-UP
  // ==========================================================

  wrap
    .querySelectorAll(
      'input[type=radio]'
    )
    .forEach(radio => {

      radio.onchange =
        async (e)=>{

          const id =
            e.target.name
              .replace('fu-', '');


          const answered =
            e.target.value === 'yes';


          await fetch(
            `${API}/${id}/followup`,
            {

              method: 'PATCH',

              headers: {
                'Content-Type':
                  'application/json'
              },

              body:
                JSON.stringify({
                  answered
                })
            }
          );


          showToast(
            answered
              ? 'Nice — next check in 3 days'
              : 'Noted — next check in 3 days',
            'success'
          );


          await loadApps();          await loadStats();
        };
    });


  // ==========================================================
  // SNOOZE FOLLOW-UP (3 days by default)
  // ==========================================================

  wrap
    .querySelectorAll('[data-snooze]')
    .forEach(btn => {
      btn.onclick = async ()=>{
        const id = btn.dataset.snooze;
        await fetch(`${API}/${id}/followup`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answered: false, days: 3 })
        });
        showToast('Snoozed 3 days', 'success');
        await loadApps();
        await loadStats();
      };
    });


  // ==========================================================
  // PAGINATION
  // ==========================================================

  wrap
    .querySelectorAll(
      '.pagination button[data-page]'
    )
    .forEach(btn => {

      btn.onclick = ()=>{

        currentPage =
          parseInt(
            btn.dataset.page,
            10
          );


        renderTable();


        wrap.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      };
    });
}


// ============================================================
// BULK ACTIONS
// ============================================================

let bulkSelectedIds = [];

function getSelectedIds(){
  return bulkSelectedIds;
}

function updateBulkBar(){
  const bar = document.getElementById('bulkBar');
  const countEl = document.getElementById('bulkCount');
  if(!bar || !countEl) return;
  if(bulkSelectedIds.length > 0){
    bar.classList.remove('hidden');
    countEl.textContent = bulkSelectedIds.length + ' selected';
  } else {
    bar.classList.add('hidden');
  }
}

document.getElementById('bulkApplyBtn')?.addEventListener('click', async ()=>{
  const statusSelect = document.getElementById('bulkStatusSelect');
  const newStatus = statusSelect?.value;
  if(!newStatus || !bulkSelectedIds.length){
    showToast('Select a status first', 'error');
    return;
  }
  for(const id of bulkSelectedIds){
    await fetch(API + '/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
  }
  showToast('Updated ' + bulkSelectedIds.length + ' applications to ' + newStatus, 'success');
  bulkSelectedIds = [];
  updateBulkBar();
  await loadApps();
  await loadStats();
});

document.getElementById('bulkCancelBtn')?.addEventListener('click', ()=>{
  bulkSelectedIds = [];
  updateBulkBar();
  render();
});


// ============================================================
// PAGINATION
// ============================================================

function renderPagination(
  totalPages
){

  let pages = [];


  for(
    let p = 1;
    p <= totalPages;
    p++
  ){

    if(
      p === 1 ||
      p === totalPages ||
      Math.abs(
        p - currentPage
      ) <= 1
    ){

      pages.push(p);

    } else if(
      pages[pages.length - 1]
      !== '...'
    ){

      pages.push('...');
    }
  }


  return `

    <div class="pagination">

      <button
        data-page="${currentPage - 1}"
        ${
          currentPage === 1
            ? 'disabled'
            : ''
        }
      >
        ‹
      </button>


      ${pages.map(
        p =>

          p === '...'

            ? `
              <span
                style="
                  padding:0 4px;
                  color:var(--ink-soft)
                "
              >
                …
              </span>
            `

            : `
              <button
                data-page="${p}"
                class="${
                  p === currentPage
                    ? 'active'
                    : ''
                }"
              >
                ${p}
              </button>
            `
      ).join('')}


      <button
        data-page="${currentPage + 1}"
        ${
          currentPage === totalPages
            ? 'disabled'
            : ''
        }
      >
        ›
      </button>

    </div>

  `;
}


// ============================================================
// ESCAPE HTML
// ============================================================

function esc(s){

  const d =
    document.createElement('div');

  d.textContent =
    s || '';

  return d.innerHTML;
}


// ============================================================
// RENDER
// ============================================================

function render(){

  renderFilters();

  renderTable();

  updateBulkBar();
}


// ============================================================
// DUPLICATE WARNING
// ============================================================

function checkDuplicate(){
  const companyInput = document.getElementById('f-company');
  const roleInput = document.getElementById('f-role');
  const warning = document.getElementById('duplicateWarning');
  if(!companyInput || !warning) return;
  const val = companyInput.value.trim().toLowerCase();
  if(!val){ warning.classList.remove('show'); return; }

  const roleVal = (roleInput?.value || '').trim().toLowerCase();

  // Check for exact match (same company + same role)
  const exactMatch = apps.find(a =>
    a.company.toLowerCase().trim() === val &&
    (a.role || '').toLowerCase().trim() === roleVal &&
    roleVal !== ''
  );

  // Check for company-only match
  const companyMatch = apps.find(a =>
    a.company.toLowerCase().trim() === val &&
    (!exactMatch || a !== exactMatch)
  );

  warning.classList.remove('dup-company', 'dup-exact');

  if(exactMatch){
    warning.classList.add('show', 'dup-exact');
    warning.textContent = '🔴 "' + exactMatch.company + ' — ' + (exactMatch.role || 'No role') + '" already exists (' + exactMatch.status + '). Add duplicate?';
  } else if(companyMatch){
    warning.classList.add('show', 'dup-company');
    warning.textContent = '⚠️ "' + companyMatch.company + '" already exists (' + companyMatch.status + '). Add another entry?';
  } else {
    warning.classList.remove('show');
  }
}

document.getElementById('f-company')?.addEventListener('input', checkDuplicate);
document.getElementById('f-role')?.addEventListener('input', checkDuplicate);


// ============================================================
// PRINT / PDF SUMMARY
// ============================================================

let isPrinting = false;

document.getElementById('printBtn')?.addEventListener('click', ()=>{
  // Temporarily show ALL applications (no pagination) for print
  isPrinting = true;
  renderTable();

  // Small delay to let the DOM update, then print
  setTimeout(()=>{
    window.print();

    // After print dialog closes, restore pagination
    isPrinting = false;
    renderTable();
  }, 100);
});


// ============================================================
// WEEKLY GOAL: EDIT / SAVE
// ============================================================

document.getElementById('editGoalBtn')?.addEventListener('click', ()=>{
  const inputGroup = document.getElementById('goalInputGroup');
  const display = document.getElementById('goalDisplay');
  const goalInput = document.getElementById('goalInput');
  if(inputGroup) inputGroup.classList.toggle('hidden');
  if(display) display.classList.toggle('hidden');
  if(goalInput) goalInput.value = weeklyGoal;
  document.getElementById('editGoalBtn').textContent =
    inputGroup?.classList.contains('hidden') ? 'Edit' : 'Cancel';
});

document.getElementById('saveGoalBtn')?.addEventListener('click', ()=>{
  const goalInput = document.getElementById('goalInput');
  const val = parseInt(goalInput?.value, 10);
  if(val && val > 0){
    weeklyGoal = val;
    // Save to DB for cross-device sync
    fetch('/api/settings/weeklyGoal', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: val })
    });
    showToast('Weekly goal set to ' + val, 'success');
  }
  document.getElementById('goalInputGroup')?.classList.add('hidden');
  document.getElementById('goalDisplay')?.classList.remove('hidden');
  document.getElementById('editGoalBtn').textContent = 'Edit';
  renderWeeklyGoal();
});


// ============================================================
// ADD APPLICATION
// ============================================================

document.getElementById(
  'addBtn'
).onclick =
  async ()=>{

    const company =
      document
        .getElementById('f-company')
        .value
        .trim();


    if(!company){

      showToast(
        'Company name needed',
        'error'
      );

      return;
    }


    const body = {

      company,

      role:
        document
          .getElementById('f-role')
          .value
          .trim(),

      source:
        document
          .getElementById('f-source')
          .value,

      dateApplied:
        document
          .getElementById('f-date')
          .value ||
        undefined,

      notes:
        document
          .getElementById('f-notes')
          .value
          .trim(),

      portalLink:
        document
          .getElementById('f-portal')
          .value
          .trim(),

      priority:
        document
          .getElementById('f-priority')
          .checked,

      eventDate:
        document
          .getElementById('f-eventdate')
          .value || undefined,

      eventLabel:
        document
          .getElementById('f-eventlabel')
          .value
          .trim()
    };


    // Duplicate check — show confirm dialog if company already exists
    const dupCompany = body.company.toLowerCase().trim();
    const dupRole = (body.role || '').toLowerCase().trim();

    const exactDup = apps.find(a =>
      a.company.toLowerCase().trim() === dupCompany &&
      (a.role || '').toLowerCase().trim() === dupRole &&
      dupRole !== ''
    );
    const companyDup = !exactDup && apps.find(a =>
      a.company.toLowerCase().trim() === dupCompany
    );

    if(exactDup || companyDup){
      const isExact = !!exactDup;
      const msg = isExact
        ? '🔴 "' + exactDup.company + ' — ' + (exactDup.role || 'No role') + '" already exists (' + exactDup.status + '). Add duplicate?'
        : '⚠️ "' + companyDup.company + '" already exists (' + companyDup.status + '). Add another entry?';
      const ok = await askConfirm(msg, {
        confirmText: isExact ? 'Yes, Add Duplicate' : 'Add Anyway',
        confirmClass: isExact ? 'confirm-danger' : 'confirm-add'
      });
      if(!ok) return;
    }


    await fetch(
      API,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(body)
      }
    );


    [
      'f-company',
      'f-role',
      'f-date',
      'f-notes',
      'f-portal',
      'f-eventdate',
      'f-eventlabel'
    ]
    .forEach(
      id =>
        document
          .getElementById(id)
          .value = ''
    );

    document.getElementById('f-priority').checked = false;
    document.getElementById('starToggle').classList.remove('starred');
    document.getElementById('starToggle').textContent = '☆ Priority';


    document.getElementById(
      'f-source'
    ).value =
      'Wellfound';


    // Hide duplicate warning
    document.getElementById('duplicateWarning')?.classList.remove('show');


    showToast(
      'Added',
      'success'
    );


    await loadApps();

    await loadStats();

    await loadCalendar();
  };


// ============================================================
// TOGGLE FORM
// ============================================================

document.getElementById(
  'toggleForm'
).onclick =
  ()=>{

    const body =
      document.getElementById(
        'formBody'
      );


    const btn =
      document.getElementById(
        'toggleForm'
      );


    const hidden =
      body.style.display === 'none';


    body.style.display =
      hidden
        ? ''
        : 'none';


    btn.textContent =
      hidden
        ? 'Hide'
        : 'Show';
  };


// ============================================================
// MOBILE FLOATING ADD BUTTON
// ============================================================

const fab =
  document.getElementById(
    'fab'
  );


if(fab){

  fab.onclick =
    ()=>{

      const body =
        document.getElementById(
          'formBody'
        );


      body.style.display =
        '';


      document.getElementById(
        'toggleForm'
      ).textContent =
        'Hide';


      document
        .getElementById(
          'f-company'
        )
        .scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });


      setTimeout(
        ()=>{
          document
            .getElementById(
              'f-company'
            )
            .focus();
        },
        300
      );
    };
}


// ============================================================
// QUICK ADD WITH ENTER
// ============================================================

document
  .getElementById('f-company')
  .addEventListener(
    'keydown',
    (e)=>{

      if(e.key === 'Enter'){

        e.preventDefault();

        document
          .getElementById('addBtn')
          .click();
      }
    }
  );


// ============================================================
// CSV EXPORT / IMPORT
// ============================================================

const CSV_COLUMNS = ['company', 'role', 'source', 'dateApplied', 'status', 'notes', 'portalLink'];
const VALID_SOURCES = ['Wellfound','Naukri','Internshala','HiringCafe','Company site','Cold email','LinkedIn','Referral','Other'];

function csvEscape(value){
  const s = (value === undefined || value === null) ? '' : String(value);
  if(/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportCsv(){
  if(!apps.length){
    showToast('Nothing to export yet', 'error');
    return;
  }
  const header = CSV_COLUMNS.join(',');
  const rows = apps.map(a => CSV_COLUMNS.map(col => {
    if(col === 'dateApplied') return csvEscape(a.dateApplied ? new Date(a.dateApplied).toISOString().slice(0,10) : '');
    return csvEscape(a[col]);
  }).join(','));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `applications-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(`Exported ${apps.length} applications`, 'success');
}

// Minimal CSV line parser: handles quoted fields with embedded commas/quotes.
function parseCsv(text){
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim() !== '');
  if(!lines.length) return [];
  const parseLine = (line) => {
    const out = [];
    let cur = '', inQuotes = false;
    for(let i = 0; i < line.length; i++){
      const ch = line[i];
      if(inQuotes){
        if(ch === '"' && line[i+1] === '"'){ cur += '"'; i++; }
        else if(ch === '"'){ inQuotes = false; }
        else { cur += ch; }
      } else {
        if(ch === '"'){ inQuotes = true; }
        else if(ch === ','){ out.push(cur); cur = ''; }
        else { cur += ch; }
      }
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = parseLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

async function importCsv(file){
  const text = await file.text();
  const rows = parseCsv(text);
  const validRows = rows.filter(r => r.company);

  if(!validRows.length){
    showToast('No valid rows found (need a "company" column)', 'error');
    return;
  }

  let imported = 0;
  for(const row of validRows){
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
      await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      imported++;
    } catch(e){ /* skip failed row, keep going */ }
  }

  showToast(`Imported ${imported} of ${validRows.length} rows`, imported ? 'success' : 'error');
  await loadApps();
  await loadStats();
}

document.getElementById('exportCsvBtn')?.addEventListener('click', exportCsv);

// Import CSV — show help dialog first
document.getElementById('importCsvBtn')?.addEventListener('click', () => {
  document.getElementById('csvImportModal')?.classList.remove('hidden');
});

// Close CSV import dialog
document.getElementById('closeCsvImport')?.addEventListener('click', () => {
  document.getElementById('csvImportModal')?.classList.add('hidden');
});

// Click outside to close
document.getElementById('csvImportModal')?.addEventListener('click', (e) => {
  if(e.target.id === 'csvImportModal'){
    e.target.classList.add('hidden');
  }
});

// Choose file button — triggers file picker
document.getElementById('csvImportFileBtn')?.addEventListener('click', () => {
  document.getElementById('importCsvFile').click();
});

// Download template CSV
document.getElementById('csvDownloadTemplate')?.addEventListener('click', () => {
  const template = 'company,role,source,dateApplied,status,notes,portalLink\nGoogle,SWE Intern,LinkedIn,2026-08-10,Interview Scheduled,sent resume,https://careers.google.com/apply\nMeta,Backend Dev,Referral,2026-08-12,Applied,follow up next week,\nAmazon,SD Intern,Wellfound,2026-08-14,OA Task Pending,OA due Friday,';
  const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'application-tracker-template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Template downloaded', 'success');
});

// Actual file import handler
document.getElementById('importCsvFile')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file) return;
  // Close the dialog
  document.getElementById('csvImportModal')?.classList.add('hidden');
  showToast('Importing...', 'success');
  await importCsv(file);
  e.target.value = '';
});


// ============================================================
// CALENDAR (interview slots / OA deadlines + follow-ups + reminders)
// ============================================================

let calendarEvents = [];
let calendarTasks = [];
let calCursor = new Date(); // month currently shown
let calSelectedDate = null;

function ymd(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadCalendar(){
  try {
    const res = await fetch(API + '/calendar');
    calendarEvents = await res.json();
  } catch(e){ calendarEvents = []; }

  try {
    const res2 = await fetch('/api/tasks');
    calendarTasks = await res2.json();
  } catch(e){ calendarTasks = []; }

  renderCalendar();
}

function eventsOnDate(dateStr){
  return calendarEvents.filter(ev => ev.eventDate && ymd(new Date(ev.eventDate)) === dateStr);
}

function tasksOnDate(dateStr){
  return calendarTasks.filter(t => t.date && ymd(new Date(t.date)) === dateStr);
}

// Follow-up cycle dates come straight from the live applications list (the
// same `apps` array the table renders from) so the calendar always matches
// what's actually due — no separate endpoint needed. Rejected/Offer
// applications are excluded since they're no longer being followed up on.
function followupsOnDate(dateStr){
  return apps.filter(a =>
    a.nextFollowupDate &&
    !['Rejected','Offer'].includes(a.status) &&
    ymd(new Date(a.nextFollowupDate)) === dateStr
  );
}

function renderCalendar(){
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calLabel');
  if(!grid || !label) return;

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  label.textContent = calCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = ymd(new Date());

  const dows = ['S','M','T','W','T','F','S'];
  let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');

  for(let i = 0; i < startOffset; i++){
    html += `<div class="cal-day"></div>`;
  }

  for(let day = 1; day <= daysInMonth; day++){
    const dateObj = new Date(year, month, day);
    const dateStr = ymd(dateObj);
    const dayEvents = eventsOnDate(dateStr);
    const dayTasks = tasksOnDate(dateStr);
    const dayFollowups = followupsOnDate(dateStr);
    const classes = ['cal-day', 'in-month'];
    if(dateStr === todayStr) classes.push('today');
    if(dayEvents.length || dayTasks.length || dayFollowups.length) classes.push('has-event');
    if(dateStr === calSelectedDate) classes.push('selected');

    // Build small preview chips (max 2 visible, "+N more" beyond that) —
    // like a mobile calendar's inline event list, not just a dot.
    // Follow-ups shown first since they're the most action-needed item.
    const allItems = [
      ...dayFollowups.map(a => ({ text: `Follow up: ${a.company}`, cls: 'chip-followup' })),
      ...dayEvents.map(ev => ({ text: `${ev.company}${ev.eventLabel ? ' · ' + ev.eventLabel : ''}`, cls: 'chip-event' })),
      ...dayTasks.map(t => ({ text: t.title, cls: 'chip-task' + (t.done ? ' chip-done' : '') }))
    ];
    const visible = allItems.slice(0, 2);
    const extra = allItems.length - visible.length;

    const chipsHtml = visible.map(it => `<div class="cal-chip ${it.cls}">${esc(it.text)}</div>`).join('')
      + (extra > 0 ? `<div class="cal-chip-more">+${extra} more</div>` : '');

    html += `
      <div class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="cal-day-num">${day}</span>
        <div class="cal-day-chips">${chipsHtml}</div>
      </div>
    `;
  }

  grid.innerHTML = html;

  grid.querySelectorAll('.cal-day.in-month').forEach(cell => {
    cell.onclick = () => {
      calSelectedDate = cell.dataset.date;
      renderCalendar();
      renderCalendarDayEvents();
    };
  });

  renderCalendarDayEvents();
}

function renderCalendarDayEvents(){
  const wrap = document.getElementById('calendarDayEvents');
  if(!wrap) return;

  if(!calSelectedDate){
    wrap.innerHTML = `<div class="panel-muted" style="font-size:11px;color:var(--ink-soft)">Tap any day to see or add reminders — coral = follow-up due, amber = interview/OA event, teal = your reminder.</div>`;
    return;
  }

  const dayEvents = eventsOnDate(calSelectedDate);
  const dayTasks = tasksOnDate(calSelectedDate);
  const dayFollowups = followupsOnDate(calSelectedDate);

  let html = '';

  html += `<div class="cal-section-label cal-section-followup">Follow-ups due</div>`;
  if(dayFollowups.length){
    html += dayFollowups.map(a => `
      <div class="cal-event-item cal-followup-item" data-jump-company="${esc(a.company)}" title="View in Applications list">
        <div>
          <div class="cal-event-company">${esc(a.company)}${a.role ? ' · ' + esc(a.role) : ''}</div>
          <div class="cal-followup-status">${esc(a.status)}</div>
        </div>
      </div>
    `).join('');
  } else {
    html += `<div class="panel-muted" style="font-size:11px;color:var(--ink-soft)">None due on ${calSelectedDate}.</div>`;
  }

  html += `<div class="cal-section-label">Application events</div>`;
  if(dayEvents.length){
    html += dayEvents.map(ev => `
      <div class="cal-event-item">
        <div>
          <div class="cal-event-company">${esc(ev.company)}${ev.role ? ' · ' + esc(ev.role) : ''}</div>
          <div class="cal-event-label">${esc(ev.eventLabel || 'Event')}</div>
        </div>
      </div>
    `).join('');
  } else {
    html += `<div class="panel-muted" style="font-size:11px;color:var(--ink-soft)">None on ${calSelectedDate}.</div>`;
  }

  html += `<div class="cal-section-label">Reminders / to-dos</div>`;
  if(dayTasks.length){
    html += dayTasks.map(t => `
      <div class="cal-task-item ${t.done ? 'done' : ''}">
        <input class="cal-task-checkbox" type="checkbox" data-task-toggle="${t._id}" ${t.done ? 'checked' : ''}>
        <span class="cal-task-title">${esc(t.title)}</span>
        <button class="cal-task-del-btn" data-task-del="${t._id}" title="Delete">✕</button>
      </div>
    `).join('');
  } else {
    html += `<div class="panel-muted" style="font-size:11px;color:var(--ink-soft)">No reminders yet.</div>`;
  }

  html += `
    <div class="cal-add-task">
      <input type="text" id="calNewTask" placeholder="e.g. Fill Google form for Stripe">
      <button id="calAddTaskBtn" type="button">+ Add</button>
    </div>
  `;

  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-jump-company]').forEach(item => {
    item.onclick = () => {
      const company = item.dataset.jumpCompany;
      searchTerm = company.toLowerCase();
      document.getElementById('searchBox').value = company;
      filter = 'All';
      currentPage = 1;
      render();
      document.getElementById('applicationsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
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
      const label = task ? task.title : 'this reminder';
      const confirmed = await askConfirm(`Delete "${label}"?`);
      if(!confirmed) return;

      await fetch(`/api/tasks/${btn.dataset.taskDel}`, { method: 'DELETE' });
      showToast('Reminder deleted', 'success');
      await loadCalendar();
    };
  });

  const addBtn = document.getElementById('calAddTaskBtn');
  const input = document.getElementById('calNewTask');
  const submitTask = async () => {
    const title = input.value.trim();
    if(!title) return;
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, date: calSelectedDate })
    });
    showToast('Reminder added', 'success');
    await loadCalendar();
  };
  addBtn.onclick = submitTask;
  input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); submitTask(); } });
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
// ADD-FORM: PRIORITY STAR TOGGLE + ADVANCED FIELDS TOGGLE
// ============================================================

document.getElementById('starToggle')?.addEventListener('click', () => {
  const checkbox = document.getElementById('f-priority');
  const btn = document.getElementById('starToggle');
  checkbox.checked = !checkbox.checked;
  btn.classList.toggle('starred', checkbox.checked);
  btn.textContent = checkbox.checked ? '★ Priority' : '☆ Priority';
});

document.getElementById('toggleAdvanced')?.addEventListener('click', () => {
  const fields = document.getElementById('advancedFields');
  const btn = document.getElementById('toggleAdvanced');
  const hidden = fields.classList.contains('hidden');
  fields.classList.toggle('hidden', !hidden);
  btn.textContent = hidden ? '− Hide interview / OA deadline date' : '+ Interview / OA deadline date';
});


// ============================================================
// PWA INSTALL PROMPT (desktop + Android — shows a real "Install" button
// instead of relying on users to find the address-bar icon themselves)
// ============================================================

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('installBtn')?.classList.remove('hidden');
});

document.getElementById('installBtn')?.addEventListener('click', async () => {
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if(outcome === 'accepted'){
    showToast('App installed', 'success');
  }
  deferredInstallPrompt = null;
  document.getElementById('installBtn')?.classList.add('hidden');
});

// Hide the button once installed (covers cases where the user installs via
// the browser's own menu instead of our button, or on later visits).
window.addEventListener('appinstalled', () => {
  document.getElementById('installBtn')?.classList.add('hidden');
  deferredInstallPrompt = null;
});

if(window.matchMedia('(display-mode: standalone)').matches){
  document.getElementById('installBtn')?.classList.add('hidden');
}


// ============================================================
// LOAD SETTINGS FROM DB
// ============================================================

async function loadSettings(){
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    if(settings.weeklyGoal !== undefined && settings.weeklyGoal !== null){
      weeklyGoal = parseInt(settings.weeklyGoal, 10) || 5;
      renderWeeklyGoal();
    }
  } catch(e){ /* ignore — use default */ }
}


// ============================================================
// START APPLICATION
// ============================================================

loadApps();

loadStats();

loadCalendar();

loadSettings();