// "Mails & notes" box: floating button -> big centered modal with two tabs.
//   Mails: subject + formatted mail content + optional resume link / note
//   Notes: formatted notes (optional title + text), drag to reorder,
//          hold to multi-select and delete together
// Loaded after app.js and uses its globals: apps, esc, showToast, askConfirm.
(function () {
  'use strict';

  const API_SNIPPETS = '/api/snippets';
  const JSON_HEADERS = { 'Content-Type': 'application/json' };
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
  const toolbar = newBtn.closest('.notes-hub-toolbar');
  const fillRow = $('hubFillRow');
  const fillSelect = $('snippetFillSelect');

  const selectBar = $('hubSelectBar');
  const selCount = $('hubSelCount');
  const selAllBtn = $('hubSelAll');
  const selDeleteBtn = $('hubSelDelete');
  const selCancelBtn = $('hubSelCancel');

  const mailFields = $('hubMailFields');
  const noteFields = $('hubNoteFields');
  const resumeFields = $('hubResumeFields');
  const bodyLabel = $('hubBodyLabel');
  const subjectInput = $('hubSubject');
  const titleInput = $('hubTitle');
  const bodyInput = $('hubBody');          // contenteditable rich editor
  const editorBar = $('hubEditorBar');
  const fontSizeSelect = $('hubFontSize');
  const colorInput = $('hubColor');
  const resumeLinkInput = $('hubResumeLink');
  const resumeNoteInput = $('hubResumeNote');
  const cancelBtn = $('hubCancel');
  const saveBtn = $('hubSave');

  let items = [];
  let tab = 'mail';       // 'mail' | 'note'
  let editingId = null;
  let dirty = false;      // unsaved changes in the editor

  let selectMode = false; // notes multi-select
  const selected = new Set();
  let suppressClick = false; // swallow the click that follows a drag / hold
  let gesture = null;        // current hold / drag on a note card
  let openTimer = null;      // single tap waits a moment in case a second tap comes
  let lastTapId = null;
  const DOUBLE_TAP_MS = 280;
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

  // Same, for the formatted version (values are HTML-escaped)
  function fillHtml(html) {
    const app = selectedApp();
    if (!app) return html;
    return String(html || '')
      .replace(/\{company\}/gi, () => esc(app.company || ''))
      .replace(/\{role\}/gi, () => esc(app.role || ''));
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

  // ---------------- rich text: sanitize ----------------
  // Only simple formatting survives. Scripts, images, event handlers and
  // unknown attributes are removed, so pasted / stored HTML is safe to render.
  const KEEP_TAGS = new Set([
    'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'BR', 'HR',
    'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'A', 'FONT', 'BLOCKQUOTE', 'PRE',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
  ]);
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK', 'TITLE', 'HEAD',
    'SVG', 'MATH', 'NOSCRIPT', 'TEMPLATE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'
  ]);
  const KEEP_STYLES = [
    'color', 'background-color', 'font-size', 'font-family', 'font-weight',
    'font-style', 'text-decoration', 'text-align', 'margin-left', 'padding-left'
  ];

  function cleanNode(node) {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }

      const tag = child.tagName.toUpperCase();
      if (DROP_TAGS.has(tag)) { child.remove(); return; }

      cleanNode(child);

      // Unknown tag: keep its text, drop the tag itself
      if (!KEEP_TAGS.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        return;
      }

      const styles = [];
      KEEP_STYLES.forEach(p => {
        const v = child.style.getPropertyValue(p);
        if (v && !/url\(|expression|javascript:/i.test(v)) styles.push([p, v]);
      });
      const href = tag === 'A' ? (child.getAttribute('href') || '').trim() : '';
      const size = tag === 'FONT' ? child.getAttribute('size') : null;
      const color = tag === 'FONT' ? child.getAttribute('color') : null;

      Array.from(child.attributes).forEach(a => child.removeAttribute(a.name));

      styles.forEach(([p, v]) => child.style.setProperty(p, v));
      if (/^(https?:\/\/|mailto:)/i.test(href)) {
        child.setAttribute('href', href);
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener');
      }
      if (size && /^[1-7]$/.test(size)) child.setAttribute('size', size);
      if (color && /^[#\w(),.% ]+$/.test(color)) child.setAttribute('color', color);
    });
  }

  function sanitizeHtml(html) {
    const tpl = document.createElement('template'); // inert: nothing runs or loads
    tpl.innerHTML = String(html || '');
    cleanNode(tpl.content);
    return tpl.innerHTML;
  }

  // Formatted body of a saved item. Items saved before rich text existed
  // only have plain `body`, so line breaks are converted.
  function htmlOf(s) {
    if (s.bodyHtml) return sanitizeHtml(s.bodyHtml);
    return esc(s.body || '').replace(/\n/g, '<br>');
  }

  // ---------------- copy ----------------
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

  // Copies formatted HTML + a plain-text version together. Gmail / Outlook /
  // Docs pick the formatted one, plain inputs (WhatsApp etc.) get the text.
  async function copyRich(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
        return;
      }
    } catch (e) { /* fall through to the selection-based copy */ }

    const box = document.createElement('div');
    box.contentEditable = 'true';
    box.innerHTML = html;
    box.style.cssText = 'position:fixed;left:-9999px;top:0;color:#222;font:14px Arial,sans-serif;white-space:normal';
    document.body.appendChild(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    box.remove();
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
        <div class="hub-body hub-rich" title="Click to expand / collapse">${htmlOf(s)}</div>
        ${resume}
      </div>`;
  }

  function noteCard(s) {
    return `
      <div class="hub-card hub-note${selected.has(s._id) ? ' is-selected' : ''}" data-id="${s._id}">
        ${s.title ? `<div class="hub-card-title">${esc(s.title)}</div>` : ''}
        <div class="hub-body hub-rich">${htmlOf(s)}</div>
        <div class="hub-note-foot">
          <span class="hub-date">${shortDate(s.updatedAt || s.createdAt)}</span>
          <span class="hub-actions">
            <button type="button" data-act="copy-body">Copy</button>
            <button type="button" data-act="del">Delete</button>
          </span>
        </div>
      </div>`;
  }

  function visibleNotes() {
    // Manual order first (drag to reorder); ties = most recently edited first
    return items.filter(s => s.type === 'note').sort((a, b) =>
      ((a.order || 0) - (b.order || 0)) || (new Date(b.updatedAt) - new Date(a.updatedAt))
    );
  }

  function updateSelCount() {
    selCount.textContent = selected.size + ' selected';
  }

  function render() {
    const selecting = selectMode && tab === 'note';

    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.hubTab === tab));
    fillRow.classList.toggle('hidden', tab !== 'mail');
    toolbar.classList.toggle('hidden', selecting);
    selectBar.classList.toggle('hidden', !selecting);
    updateSelCount();

    newBtn.textContent = tab === 'mail' ? '+ New mail' : '+ New note';
    listEl.className = 'notes-hub-list ' + (tab === 'mail' ? 'is-mails' : 'is-notes') +
      (selecting ? ' is-selecting' : '');

    const list = tab === 'note' ? visibleNotes() : items.filter(s => s.type === 'mail');

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
    if (suppressClick) { suppressClick = false; e.preventDefault(); return; }

    const card = e.target.closest('.hub-card');
    if (!card) return;
    const s = items.find(x => x._id === card.dataset.id);
    if (!s) return;

    // Multi-select mode: a tap only ticks / unticks the note
    if (selectMode && s.type === 'note') {
      e.preventDefault();
      if (selected.has(s._id)) selected.delete(s._id);
      else selected.add(s._id);
      card.classList.toggle('is-selected', selected.has(s._id));
      updateSelCount();
      return;
    }

    if (e.target.closest('a')) return; // links inside the text / resume "Open"

    const actBtn = e.target.closest('[data-act]');
    const act = actBtn ? actBtn.dataset.act : null;
    const app = selectedApp();
    const isMail = s.type === 'mail';
    const forApp = (isMail && app) ? ' for ' + app.company : '';

    if (act === 'copy-subject') {
      await copyText(fillText(s.subject || s.title));
      showToast('Subject copied' + forApp, 'success');
    } else if (act === 'copy-body') {
      const html = htmlOf(s);
      await copyRich(isMail ? fillHtml(html) : html, isMail ? fillText(s.body) : s.body);
      showToast((isMail ? 'Mail copied' : 'Note copied') + forApp, 'success');
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
      if (openTimer && lastTapId === s._id) {
        // Second tap on the same note = start multi-select
        clearTimeout(openTimer);
        openTimer = null;
        enterSelect(s._id);
      } else {
        // First tap: open the note, unless a second tap arrives in time
        clearTimeout(openTimer);
        lastTapId = s._id;
        openTimer = setTimeout(() => {
          openTimer = null;
          if (tab === 'note' && !selectMode && !overlay.classList.contains('hidden')) openEditor(s);
        }, DOUBLE_TAP_MS);
      }
    } else {
      card.classList.toggle('open'); // tap a mail to expand / collapse
    }
  });

  // ---------------- notes: multi-select ----------------
  function enterSelect(id) {
    selectMode = true;
    selected.clear();
    if (id) selected.add(id);
    render();
  }

  function exitSelect() {
    if (!selectMode) return;
    selectMode = false;
    selected.clear();
    render();
  }

  selCancelBtn.addEventListener('click', exitSelect);

  selAllBtn.addEventListener('click', () => {
    const notes = visibleNotes();
    const all = notes.length > 0 && notes.every(n => selected.has(n._id));
    selected.clear();
    if (!all) notes.forEach(n => selected.add(n._id));
    render();
  });

  selDeleteBtn.addEventListener('click', async () => {
    const ids = Array.from(selected);
    if (!ids.length) {
      showToast('Select at least one note', 'error');
      return;
    }
    const label = ids.length + ' note' + (ids.length > 1 ? 's' : '');
    const ok = await askConfirm(`Delete ${label}?`);
    if (!ok) return;

    try {
      const res = await fetch(API_SNIPPETS + '/bulk-delete', {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showToast('Deleted ' + label, 'success');
    } catch (e) {
      showToast('Could not delete', 'error');
    }
    selectMode = false;
    selected.clear();
    await load();
  });

    // ---------------- notes: hold to select, drag to reorder ----------------
  // Mouse:  drag a note to move it; hold ~half a second without moving to select.
  // Touch:  hold until the note lifts, then drag to move it, or let go to select.
  //         (A normal swipe still scrolls the list.)
  const HOLD_MS = 450;
  const MOVE_PX = 8;
  const FLIP_MS = 180; // how long the other notes take to slide aside

  function swallowNextClick() {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 350);
  }

  // settle === true: the dragged note glides into its slot before cleanup
  function endGesture(settle) {
    if (!gesture) return;
    const g = gesture;
    clearTimeout(g.timer);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', endGesture);
    g.card.classList.remove('is-held');

    const finish = () => {
      g.card.classList.remove('is-dragging');
      listEl.classList.remove('is-reordering');
      listEl.querySelectorAll('.hub-note').forEach(c => {
        c.style.transition = '';
        c.style.transform = '';
      });
      if (gesture === g) gesture = null;
    };

    if (settle === true && g.dragging) {
      g.card.style.transition = `transform ${FLIP_MS}ms ease`;
      g.card.style.transform = 'none';
      setTimeout(finish, FLIP_MS + 20);
    } else {
      finish();
    }
  }

  async function saveOrder() {
    const ids = Array.from(listEl.querySelectorAll('.hub-note')).map(c => c.dataset.id);
    ids.forEach((id, i) => {
      const s = items.find(x => x._id === id);
      if (s) s.order = i;
    });
    try {
      const res = await fetch(API_SNIPPETS + '/reorder', {
        method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ ids })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (e) {
      showToast('Could not save the new order', 'error');
      load();
    }
  }

  // Keep the lifted note under the pointer, wherever its slot currently is
  function placeDragged(e) {
    const card = gesture.card;
    card.style.transition = 'none';
    card.style.transform = 'none';
    const slot = card.getBoundingClientRect();
    const dx = e.clientX - gesture.grabX - slot.left;
    const dy = e.clientY - gesture.grabY - slot.top;
    card.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`;
  }

  // Move the dragged note next to `target`; the other notes slide to their
  // new places instead of jumping (FLIP animation)
  function reorderTo(target) {
    const card = gesture.card;
    const others = Array.from(listEl.querySelectorAll('.hub-note')).filter(c => c !== card);
    const before = new Map(others.map(c => [c, c.getBoundingClientRect()]));

    const cards = Array.from(listEl.children);
    const forward = cards.indexOf(card) < cards.indexOf(target);
    listEl.insertBefore(card, forward ? target.nextSibling : target);

    others.forEach(c => {
      const was = before.get(c);
      const now = c.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (!dx && !dy) return;
      c.style.transition = 'none';
      c.style.transform = `translate(${dx}px, ${dy}px)`;
      c.getBoundingClientRect(); // apply the start position before animating
      c.style.transition = `transform ${FLIP_MS}ms ease`;
      c.style.transform = '';
    });

    // No new swap until the slide finishes, otherwise notes flicker back and forth
    gesture.lockUntil = Date.now() + FLIP_MS + 40;
  }

  function onPointerMove(e) {
    if (!gesture) return;

    if (!gesture.dragging) {
      const moved = Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y);
      if (moved < MOVE_PX) return;
      // Finger moved before the hold finished = the user is scrolling
      if (gesture.touch && !gesture.armed) { endGesture(); return; }

      gesture.dragging = true;
      clearTimeout(gesture.timer);
      gesture.card.classList.remove('is-held');
      gesture.card.classList.add('is-dragging');
      listEl.classList.add('is-reordering');
    }

    if (Date.now() > gesture.lockUntil) {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const target = under ? under.closest('.hub-note') : null;
      if (target && target !== gesture.card && target.parentNode === listEl) reorderTo(target);
    }

    // Auto-scroll near the top / bottom edge
    const r = listEl.getBoundingClientRect();
    if (e.clientY < r.top + 40) listEl.scrollTop -= 14;
    else if (e.clientY > r.bottom - 40) listEl.scrollTop += 14;

    placeDragged(e);
  }

  function onPointerUp() {
    if (!gesture) return;
    const card = gesture.card;
    const armed = gesture.armed;
    const dragging = gesture.dragging;
    endGesture(true);

    if (dragging) {
      swallowNextClick();
      saveOrder();
    } else if (armed) {
      swallowNextClick();
      enterSelect(card.dataset.id);
    }
  }

  listEl.addEventListener('pointerdown', (e) => {
    if (tab !== 'note' || selectMode || gesture) return;
    if (e.button !== 0) return;
    const card = e.target.closest('.hub-note');
    if (!card || e.target.closest('button, a')) return;

    const rect = card.getBoundingClientRect();
    gesture = {
      card,
      x: e.clientX,
      y: e.clientY,
      grabX: e.clientX - rect.left, // where inside the note it was grabbed
      grabY: e.clientY - rect.top,
      touch: e.pointerType !== 'mouse',
      armed: false,
      dragging: false,
      lockUntil: 0,
      timer: null
    };
    gesture.timer = setTimeout(() => {
      if (!gesture || gesture.dragging) return;
      gesture.armed = true;
      gesture.card.classList.add('is-held');
      if (navigator.vibrate) navigator.vibrate(15);
    }, HOLD_MS);

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', endGesture);
  });

  // Once a note is lifted, stop the page from scrolling under the finger
  listEl.addEventListener('touchmove', (e) => {
    if (gesture && (gesture.armed || gesture.dragging)) e.preventDefault();
  }, { passive: false });

  // Long-press on Android also opens the context menu: not while holding a note
  listEl.addEventListener('contextmenu', (e) => {
    if (gesture) e.preventDefault();
  });

  // ---------------- editor: formatting toolbar ----------------
  let savedRange = null; // last cursor / selection inside the editor

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel.rangeCount && bodyInput.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  });

  function restoreRange() {
    bodyInput.focus();
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function format(cmd, value) {
    restoreRange();
    document.execCommand(cmd, false, value);
    dirty = true;
  }

  // Keep the text selection when a toolbar button is pressed
  editorBar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  editorBar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (btn) format(btn.dataset.cmd);
  });
  fontSizeSelect.addEventListener('change', () => {
    if (fontSizeSelect.value) format('fontSize', fontSizeSelect.value);
    fontSizeSelect.value = '';
  });
  colorInput.addEventListener('input', () => format('foreColor', colorInput.value));

  // Paste keeps formatting (bold, lists, colours...) but drops everything else
  bodyInput.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const html = cd.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitizeHtml(html));
    else document.execCommand('insertText', false, cd.getData('text/plain'));
    dirty = true;
  });

  bodyInput.addEventListener('input', () => {
    dirty = true;
    // A cleared editor keeps a stray <br>; remove it so the placeholder shows
    if (!bodyInput.innerText.trim() && !bodyInput.querySelector('li')) bodyInput.innerHTML = '';
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
    savedRange = null;

    mailFields.classList.toggle('hidden', !isMail);
    resumeFields.classList.toggle('hidden', !isMail);
    noteFields.classList.toggle('hidden', isMail);
    bodyLabel.textContent = isMail ? 'Mail content' : 'Note';
    bodyInput.dataset.placeholder = isMail
      ? 'Hi, I applied for the {role} role at {company} last week...'
      : 'Write anything...';

    subjectInput.value = s ? (s.subject || s.title || '') : '';
    titleInput.value = s ? (s.title || '') : '';
    bodyInput.innerHTML = s ? htmlOf(s) : '';
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
    const text = bodyInput.innerText.replace(/\u00a0/g, ' ').trim();
    const payload = {
      type: tab,
      body: text,                                             // plain version
      bodyHtml: text ? sanitizeHtml(bodyInput.innerHTML) : '' // formatted version
    };

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
      if (!payload.title && !text) {
        showToast('Write something first', 'error');
        bodyInput.focus();
        return;
      }
    }

    saveBtn.disabled = true;
    try {
      const res = await fetch(editingId ? `${API_SNIPPETS}/${editingId}` : API_SNIPPETS, {
        method: editingId ? 'PATCH' : 'POST',
        headers: JSON_HEADERS,
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
    selectMode = false;
    selected.clear();
    overlay.classList.remove('hidden');
    showList();
    render();
    load();
  }

  async function closeHub() {
    if (inEditor() && !(await leaveEditor())) return;
    exitSelect();
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
      selectMode = false;
      selected.clear();
      tab = b.dataset.hubTab;
      render();
    });
  });

  // Clicking the blurred backdrop closes the box
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeHub();
  });

  [subjectInput, titleInput, resumeLinkInput, resumeNoteInput].forEach(el => {
    el.addEventListener('input', () => { dirty = true; });
  });

  // Ctrl+Enter / Cmd+Enter saves
  bodyInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  // Escape: editor -> back to list, select mode -> cancel, list -> close box.
  // Capture phase + stopPropagation so app.js's Escape handler doesn't
  // instantly cancel the "Discard?" dialog this may open.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || overlay.classList.contains('hidden')) return;
    const confirmModal = $('confirmModal');
    if (confirmModal && !confirmModal.classList.contains('hidden')) return; // confirm handles it
    e.stopPropagation();
    if (inEditor()) leaveEditor();
    else if (selectMode) exitSelect();
    else closeHub();
  }, true);

  window.renderSnippetFill();
})();