const STATUSES = ['Applied','Under Consideration','OA/Task Pending','Interview Scheduled','Interviewed','Offer','Rejected','No Response','Ghosted'];const API = '/api/applications';
let apps = [];
let filter = 'All';
let charts = {};

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
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

function renderCharts(stats){
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
      plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10 } }, title: { display: true, text: 'By status', font: { size: 11 } } }
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
      plugins: { legend: { display: false }, title: { display: true, text: 'By source', font: { size: 11 } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });

  const weeklyCtx = document.getElementById('weeklyChart');
  if(charts.weekly) charts.weekly.destroy();
  charts.weekly = new Chart(weeklyCtx, {
    type: 'line',
    data: {
      labels: stats.weeks.map(w=>w.label),
      datasets: [{ data: stats.weeks.map(w=>w.count), borderColor: '#0F6B5C', backgroundColor: '#E4F1EE', tension: 0.3, fill: true }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: 'Applications per week', font: { size: 11 } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
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
          <td><div class="company">${esc(a.company)}</div><div class="role">${esc(a.role||'')}</div></td>
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
          <td class="notes">${esc(a.notes||'')}</td>
          <td class="row-actions"><button data-del="${a._id}" title="Delete">✕</button></td>
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
      showToast('Status updated');
      await loadApps(); await loadStats();
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
      showToast(answered ? 'Nice — next check in 3 days' : 'Noted — next check in 3 days');
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
  if(!company){ showToast('Company name needed'); return; }
  const body = {
    company,
    role: document.getElementById('f-role').value.trim(),
    source: document.getElementById('f-source').value,
    dateApplied: document.getElementById('f-date').value || undefined,
    notes: document.getElementById('f-notes').value.trim()
  };
  await fetch(API, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  ['f-company','f-role','f-date','f-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('f-source').value = 'Wellfound';
  showToast('Added');
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
