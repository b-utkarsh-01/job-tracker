const STATUSES = ['Applied','Under Consideration','OA/Task Pending','Interview Scheduled','Interviewed','Offer','Rejected','No Response','Ghosted'];
const API = '/api/applications';
let apps = [];
let filter = 'All';
let searchTerm = '';
let charts = {};

// ---- Dark mode ----
function initDarkMode(){
  const saved = localStorage.getItem('jt-theme');
  if(saved === 'dark') document.body.classList.add('dark');
  document.getElementById('darkToggle').textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
}
document.getElementById('darkToggle').onclick = ()=>{
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('jt-theme', isDark ? 'dark' : 'light');
  document.getElementById('darkToggle').textContent = isDark ? '☀️' : '🌙';
  if(lastStats) renderCharts(lastStats);
};
initDarkMode();

// ---- Search ----
document.getElementById('searchBox').oninput = (e)=>{
  searchTerm = e.target.value.trim().toLowerCase();
  render();
};

// Turn any URL inside plain text into a clickable "Open link ↗" so long
// links don't blow up the table layout.
function linkify(text){
  const escaped = esc(text);
  return escaped.replace(/(https?:\/\/[^\s]+)/g, (url)=>{
    const clean = url.replace(/[.,;)]+$/, '');
    return `<a href="${clean}" target="_blank" rel="noopener">Open link ↗</a>`;
  });
}

function showToast(msg, type = 'success'){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(()=>{ t.classList.remove('show'); }, 1800);
}

async function loadApps(){
  const res = await fetch(API);
  apps = await res.json();
  render();
}

async function loadStats(){
  const res = await fetch(API + '/stats');
  const stats = await res.json();
  renderStatCards(stats);
  renderCharts(stats);
}

function renderStatCards(stats){
  const active = STATUSES.filter(s => !['Rejected','Ghosted','No Response'].includes(s))
    .reduce((sum,s)=> sum + (stats.byStatus[s]||0), 0);
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="n">${stats.total}</div><div class="l">Total</div></div>
    <div class="stat active"><div class="n">${active}</div><div class="l">Active</div></div>
    <div class="stat pending"><div class="n">${stats.byStatus['OA/Task Pending']||0}</div><div class="l">Task pending</div></div>
    <div class="stat overdue"><div class="n">${stats.overdueFollowups}</div><div class="l">Follow-up due</div></div>
  `;
}

let lastStats = null;

function chartColors(){
  const styles = getComputedStyle(document.body);
  return {
    text: styles.getPropertyValue('--ink').trim(),
    soft: styles.getPropertyValue('--ink-soft').trim(),
    grid: styles.getPropertyValue('--line').trim()
  };
}

function renderCharts(stats){
  lastStats = stats;
  const c = chartColors();
  const palette = ['#0F6B5C','#B8791A','#C13F2B','#4A5568','#7C9885','#D4A574','#8E6C88','#5B7C99'];

  const statusCtx = document.getElementById('statusChart');
  if(charts.status) charts.status.destroy();
  charts.status = new Chart(statusCtx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(stats.byStatus),
      datasets: [{ data: Object.values(stats.byStatus), backgroundColor: palette }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10, color: c.soft } },
        title: { display: true, text: 'By status', font: { size: 11 }, color: c.text }
      }
    }
  });

  const sourceCtx = document.getElementById('sourceChart');
  if(charts.source) charts.source.destroy();
  charts.source = new Chart(sourceCtx, {
    type: 'bar',
    data: {
      labels: Object.keys(stats.bySource),
      datasets: [{ data: Object.values(stats.bySource), backgroundColor: '#0F6B5C' }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: 'By source', font: { size: 11 }, color: c.text } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, color: c.soft }, grid: { color: c.grid } },
        x: { ticks: { color: c.soft }, grid: { color: c.grid } }
      }
    }
  });

  const weeklyCtx = document.getElementById('weeklyChart');
  if(charts.weekly) charts.weekly.destroy();
  charts.weekly = new Chart(weeklyCtx, {
    type: 'line',
    data: {
      labels: stats.weeks.map(w=>w.label),
      datasets: [{ data: stats.weeks.map(w=>w.count), borderColor: '#0F6B5C', backgroundColor: '#0F6B5C33', tension: 0.3, fill: true }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: 'Applications per week', font: { size: 11 }, color: c.text } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, color: c.soft }, grid: { color: c.grid } },
        x: { ticks: { color: c.soft }, grid: { color: c.grid } }
      }
    }
  });
}

function renderFilters(){
  const cats = ['All', ...STATUSES];
  document.getElementById('filters').innerHTML = cats.map(c =>
    `<button data-f="${c}" class="${filter===c?'active':''}">${c}</button>`
  ).join('');
  document.querySelectorAll('#filters button').forEach(b=>{
    b.onclick = ()=>{ filter = b.dataset.f; render(); };
  });
}

function isOverdue(app){
  if(['Rejected','Offer'].includes(app.status)) return false;
  return new Date(app.nextFollowupDate) <= new Date();
}

function renderTable(){
  let list = apps.slice();
  if(filter !== 'All') list = list.filter(a=>a.status===filter);
  if(searchTerm){
    list = list.filter(a =>
      (a.company||'').toLowerCase().includes(searchTerm) ||
      (a.role||'').toLowerCase().includes(searchTerm)
    );
  }
  list.sort((a,b)=>{
    const aOver = isOverdue(a), bOver = isOverdue(b);
    if(aOver && !bOver) return -1;
    if(!aOver && bOver) return 1;
    return new Date(a.nextFollowupDate) - new Date(b.nextFollowupDate);
  });

  const wrap = document.getElementById('tableWrap');
  if(list.length === 0){
    wrap.innerHTML = `<div class="empty">No applications here yet. Add your first one above.</div>`;
    return;
  }

  wrap.innerHTML = `
  <table>
    <thead><tr>
      <th>Company / Role</th><th>Source</th><th>Applied</th><th>Status</th><th>Follow-up (every 3d)</th><th>Notes</th><th></th>
    </tr></thead>
    <tbody>
      ${list.map(a=>{
        const applied = a.dateApplied ? new Date(a.dateApplied).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—';
        const overdue = isOverdue(a);
        const skip = ['Rejected','Offer'].includes(a.status);
        return `
        <tr data-id="${a._id}">
          <td>
            <div class="company">${esc(a.company)}</div>
            <div class="role">${esc(a.role||'')}</div>
            ${a.portalLink ? `<a class="portal-link" href="${esc(a.portalLink)}" target="_blank" rel="noopener">Track status ↗</a>` : ''}
          </td>
          <td>${esc(a.source)}</td>
          <td>${applied}</td>
          <td>
            <select class="status-select" data-id="${a._id}">
              ${STATUSES.map(s=>`<option ${s===a.status?'selected':''}>${s}</option>`).join('')}
            </select>
          </td>
          <td>
            ${skip ? `<span class="followup ok">—</span>` : overdue ? `
              <div class="followup-prompt">
                <span class="followup overdue">Followed up?</span>
                <div class="radio-row">
                  <label><input type="radio" name="fu-${a._id}" value="yes"> Yes</label>
                  <label><input type="radio" name="fu-${a._id}" value="no"> No</label>
                </div>
              </div>
            ` : `<span class="followup ok">next check ${new Date(a.nextFollowupDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>`}
          </td>
          <td class="notes" data-notes-id="${a._id}">${a.notes ? linkify(a.notes) : '<span style="opacity:0.5">— click to add —</span>'}</td>
          <td class="row-actions">
            <button data-edit="${a._id}" title="Edit notes">✎</button>
            <button data-del="${a._id}" title="Delete">✕</button>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  wrap.querySelectorAll('.status-select').forEach(sel=>{
    sel.onchange = async ()=>{
      await fetch(`${API}/${sel.dataset.id}`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ status: sel.value })
      });
      showToast('Status updated', 'success');
      await loadApps(); await loadStats();
    };
  });

  wrap.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.dataset.edit;
      const app = apps.find(a=>a._id===id);
      const cell = wrap.querySelector(`[data-notes-id="${id}"]`);
      cell.innerHTML = `<textarea id="edit-${id}">${app.notes||''}</textarea>`;
      const ta = document.getElementById(`edit-${id}`);
      ta.focus();
      const saveEdit = async ()=>{
        await fetch(`${API}/${id}`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ notes: ta.value.trim() })
        });
        await loadApps();
      };
      ta.onblur = saveEdit;
      ta.onkeydown = (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); ta.blur(); } };
    };
  });

  wrap.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = async ()=>{
      await fetch(`${API}/${btn.dataset.del}`, { method: 'DELETE' });
      await loadApps(); await loadStats();
    };
  });

  wrap.querySelectorAll('input[type=radio]').forEach(radio=>{
    radio.onchange = async (e)=>{
      const id = e.target.name.replace('fu-','');
      const answered = e.target.value === 'yes';
      await fetch(`${API}/${id}/followup`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ answered })
      });
      showToast(answered ? 'Nice — next check in 3 days' : 'Noted — next check in 3 days', 'success');
      await loadApps(); await loadStats();
    };
  });
}

function esc(s){
  const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
}

function render(){
  renderFilters(); renderTable();
}

document.getElementById('addBtn').onclick = async ()=>{
  const company = document.getElementById('f-company').value.trim();
  if(!company){ showToast('Company name needed', 'error'); return; }
  const body = {
    company,
    role: document.getElementById('f-role').value.trim(),
    source: document.getElementById('f-source').value,
    dateApplied: document.getElementById('f-date').value || undefined,
    notes: document.getElementById('f-notes').value.trim(),
    portalLink: document.getElementById('f-portal').value.trim()
  };
  await fetch(API, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  ['f-company','f-role','f-date','f-notes','f-portal'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('f-source').value = 'Wellfound';
  showToast('Added', 'success');
  await loadApps(); await loadStats();
};

document.getElementById('toggleForm').onclick = ()=>{
  const body = document.getElementById('formBody');
  const btn = document.getElementById('toggleForm');
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  btn.textContent = hidden ? 'Hide' : 'Show';
};

loadApps();
loadStats();