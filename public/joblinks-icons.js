// Favicon helper for the job-links sidebar.
// - Icon is picked from the link's own URL (Google favicon service)
// - If there is no usable URL, or the favicon fails to load, a letter
//   avatar (first letter of the site name) is shown instead.

(function () {
  'use strict';

  const FAVICON_BASE = 'https://www.google.com/s2/favicons?sz=64&domain=';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // "cutshort.io/jobs" or "https://cutshort.io/jobs" -> "cutshort.io"
  function hostOf(url) {
    if (!url || typeof url !== 'string') return '';
    let u = url.trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
      const host = new URL(u).hostname;
      return host.includes('.') ? host : '';
    } catch (e) {
      return '';
    }
  }

  function letterOf(name, host) {
    const source = String(name || '').trim() || String(host || '').replace(/^www\./, '');
    return (source.charAt(0) || '?').toUpperCase();
  }

  function letterHtml(letter) {
    return '<span class="sidebar-favicon-letter" aria-hidden="true">' + esc(letter) + '</span>';
  }

  // link = { url, name }
  function iconFor(link) {
    const host = hostOf(link && link.url);
    const letter = letterOf(link && link.name, host);
    if (!host) return letterHtml(letter);
    return '<img class="sidebar-favicon" src="' + FAVICON_BASE + encodeURIComponent(host) +
      '" alt="" loading="lazy" data-letter="' + esc(letter) + '">';
  }

  // Call once on a container: any favicon inside it that fails to load is
  // swapped for the letter avatar. (error events don't bubble, so capture.)
  function watch(container) {
    if (!container) return;
    container.addEventListener('error', function (e) {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || !img.classList.contains('sidebar-favicon')) return;
      const span = document.createElement('span');
      span.className = 'sidebar-favicon-letter';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = img.getAttribute('data-letter') || '?';
      img.replaceWith(span);
    }, true);
  }

  window.JobLinksIcons = { iconFor: iconFor, hostOf: hostOf, watch: watch };
})();