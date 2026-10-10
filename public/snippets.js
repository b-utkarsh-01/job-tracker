// "Mails & notes" box: floating button -> big centered modal with two tabs.
//   Mails: subject + mail content + optional resume link / resume note
//   Notes: plain notes (optional title + text)
// Loaded after app.js and uses its globals: apps, esc, showToast, askConfirm.
(function () {
  'use strict';

  const API_SNIPPETS = '/api/snippets';
  const $ = (id) => document.getElementById(id);

  const fabBtn = $('notesFab');
  const overlay = $('notesHub');
  if (!fabBtn || !overlay) return;

  const closeBtn = $('notesHubClose');
  const tabBtns = overlay.querySelectorAll('[data-hub-tab]');
  const listView = $('notesHubListView');
  const editView = $('notesHubEditView');
  const listEl = $('notesHubList');
  const newBtn = $('notesHubNew');
  const fillRow = $('hubFillRow');
  const fillSelect = $('snippetFillSelect');

  const mailFields = $('hubMailFields');
  const noteFields = $('hubNoteFields');
  const resumeFields = $('hubResumeFields');
  const bodyLabel = $('hubBodyLabel');
  const subjectInput = $('hubSubject');
  const titleInput = $('hubTitle');
  const bodyInput = $('hubBody');
  const resumeLinkInput = $('hubResumeLink');
  const resumeNoteInput = $('hubResumeNote');
  const cancelBtn = $('hubCancel');
  const saveBtn = $('hubSave');

  let items = [];
  let tab = 'mail';       // 'mail' | 'note'
  let editingId = null;
  let dirty = false;      // unsaved changes in the editor

  // ---------------- helpers ----------------
  const attr = (s) => esc(s).replace(/"/g, '&quot;');
  const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const inEditor = () => !editView.classList.contains('hidden');

  function normalizeUrl(raw) {
    const u = (raw || '').trim();
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
  }

  function selectedApp() {
    return apps.find(a => a._id === fillSelect.value) || null;
  }

  // Replace {company} / {role} with the application picked in the dropdown
  function fillText(text) {
    const app = selectedApp();
    if (!app) return text;
    return String(text || '')
      .replace(/\{company\}/gi, () => app.company || '')
      .replace(/\{role\}/gi, () => app.role || '');
  }

  // Called from app.js after every loadApps()
  window.renderSnippetFill = function () {
    const current = fillSelect.value;
    fillSelect.innerHTML =
      '<option value="">No application (keep placeholders)</option>' +
      apps.map(a =>
        `<option value="${a._id}">${esc(a.company)}${a.role ? ' · ' + esc(a.role) : ''}</option>`
      ).join('');
    fillSelect.value = current;
    if (fillSelect.selectedIndex < 0) fillSelect.value = '';
  };

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Fallback for http / older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  // ---------------- list view ----------------
  function mailCard(s) {
    const subject = s.subject || s.title || '(no subject)';
    const hasResume = s.resumeLink || s.resumeNote;
    const resume = hasResume ? `
      <div class="hub-resume-row">
        <span class="hub-resume-tag">Resume</span>
        <span class="hub-resume-note">${esc(s.resumeNote || '')}</span>
        ${s.resumeLink ? `
          <a href="${attr(s.resumeLink)}" target="_blank" rel="noopener">Open ↗</a>
          <button type="button" data-act="copy-resume">Copy link</button>
        ` : ''}
      </div>` : '';

    return `
      <div class="hub-card hub-mail" data-id="${s._id}">
        <div class="hub-mail-head">
          <span class="hub-card-title">${esc(subject)}</span>
          <span class="hub-actions">
            <button type="button" data-act="copy-subject">Copy subject</button>
            <button type="button" data-act="copy-body" class="hub-primary">Copy mail</button>
            <button type="button" data-act="edit">Edit</button>
            <button type="button" data-act="del">Delete</button>
          </span>
        </div>
        <pre class="hub-body" title="Click to expand / collapse">${esc(s.body)}</pre>
        ${resume}
      </div>`;
  }

  function noteCard(s) {
    return `
      <div class="hub-card hub-note" data-id="${s._id}" title="Click to open">
        ${s.title ? `<div class="hub-card-title">${esc(s.title)}</div>` : ''}
        <pre class="hub-body">${esc(s.body)}</pre>
        <div class="hub-note-foot">
          <span class="hub-date">${shortDate(s.updatedAt || s.createdAt)}</span>
          <span class="hub-actions">
            <button type="button" data-act="copy-body">Copy</button>
            <button type="button" data-act="del">Delete</button>
          </span>
        </div>
      </div>`;
  }

  function render() {
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.hubTab === tab));
    fillRow.classList.toggle('hidden', tab !== 'mail');
    newBtn.textContent = tab === 'mail' ? '+ New mail' : '+ New note';
    listEl.className = 'notes-hub-list ' + (tab === 'mail' ? 'is-mails' : 'is-notes');

    let list = items.filter(s => s.type === tab);
    if (tab === 'note') {
      // Most recently edited first, like a phone notes app
      list = list.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    if (!list.length) {
      listEl.innerHTML = tab === 'mail'
        ? '<div class="empty">No mails saved yet. Hit "+ New mail" and paste your follow-up mail.</div>'
        : '<div class="empty">No notes yet. Hit "+ New note".</div>';
      return;
    }
    listEl.innerHTML = list.map(tab === 'mail' ? mailCard : noteCard).join('');
  }

  async function load() {
    try {
      const res = await fetch(API_SNIPPETS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      items = await res.json();
    } catch (e) {
      listEl.innerHTML = '<div class="empty">Could not load.</div>';
      return;
    }
    render();
  }

  listEl.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return; // resume "Open" link
    const card = e.target.closest('.hub-card');
    if (!card) return;
    const s = items.find(x => x._id === card.dataset.id);
    if (!s) return;

    const actBtn = e.target.closest('[data-act]');
    const act = actBtn ? actBtn.dataset.act : null;
    const app = selectedApp();
    const forApp = (s.type === 'mail' && app) ? ' for ' + app.company : '';

    if (act === 'copy-subject') {
      await copyText(fillText(s.subject || s.title));
      showToast('Subject copied' + forApp, 'success');
    } else if (act === 'copy-body') {
      await copyText(s.type === 'mail' ? fillText(s.body) : s.body);
      showToast((s.type === 'mail' ? 'Mail copied' : 'Note copied') + forApp, 'success');
    } else if (act === 'copy-resume') {
      await copyText(s.resumeLink);
      showToast('Resume link copied', 'success');
    } else if (act === 'edit') {
      openEditor(s);
    } else if (act === 'del') {
      const name = s.subject || s.title || 'this note';
      const ok = await askConfirm(`Delete "${name}"?`);
      if (!ok) return;
      await fetch(`${API_SNIPPETS}/${s._id}`, { method: 'DELETE' });
      showToast('Deleted', 'success');
      load();
    } else if (s.type === 'note') {
      openEditor(s);                 // tap a note to open it
    } else {
      card.classList.toggle('open'); // tap a mail to expand / collapse
    }
  });

  // ---------------- editor view ----------------
  function showList() {
    editView.classList.add('hidden');
    listView.classList.remove('hidden');
  }

  function openEditor(s) {
    const isMail = tab === 'mail';
    editingId = s ? s._id : null;
    dirty = false;

    mailFields.classList.toggle('hidden', !isMail);
    resumeFields.classList.toggle('hidden', !isMail);
    noteFields.classList.toggle('hidden', isMail);
    bodyLabel.textContent = isMail ? 'Mail content' : 'Note';
    bodyInput.placeholder = isMail
      ? 'Hi, I applied for the {role} role at {company} last week...'
      : 'Write anything...';

    subjectInput.value = s ? (s.subject || s.title || '') : '';
    titleInput.value = s ? (s.title || '') : '';
    bodyInput.value = s ? (s.body || '') : '';
    resumeLinkInput.value = s ? (s.resumeLink || '') : '';
    resumeNoteInput.value = s ? (s.resumeNote || '') : '';

    listView.classList.add('hidden');
    editView.classList.remove('hidden');

    const first = isMail ? subjectInput : (s ? bodyInput : titleInput);
    setTimeout(() => first.focus(), 0);
  }

  // Returns false if the user chose to keep editing
  async function leaveEditor() {
    if (dirty) {
      const ok = await askConfirm('Discard unsaved changes?', {
        confirmText: 'Discard', confirmClass: 'confirm-danger'
      });
      if (!ok) return false;
    }
    dirty = false;
    editingId = null;
    showList();
    return true;
  }

  async function save() {
    const isMail = tab === 'mail';
    const payload = { type: tab, body: bodyInput.value };

    if (isMail) {
      payload.subject = subjectInput.value.trim();
      payload.resumeLink = normalizeUrl(resumeLinkInput.value);
      payload.resumeNote = resumeNoteInput.value.trim();
      if (!payload.subject) {
        showToast('Add a subject', 'error');
        subjectInput.focus();
        return;
      }
    } else {
      payload.title = titleInput.value.trim();
      if (!payload.title && !payload.body.trim()) {
        showToast('Write something first', 'error');
        bodyInput.focus();
        return;
      }
    }

    saveBtn.disabled = true;
    try {
      const res = await fetch(editingId ? `${API_SNIPPETS}/${editingId}` : API_SNIPPETS, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Could not save', 'error');
        return;
      }
      showToast('Saved', 'success');
      dirty = false;
      editingId = null;
      showList();
      await load();
    } catch (e) {
      showToast('Could not save', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  // ---------------- open / close ----------------
  function openHub() {
    overlay.classList.remove('hidden');
    showList();
    render();
    load();
  }

  async function closeHub() {
    if (inEditor() && !(await leaveEditor())) return;
    overlay.classList.add('hidden');
  }

  // ---------------- events ----------------
  fabBtn.addEventListener('click', openHub);
  closeBtn.addEventListener('click', closeHub);
  newBtn.addEventListener('click', () => openEditor(null));
  cancelBtn.addEventListener('click', leaveEditor);
  saveBtn.addEventListener('click', save);

  tabBtns.forEach(b => {
    b.addEventListener('click', async () => {
      if (b.dataset.hubTab === tab) return;
      if (inEditor() && !(await leaveEditor())) return;
      tab = b.dataset.hubTab;
      render();
    });
  });

  // Clicking the blurred backdrop closes the box
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeHub();
  });

  [subjectInput, titleInput, bodyInput, resumeLinkInput, resumeNoteInput].forEach(el => {
    el.addEventListener('input', () => { dirty = true; });
  });

  // Ctrl+Enter / Cmd+Enter saves
  bodyInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  // Escape: editor -> back to list, list -> close box.
  // Capture phase + stopPropagation so app.js's Escape handler doesn't
  // instantly cancel the "Discard?" dialog this may open.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || overlay.classList.contains('hidden')) return;
    const confirmModal = $('confirmModal');
    if (confirmModal && !confirmModal.classList.contains('hidden')) return; // confirm handles it
    e.stopPropagation();
    if (inEditor()) leaveEditor();
    else closeHub();
  }, true);

  window.renderSnippetFill();
})();