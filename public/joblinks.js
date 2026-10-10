// Job-site sidebar logic
// - Loads links from /api/links (persisted, so they survive across devices)
// - Collapsed: heading + icon-only rail. Expanded: icons + names + "Add link".
// - Icons come from joblinks-icons.js (window.JobLinksIcons)
// - Add / remove links via modal + API

(function () {
  'use strict';

  const API_LINKS = '/api/links';
  const Icons = window.JobLinksIcons;

  if (!Icons) {
    console.error('joblinks-icons.js must be loaded before joblinks.js');
    return;
  }

  // ---- DOM refs ----
  const sidebar = document.getElementById('jobLinksSidebar');
  const rail = document.getElementById('sidebarLinks');
  const railToggle = document.getElementById('sidebarToggle');
  const addChip = document.getElementById('sidebarAddChip');

  const modal = document.getElementById('linkModal');
  const modalTitle = document.getElementById('linkModalTitle');
  const modalClose = document.getElementById('linkModalClose');
  const modalCancel = document.getElementById('linkModalCancel');
  const modalSave = document.getElementById('linkModalSave');
  const nameInput = document.getElementById('linkNameInput');
  const urlInput = document.getElementById('linkUrlInput');
  const sectionSelect = document.getElementById('linkSectionSelect');
  const previewIcon = document.getElementById('linkPreviewIcon');
  const previewName = document.getElementById('linkPreviewName');
  const previewHost = document.getElementById('linkPreviewHost');

  // ---- state ----
  let linksBySection = { S: [], A: [], B: [], C: [] };
  let sectionsMeta = [];
  let editingLinkId = null;

  // ---- toast ----
  let toastTimer = null;
  function showToast(msg, type) {
    type = type || 'success';
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // ---- helpers ----
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // "cutshort.io/jobs" -> "https://cutshort.io/jobs"
  function normalizeUrl(raw) {
    const u = (raw || '').trim();
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
  }

  // "in.indeed.com" -> "Indeed", "www.glassdoor.co.in" -> "Glassdoor"
  function suggestName(host) {
    const labels = host.replace(/^www\./, '').split('.').slice(0, -1);
    let best = '';
    labels.forEach(function (l) { if (l.length > best.length) best = l; });
    return best ? best.charAt(0).toUpperCase() + best.slice(1) : '';
  }

  // ---- render rail ----
  function renderRail() {
    if (!rail) return;

    const expanded = sidebar.classList.contains('sidebar-expanded');

    const sections = sectionsMeta.length
      ? sectionsMeta
      : [
          { tier: 'S', label: 'S · Best reply rate', description: '' },
          { tier: 'A', label: 'A · Strong', description: '' },
          { tier: 'B', label: 'B · Fresher / niche', description: '' },
          { tier: 'C', label: 'C · Also try', description: '' }
        ];

    let html = '';

    for (const sec of sections) {
      const tier = sec.tier;
      const links = linksBySection[tier] || [];
      if (!links.length) continue;

      html += '<div class="sidebar-section">';
      html += '<div class="sidebar-section-head">';
      html += '<span class="sidebar-section-tier">' + esc(tier) + '</span>';
      html += '<span class="sidebar-section-label">' + esc(sec.label) + '</span>';
      html += '</div>';
      html += '<div class="sidebar-section-items" role="list">';

      for (const link of links) {
        html += railItemHtml(link, expanded);
      }

      html += '</div></div>';
    }

    // If nothing rendered at all, show empty state.
    if (!html) {
      html = '<div class="sidebar-empty">No links yet.</div>';
    }

    rail.innerHTML = html;

    // Wire each rail item
    rail.querySelectorAll('.sidebar-rail-item').forEach(function (item) {
      // Remove button
      const rm = item.querySelector('.sidebar-remove-btn');
      if (rm) {
        rm.addEventListener('click', function (e) {
          e.preventDefault(); // button sits inside the <a>, don't open the link
          e.stopPropagation();
          removeLinkById(item.getAttribute('data-link-id'));
        });
      }

      // Keyboard activation: Space on the <a> should follow the link too
      if (item.classList.contains('sidebar-rail-link')) {
        item.addEventListener('keydown', function (e) {
          if (e.key === ' ' && e.target === item) {
            e.preventDefault();
            item.click();
          }
        });
      }
    });

    updateScrollAffordance();
    setTimeout(updateScrollAffordance, 60);
  }

  function updateScrollAffordance() {
    if (!rail) return;
    const hasOverflowBottom = rail.scrollTop + rail.clientHeight < rail.scrollHeight - 6;
    const hasOverflowTop = rail.scrollTop > 6;

    rail.classList.toggle('has-overflow-bottom', hasOverflowBottom);
    rail.classList.toggle('has-overflow-top', hasOverflowTop);

    const hint = document.getElementById('sidebarScrollHint');
    if (hint) {
      hint.classList.toggle('visible', hasOverflowBottom);
    }
  }

  function removeButtonHtml(link) {
    if (!link.isCustom) return '';
    return '' +
      '<button class="sidebar-remove-btn" type="button" title="Remove link" aria-label="Remove ' + esc(link.name) + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
          '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
        '</svg>' +
      '</button>';
  }

  function railItemHtml(link, expanded) {
    // Each rail item is a clickable link that opens the job portal in a new tab.
    // The remove button (only for custom links) lives alongside the link.
    const itemClass = 'sidebar-rail-item' +
      (expanded ? ' sidebar-expanded' : '');

    const inner =
      '<div class="sidebar-rail-icon">' + Icons.iconFor(link) + '</div>' +
      '<div class="sidebar-rail-name">' + esc(link.name) + '</div>' +
      removeButtonHtml(link);

    if (!link.url) {
      // No URL — render a non-interactive placeholder
      return '' +
        '<div class="' + itemClass + '" ' +
          'title="' + esc(link.name) + '" ' +
          'data-link-id="' + esc(link._id || '') + '" ' +
          'role="listitem">' +
          inner +
        '</div>';
    }

    return '' +
      '<a class="' + itemClass + ' sidebar-rail-link" ' +
        'href="' + esc(link.url) + '" ' +
        'target="_blank" rel="noopener" ' +
        'title="' + esc(link.name) + '" ' +
        'data-link-id="' + esc(link._id || '') + '" ' +
        'role="listitem">' +
        inner +
      '</a>';
  }

  function findLinkById(id) {
    for (const tier of ['S', 'A', 'B', 'C']) {
      const found = linksBySection[tier].find(function (l) { return l._id === id; });
      if (found) return found;
    }
    return null;
  }

  // ---- Delete confirmation dialog (uses the app's styled confirm modal) ----
  let pendingDeleteResolver = null;

  function showDeleteConfirm(link) {
    return new Promise(function (resolve) {
      const msg = document.getElementById('confirmMessage');
      const yesBtn = document.getElementById('confirmYes');
      const cancelBtn = document.getElementById('confirmCancel');
      const modal = document.getElementById('confirmModal');

      if (!modal || !msg || !yesBtn || !cancelBtn) {
        // Fallback: native confirm if the modal elements are missing
        resolve(window.confirm('Remove "' + link.name + '" from the sidebar?'));
        return;
      }

      // Style the confirm button as a delete action
      yesBtn.textContent = 'Remove';
      yesBtn.className = 'confirm-btn confirm-danger';

      msg.textContent = 'Remove "' + link.name + '" from the sidebar?';
      modal.classList.remove('hidden');

      const cleanup = function (confirmed) {
        modal.classList.add('hidden');
        yesBtn.onclick = null;
        cancelBtn.onclick = null;
        // Restore confirm button style
        yesBtn.textContent = 'Delete';
        yesBtn.className = 'confirm-btn confirm-danger';
        pendingDeleteResolver = null;
        resolve(confirmed);
      };

      pendingDeleteResolver = cleanup;
      yesBtn.onclick = function () { cleanup(true); };
      cancelBtn.onclick = function () { cleanup(false); };
    });
  }

  function removeLinkById(id) {
    if (!id) return;
    const link = findLinkById(id);
    if (!link || !link.isCustom) {
      showToast('Cannot remove default links', 'error');
      return;
    }

    showDeleteConfirm(link).then(function (confirmed) {
      if (!confirmed) return;

      fetch(API_LINKS + '/' + id, { method: 'DELETE' })
        .then(function (res) { return res.json(); })
        .then(function () {
          loadLinks();
          showToast('Link removed', 'success');
        })
        .catch(function () {
          showToast('Failed to remove link', 'error');
        });
    });
  }

  // ---- modal ----
  function updatePreview() {
    if (!previewIcon) return;
    const url = normalizeUrl(urlInput.value);
    const name = (nameInput.value || '').trim();
    const host = Icons.hostOf(url);

    previewIcon.innerHTML = Icons.iconFor({ url: url, name: name });
    previewName.textContent = name || 'New link';
    previewHost.textContent = host || 'Icon is picked automatically from the URL';
  }

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 300);
  }

  function openModal(link) {
    if (!modal) return;
    editingLinkId = link ? link._id || null : null;
    modalTitle.textContent = link ? 'Edit job link' : 'Add job link';

    nameInput.value = link ? link.name || '' : '';
    urlInput.value = link ? link.url || '' : '';
    sectionSelect.value = link ? link.section || 'C' : 'C';

    updatePreview();
    modal.classList.remove('hidden');
    // focus URL first — the name gets suggested from it
    setTimeout(function () { urlInput.focus(); }, 0);
  }

  function closeModal() {
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    editingLinkId = null;
    if (addChip) addChip.focus();
  }

  function saveFromModal() {
    const name = (nameInput.value || '').trim();
    const url = normalizeUrl(urlInput.value);
    const section = sectionSelect.value.toUpperCase();

    if (!url) {
      showToast('Add the site URL', 'error');
      urlInput.focus();
      return;
    }
    if (!Icons.hostOf(url)) {
      showToast('That URL does not look right', 'error');
      urlInput.focus();
      return;
    }
    if (!name) {
      showToast('Add a site name', 'error');
      nameInput.focus();
      return;
    }

    const body = JSON.stringify({ name: name, url: url, section: section });
    const wasEditing = !!editingLinkId;

    modalSave.disabled = true;

    const promise = editingLinkId
      ? fetch(API_LINKS + '/' + editingLinkId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: body
        })
      : fetch(API_LINKS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body
        });

    promise
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data._id) {
          showToast((data && data.error) || 'Could not save link', 'error');
          return;
        }
        closeModal();
        loadLinks();
        showToast(wasEditing ? 'Link updated' : 'Link added', 'success');
      })
      .catch(function () {
        showToast('Failed to save link', 'error');
      })
      .then(function () {
        modalSave.disabled = false;
      });
  }

  // ---- load links from server ----
  function loadLinks() {
    if (!rail) return;

    // Show a soft loading state while we fetch.
    rail.innerHTML = '<div class="sidebar-loading"><div class="spinner"></div></div>';

    fetch(API_LINKS)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        linksBySection = { S: [], A: [], B: [], C: [] };
        if (data.sections) {
          for (const sec of data.sections) {
            linksBySection[sec.tier] = sec.links || [];
          }
        }

        sectionsMeta = data.sectionsMeta || [];

        renderRail();
      })
      .catch(function () {
        rail.innerHTML = '<div class="sidebar-empty">Could not load links.</div>';
      });
  }

  // ---- wire events (defensively: only if elements exist) ----

  // Favicons that fail to load fall back to a letter avatar
  Icons.watch(rail);
  Icons.watch(previewIcon);

  if (railToggle && sidebar) {
    railToggle.addEventListener('click', function () {
      const expanded = !sidebar.classList.contains('sidebar-expanded');
      sidebar.classList.toggle('sidebar-expanded', expanded);
      sidebar.classList.toggle('sidebar-collapsed', !expanded);
      railToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      renderRail();
      setTimeout(updateScrollAffordance, 240);
    });
  }

  const scrollHint = document.getElementById('sidebarScrollHint');
  if (scrollHint && rail) {
    scrollHint.addEventListener('click', function () {
      rail.scrollBy({ top: 140, behavior: 'smooth' });
    });
  }

  if (rail) {
    rail.addEventListener('scroll', updateScrollAffordance, { passive: true });
    window.addEventListener('resize', updateScrollAffordance, { passive: true });
  }

  if (addChip) {
    addChip.addEventListener('click', function () { openModal(null); });
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (modalSave) modalSave.addEventListener('click', saveFromModal);

  if (urlInput) {
    urlInput.addEventListener('input', schedulePreview);
    // Suggest a name from the URL if the user hasn't typed one
    urlInput.addEventListener('blur', function () {
      const host = Icons.hostOf(normalizeUrl(urlInput.value));
      if (host && !(nameInput.value || '').trim()) {
        nameInput.value = suggestName(host);
      }
      updatePreview();
    });
  }
  if (nameInput) {
    nameInput.addEventListener('input', schedulePreview);
  }

  // Enter in either text field saves
  [urlInput, nameInput].forEach(function (input) {
    if (!input) return;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveFromModal();
      }
    });
  });

  // Close modal on outside click / Escape
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target.id === 'linkModal') closeModal();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  // ---- init ----
  loadLinks();

  // Refresh links when the page regains focus (handy if user added a link in
  // another tab and comes back here).
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) loadLinks();
  });

})();