const STATUSES = ['Applied','Under Consideration','OA/Task Pending','Interview Scheduled','Interviewed','Offer','Rejected','No Response','Ghosted'];
const API = '/api/applications';

let apps = [];
let filter = 'All';
let searchTerm = '';
let currentPage = 1;

const PAGE_SIZE = 8;
let charts = {};

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
        <div class="notification-item">

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
    new Notification(
      'Job Tracker — Follow-up due',
      {
        body:
          `${a.company}` +
          `${a.role ? ` · ${a.role}` : ''}` +
          ` needs a follow-up.`,

        tag: `followup-${a._id}`
      }
    );


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
}


// ============================================================
// LOAD STATS
// ============================================================

async function loadStats(){

  const res =
    await fetch(API + '/stats');

  const stats =
    await res.json();

  renderStatCards(stats);

  renderCharts(stats);
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

    <div class="stat">
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


    <div class="stat pending">
      <div class="n">
        ${stats.byStatus['OA/Task Pending'] || 0}
      </div>

      <div class="l">
        Task pending
      </div>
    </div>


    <div class="stat overdue">
      <div class="n">
        ${stats.overdueFollowups}
      </div>

      <div class="l">
        Follow-up due
      </div>
    </div>

  `;
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
// RENDER TABLE
// ============================================================

function renderTable(){

  let list =
    apps.slice();


  // Filter
  if(filter !== 'All'){

    list =
      list.filter(
        a =>
          a.status === filter
      );
  }


  // Search
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
      );
  }


  // Sort overdue first
  list.sort(
    (a,b)=>{

      const aOver =
        isOverdue(a);

      const bOver =
        isOverdue(b);


      if(
        aOver &&
        !bOver
      ){

        return -1;
      }


      if(
        !aOver &&
        bOver
      ){

        return 1;
      }


      return (
        new Date(
          a.nextFollowupDate
        )
        -
        new Date(
          b.nextFollowupDate
        )
      );
    }
  );


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

    currentPage =
      totalPages;
  }


  const start =
    (currentPage - 1) *
    PAGE_SIZE;


  const pageItems =
    list.slice(
      start,
      start + PAGE_SIZE
    );


  wrap.innerHTML = `

    <div class="result-count">

      ${total}
      application${total === 1 ? '' : 's'}
      · page
      ${currentPage}
      of
      ${totalPages}

    </div>


    <table>

      <thead>

        <tr>

          <th>
            Company / Role
          </th>

          <th>
            Source
          </th>

          <th>
            Applied
          </th>

          <th>
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


          return `

            <tr
              data-id="${a._id}"
            >

              <td
                data-label="Company"
              >

                <div class="company">
                  ${esc(a.company)}
                </div>

                <div class="role">
                  ${esc(a.role || '')}
                </div>

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


          await loadApps();

          await loadStats();
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
  // DELETE
  // ==========================================================

  wrap
    .querySelectorAll(
      '[data-del]'
    )
    .forEach(btn => {

      btn.onclick =
        async ()=>{

          await fetch(
            `${API}/${btn.dataset.del}`,
            {
              method: 'DELETE'
            }
          );


          await loadApps();

          await loadStats();
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
}


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
          .trim()
    };


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
      'f-portal'
    ]
    .forEach(
      id =>
        document
          .getElementById(id)
          .value = ''
    );


    document.getElementById(
      'f-source'
    ).value =
      'Wellfound';


    showToast(
      'Added',
      'success'
    );


    await loadApps();

    await loadStats();
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
// START APPLICATION
// ============================================================

loadApps();

loadStats();