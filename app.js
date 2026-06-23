// ============================================================
// Script Manager — Application Logic
// ============================================================

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────
  const STORAGE_KEY = 'scriptManagerData';
  const MAX_IMAGE_WIDTH = 1200;
  const MAX_IMAGE_HEIGHT = 800;
  const AUTOSAVE_DELAY = 400;

  const fs = require('fs');
  const path = require('path');
  const { ipcRenderer } = require('electron');
  const userDataPath = path.join(process.env.APPDATA || process.env.USERPROFILE, 'ScriptManagerData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  const DATA_FILE = path.join(userDataPath, 'data.json');

  // ── State ──────────────────────────────────────────────────
  let state = {
    scripts: [],
    activeScriptId: null,
    currentView: 'editor',
    calendarDate: new Date(),
    searchQuery: '',
    statusFilter: 'all',
    theme: 'dark',
    editorFontSize: 15,
    tpSpeed: 0.5,
    tpMargin: 15,
    tpLineHeight: 1.6,
    tpLetterSpacing: 0,
    tpFontSize: 48,
    tpIsPlaying: false,
    tpMirrored: false,
    tpFlipped: false,
  };

  let tpAnimationId = null;
  let tpLastTimestamp = null;
  let tpExactScrollTop = 0;
  let savedSelectionRange = null;

  // ── DOM Helpers ────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Utilities ──────────────────────────────────────────────
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── Persistence ────────────────────────────────────────────
  function save() {
    try {
      const data = { 
        scripts: state.scripts,
        editorFontSize: state.editorFontSize,
        theme: state.theme
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
    } catch (e) {
      console.error('Failed to save data:', e);
      showToast('Error saving data to disk', 'error');
    }
  }

  function load() {
    try {
      let raw = null;
      if (fs.existsSync(DATA_FILE)) {
        raw = fs.readFileSync(DATA_FILE, 'utf8');
      } else {
        // Fallback to localStorage on first run
        raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          fs.writeFileSync(DATA_FILE, raw, 'utf8'); // migrate it
        }
      }

      if (raw) {
        const data = JSON.parse(raw);
        state.scripts = data.scripts || [];
        state.editorFontSize = data.editorFontSize || 15;
        state.theme = data.theme || 'dark';
        if (state.scripts.length > 0 && !state.activeScriptId) {
          state.activeScriptId = state.scripts[0].id;
        }
      }
    } catch (e) {
      console.error('Failed to load data:', e);
      state.scripts = [];
    }
  }

  // ── Script Operations ─────────────────────────────────────
  function createScript() {
    const script = {
      id: generateId(),
      title: '',
      content: '',
      coverImage: null,
      publishDate: null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.scripts.unshift(script);
    state.activeScriptId = script.id;
    state.currentView = 'editor';
    save();
    render();
    // Focus the title input
    setTimeout(() => {
      const titleInput = $('#scriptTitle');
      if (titleInput) titleInput.focus();
    }, 100);
    showToast('New script created', 'success');
  }

  function deleteScript(id) {
    const idx = state.scripts.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const title = state.scripts[idx].title || 'Untitled Script';
    state.scripts.splice(idx, 1);
    if (state.activeScriptId === id) {
      state.activeScriptId = state.scripts.length > 0 ? state.scripts[0].id : null;
    }
    save();
    render();
    showToast(`"${title}" deleted`, 'info');
  }

  function getScript(id) {
    return state.scripts.find((s) => s.id === id);
  }

  function getActiveScript() {
    return getScript(state.activeScriptId);
  }

  function selectScript(id) {
    if (state.activeScriptId === id) return;
    saveCurrentEditorContent();
    state.activeScriptId = id;
    state.currentView = 'editor';
    render();
    save();

    // Close mobile sidebar if open
    if (document.body.classList.contains('sidebar-is-open')) {
      document.body.classList.remove('sidebar-is-open');
      const sidebar = $('#listPane');
      if (sidebar) sidebar.classList.remove('sidebar-open');
    }
  }

  function saveCurrentEditorContent() {
    const script = getActiveScript();
    if (!script) return;
    const editor = $('#editor');
    const titleInput = $('#scriptTitle');
    if (editor) {
      script.content = editor.innerHTML;
    }
    if (titleInput) {
      script.title = titleInput.value;
    }
    script.updatedAt = new Date().toISOString();
    save();
  }

  // ── Auto-save (debounced) ──────────────────────────────────
  const autoSave = debounce(() => {
    saveCurrentEditorContent();
    updateSidebarActiveItem();
  }, AUTOSAVE_DELAY);

  // ── Rendering ──────────────────────────────────────────────
  function render() {
    renderSidebar();
    renderMainContent();
  }

  function renderSidebar() {
    const listEl = $('#scriptList');
    const countEl = $('#scriptCount');
    if (!listEl) return;

    // Filter scripts by search and status
    const query = state.searchQuery.toLowerCase().trim();
    let filtered = state.scripts;

    if (query) {
      filtered = filtered.filter(
        (s) =>
          (s.title || '').toLowerCase().includes(query) ||
          (s.content || '').toLowerCase().includes(query)
      );
    }
    
    if (state.statusFilter !== 'all') {
      filtered = filtered.filter((s) => (s.status || 'pending') === state.statusFilter);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No scripts found
        </div>`;
    } else {
      listEl.innerHTML = filtered
        .map(
          (s, i) => `
        <div class="script-item ${s.id === state.activeScriptId ? 'active' : ''}" 
             data-id="${s.id}" style="animation-delay: ${i * 40}ms">
          <div class="script-item-thumb">
            ${
              s.coverImage
                ? `<img src="${s.coverImage}" alt="">`
                : '<span>📄</span>'
            }
          </div>
          <div class="script-item-info">
            <div class="script-item-title">${s.title || 'Untitled Script'}</div>
            <div class="script-item-meta">
              <span class="script-item-status status-${s.status || 'pending'}">${(s.status || 'pending').toUpperCase()}</span>
              <span class="script-item-date ${s.publishDate ? 'has-date' : ''}">
                ${s.publishDate ? '📅 ' + formatShortDate(s.publishDate) : 'No date'}
              </span>
            </div>
          </div>
        </div>`
        )
        .join('');
    }

    if (countEl) {
      countEl.textContent = `${state.scripts.length} script${state.scripts.length !== 1 ? 's' : ''}`;
    }
  }

  function renderMainContent() {
    const editorView = $('#editorView');
    const calendarView = $('#calendarView');
    const emptyState = $('#emptyState');
    const deleteBtn = $('#deleteScriptBtn');
    const printBtn = $('#printScriptBtn');
    const tpBtn = $('#openTeleprompterRailBtn');

    // Update nav/rail tabs
    $$('.rail-tab[data-view]').forEach((t) => {
      t.classList.toggle('active', t.dataset.view === state.currentView);
    });

    // Hide all views
    editorView.classList.remove('active');
    calendarView.classList.remove('active');
    emptyState.classList.remove('active');

    if (state.currentView === 'calendar') {
      calendarView.classList.add('active');
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (printBtn) printBtn.style.display = 'none';
      if (tpBtn) tpBtn.style.display = 'none';
      renderCalendar();
      return;
    }

    // Editor view
    const script = getActiveScript();
    if (!script) {
      emptyState.classList.add('active');
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (printBtn) printBtn.style.display = 'none';
      if (tpBtn) tpBtn.style.display = 'none';
      return;
    }

    editorView.classList.add('active');
    if (deleteBtn) deleteBtn.style.display = '';
    if (printBtn) printBtn.style.display = '';
    if (tpBtn) tpBtn.style.display = '';
    renderEditor(script);
  }

  function renderEditor(script) {
    const titleInput = $('#scriptTitle');
    const editor = $('#editor');
    const coverPreview = $('#coverImagePreview');
    const removeCoverBtn = $('#removeCoverBtn');
    const publishDateText = $('#publishDateText');
    const publishDateBtn = $('#publishDateBtn');
    const statusSelect = $('#scriptStatus');

    if (titleInput) titleInput.value = script.title || '';
    if (statusSelect) statusSelect.value = script.status || 'pending';

    if (editor) {
      editor.innerHTML = script.content || '';
      editor.style.fontSize = `${state.editorFontSize}px`;
      updatePartsSidebar();
    }

    const fontSizeSlider = $('#fontSizeSlider');
    if (fontSizeSlider) {
      fontSizeSlider.value = state.editorFontSize;
    }

    // Cover image
    if (coverPreview) {
      if (script.coverImage) {
        coverPreview.innerHTML = `<img src="${script.coverImage}" alt="Cover">`;
        removeCoverBtn.style.display = '';
      } else {
        coverPreview.innerHTML = `
          <div class="cover-placeholder">
            <span class="cover-placeholder-icon">🖼️</span>
            <span>Click to add cover image</span>
          </div>`;
        removeCoverBtn.style.display = 'none';
      }
    }

    // Publish date
    if (publishDateText) {
      if (script.publishDate) {
        publishDateText.textContent = formatDate(script.publishDate);
        publishDateBtn.classList.add('has-date');
      } else {
        publishDateText.textContent = 'Set publish date';
        publishDateBtn.classList.remove('has-date');
      }
    }
  }

  function updateSidebarActiveItem() {
    const script = getActiveScript();
    if (!script) return;
    const item = $(`.script-item[data-id="${script.id}"]`);
    if (!item) return;
    const titleEl = item.querySelector('.script-item-title');
    if (titleEl) titleEl.textContent = script.title || 'Untitled Script';
  }

  // ── Calendar ───────────────────────────────────────────────
  function renderCalendar() {
    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();

    // Update title
    const titleEl = $('#calendarTitle');
    if (titleEl) {
      const monthName = state.calendarDate.toLocaleString('en-US', { month: 'long' });
      titleEl.textContent = `${monthName} ${year}`;
    }

    // Generate days
    const daysEl = $('#calendarDays');
    if (!daysEl) return;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const today = new Date();

    let html = '';

    // Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      html += `<div class="calendar-day other-month"><div class="day-number">${day}</div></div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const scriptsOnDay = state.scripts.filter((s) => s.publishDate === dateStr);

      html += `<div class="calendar-day ${isToday ? 'today' : ''}" data-date="${dateStr}">
        <div class="day-number">${d}</div>
        <div class="day-scripts">
          ${scriptsOnDay
            .map(
              (s) =>
                `<div class="day-script-pill" data-script-id="${s.id}" title="${s.title || 'Untitled'}">
                  <div class="status-dot ${s.status || 'pending'}"></div>
                  ${s.title || 'Untitled'}
                 </div>`
            )
            .join('')}
        </div>
      </div>`;
    }

    // Next month days to fill the grid
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="calendar-day other-month"><div class="day-number">${d}</div></div>`;
    }

    daysEl.innerHTML = html;

    // Render upcoming schedule
    renderUpcoming();
  }

  function renderUpcoming() {
    const container = $('#upcomingList');
    if (!container) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const upcoming = state.scripts
      .filter((s) => s.publishDate && s.publishDate >= todayStr)
      .sort((a, b) => a.publishDate.localeCompare(b.publishDate));

    if (upcoming.length === 0) {
      container.innerHTML = `<div class="upcoming-empty">No upcoming scripts scheduled</div>`;
      return;
    }

    container.innerHTML = upcoming
      .map(
        (s) => `
      <div class="upcoming-item" data-script-id="${s.id}">
        <div class="upcoming-item-date">${formatShortDate(s.publishDate)}</div>
        <div class="upcoming-item-thumb">
          ${s.coverImage ? `<img src="${s.coverImage}" alt="">` : '📄'}
        </div>
        <div class="upcoming-item-title">
          <div style="display:inline-block; margin-right:6px;" class="status-dot ${s.status || 'pending'}"></div>
          ${s.title || 'Untitled Script'}
        </div>
      </div>`
      )
      .join('');
  }

  function navigateMonth(dir) {
    state.calendarDate.setMonth(state.calendarDate.getMonth() + dir);
    renderCalendar();
  }

  function goToToday() {
    state.calendarDate = new Date();
    renderCalendar();
  }

  // ── Rich Text Editor ──────────────────────────────────────
  function execFormat(command, value = null) {
    document.execCommand(command, false, value);
    $('#editor').focus();
  }

  function insertLink() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      showToast('Please select some text first to add a link.', 'info');
      return;
    }

    savedSelectionRange = selection.getRangeAt(0);

    const existingLink = selection.anchorNode?.parentElement?.closest('a');
    const currentUrl = existingLink ? existingLink.href : '';

    // Show link modal
    const linkUrlInput = $('#linkUrlInput');
    const linkModal = $('#linkModal');
    if (linkUrlInput) linkUrlInput.value = currentUrl;
    openModal('linkModal');
    if (linkUrlInput) setTimeout(() => linkUrlInput.focus(), 10);
  }

  function applyLink() {
    const url = $('#linkUrlInput').value.trim();
    
    // Restore selection
    $('#editor').focus();
    if (savedSelectionRange) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedSelectionRange);
    }

    if (!url) {
      document.execCommand('unlink', false, null);
    } else {
      const fullUrl = url.startsWith('http') ? url : 'https://' + url;
      document.execCommand('createLink', false, fullUrl);
    }
    closeModal('linkModal');
    savedSelectionRange = null;
  }

  // ── Image Handling ─────────────────────────────────────────
  function handleImageUpload(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Image too large. Max 10MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      resizeImage(e.target.result, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, (resized) => {
        const script = getActiveScript();
        if (script) {
          script.coverImage = resized;
          script.updatedAt = new Date().toISOString();
          save();
          render();
          showToast('Cover image updated', 'success');
        }
      });
    };
    reader.readAsDataURL(file);
  }

  function resizeImage(dataUrl, maxW, maxH, callback) {
    const img = new Image();
    img.onload = function () {
      let w = img.width;
      let h = img.height;

      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  }

  function removeCoverImage() {
    const script = getActiveScript();
    if (script) {
      script.coverImage = null;
      script.updatedAt = new Date().toISOString();
      save();
      render();
      showToast('Cover image removed', 'info');
    }
  }

  // ── Toasts ─────────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const container = $('#toastContainer');
    if (!container) return;

    const icons = { success: '✅', error: '❌', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // ── Teleprompter ───────────────────────────────────────────
  let tpScriptParts = [];

  function openTeleprompter() {
    saveCurrentEditorContent();
    const script = getActiveScript();
    if (!script) return;

    const tpOverlay = $('#teleprompterOverlay');
    const tpContent = $('#tpContent');
    const tpScrollArea = $('#tpScrollArea');
    const tpPartGroup = $('#tpPartGroup');
    const tpPartSelect = $('#tpPartSelect');

    // Stop any existing animation
    state.tpIsPlaying = false;
    if (tpAnimationId) cancelAnimationFrame(tpAnimationId);
    tpAnimationId = null;
    tpLastTimestamp = null;

    // Extract parts directly from the editor DOM
    const editorEl = $('#editor');
    let partElements = editorEl ? Array.from(editorEl.querySelectorAll('.script-part')) : [];
    
    tpScriptParts = [];
    let tpScriptNames = [];
    
    if (partElements.length > 0) {
      if (script.partsOrder) {
        partElements.sort((a, b) => script.partsOrder.indexOf(a.id) - script.partsOrder.indexOf(b.id));
      }
      partElements.forEach(el => {
        tpScriptParts.push(el.innerHTML);
        tpScriptNames.push(el.dataset.partName || 'Part');
      });
    } else {
      tpScriptParts = [script.content || '<h2 style="text-align:center; color:#666;">Empty Script</h2>'];
      tpScriptNames = ['Script'];
    }

    if (tpScriptParts.length > 1) {
      if (tpPartGroup) tpPartGroup.style.display = 'flex';
      if (tpPartSelect) {
        tpPartSelect.innerHTML = tpScriptNames.map((name, i) => `<option value="${i}">${name}</option>`).join('');
        tpPartSelect.value = "0";
      }
      tpContent.innerHTML = tpScriptParts[0];
    } else {
      if (tpPartGroup) tpPartGroup.style.display = 'none';
      tpContent.innerHTML = tpScriptParts[0];
    }
    
    // Apply initial settings
    updateTeleprompterStyles();
    updateTpPlayButton();
    updateTpTransform();

    // Show overlay, then set scroll after content fully renders
    tpOverlay.hidden = false;
    setTimeout(() => {
      if (state.tpFlipped) {
        // Flipped: beginning of text is at bottom, scroll there
        tpScrollArea.scrollTop = tpScrollArea.scrollHeight - tpScrollArea.clientHeight;
      } else {
        tpScrollArea.scrollTop = 0;
      }
      tpExactScrollTop = tpScrollArea.scrollTop;
    }, 100);
  }

  function closeTeleprompter() {
    state.tpIsPlaying = false;
    if (tpAnimationId) cancelAnimationFrame(tpAnimationId);
    tpAnimationId = null;
    tpLastTimestamp = null;
    $('#teleprompterOverlay').hidden = true;
  }

  function toggleTeleprompterPlay() {
    state.tpIsPlaying = !state.tpIsPlaying;
    updateTpPlayButton();
    if (state.tpIsPlaying) {
      tpLastTimestamp = null;
      tpExactScrollTop = $('#tpScrollArea').scrollTop;
      tpAnimationId = requestAnimationFrame(tpAnimationLoop);
    } else {
      if (tpAnimationId) cancelAnimationFrame(tpAnimationId);
      tpAnimationId = null;
    }
  }

  function updateTpPlayButton() {
    const btn = $('#tpPlayPauseBtn');
    if (btn) {
      btn.textContent = state.tpIsPlaying ? '⏸ Pause (Space)' : '▶ Play (Space)';
    }
  }

  function tpAnimationLoop(timestamp) {
    if (!state.tpIsPlaying) return;
    
    if (tpLastTimestamp === null) {
      tpLastTimestamp = timestamp;
      tpAnimationId = requestAnimationFrame(tpAnimationLoop);
      return;
    }
    
    const scrollArea = $('#tpScrollArea');
    const deltaMs = timestamp - tpLastTimestamp;
    tpLastTimestamp = timestamp;
    const deltaTime = Math.min(deltaMs / 1000, 0.1);
    
    // Speed: 0.2x-1x → 1x = 150px/s
    const pixelsPerSecond = parseFloat(state.tpSpeed) * 150;
    const scrollDelta = pixelsPerSecond * deltaTime;

    if (state.tpFlipped) {
      // Flipped: text beginning is at bottom, scroll upward
      tpExactScrollTop -= scrollDelta;
      if (tpExactScrollTop < 0) tpExactScrollTop = 0;
      scrollArea.scrollTop = Math.round(tpExactScrollTop);
      if (scrollArea.scrollTop <= 0) {
        state.tpIsPlaying = false;
        updateTpPlayButton();
        return;
      }
    } else {
      // Normal: scroll downward
      tpExactScrollTop += scrollDelta;
      scrollArea.scrollTop = Math.round(tpExactScrollTop);
      const maxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
      if (scrollArea.scrollTop >= maxScroll - 1) {
        state.tpIsPlaying = false;
        updateTpPlayButton();
        return;
      }
    }

    tpAnimationId = requestAnimationFrame(tpAnimationLoop);
  }

  function updateTpTransform() {
    const content = $('#tpContent');
    if (!content) return;
    let transforms = [];
    if (state.tpMirrored) transforms.push('scaleX(-1)');
    if (state.tpFlipped) transforms.push('scaleY(-1)');
    content.style.transform = transforms.length ? transforms.join(' ') : 'none';
    
    // Update button active states
    const mirrorBtn = $('#tpMirrorBtn');
    const flipBtn = $('#tpFlipBtn');
    if (mirrorBtn) mirrorBtn.style.background = state.tpMirrored ? 'rgba(124, 107, 245, 0.3)' : '';
    if (flipBtn) flipBtn.style.background = state.tpFlipped ? 'rgba(124, 107, 245, 0.3)' : '';
  }

  function updateTeleprompterStyles() {
    const tpContent = $('#tpContent');
    if (!tpContent) return;
    tpContent.style.fontSize = `${state.tpFontSize}px`;
    tpContent.style.paddingLeft = `${state.tpMargin}vw`;
    tpContent.style.paddingRight = `${state.tpMargin}vw`;
    
    const elements = tpContent.querySelectorAll('*');
    elements.forEach(el => {
      el.style.fontSize = 'inherit';
      el.style.lineHeight = state.tpLineHeight;
      el.style.letterSpacing = `${state.tpLetterSpacing}px`;
    });
    tpContent.style.lineHeight = state.tpLineHeight;
    tpContent.style.letterSpacing = `${state.tpLetterSpacing}px`;
  }

  // ── Modals ─────────────────────────────────────────────────
  function openModal(id) {
    const modal = $(`#${id}`);
    if (modal) modal.hidden = false;
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    if (modal) modal.hidden = true;
  }

  // ── Event Listeners ────────────────────────────────────────
  function setupEventListeners() {
    // Parts List Drag & Drop Reordering
    const partsList = $('#partsList');
    if (partsList) {
      partsList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggable = document.querySelector('.part-item.dragging');
        if (!draggable) return;
        
        const draggableElements = [...partsList.querySelectorAll('.part-item:not(.dragging)')];
        const afterElement = draggableElements.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = e.clientY - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
          } else {
            return closest;
          }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
        
        if (afterElement == null) {
          partsList.appendChild(draggable);
        } else {
          partsList.insertBefore(draggable, afterElement);
        }
      });

      partsList.addEventListener('drop', (e) => {
        e.preventDefault();
        const script = getActiveScript();
        if (!script) return;
        
        const newOrder = Array.from(partsList.querySelectorAll('.part-item')).map(item => item.dataset.partId);
        script.partsOrder = newOrder;
        save();
        updatePartsSidebar();
      });
    }

    // New script buttons
    $('#newScriptBtn').addEventListener('click', createScript);
    $('#emptyNewBtn').addEventListener('click', createScript);

    // Search
    $('#searchInput').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderSidebar();
    });

    // Status Filter
    const statusFilter = $('#statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        state.statusFilter = e.target.value;
        renderSidebar();
      });
    }

    // Theme Toggle removed. Always dark mode.
    state.theme = 'dark';

    // Script list click (delegation)
    $('#scriptList').addEventListener('click', (e) => {
      const item = e.target.closest('.script-item');
      if (item) selectScript(item.dataset.id);
    });

    // Nav tabs
    $$('.rail-tab[data-view]').forEach((tab) => {
      tab.addEventListener('click', () => {
        saveCurrentEditorContent();
        state.currentView = tab.dataset.view;
        render();
      });
    });

    // Delete script
    $('#deleteScriptBtn').addEventListener('click', () => {
      if (state.activeScriptId) openModal('deleteModal');
    });

    $('#confirmDeleteBtn').addEventListener('click', () => {
      closeModal('deleteModal');
      if (state.activeScriptId) deleteScript(state.activeScriptId);
    });

    // Print script
    const printBtn = $('#printScriptBtn');
    if (printBtn) {
      printBtn.addEventListener('click', openPrintPreview);
    }

    function openPrintPreview() {
      if (state.currentView !== 'editor') return;
      saveCurrentEditorContent();
      
      const script = getActiveScript();
      if (!script) return;

      $('#ppTitle').textContent = script.title || 'Untitled Script';
      
      // Convert explicitly white text to black so it's visible on paper
      let content = script.content || '';
      content = content.replace(/color:\s*(?:#ffffff|#fff|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(?:,\s*1\s*)?\))/gi, 'color: #000000');
      
      $('#ppBody').innerHTML = content;
      
      // Force font size in preview to match what they see, or set a standard print size
      $('#ppBody').style.fontSize = `${state.editorFontSize}px`;
      
      $('#printPreviewModal').hidden = false;
    }

    // Print Preview UI Events
    $('.pp-close-btn').addEventListener('click', () => {
      $('#printPreviewModal').hidden = true;
    });

    $('#ppConfirmPrintBtn').addEventListener('click', () => {
      const script = getActiveScript();
      if (script) {
        ipcRenderer.send('print-to-pdf', script.title);
      }
    });

    // Title input
    $('#scriptTitle').addEventListener('input', autoSave);

    // Editor input
    $('#editor').addEventListener('input', autoSave);

    // Clean paste from ChatGPT or other sources
    $('#editor').addEventListener('paste', (e) => {
      e.preventDefault();
      const html = (e.clipboardData || window.clipboardData).getData('text/html');
      if (html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        temp.querySelectorAll('*').forEach(el => {
          el.style.fontSize = '';
          el.style.fontFamily = '';
          el.style.lineHeight = '';
          el.style.backgroundColor = '';
          el.style.color = '';
          if (!el.getAttribute('style')) el.removeAttribute('style');
        });
        document.execCommand('insertHTML', false, temp.innerHTML);
      } else {
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      }
    });

    // Status change
    const statusSelect = $('#scriptStatus');
    if (statusSelect) {
      statusSelect.addEventListener('change', (e) => {
        const script = getActiveScript();
        if (script) {
          script.status = e.target.value;
          script.updatedAt = new Date().toISOString();
          save();
          renderSidebar();
          showToast('Status updated', 'success');
        }
      });
    }

    // Teleprompter controls
    $('#openTeleprompterRailBtn').addEventListener('click', openTeleprompter);
    $('#tpBackBtn').addEventListener('click', closeTeleprompter);
    $('#tpPlayPauseBtn').addEventListener('click', toggleTeleprompterPlay);

    const tpPartSelect = $('#tpPartSelect');
    if (tpPartSelect) {
      tpPartSelect.addEventListener('change', (e) => {
        const partIndex = parseInt(e.target.value, 10);
        $('#tpContent').innerHTML = tpScriptParts[partIndex] || '';
        updateTeleprompterStyles();
        
        // Reset scroll position for the new part
        const tpScrollArea = $('#tpScrollArea');
        tpScrollArea.scrollTop = state.tpFlipped ? (tpScrollArea.scrollHeight - tpScrollArea.clientHeight) : 0;
        tpExactScrollTop = tpScrollArea.scrollTop;
      });
    }

    $('#tpSpeedSlider').addEventListener('input', (e) => {
      state.tpSpeed = e.target.value;
    });

    $('#tpMarginSlider').addEventListener('input', (e) => {
      state.tpMargin = e.target.value;
      updateTeleprompterStyles();
    });

    $('#tpLineHeightSlider').addEventListener('input', (e) => {
      state.tpLineHeight = e.target.value;
      updateTeleprompterStyles();
    });

    $('#tpLetterSpacingSlider').addEventListener('input', (e) => {
      state.tpLetterSpacing = e.target.value;
      updateTeleprompterStyles();
    });

    $('#tpFontSizeSlider').addEventListener('input', (e) => {
      state.tpFontSize = e.target.value;
      updateTeleprompterStyles();
    });

    $('#tpMirrorBtn').addEventListener('click', () => {
      state.tpMirrored = !state.tpMirrored;
      updateTpTransform();
    });

    $('#tpFlipBtn').addEventListener('click', () => {
      state.tpFlipped = !state.tpFlipped;
      updateTpTransform();
    });

    // Pause teleprompter on manual scroll wheel interaction and sync position
    $('#tpScrollArea').addEventListener('wheel', () => {
      if (state.tpIsPlaying) {
        toggleTeleprompterPlay();
      }
      // Sync exact scroll after manual wheel
      setTimeout(() => {
        tpExactScrollTop = $('#tpScrollArea').scrollTop;
      }, 50);
    });

    // Toolbar buttons
    $$('.toolbar-btn[data-command]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cmd = btn.dataset.command;
        const val = btn.dataset.value || null;
        if (cmd === 'formatBlock' && val) {
          execFormat(cmd, `<${val}>`);
        } else {
          execFormat(cmd, val);
        }
      });
    });

    // ── Custom Context Menu ──────────────────────────────────
    const ctxMenu = $('#editorContextMenu');
    const editorEl = $('#editor');
    let ctxSavedRange = null;
    const PART_COLORS = ['#6e6aff', '#ff9f43', '#2ed573', '#ff6b81', '#1e90ff'];

    function hideContextMenu() {
      if (ctxMenu) ctxMenu.hidden = true;
    }

    if (editorEl && ctxMenu) {
      editorEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          // Save the selection range before the menu opens
          ctxSavedRange = sel.getRangeAt(0).cloneRange();
        } else {
          ctxSavedRange = null;
        }

        ctxMenu.hidden = false;
        // Position the menu
        let x = e.clientX;
        let y = e.clientY;
        // Prevent going off screen
        const menuW = ctxMenu.offsetWidth;
        const menuH = ctxMenu.offsetHeight;
        if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 8;
        if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 8;
        ctxMenu.style.left = x + 'px';
        ctxMenu.style.top = y + 'px';
      });

      // Close context menu on click elsewhere
      document.addEventListener('click', (e) => {
        if (!ctxMenu.contains(e.target)) hideContextMenu();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideContextMenu();
      });

      // Handle context menu actions
      ctxMenu.querySelectorAll('.ctx-menu-item').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Don't steal focus/selection
        });
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const action = btn.dataset.action;

          // Restore saved selection
          if (ctxSavedRange) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(ctxSavedRange);
          }

          switch (action) {
            case 'bold':
              document.execCommand('bold');
              break;
            case 'italic':
              document.execCommand('italic');
              break;
            case 'highlight':
              document.execCommand('backColor', false, 'rgba(255, 235, 59, 0.3)');
              break;
            case 'remove-highlight':
              document.execCommand('backColor', false, 'transparent');
              break;
            case 'make-part':
              createPartFromSelection();
              break;
          }

          hideContextMenu();
          saveCurrentEditorContent();
        });
      });
    }

    function createPartFromSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        alert('Pehle kuch text select kijiye!');
        return;
      }
      
      const range = sel.getRangeAt(0);
      const existingParts = editorEl ? editorEl.querySelectorAll('.script-part').length : 0;
      const defaultName = 'Part ' + (existingParts + 1);

      // Show custom prompt
      const overlay = $('#customPromptOverlay');
      const input = $('#customPromptInput');
      const btnOk = $('#customPromptOk');
      const btnCancel = $('#customPromptCancel');

      if (!overlay) return;

      input.value = defaultName;
      overlay.hidden = false;
      input.focus();
      input.select();

      // We need to handle the promise-like behavior
      function closePrompt() {
        overlay.hidden = true;
        // Clean up listeners
        btnOk.onclick = null;
        btnCancel.onclick = null;
        input.onkeydown = null;
        
        // Restore selection safely
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }

      function applyPart(partName) {
        closePrompt();
        if (!partName) return;

        const content = range.extractContents();
        const partDiv = document.createElement('div');
        partDiv.className = 'script-part';
        partDiv.id = 'part-' + Date.now();
        partDiv.dataset.partName = partName.trim() || defaultName;
        partDiv.dataset.partColor = String((existingParts % 5) + 1);
        partDiv.appendChild(content);
        range.insertNode(partDiv);

        window.getSelection().removeAllRanges();
        updatePartsSidebar();
        saveCurrentEditorContent();
      }

      btnOk.onclick = () => applyPart(input.value);
      btnCancel.onclick = () => closePrompt();
      input.onkeydown = (e) => {
        if (e.key === 'Enter') applyPart(input.value);
        if (e.key === 'Escape') closePrompt();
      };
    }

    // Font size slider
    const fontSizeSlider = $('#fontSizeSlider');
    const editor = $('#editor');
    if (fontSizeSlider && editor) {
      fontSizeSlider.addEventListener('input', (e) => {
        const size = e.target.value;
        editor.style.fontSize = `${size}px`;
        state.editorFontSize = size;
        save();
      });
    }

    // Link button
    $('#linkBtn').addEventListener('click', (e) => {
      e.preventDefault();
      insertLink();
    });

    // Save link
    $('#saveLinkBtn').addEventListener('click', applyLink);

    // Color button & picker
    const colorBtn = $('#colorBtn');
    const colorPicker = $('#colorPicker');
    colorBtn.addEventListener('click', (e) => {
      e.preventDefault();
      colorPicker.click();
    });
    colorPicker.addEventListener('input', (e) => {
      execFormat('foreColor', e.target.value);
    });

    // Cover image — click to upload
    $('#coverImageArea').addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-cover')) return;
      $('#coverImageInput').click();
    });

    $('#coverImageInput').addEventListener('change', (e) => {
      if (e.target.files[0]) handleImageUpload(e.target.files[0]);
      e.target.value = '';
    });

    // Cover image — drag & drop
    const coverArea = $('#coverImageArea');
    coverArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      coverArea.classList.add('dragover');
    });
    coverArea.addEventListener('dragleave', () => {
      coverArea.classList.remove('dragover');
    });
    coverArea.addEventListener('drop', (e) => {
      e.preventDefault();
      coverArea.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleImageUpload(e.dataTransfer.files[0]);
    });

    // Remove cover
    $('#removeCoverBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeCoverImage();
    });

    // Publish date
    $('#publishDateBtn').addEventListener('click', () => {
      const script = getActiveScript();
      const dateInput = $('#publishDateInput');
      if (script && dateInput) {
        dateInput.value = script.publishDate || '';
      }
      openModal('dateModal');
    });

    $('#saveDateBtn').addEventListener('click', () => {
      const script = getActiveScript();
      const dateInput = $('#publishDateInput');
      if (script && dateInput) {
        script.publishDate = dateInput.value || null;
        script.updatedAt = new Date().toISOString();
        save();
        render();
        if (script.publishDate) {
          showToast(`Publish date set: ${formatDate(script.publishDate)}`, 'success');
        }
      }
      closeModal('dateModal');
    });

    $('#removeDateBtn').addEventListener('click', () => {
      const script = getActiveScript();
      if (script) {
        script.publishDate = null;
        script.updatedAt = new Date().toISOString();
        save();
        render();
        showToast('Publish date removed', 'info');
      }
      closeModal('dateModal');
    });

    // Calendar navigation
    $('#prevMonth').addEventListener('click', () => navigateMonth(-1));
    $('#nextMonth').addEventListener('click', () => navigateMonth(1));
    $('#todayBtn').addEventListener('click', goToToday);

    // Calendar day click — assign active script's publish date
    $('#calendarDays').addEventListener('click', (e) => {
      // Click on a script pill — navigate to that script
      const pill = e.target.closest('.day-script-pill');
      if (pill) {
        const scriptId = pill.dataset.scriptId;
        selectScript(scriptId);
        return;
      }

      // Click on a day cell — set active script's publish date
      const day = e.target.closest('.calendar-day:not(.other-month)');
      if (day && day.dataset.date) {
        const script = getActiveScript();
        if (script) {
          script.publishDate = day.dataset.date;
          script.updatedAt = new Date().toISOString();
          save();
          renderCalendar();
          renderSidebar();
          showToast(`"${script.title || 'Untitled'}" scheduled for ${formatDate(day.dataset.date)}`, 'success');
        } else {
          showToast('Select a script first to assign a date', 'info');
        }
      }
    });

    // Upcoming items click
    $('#upcomingList').addEventListener('click', (e) => {
      const item = e.target.closest('.upcoming-item');
      if (item) selectScript(item.dataset.scriptId);
    });

    // Modal close buttons
    $$('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        if (modalId) closeModal(modalId);
      });
    });

    // Close modal on overlay click
    $$('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.hidden = true;
      });
    });

    // Mobile Sidebar Toggle
    const mobileMenuBtn = $('#mobileMenuBtn');
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.body.classList.toggle('sidebar-is-open');
        $('#sidebar').classList.toggle('sidebar-open');
      });
    }

    // Close sidebar on mobile when clicking outside
    document.addEventListener('click', (e) => {
      const sidebar = $('#sidebar');
      if (document.body.classList.contains('sidebar-is-open') && !sidebar.contains(e.target) && e.target !== mobileMenuBtn) {
        document.body.classList.remove('sidebar-is-open');
        sidebar.classList.remove('sidebar-open');
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+S — save (prevent default browser save)
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveCurrentEditorContent();
        showToast('Saved', 'success');
      }

      // Ctrl+P — Print
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        if (state.currentView === 'editor') {
          openPrintPreview();
        }
      }

      // Ctrl+F — Find
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        openFindReplace(false);
      }

      // Ctrl+H — Find & Replace
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        openFindReplace(true);
      }

      // Escape — close modals, teleprompter, and find/replace
      if (e.key === 'Escape') {
        $$('.modal-overlay').forEach((m) => (m.hidden = true));
        closeTeleprompter();
        const frPanel = $('#findReplacePanel');
        if (frPanel) frPanel.hidden = true;
      }

      // Spacebar for teleprompter play/pause
      if (e.code === 'Space') {
        const tpOverlay = $('#teleprompterOverlay');
        if (tpOverlay && !tpOverlay.hidden) {
          e.preventDefault();
          toggleTeleprompterPlay();
        }
      }
    });

    // Save before unload
    window.addEventListener('beforeunload', () => {
      saveCurrentEditorContent();
    });

    // Ctrl + Scroll to zoom (change font size)
    document.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault(); // Prevent default browser zoom
        
        if (state.currentView !== 'editor') return;

        const slider = $('#fontSizeSlider');
        const editor = $('#editor');
        if (!slider || !editor) return;

        let size = parseInt(state.editorFontSize, 10);
        
        if (e.deltaY < 0) {
          // Scroll up -> Increase font size
          size = Math.min(32, size + 1);
        } else if (e.deltaY > 0) {
          // Scroll down -> Decrease font size
          size = Math.max(12, size - 1);
        }

        if (size !== parseInt(state.editorFontSize, 10)) {
          state.editorFontSize = size;
          editor.style.fontSize = `${size}px`;
          slider.value = size;
          save();
        }
      }
    }, { passive: false });

    // Find & Replace UI Events
    $('#closeFindReplaceBtn').addEventListener('click', () => {
      $('#findReplacePanel').hidden = true;
    });

    $('#findInput').addEventListener('input', () => updateFindMatchCount());
    $('#findInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doFind(e.shiftKey);
      }
    });

    $('#findNextBtn').addEventListener('click', () => doFind(false));
    $('#findPrevBtn').addEventListener('click', () => doFind(true));
    
    $('#replaceBtn').addEventListener('click', () => {
      const q = $('#findInput').value;
      const r = $('#replaceInput').value;
      if (!q) return;
      
      // If we have a selection and it matches the query, replace it
      const selection = window.getSelection();
      if (selection && selection.toString().toLowerCase() === q.toLowerCase()) {
        document.execCommand('insertText', false, r);
      }
      doFind(false);
    });

    $('#replaceAllBtn').addEventListener('click', () => {
      const q = $('#findInput').value;
      const r = $('#replaceInput').value;
      if (!q) return;

      $('#editor').focus();
      // Move cursor to start
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents($('#editor'));
      range.collapse(true);
      sel.addRange(range);

      let count = 0;
      let attempts = 0;
      while (attempts < 5000) {
        let found = window.find(q, false, false, false, false, false, false);
        if (!found) break;
        
        // Only replace if the matched text is inside the editor
        if ($('#editor').contains(window.getSelection().anchorNode)) {
          document.execCommand('insertText', false, r);
          count++;
        }
        attempts++;
      }
      
      showToast(`Replaced ${count} occurrences`, 'success');
      updateFindMatchCount();
    });
  }

  // ── Find & Replace Logic ──────────────────────────────────
  function openFindReplace(showReplace) {
    if (state.currentView !== 'editor') return;
    
    const panel = $('#findReplacePanel');
    const replaceGroup = $('#replaceGroup');
    const title = $('#findReplaceTitle');
    
    panel.hidden = false;
    if (showReplace) {
      replaceGroup.style.display = 'flex';
      $('#replaceBtn').style.display = 'block';
      $('#replaceAllBtn').style.display = 'block';
      title.textContent = 'Find & Replace';
    } else {
      replaceGroup.style.display = 'none';
      $('#replaceBtn').style.display = 'none';
      $('#replaceAllBtn').style.display = 'none';
      title.textContent = 'Find';
    }
    
    const findInput = $('#findInput');
    findInput.focus();
    findInput.select();
    updateFindMatchCount();
  }

  function doFind(backwards) {
    const q = $('#findInput').value;
    if (!q) return;
    
    $('#editor').focus();
    
    let found = false;
    let attempts = 0;
    const maxAttempts = 1000;

    while (attempts < maxAttempts) {
      found = window.find(q, false, backwards, true, false, false, false);
      if (!found) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents($('#editor'));
        range.collapse(!backwards);
        sel.addRange(range);
        found = window.find(q, false, backwards, true, false, false, false);
      }
      
      if (!found) break;

      if ($('#editor').contains(window.getSelection().anchorNode)) {
        break; // Match is valid
      }
      attempts++;
    }

    if (attempts >= maxAttempts || !found) {
      window.getSelection().removeAllRanges();
    }
    updateFindMatchCount();
  }

  function updateFindMatchCount() {
    const q = $('#findInput').value;
    const countEl = $('#findMatchCount');
    if (!q) {
      countEl.textContent = '0/0';
      return;
    }
    const text = $('#editor').innerText || '';
    // Escape regex
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text.match(new RegExp(escaped, 'gi'));
    countEl.textContent = matches ? `?/${matches.length}` : '0/0';
  }

  // ── Initialization ─────────────────────────────────────────
  function applyTheme() {
    if (state.theme === 'light') {
      document.body.classList.add('light-mode');
      const icon = $('#themeToggleBtn .rail-icon');
      if (icon) icon.textContent = '🌙';
    } else {
      document.body.classList.remove('light-mode');
      const icon = $('#themeToggleBtn .rail-icon');
      if (icon) icon.textContent = '🌞';
    }
  }

  function init() {
    load();
    render();
    setupEventListeners();
    applyTheme();

    // Ensure teleprompter overlay is hidden on app start
    const tpOverlay = $('#teleprompterOverlay');
    if (tpOverlay) tpOverlay.hidden = true;

    // Listen for remote teleprompter commands from mobile app
    window.addEventListener('teleprompter-remote', (e) => {
      const { action, value } = e.detail;
      console.log('[Remote Control]', action, value);

      switch (action) {
        case 'play':
          if (!state.tpIsPlaying) toggleTeleprompterPlay();
          break;
        case 'pause':
          if (state.tpIsPlaying) toggleTeleprompterPlay();
          break;
        case 'toggle':
          toggleTeleprompterPlay();
          break;
        case 'setSpeed':
          if (value != null) {
            state.tpSpeed = value;
            const slider = $('#tpSpeedSlider');
            if (slider) slider.value = value;
          }
          break;
        case 'open':
          openTeleprompter();
          break;
        case 'close':
          closeTeleprompter();
          break;
      }
    });
  }

  // ── Parts Sidebar Logic ────────────────────────────────────
  const PART_SIDEBAR_COLORS = ['#6e6aff', '#ff9f43', '#2ed573', '#ff6b81', '#1e90ff'];

  function updatePartsSidebar() {
    const partsList = $('#partsList');
    if (!partsList) return;
    partsList.innerHTML = '';
    
    const editorEl = $('#editor');
    if (!editorEl) return;
    
    const script = getActiveScript();
    if (!script) return;

    let domParts = Array.from(editorEl.querySelectorAll('.script-part'));
    if (domParts.length === 0) return;

    // Ensure IDs and default names/colors exist
    if (!script.partsOrder) script.partsOrder = [];
    const domIds = domParts.map((p, index) => {
      if (!p.id) p.id = 'part-' + Math.random().toString(36).substr(2, 9);
      if (!p.dataset.partColor) p.dataset.partColor = String((index % 5) + 1);
      if (!p.dataset.partName) p.dataset.partName = 'Part ' + (index + 1);
      return p.id;
    });

    // Cleanup and add new parts to order
    script.partsOrder = script.partsOrder.filter(id => domIds.includes(id));
    domIds.forEach(id => {
      if (!script.partsOrder.includes(id)) script.partsOrder.push(id);
    });

    // Sort by custom order
    let sortedParts = [...domParts].sort((a, b) => script.partsOrder.indexOf(a.id) - script.partsOrder.indexOf(b.id));

    sortedParts.forEach((part) => {
      const colorIndex = parseInt(part.dataset.partColor) - 1;
      const color = PART_SIDEBAR_COLORS[colorIndex] || PART_SIDEBAR_COLORS[0];
      
      const item = document.createElement('div');
      item.className = 'part-item';
      item.dataset.partId = part.id;
      item.draggable = true;

      item.addEventListener('dragstart', (e) => {
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Need to set data for Firefox
        e.dataTransfer.setData('text/plain', part.id);
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        
        // Ensure new order is saved properly when drag completes
        const script = getActiveScript();
        if (script && partsList) {
          const newOrder = Array.from(partsList.querySelectorAll('.part-item')).map(el => el.dataset.partId);
          script.partsOrder = newOrder;
          save();
          updatePartsSidebar(); // refresh to enforce the correct order array
        }
      });
      
      const leftDiv = document.createElement('div');
      leftDiv.className = 'part-item-left';

      const colorDot = document.createElement('span');
      colorDot.className = 'part-item-color';
      colorDot.style.backgroundColor = color;

      const name = document.createElement('span');
      name.className = 'part-item-name';
      name.textContent = part.dataset.partName;
      
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-part';
      delBtn.innerHTML = '🗑️';
      delBtn.title = 'Remove Part (Keeps Text)';
      
      // Click on part item → scroll to it and highlight it in editor
      item.addEventListener('click', (e) => {
        if (e.target === delBtn || delBtn.contains(e.target)) return;

        // Remove previous active state
        $$('#editor .script-part.part-active').forEach(el => el.classList.remove('part-active'));
        
        part.classList.add('part-active');
        part.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Remove active after 2 seconds
        setTimeout(() => {
          part.classList.remove('part-active');
        }, 2000);
      });
      
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Unwrap the part without deleting text
        const fragment = document.createDocumentFragment();
        while (part.firstChild) {
          fragment.appendChild(part.firstChild);
        }
        part.parentNode.replaceChild(fragment, part);
        updatePartsSidebar();
        saveCurrentEditorContent();
      });
      
      leftDiv.appendChild(colorDot);
      leftDiv.appendChild(name);
      item.appendChild(leftDiv);
      item.appendChild(delBtn);
      partsList.appendChild(item);
    });
  }

  // ── MUI Ripple Effect Logic ──────────────────────────────────
  function createRipple(event) {
    const button = event.currentTarget;
    const circle = document.createElement("span");
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;

    const rect = button.getBoundingClientRect();
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${event.clientX - rect.left - radius}px`;
    circle.style.top = `${event.clientY - rect.top - radius}px`;
    circle.classList.add("mui-ripple");

    const ripple = button.querySelector(".mui-ripple");
    if (ripple) {
      ripple.remove();
    }
    button.appendChild(circle);
  }

  function initRipples() {
    const buttons = document.querySelectorAll('.mui-btn, .toolbar-btn, .btn-primary, .btn-secondary, .ctx-menu-item, .nav-btn, .part-item');
    buttons.forEach(btn => {
      btn.addEventListener('mousedown', createRipple);
      // Ensure positioning works
      if (window.getComputedStyle(btn).position === 'static') {
        btn.style.position = 'relative';
      }
      btn.style.overflow = 'hidden';
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    initRipples();
  });
})();
