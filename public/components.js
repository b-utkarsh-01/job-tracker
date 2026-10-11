// ============================================================
// APP COMPONENTS & PRIMITIVES
// Shared accessible components: Custom Select, Accordion SettingsGroup,
// Modal helpers, and Toggle switches.
// ============================================================
(function () {
  'use strict';

  // ------------------------------------------------------------
  // CUSTOM SELECT COMPONENT
  // Replaces native select with a styled, accessible widget matching theme.
  // On mobile / touch devices, taps trigger the native picker smoothly.
  // ------------------------------------------------------------
  function enhanceSelect(selectEl) {
    if (!selectEl || selectEl._customEnhanced) return;
    selectEl._customEnhanced = true;

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    if (selectEl.id) wrapper.id = `wrap-${selectEl.id}`;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'custom-select-label';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'custom-select-chevron';
    iconSpan.innerHTML = window.AppIcons ? window.AppIcons.get('chevron-down', { size: 14 }) : '▼';

    trigger.appendChild(labelSpan);
    trigger.appendChild(iconSpan);

    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.tabIndex = -1;

    function renderOptions() {
      dropdown.innerHTML = '';
      const selectedIndex = selectEl.selectedIndex >= 0 ? selectEl.selectedIndex : 0;
      const selectedOption = selectEl.options[selectedIndex];
      labelSpan.textContent = selectedOption ? selectedOption.text : 'Select...';

      Array.from(selectEl.options).forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'custom-select-option' + (idx === selectedIndex ? ' is-selected' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', idx === selectedIndex ? 'true' : 'false');
        item.textContent = opt.text;

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selectEl.selectedIndex = idx;
          labelSpan.textContent = opt.text;
          closeDropdown();
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        });

        dropdown.appendChild(item);
      });
    }

    function openDropdown() {
      // On mobile / small touchscreens, trigger native select picker
      if (window.innerWidth < 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
        selectEl.focus();
        if (typeof selectEl.showPicker === 'function') {
          try { selectEl.showPicker(); return; } catch (e) { /* fallback */ }
        }
      }

      document.querySelectorAll('.custom-select-wrapper.is-open').forEach(w => {
        if (w !== wrapper) w.classList.remove('is-open');
      });
      wrapper.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown() {
      wrapper.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (wrapper.classList.contains('is-open')) closeDropdown();
      else openDropdown();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!wrapper.classList.contains('is-open')) openDropdown();
      } else if (e.key === 'Escape') {
        closeDropdown();
      }
    });

    dropdown.addEventListener('keydown', (e) => {
      const options = Array.from(dropdown.querySelectorAll('.custom-select-option'));
      const currentIndex = options.findIndex(o => o.classList.contains('is-highlighted') || o.classList.contains('is-selected'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (currentIndex + 1) % options.length;
        options.forEach((o, i) => o.classList.toggle('is-highlighted', i === next));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (currentIndex - 1 + options.length) % options.length;
        options.forEach((o, i) => o.classList.toggle('is-highlighted', i === prev));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const highlighted = dropdown.querySelector('.is-highlighted') || dropdown.querySelector('.is-selected');
        if (highlighted) highlighted.click();
      } else if (e.key === 'Escape') {
        closeDropdown();
        trigger.focus();
      }
    });

    // Sync when underlying select changes
    selectEl.addEventListener('change', () => {
      const selectedOption = selectEl.options[selectEl.selectedIndex];
      if (selectedOption) labelSpan.textContent = selectedOption.text;
      dropdown.querySelectorAll('.custom-select-option').forEach((optEl, i) => {
        optEl.classList.toggle('is-selected', i === selectEl.selectedIndex);
      });
    });

    // Observer for option changes
    const observer = new MutationObserver(() => {
      renderOptions();
    });
    observer.observe(selectEl, { childList: true, subtree: true });

    renderOptions();

    // Replace in DOM
    selectEl.parentNode.insertBefore(wrapper, selectEl);
    wrapper.appendChild(selectEl);
    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);

    // Keep native select accessible for form submissions & screen readers
    selectEl.classList.add('visually-hidden-select');
  }

  // Global click to close open dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-wrapper')) {
      document.querySelectorAll('.custom-select-wrapper.is-open').forEach(w => {
        w.classList.remove('is-open');
        const trig = w.querySelector('.custom-select-trigger');
        if (trig) trig.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // ------------------------------------------------------------
  // COLLAPSIBLE SETTINGS GROUP ACCORDION
  // ------------------------------------------------------------
  function initSettingsGroups(container = document) {
    const groups = container.querySelectorAll('.settings-group');
    if (!groups.length) return;

    groups.forEach(group => {
      const header = group.querySelector('.settings-group-header');
      const body = group.querySelector('.settings-group-body');
      if (!header || !body || header._accordionInit) return;
      header._accordionInit = true;

      // Restore saved group state if matches
      const parentCategory = group.closest('.settings-pane') || group.closest('.settings-category-view');
      const categoryKey = parentCategory?.dataset?.settingsPane || 'cat';
      const savedGroupId = (() => {
        try { return localStorage.getItem(`jt-last-group-${categoryKey}`); } catch (e) { return null; }
      })();

      if (savedGroupId && group.dataset.groupId) {
        const shouldBeOpen = group.dataset.groupId === savedGroupId;
        group.classList.toggle('is-open', shouldBeOpen);
        header.setAttribute('aria-expanded', shouldBeOpen ? 'true' : 'false');
        body.style.maxHeight = shouldBeOpen ? 'none' : '0px';
      } else if (group.classList.contains('is-open')) {
        header.setAttribute('aria-expanded', 'true');
        body.style.maxHeight = 'none';
      }

      header.addEventListener('click', () => {
        const wasOpen = group.classList.contains('is-open');

        // Accordion behavior: close other groups in this category
        if (parentCategory) {
          parentCategory.querySelectorAll('.settings-group.is-open').forEach(other => {
            if (other !== group) {
              const otherHeader = other.querySelector('.settings-group-header');
              const otherBody = other.querySelector('.settings-group-body');
              if (otherBody) {
                otherBody.style.maxHeight = `${otherBody.scrollHeight}px`;
                void otherBody.offsetHeight;
                otherBody.style.maxHeight = '0px';
              }
              other.classList.remove('is-open');
              if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
            }
          });
        }

        if (wasOpen) {
          body.style.maxHeight = `${body.scrollHeight}px`;
          void body.offsetHeight;
          group.classList.remove('is-open');
          header.setAttribute('aria-expanded', 'false');
          body.style.maxHeight = '0px';
        } else {
          group.classList.add('is-open');
          header.setAttribute('aria-expanded', 'true');
          body.style.maxHeight = `${body.scrollHeight}px`;
          setTimeout(() => {
            if (group.classList.contains('is-open')) {
              body.style.maxHeight = 'none';
            }
          }, 220);

          // Remember last open group per category
          const groupId = group.dataset.groupId;
          if (groupId) {
            try { localStorage.setItem(`jt-last-group-${categoryKey}`, groupId); } catch (e) {}
          }
        }
      });
    });
  }

  // ------------------------------------------------------------
  // UNIVERSAL MODAL / SHEET BEHAVIOR
  // Focus trap, Escape key, body scroll locking, background blur
  // ------------------------------------------------------------
  let activeModal = null;
  let previousActiveElement = null;

  function openModal(modalEl) {
    if (!modalEl) return;
    previousActiveElement = document.activeElement;
    activeModal = modalEl;
    modalEl.classList.remove('hidden');
    document.body.classList.add('modal-open');

    // Focus first interactive element inside modal
    setTimeout(() => {
      const focusable = modalEl.querySelector('input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
      if (focusable) focusable.focus();
    }, 60);
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('hidden');
    if (activeModal === modalEl) activeModal = null;

    if (!document.querySelector('.shortcut-help:not(.hidden), .notes-hub:not(.hidden), .snooze-modal:not(.hidden), .notes-modal-open')) {
      document.body.classList.remove('modal-open');
    }

    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
      previousActiveElement = null;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeModal && !activeModal.classList.contains('hidden')) {
      const closeBtn = activeModal.querySelector('[data-modal-close], .settings-close, .notes-hub-close, .shortcut-close, #linkModalClose');
      if (closeBtn) closeBtn.click();
      else closeModal(activeModal);
    }
  });

  window.AppComponents = {
    enhanceSelect,
    initCustomSelects: (root = document) => {
      root.querySelectorAll('select.styled-select').forEach(enhanceSelect);
    },
    initSettingsGroups,
    openModal,
    closeModal
  };
})();
