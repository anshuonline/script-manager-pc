// ============================================================
// Script Manager — Application Logic
// ============================================================

(function () {
  'use strict';
  
  // Global error logging (console only, no alerts)
  window.addEventListener('error', (e) => {
    console.error('App Error:', e.error ? e.error.stack : e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise Error:', e.reason ? (e.reason.stack || e.reason) : 'Unknown');
  });

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
    characters: [],
    activeScriptId: null,
    currentView: 'editor',
    calendarDate: new Date(),
    searchQuery: '',
    statusFilter: 'all',
    theme: 'dark',
    editorFontSize: 15,
    editorLineHeight: '1.6',
    sidebarWidth: 260,
    autoBackup: {
      enabled: false,
      frequency: 60,
      folderPath: null
    },
    tpSpeed: 0.5,
    tpMargin: 15,
    tpLineHeight: 1.6,
    tpLetterSpacing: 0,
    tpFontSize: 48,
    tpIsPlaying: false,
    tpMirrored: false,
    tpFlipped: false,
    tpBluetoothMode: false,
    tpShortcuts: {
      playPause: 'Space',
      speedUp: 'ArrowUp',
      speedDown: 'ArrowDown',
      scrollUp: 'PageUp',
      scrollDown: 'PageDown',
      exit: 'Escape'
    },
    driveConnectedEmail: null,
    driveLastBackup: null
  };

  let tpAnimationId = null;
  let tpLastTimestamp = null;
  let tpExactScrollTop = 0;
  let savedSelectionRange = null;
  let serverIP = '';
  
  // Context menu state is now managed by context-menu.js

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
  // Expose for external modules
  window.appState = state;
  window.saveState = save;
  window.showToast = showToast;

  function save() {
    try {
      const data = { 
        scripts: state.scripts,
        theme: state.theme,
        editorFontSize: state.editorFontSize,
        editorLineHeight: state.editorLineHeight,
        sidebarWidth: state.sidebarWidth,
        autoBackup: state.autoBackup,
        tpShortcuts: state.tpShortcuts,
        characters: state.characters
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
        state.theme = data.theme || 'dark';
        state.editorFontSize = data.editorFontSize || 15;
        state.editorLineHeight = data.editorLineHeight || '1.6';
        state.sidebarWidth = data.sidebarWidth || 260;
        state = { ...state, ...data };
        window.appState = state; // Update global reference
        // Ensure shortcuts object exists (for backwards compatibility)
        if (!state.tpShortcuts) {
          state.tpShortcuts = {
            playPause: 'Space',
            speedUp: 'ArrowUp',
            speedDown: 'ArrowDown',
            scrollUp: 'PageUp',
            scrollDown: 'PageDown',
            exit: 'Escape'
          };
        }
        if (state.scripts.length > 0 && !state.activeScriptId) {
          state.activeScriptId = state.scripts[0].id;
        }
      }
      
      // Initialize Auto Backup after state is loaded
      initAutoBackup();
      
    } catch (e) {
      console.error('Failed to load data:', e);
      state.scripts = [];
    }
  }

  // ── Auto Backup ───────────────────────────────────────────
  let autoBackupTimer = null;

  function initAutoBackup() {
    if (autoBackupTimer) {
      clearInterval(autoBackupTimer);
      autoBackupTimer = null;
    }

    if (!state.autoBackup || !state.autoBackup.enabled || !state.autoBackup.folderPath) {
      return;
    }

    const freqMs = state.autoBackup.frequency * 60 * 1000;
    console.log(`[Auto Backup] Started. Frequency: ${state.autoBackup.frequency} mins. Folder: ${state.autoBackup.folderPath}`);
    
    autoBackupTimer = setInterval(async () => {
      console.log('[Auto Backup] Triggering auto backup...');
      try {
        const result = await ipcRenderer.invoke('create-auto-backup', {
          stateData: { 
            scripts: state.scripts,
            theme: state.theme,
            editorFontSize: state.editorFontSize,
            editorLineHeight: state.editorLineHeight,
            sidebarWidth: state.sidebarWidth,
            autoBackup: state.autoBackup,
            tpShortcuts: state.tpShortcuts,
            characters: state.characters
          },
          folderPath: state.autoBackup.folderPath
        });
        if (result && result.success) {
          console.log('[Auto Backup] Successfully backed up to:', result.filePath);
        } else {
          console.error('[Auto Backup] Failed:', result.error);
        }
      } catch (err) {
        console.error('[Auto Backup] IPC error:', err);
      }
    }, freqMs);
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
    
    const script = state.scripts[idx];
    const title = script.title || 'Untitled Script';
    
    if (script.status === 'deleted') {
       // Permanent delete
       state.scripts.splice(idx, 1);
       if (state.activeScriptId === id) {
         const nextScript = state.scripts.find(s => s.status === 'deleted');
         state.activeScriptId = nextScript ? nextScript.id : null;
       }
       showToast(`"${title}" permanently deleted`, 'info');
    } else {
       // Move to trash
       script.status = 'deleted';
       if (state.activeScriptId === id) {
         const nextScript = state.scripts.find(s => s.status !== 'deleted');
         state.activeScriptId = nextScript ? nextScript.id : null;
       }
       showToast(`"${title}" moved to Trash`, 'info');
    }
    
    save();
    render();
  }

  function getScript(id) {
    return state.scripts.find((s) => s.id === id);
  }

  function getActiveScript() {
    return getScript(state.activeScriptId);
  }

  function selectScript(id) {
    if (state.activeScriptId === id && !state.activeSectionId) return;
    saveCurrentEditorContent();
    state.activeScriptId = id;
    state.activeSectionId = null; // Reset section when selecting main script
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

  function showCustomPrompt(title, defaultValue = '') {
    return new Promise((resolve) => {
      try {
        const overlay = $('#customPromptOverlay');
        const titleEl = $('#customPromptTitle');
        const inputEl = $('#customPromptInput');
        const okBtn = $('#customPromptOk');
        const cancelBtn = $('#customPromptCancel');

        if (!overlay || !inputEl || !titleEl || !okBtn || !cancelBtn) {
          resolve(prompt(title, defaultValue)); // fallback
          return;
        }

        titleEl.textContent = title;
        inputEl.value = defaultValue;
        overlay.hidden = false;
        inputEl.focus();
        inputEl.select();

        const cleanup = () => {
          overlay.hidden = true;
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          inputEl.removeEventListener('keydown', onKey);
        };

        const onOk = () => { cleanup(); resolve(inputEl.value); };
        const onCancel = () => { cleanup(); resolve(null); };
        const onKey = (e) => {
          if (e.key === 'Enter') { e.preventDefault(); onOk(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        inputEl.addEventListener('keydown', onKey);
      } catch (err) {
        if (typeof showToast === 'function') showToast('Prompt error: ' + err.message, 'error');
        resolve(null);
      }
    });
  }

  function showCustomConfirm(title) {
    return new Promise((resolve) => {
      try {
        const overlay = $('#customPromptOverlay');
        const titleEl = $('#customPromptTitle');
        const inputEl = $('#customPromptInput');
        const okBtn = $('#customPromptOk');
        const cancelBtn = $('#customPromptCancel');

        if (!overlay || !inputEl || !titleEl || !okBtn || !cancelBtn) {
          resolve(confirm(title)); // fallback
          return;
        }

        titleEl.textContent = title;
        inputEl.parentElement.style.display = 'none'; // hide the input
        overlay.hidden = false;

        const cleanup = () => {
          overlay.hidden = true;
          inputEl.parentElement.style.display = ''; // restore input display
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
        };

        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
      } catch (err) {
        if (typeof showToast === 'function') showToast('Confirm error: ' + err.message, 'error');
        resolve(false);
      }
    });
  }

  async function addSection(scriptId) {
    try {
      const script = getScript(scriptId);
      if (!script) {
        showToast('Script not found', 'error');
        return;
      }
      
      if (!script.sections) script.sections = [];
      
      // Auto-generate name — no modal needed
      const sectionNumber = script.sections.length + 1;
      const sectionName = 'Section ' + sectionNumber;

      const newSection = {
        id: generateId(),
        name: sectionName,
        content: ''
      };
      
      script.sections.push(newSection);
      
      // Auto select the new section
      saveCurrentEditorContent();
      state.activeScriptId = scriptId;
      state.activeSectionId = newSection.id;
      state.currentView = 'editor';
      
      save();
      render();
      showToast('Section "' + sectionName + '" created', 'success');
    } catch (err) {
      showToast('Add Section Error: ' + err.message, 'error');
    }
  }

  // Expose for inline onclick handlers
  window._addSection = addSection;

  function selectSection(scriptId, sectionId) {
    if (state.activeScriptId === scriptId && state.activeSectionId === sectionId) return;
    
    saveCurrentEditorContent();
    state.activeScriptId = scriptId;
    state.activeSectionId = sectionId;
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

  function showSectionContextMenu(x, y, scriptId, sectionId) {
    const script = getScript(scriptId);
    if (!script) return;
    const section = script.sections?.find(s => s.id === sectionId);
    if (!section) return;

    // Create a temporary context menu element
    let menu = document.getElementById('sectionContextMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'sectionContextMenu';
      menu.className = 'editor-context-menu';
      document.body.appendChild(menu);
      
      // Close on click outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#sectionContextMenu')) {
          menu.hidden = true;
        }
      });
    }

    menu.innerHTML = `
      <button class="ctx-menu-item" data-action="rename">✏️&nbsp;&nbsp;Rename Section</button>
      <div class="ctx-menu-divider"></div>
      <button class="ctx-menu-item ctx-danger" data-action="delete" style="color: #ff6b81;">🗑️&nbsp;&nbsp;Delete Section</button>
    `;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.hidden = false;

    // Handle clicks
    menu.onclick = async (e) => {
      const action = e.target.closest('.ctx-menu-item')?.dataset.action;
      if (!action) return;

      if (action === 'rename') {
        menu.hidden = true; // hide menu before showing prompt
        const newName = await showCustomPrompt('Enter new section name:', section.name);
        if (newName && newName.trim()) {
          section.name = newName.trim();
          save();
          renderSidebar();
        }
      } else if (action === 'delete') {
        menu.hidden = true;
        const confirmed = await showCustomConfirm(`Are you sure you want to delete section "${section.name}"?`);
        if (confirmed) {
          script.sections = script.sections.filter(s => s.id !== sectionId);
          if (state.activeSectionId === sectionId) {
            state.activeSectionId = null; // revert to main script
            render();
          }
          save();
          renderSidebar();
        }
      }
      if (!menu.hidden) menu.hidden = true;
    };
  }

  async function translateToEnglish(text) {
    if (!text || text.trim() === '') return '';
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data[0] && data[0][0]) {
        return data[0][0][0] || '';
      }
    } catch (e) {
      console.error('Translation failed:', e);
    }
    return '';
  }

  function saveCurrentEditorContent() {
    const script = getActiveScript();
    if (!script) return;
    const editor = $('#editor');
    const titleInput = $('#scriptTitle');
    let titleChanged = false;

    if (editor) {
      if (state.activeSectionId) {
        if (!script.sections) script.sections = [];
        const section = script.sections.find(s => s.id === state.activeSectionId);
        if (section) {
          section.content = editor.innerHTML;
        }
      } else {
        script.content = editor.innerHTML;
      }
    }
    
    if (titleInput) {
      if (script.title !== titleInput.value) {
        titleChanged = true;
      }
      script.title = titleInput.value;
    }
    script.updatedAt = new Date().toISOString();
    save();

    if (titleChanged) {
      // Background translation for smart search
      translateToEnglish(script.title).then(enText => {
        if (enText && enText.toLowerCase() !== script.title.toLowerCase()) {
          script.titleEn = enText;
          save();
        }
      });
    }
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
          (s.titleEn || '').toLowerCase().includes(query) ||
          (s.content || '').toLowerCase().includes(query)
      );
    }
    
    if (state.statusFilter !== 'all') {
      filtered = filtered.filter((s) => (s.status || 'pending') === state.statusFilter);
    } else {
      // If 'all', do not show deleted scripts
      filtered = filtered.filter((s) => s.status !== 'deleted');
    }
    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No scripts found
        </div>`;
    } else {
      const limit = state.visibleScriptsCount || 20;
      const visible = filtered.slice(0, limit);
      
      let html = visible
        .map(
          (s, i) => {
            const isScriptActive = s.id === state.activeScriptId;
            const sections = s.sections || [];
            
            let sectionsHtml = '';
            if (isScriptActive) {
              // Show sections list + add button for the active script
              if (sections.length > 0) {
                sectionsHtml = `<div class="script-sections-list">` +
                  sections.map(sec => `
                    <div class="script-section-item ${sec.id === state.activeSectionId ? 'active' : ''}" data-script-id="${s.id}" data-section-id="${sec.id}">
                      <span class="section-tree-line"></span>
                      <span class="section-icon">#</span>
                      <span class="section-name">${sec.name || 'Untitled'}</span>
                    </div>
                  `).join('') +
                `</div>`;
              }
              // Always show the Add Section button for active script
              sectionsHtml += `<button class="add-section-btn" data-script-id="${s.id}" onclick="window._addSection('${s.id}')" style="
                display: flex; align-items: center; gap: 6px;
                width: 100%; padding: 6px 12px 6px 32px;
                margin-top: 2px;
                background: transparent; border: 1px dashed var(--glass-border);
                border-radius: var(--radius-sm);
                color: var(--text-muted); font-size: 12px;
                cursor: pointer; transition: all 0.2s ease;
              " onmouseover="this.style.background='var(--glass-2)';this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.background='transparent';this.style.borderColor='var(--glass-border)';this.style.color='var(--text-muted)'"
              >+ Add Section</button>`;
            }

            return `
        <div class="script-item-wrapper" style="animation-delay: ${i * 40}ms">
          <div class="script-item ${isScriptActive && !state.activeSectionId ? 'active' : ''}" data-id="${s.id}">
            <div class="script-item-thumb">
              ${
                s.coverImage
                  ? `<img src="${s.coverImage}" alt="">`
                  : '<span>📄</span>'
              }
            </div>
            <div class="script-item-info">
              <div class="script-item-title">${s.title || 'Untitled Script'}</div>
              <div class="script-item-excerpt" style="font-size: 11px; color: var(--text-muted); margin: 2px 0 6px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${(() => {
                  const text = (s.content || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
                  return text ? text : 'No content...';
                })()}
              </div>
              <div class="script-item-meta">
                <span class="script-item-status status-${s.status || 'pending'}">${(s.status || 'pending').toUpperCase()}</span>
                <span class="script-item-date ${s.publishDate ? 'has-date' : ''}">
                  ${s.publishDate ? '📅 ' + formatShortDate(s.publishDate) : 'No date'}
                </span>
              </div>
            </div>
          </div>
          ${sectionsHtml}
        </div>`;
          }
        )
        .join('');
        
      if (filtered.length > limit) {
        html += `<button class="btn-secondary load-more-btn" style="width: 100%; margin-top: 12px; font-size: 12px; padding: 8px; justify-content: center;">Load More (${filtered.length - limit} left)</button>`;
      }
      
      listEl.innerHTML = html;
    }

    if (countEl) {
      countEl.textContent = `${state.scripts.length} script${state.scripts.length !== 1 ? 's' : ''}`;
    }
  }

  function renderMainContent() {
    const editorView = $('#editorView');
    const calendarView = $('#calendarView');
    const statsView = $('#statsView');
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
    if (statsView) statsView.classList.remove('active');
    const driveView = $('#driveView');
    if (driveView) driveView.classList.remove('active');
    emptyState.classList.remove('active');

    if (state.currentView === 'calendar') {
      calendarView.classList.add('active');
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (printBtn) printBtn.style.display = 'none';
      if (tpBtn) tpBtn.style.display = 'none';
      renderCalendar();
      return;
    }

    if (state.currentView === 'stats') {
      if (statsView) statsView.classList.add('active');
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (printBtn) printBtn.style.display = 'none';
      if (tpBtn) tpBtn.style.display = 'none';
      renderStatsDashboard();
      return;
    }

    if (state.currentView === 'drive') {
      const driveView = $('#driveView');
      if (driveView) driveView.classList.add('active');
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (printBtn) printBtn.style.display = 'none';
      if (tpBtn) tpBtn.style.display = 'none';
      renderDriveDashboard();
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

  function updateEditorStats() {
    const editor = $('#editor');
    const wordCountEl = $('#wordCount');
    const readingTimeEl = $('#readingTime');
    if (!editor || !wordCountEl || !readingTimeEl) return;

    const text = editor.innerText || editor.textContent || '';
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    const count = words.length;
    wordCountEl.textContent = `${count} word${count !== 1 ? 's' : ''}`;

    // Average reading speed is ~150 words per minute for teleprompter/video scripts
    const minutes = count / 150;
    const readingTime = Math.ceil(minutes);
    readingTimeEl.textContent = `~${readingTime} min read`;
  }

  function renderEditor(script) {
    const titleInput = $('#scriptTitle');
    const editor = $('#editor');
    const coverPreview = $('#coverImagePreview');
    const removeCoverBtn = $('#removeCoverBtn');
    const publishDateText = $('#publishDateText');
    const publishDateBtn = $('#publishDateBtn');
    const statusSelect = $('#scriptStatus');

    const isSection = !!state.activeSectionId;
    let section = null;
    if (isSection) {
      section = script.sections?.find(s => s.id === state.activeSectionId);
    }

    if (titleInput) {
      if (isSection && section) {
        titleInput.value = section.name || '';
        titleInput.readOnly = true; // disable renaming from here, use ctx menu
      } else {
        titleInput.value = script.title || '';
        titleInput.readOnly = false;
      }
    }
    
    if (statusSelect) statusSelect.value = script.status || 'pending';

    // Toolbar visibility
    const editorToolbar = $('.editor-toolbar');
    const toolsSidebar = $('#toolsSidebar');
    if (editorToolbar) editorToolbar.style.display = isSection ? 'none' : 'flex';
    if (toolsSidebar) toolsSidebar.style.display = isSection ? 'none' : 'block';

    if (editor) {
      if (isSection && section) {
        editor.innerHTML = section.content || '';
      } else {
        editor.innerHTML = script.content || '';
      }
      
      editor.style.fontSize = `${state.editorFontSize}px`;
      editor.style.lineHeight = state.editorLineHeight || '1.6';
      if (state.editorLineHeight === '2.5') {
        $('#lineSpacingBtn')?.classList.add('active');
      }

      // Legacy part migration: unwrap any old .script-part elements
      const legacyParts = editor.querySelectorAll('.script-part');
      if (legacyParts.length > 0) {
        legacyParts.forEach(part => {
          const fragment = document.createDocumentFragment();
          while (part.firstChild) {
            fragment.appendChild(part.firstChild);
          }
          part.parentNode.replaceChild(fragment, part);
        });
        editor.normalize();
        // Fire save later to persist migration
        setTimeout(() => { if (typeof saveCurrentEditorContent === 'function') saveCurrentEditorContent(); }, 500);
      }

      updateCommentsSidebar();
      if (typeof updateEditorStats === 'function') {
        updateEditorStats();
      }
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
    const localTodayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);

    const upcoming = state.scripts
      .filter((s) => s.publishDate && s.publishDate >= localTodayStr && s.status !== 'finished' && s.status !== 'published')
      .sort((a, b) => a.publishDate.localeCompare(b.publishDate));

    if (upcoming.length === 0) {
      container.innerHTML = `<div class="upcoming-empty">
        <span class="empty-emoji">🌴</span>
        <p>No upcoming scripts scheduled</p>
      </div>`;
      return;
    }

    container.innerHTML = upcoming
      .map(
        (s) => `
      <div class="upcoming-item-premium" data-script-id="${s.id}">
        <div class="upcoming-item-left">
          <div class="upcoming-item-thumb">
            ${s.coverImage ? `<img src="${s.coverImage}" alt="">` : '📄'}
          </div>
          <div class="upcoming-item-info">
            <div class="upcoming-item-title">${s.title || 'Untitled Script'}</div>
            <div class="upcoming-item-meta">
              <span class="status-dot ${s.status || 'pending'}"></span>
              <span class="upcoming-item-date">${formatShortDate(s.publishDate)}</span>
            </div>
          </div>
        </div>
        <button class="btn-mark-done" title="Mark as Finished">✓</button>
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
    const editor = $('#editor');
    
    // Special handling for formatBlock — use manual DOM replacement
    // Chrome's execCommand('formatBlock') is unreliable inside nested divs (.script-part)
    // and often injects unwanted inline styles. We handle it manually everywhere.
    if (command === 'formatBlock' && value) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node = sel.anchorNode;
        if (node && node.nodeType === 3) node = node.parentElement;
        if (!node) { editor.focus(); return; }
        
        // Find the closest block element containing the cursor
        let block = node;
        const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'BLOCKQUOTE'];
        
        // Walk up to find a block-level element, but stop at editor or .script-part boundary
        while (block && block !== editor) {
          if (block.classList && block.classList.contains('script-part')) {
            // Don't convert the .script-part div itself
            block = null;
            break;
          }
          if (blockTags.includes(block.tagName)) break;
          block = block.parentElement;
        }
        
        if (block && block !== editor && blockTags.includes(block.tagName)) {
          const newTag = value.replace(/[<>]/g, '').toLowerCase();
          
          // Don't replace if already the same tag
          if (block.tagName.toLowerCase() === newTag) {
            editor.focus();
            return;
          }
          
          const newEl = document.createElement(newTag);
          newEl.innerHTML = block.innerHTML;
          
          // Strip ALL inline font-size/font-family/line-height styles
          // These are leftovers from heading formatting
          newEl.style.fontSize = '';
          newEl.style.fontFamily = '';
          newEl.style.lineHeight = '';
          newEl.style.fontWeight = '';
          // Clean empty style attribute
          if (!newEl.getAttribute('style')?.trim()) {
            newEl.removeAttribute('style');
          }
          
          // Also clean children that might have inline heading styles
          newEl.querySelectorAll('[style]').forEach(child => {
            child.style.fontSize = '';
            child.style.fontFamily = '';
            child.style.lineHeight = '';
            if (!child.getAttribute('style')?.trim()) {
              child.removeAttribute('style');
            }
          });
          
          block.parentNode.replaceChild(newEl, block);
          
          // Place cursor inside new element
          const range = document.createRange();
          range.selectNodeContents(newEl);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          
          // Save after format change
          if (window._smBridge && typeof window._smBridge.saveEditor === 'function') {
            window._smBridge.saveEditor();
          }
          
          editor.focus();
          return;
        }
      }
      
      // Fallback to execCommand for edge cases
      document.execCommand(command, false, value);
      editor.focus();
      return;
    }
    
    document.execCommand(command, false, value);
    editor.focus();
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
  let tpScriptSections = [];

  function openTeleprompter() {
    saveCurrentEditorContent();
    const script = getActiveScript();
    if (!script) return;

    const tpOverlay = $('#teleprompterOverlay');
    const tpContent = $('#tpContent');
    const tpScrollArea = $('#tpScrollArea');
    const tpSectionGroup = $('#tpSectionGroup');
    const tpSectionSelect = $('#tpSectionSelect');

    // Stop any existing animation
    state.tpIsPlaying = false;
    if (tpAnimationId) cancelAnimationFrame(tpAnimationId);
    tpAnimationId = null;
    tpLastTimestamp = null;

    tpScriptSections = [];
    let tpSectionNames = [];
    
    if (script.sections && script.sections.length > 0) {
      tpScriptSections.push(script.content || '<h2 style="text-align:center; color:#666;">Empty Script</h2>');
      tpSectionNames.push('Main Script');
      
      script.sections.forEach(sec => {
        tpScriptSections.push(sec.content || '<h2 style="text-align:center; color:#666;">Empty Section</h2>');
        tpSectionNames.push(sec.name || 'Section');
      });
    } else {
      tpScriptSections = [script.content || '<h2 style="text-align:center; color:#666;">Empty Script</h2>'];
      tpSectionNames = ['Script'];
    }

    function sanitizeTpHtml(html) {
      if (!html) return html;
      // Create a temporary element to parse and clean HTML
      const temp = document.createElement('div');
      temp.innerHTML = html;
      // Remove all style and class attributes, keep structure
      temp.querySelectorAll('*').forEach(el => {
        el.removeAttribute('style');
        el.removeAttribute('class');
        // Remove data attributes except those we might want to keep
        Array.from(el.attributes).forEach(attr => {
          if (attr.name.startsWith('data-')) {
            el.removeAttribute(attr.name);
          }
        });
      });
      return temp.innerHTML;
    }

    function highlightMarkers(html) {
      if (!html) return html;
      // Only match markers like [HOOK], [CTA], [B-ROLL] etc — not CSS selectors like [&_b]
      return html.replace(/\[([A-Z][A-Z0-9 _\-]*)\]/g, '<span class="tp-marker">[$1]</span>');
    }

    if (tpScriptSections.length > 1) {
      if (tpSectionGroup) tpSectionGroup.style.display = 'block';
      if (tpSectionSelect) {
        tpSectionSelect.innerHTML = tpSectionNames.map((name, i) => `<option value="${i}">${name}</option>`).join('');
        
        // Match active section
        let activeIdx = 0;
        if (state.activeSectionId) {
          const sIdx = script.sections.findIndex(s => s.id === state.activeSectionId);
          if (sIdx !== -1) activeIdx = sIdx + 1;
        }
        tpSectionSelect.value = activeIdx.toString();
        tpContent.innerHTML = highlightMarkers(sanitizeTpHtml(tpScriptSections[activeIdx]));
      }
    } else {
      if (tpSectionGroup) tpSectionGroup.style.display = 'none';
      tpContent.innerHTML = highlightMarkers(sanitizeTpHtml(tpScriptSections[0]));
    }
    
    // Initialize Toggle State
    const tpBluetoothToggle = $('#tpBluetoothToggle');
    if (tpBluetoothToggle) {
      tpBluetoothToggle.checked = !!state.tpBluetoothMode;
    }

    // Build Chapters Sidebar
    const sidebar = $('#tpChaptersSidebar');
    if (sidebar && tpContent) {
      const markers = tpContent.querySelectorAll('.tp-marker');
      if (markers.length > 0) {
        sidebar.hidden = false;
        sidebar.innerHTML = '';
        markers.forEach((marker, i) => {
          if (!marker.id) marker.id = `tp-marker-${i}`;
          const btn = document.createElement('button');
          btn.className = 'tp-chapter-btn';
          btn.textContent = marker.textContent.replace(/[\[\]]/g, '');
          btn.onclick = () => {
            const scrollArea = $('#tpScrollArea');
            const offset = Math.max(0, marker.offsetTop - (scrollArea.clientHeight / 3));
            if (state.tpIsPlaying) toggleTeleprompterPlay();
            scrollArea.scrollTop = offset;
            tpExactScrollTop = offset;
            tpLastIntScroll = offset;
          };
          sidebar.appendChild(btn);
        });
      } else {
        sidebar.hidden = true;
      }
    }

    // Reset Timer
    tpElapsedTimeMs = 0;
    const elTimeEl = $('#tpElapsedTime');
    if (elTimeEl) elTimeEl.textContent = '00:00';

    // Sync HUD state
    const eyelineToggle = $('#tpEyelineToggle');
    if (eyelineToggle) eyelineToggle.checked = !!state.tpEyeline;
    const eyelineOverlay = $('#tpEyelineOverlay');
    if (eyelineOverlay) eyelineOverlay.hidden = !state.tpEyeline;
    
    const fwSelect = $('#tpFontWeightSelect');
    if (fwSelect && state.tpFontWeight) fwSelect.value = state.tpFontWeight;

    const themeBtns = document.querySelectorAll('.theme-btn');
    themeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === (state.tpTheme || 'default'));
    });

    // Migrate old fractional speed to new slider range (10-250)
    if (state.tpSpeed < 10) {
      state.tpSpeed = Math.round((parseFloat(state.tpSpeed) || 0.5) * 140);
      save();
    }
    
    const speedSlider = $('#tpSpeedSlider');
    if (speedSlider) speedSlider.value = state.tpSpeed;
    
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
    const playIcon = document.querySelector('#tpPlayPauseBtn .play-icon');
    const pauseIcon = document.querySelector('#tpPlayPauseBtn .pause-icon');
    if (playIcon && pauseIcon) {
      playIcon.style.display = state.tpIsPlaying ? 'none' : 'block';
      pauseIcon.style.display = state.tpIsPlaying ? 'block' : 'none';
    }
  }

  let tpLastIntScroll = -1;
  let tpElapsedTimeMs = 0;

  function formatTpTime(totalSeconds) {
    if (!isFinite(totalSeconds) || totalSeconds < 0) return "--:--";
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function tpAnimationLoop(timestamp) {
    if (!state.tpIsPlaying) return;
    
    if (tpLastTimestamp === null) {
      tpLastTimestamp = timestamp;
      tpAnimationId = requestAnimationFrame(tpAnimationLoop);
      return;
    }
    
    const scrollArea = $('#tpScrollArea');

    // Sync manual scroll: if the user scrolled manually, update our exact tracker
    if (tpLastIntScroll !== -1 && Math.abs(scrollArea.scrollTop - tpLastIntScroll) > 2) {
      tpExactScrollTop = scrollArea.scrollTop;
    }

    const deltaMs = timestamp - tpLastTimestamp;
    tpLastTimestamp = timestamp;
    const deltaTime = Math.min(deltaMs / 1000, 0.1);
    
    tpElapsedTimeMs += deltaMs;
    const elTimeEl = $('#tpElapsedTime');
    if (elTimeEl) elTimeEl.textContent = formatTpTime(tpElapsedTimeMs / 1000);

    // Speed directly from slider (10-250 pixels per second)
    const pixelsPerSecond = parseFloat(state.tpSpeed) || 70;
    const scrollDelta = pixelsPerSecond * deltaTime;
    const content = $('#tpContent');

    // Update ETA
    const maxScrollForEta = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight);
    const remainingPixels = state.tpFlipped ? tpExactScrollTop : Math.max(0, maxScrollForEta - tpExactScrollTop);
    const etaSeconds = pixelsPerSecond > 0 ? remainingPixels / pixelsPerSecond : 0;
    const etaTimeEl = $('#tpEtaTime');
    if (etaTimeEl) etaTimeEl.textContent = formatTpTime(etaSeconds);

    if (state.tpFlipped) {
      // Flipped: text beginning is at bottom, scroll upward
      tpExactScrollTop -= scrollDelta;
      if (tpExactScrollTop < 0) tpExactScrollTop = 0;
      
      const intScroll = Math.ceil(tpExactScrollTop);
      const fracScroll = intScroll - tpExactScrollTop;
      scrollArea.scrollTop = intScroll;
      tpLastIntScroll = scrollArea.scrollTop;

      if (content) content.style.transform = (state.tpBaseTransform ? state.tpBaseTransform + ' ' : '') + `translateY(${fracScroll}px)`;

      if (scrollArea.scrollTop <= 0) {
        state.tpIsPlaying = false;
        if (content) content.style.transform = state.tpBaseTransform || 'none';
        updateTpPlayButton();
        return;
      }
    } else {
      // Normal: scroll downward
      tpExactScrollTop += scrollDelta;
      const maxScroll = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight);
      
      if (tpExactScrollTop > maxScroll) {
        tpExactScrollTop = maxScroll;
      }

      const intScroll = Math.floor(tpExactScrollTop);
      const fracScroll = tpExactScrollTop - intScroll;
      scrollArea.scrollTop = intScroll;
      tpLastIntScroll = scrollArea.scrollTop;

      if (content) content.style.transform = (state.tpBaseTransform ? state.tpBaseTransform + ' ' : '') + `translateY(-${fracScroll}px)`;

      if (scrollArea.scrollTop >= maxScroll - 1) {
        state.tpIsPlaying = false;
        if (content) content.style.transform = state.tpBaseTransform || 'none';
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
    state.tpBaseTransform = transforms.length ? transforms.join(' ') : '';
    content.style.transform = state.tpBaseTransform ? state.tpBaseTransform : 'none';
    
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
    tpContent.style.paddingTop = '50vh';
    tpContent.style.paddingBottom = '50vh';
    tpContent.style.fontWeight = state.tpFontWeight || 'bold';

    const overlay = $('#teleprompterOverlay');
    if (overlay) {
      overlay.classList.remove('theme-high-contrast', 'theme-light');
      if (state.tpTheme === 'high-contrast') overlay.classList.add('theme-high-contrast');
      else if (state.tpTheme === 'light') overlay.classList.add('theme-light');
    }
    
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

  // ── Find & Replace Logic ──────────────────────────────────
  function setupFindReplaceListeners() {
    console.log('[F&R] Setting up Find & Replace listeners...');
    
    const panel = document.getElementById('findReplacePanel');
    const openBtn = document.getElementById('openFindBtn');
    const closeBtn = document.getElementById('closeFindReplaceBtn');
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    const findNextBtn = document.getElementById('findNextBtn');
    const findPrevBtn = document.getElementById('findPrevBtn');
    const replaceBtn = document.getElementById('replaceBtn');
    const replaceAllBtn = document.getElementById('replaceAllBtn');
    const matchCountEl = document.getElementById('findMatchCount');
    const replaceGroup = document.getElementById('replaceGroup');
    const titleEl = document.getElementById('findReplaceTitle');

    console.log('[F&R] Elements found:', {
      panel: !!panel, openBtn: !!openBtn, closeBtn: !!closeBtn,
      findInput: !!findInput, replaceInput: !!replaceInput
    });

    if (!panel || !openBtn || !findInput) {
      console.error('[F&R] Critical elements missing! Aborting setup.');
      return;
    }

    // Open panel on button click
    openBtn.addEventListener('click', () => {
      console.log('[F&R] Open button clicked');
      showFindPanel(true);
    });

    // Close panel
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        console.log('[F&R] Close button clicked');
        hideFindPanel();
      });
    }

    // Find input events
    findInput.addEventListener('input', () => refreshMatchCount());
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doFind(e.shiftKey);
      }
      if (e.key === 'Escape') {
        hideFindPanel();
      }
    });

    // Prevent buttons from stealing focus from editor, AND trigger action instantly
    if (findNextBtn) findNextBtn.addEventListener('mousedown', (e) => { e.preventDefault(); doFind(false); });
    if (findPrevBtn) findPrevBtn.addEventListener('mousedown', (e) => { e.preventDefault(); doFind(true); });

    // Replace single
    if (replaceBtn) {
      replaceBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const q = findInput.value;
        const r = replaceInput ? replaceInput.value : '';
        if (!q) return;
        const sel = window.getSelection();
        if (sel && sel.toString().toLowerCase() === q.toLowerCase()) {
          document.execCommand('insertText', false, r);
        }
        doFind(false);
      });
    }

    // Replace all
    if (replaceAllBtn) {
      replaceAllBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const q = findInput.value;
        const r = replaceInput ? replaceInput.value : '';
        if (!q) return;

        const editorEl = document.getElementById('editor');
        if (!editorEl) return;
        editorEl.focus();

        let count = 0;
        function walkAndReplace(node) {
          if (node.nodeType === 3) {
            const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'gi');
            if (regex.test(node.nodeValue)) {
              const m = node.nodeValue.match(new RegExp(escaped, 'gi'));
              if (m) count += m.length;
              node.nodeValue = node.nodeValue.replace(new RegExp(escaped, 'gi'), r);
            }
          } else if (node.nodeType === 1 && node.nodeName !== 'SCRIPT' && node.nodeName !== 'STYLE') {
            Array.from(node.childNodes).forEach(walkAndReplace);
          }
        }
        walkAndReplace(editorEl);
        showToast(`Replaced ${count} occurrences`, 'success');
        refreshMatchCount();
      });
    }

    // Keyboard shortcuts: Ctrl+F and Ctrl+H
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        console.log('[F&R] Ctrl+F pressed');
        showFindPanel(false);
      }
      if (e.ctrlKey && e.key && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        e.stopPropagation();
        console.log('[F&R] Ctrl+H pressed');
        showFindPanel(true);
      }
    }, true); // Use capture phase to beat other handlers

    // ─── Helper Functions ───
    function showFindPanel(withReplace) {
      console.log('[F&R] showFindPanel called, withReplace:', withReplace);
      
      if (state.currentView !== 'editor') {
        showToast('Can only search in editor view', 'error');
        return;
      }

      // Force show the panel
      panel.style.cssText = 'display: flex !important; position: fixed !important; top: 16px !important; right: 24px !important; z-index: 999999 !important; opacity: 1 !important; width: 320px !important; pointer-events: auto !important;';
      
      if (withReplace) {
        if (replaceGroup) replaceGroup.style.display = 'flex';
        if (replaceBtn) replaceBtn.style.display = 'block';
        if (replaceAllBtn) replaceAllBtn.style.display = 'block';
        if (titleEl) titleEl.textContent = 'Find & Replace';
      } else {
        if (replaceGroup) replaceGroup.style.display = 'none';
        if (replaceBtn) replaceBtn.style.display = 'none';
        if (replaceAllBtn) replaceAllBtn.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Find';
      }

      findInput.focus();
      findInput.select();
      refreshMatchCount();
      console.log('[F&R] Panel should now be visible. Computed display:', window.getComputedStyle(panel).display);
    }

    function hideFindPanel() {
      panel.style.cssText = 'display: none !important;';
    }

    function doFind(backwards) {
      const q = findInput.value;
      if (!q) return;

      const editorEl = document.getElementById('editor');
      if (!editorEl) return;
      editorEl.focus();

      let found = false;
      let attempts = 0;
      let lastAnchorNode = null;
      let lastAnchorOffset = null;

      while (attempts < 100) {
        found = window.find(q, false, backwards, true, false, false, false);
        if (!found) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(editorEl);
          range.collapse(!backwards);
          sel.addRange(range);
          found = window.find(q, false, backwards, true, false, false, false);
        }

        if (!found) break;

        const sel = window.getSelection();
        if (sel.anchorNode === lastAnchorNode && sel.anchorOffset === lastAnchorOffset) break;
        lastAnchorNode = sel.anchorNode;
        lastAnchorOffset = sel.anchorOffset;

        if (editorEl.contains(sel.anchorNode)) {
          // Auto-scroll to matched text
          if (sel.rangeCount > 0) {
            let node = sel.anchorNode;
            if (node.nodeType === 3) node = node.parentNode;
            if (node && node.scrollIntoView) {
              node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
          break;
        }
        attempts++;
      }

      if (attempts >= 100 || !found) {
        window.getSelection().removeAllRanges();
      }
      refreshMatchCount();
    }

    function refreshMatchCount() {
      const q = findInput.value;
      if (!matchCountEl) return;
      if (!q) {
        matchCountEl.textContent = '0/0';
        return;
      }
      const editorEl = document.getElementById('editor');
      if (!editorEl) return;
      
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      
      let totalMatches = 0;
      function countMatchesInNode(node) {
        if (node.nodeType === 3) {
          const m = node.nodeValue.match(regex);
          if (m) totalMatches += m.length;
        } else if (node.nodeType === 1 && node.nodeName !== 'SCRIPT' && node.nodeName !== 'STYLE') {
          Array.from(node.childNodes).forEach(countMatchesInNode);
        }
      }
      countMatchesInNode(editorEl);

      if (totalMatches === 0) {
        matchCountEl.textContent = '0/0';
        return;
      }

      let currentIndex = '?';
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && editorEl.contains(sel.anchorNode)) {
        try {
          const range = sel.getRangeAt(0);
          const preRange = document.createRange();
          preRange.selectNodeContents(editorEl);
          preRange.setEnd(range.startContainer, range.startOffset);
          
          let preMatchesCount = 0;
          function countPreMatches(node) {
            if (node.nodeType === 3) {
              const m = node.nodeValue.match(regex);
              if (m) preMatchesCount += m.length;
            } else if (node.nodeType === 1 && node.nodeName !== 'SCRIPT' && node.nodeName !== 'STYLE') {
              Array.from(node.childNodes).forEach(countPreMatches);
            }
          }
          
          // To safely count pre-matches without heavy cloning, 
          // fallback to textContent for the range before cursor.
          const preText = preRange.cloneContents().textContent || '';
          const preMatches = preText.match(regex);
          currentIndex = (preMatches ? preMatches.length : 0) + 1;
          if (currentIndex > totalMatches) currentIndex = totalMatches;
        } catch (e) {}
      }

      matchCountEl.textContent = `${currentIndex}/${totalMatches}`;
    }

    console.log('[F&R] Setup complete!');
  }

  // ── Custom Date Picker Modal ────────────────────────────────────────
  let cdpCurrentDate = new Date();
  let cdpSelectedDateStr = null;
  let cdpTooltipTimeout = null;

  function renderCustomDatePicker() {
    const year = cdpCurrentDate.getFullYear();
    const month = cdpCurrentDate.getMonth();
    
    const titleEl = $('#cdpMonthYear');
    if (titleEl) {
      titleEl.textContent = cdpCurrentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }

    const gridEl = $('#cdpGrid');
    if (!gridEl) return;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const today = new Date();

    let html = '';

    // Prev month days
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      html += `<div class="cdp-day other-month">${day}</div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const isSelected = dateStr === cdpSelectedDateStr;
      
      const scriptsOnDay = state.scripts.filter((s) => s.publishDate === dateStr);
      let dotsHtml = '';
      let tooltipData = '';
      if (scriptsOnDay.length > 0) {
        dotsHtml = '<div class="cdp-dots">';
        // Cap dots at 3 so it doesn't overflow UI
        for (let i = 0; i < Math.min(scriptsOnDay.length, 3); i++) {
          dotsHtml += '<div class="cdp-dot"></div>';
        }
        dotsHtml += '</div>';
        // Encode data for tooltip
        tooltipData = `data-scripts='${JSON.stringify(scriptsOnDay.map(s => ({id: s.id, title: s.title || 'Untitled'}))).replace(/'/g, "&#39;")}'`;
      }

      html += `
        <div class="cdp-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${dateStr}" ${tooltipData}>
          ${d}
          ${dotsHtml}
        </div>
      `;
    }

    // Next month days
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="cdp-day other-month">${d}</div>`;
    }

    gridEl.innerHTML = html;
  }

  function setupCustomDatePicker() {
    const prevBtn = $('#cdpPrevMonth');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        cdpCurrentDate.setMonth(cdpCurrentDate.getMonth() - 1);
        renderCustomDatePicker();
      });
    }
    const nextBtn = $('#cdpNextMonth');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        cdpCurrentDate.setMonth(cdpCurrentDate.getMonth() + 1);
        renderCustomDatePicker();
      });
    }

    const grid = $('#cdpGrid');
    const tooltip = $('#cdpTooltip');
    
    if (grid) {
      grid.addEventListener('click', (e) => {
        // If clicking a tooltip item, don't trigger day click
        if (e.target.closest('.cdp-tooltip')) return;
        
        const dayEl = e.target.closest('.cdp-day[data-date]');
        if (dayEl) {
          cdpSelectedDateStr = dayEl.dataset.date;
          renderCustomDatePicker();
          
          // Re-trigger tooltip if it has scripts
          if (dayEl.hasAttribute('data-scripts')) {
            showTooltipForDay(grid.querySelector(`.cdp-day[data-date="${cdpSelectedDateStr}"]`));
          } else {
            tooltip.classList.remove('visible');
          }
        }
      });

      // Hover for tooltip using delegation but more robust
      grid.addEventListener('mouseover', (e) => {
        const dayEl = e.target.closest('.cdp-day[data-scripts]');
        if (dayEl) {
          showTooltipForDay(dayEl);
        }
      });
      
      grid.addEventListener('mouseout', (e) => {
        const dayEl = e.target.closest('.cdp-day[data-scripts]');
        if (dayEl) {
          const related = e.relatedTarget;
          // Hide only if we are actually leaving the day cell and not entering the tooltip
          if (!dayEl.contains(related) && (!tooltip.contains(related) && related !== tooltip)) {
            cdpTooltipTimeout = setTimeout(() => {
              tooltip.classList.remove('visible');
            }, 100);
          }
        }
      });
    }

    function showTooltipForDay(dayEl) {
      if (!dayEl || !tooltip) return;
      clearTimeout(cdpTooltipTimeout);
      const scripts = JSON.parse(dayEl.dataset.scripts.replace(/&#39;/g, "'"));
      tooltip.innerHTML = scripts.map(s => 
        `<div class="cdp-tooltip-item" data-id="${s.id}">${s.title}</div>`
      ).join('');
      
      // Position it exactly centered above the day
      const rect = dayEl.getBoundingClientRect();
      const modalBodyRect = dayEl.closest('.modal-body').getBoundingClientRect();
      
      const left = rect.left - modalBodyRect.left + (rect.width / 2);
      const bottom = modalBodyRect.bottom - rect.top + 8;
      
      tooltip.style.left = `${left}px`;
      tooltip.style.bottom = `${bottom}px`;
      
      tooltip.classList.add('visible');
    }

    if (tooltip) {
      tooltip.addEventListener('mouseover', () => clearTimeout(cdpTooltipTimeout));
      tooltip.addEventListener('mouseout', () => {
        cdpTooltipTimeout = setTimeout(() => {
          tooltip.classList.remove('visible');
        }, 100);
      });
      
      // Click script to navigate
      tooltip.addEventListener('click', (e) => {
        const item = e.target.closest('.cdp-tooltip-item');
        if (item) {
          closeModal('dateModal');
          selectScript(item.dataset.id);
          tooltip.classList.remove('visible');
        }
      });
    }
  }

  // ── Event Listeners ────────────────────────────────────────
  function setupEventListeners() {
    setupFindReplaceListeners();

    // New script buttons
    $('#newScriptBtn').addEventListener('click', createScript);
    $('#emptyNewBtn').addEventListener('click', createScript);

    // Search
    $('#searchInput').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      state.visibleScriptsCount = 20; // reset pagination on search
      renderSidebar();
    });

    // Status Filter
    const statusFilter = $('#statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        state.statusFilter = e.target.value;
        state.visibleScriptsCount = 20; // reset pagination on filter change
        renderSidebar();
      });
    }


    // Theme Toggle removed. Always dark mode.
    state.theme = 'dark';

    // Script list click (delegation)
    $('#scriptList').addEventListener('click', (e) => {
      const loadMore = e.target.closest('.load-more-btn');
      if (loadMore) {
        state.visibleScriptsCount = (state.visibleScriptsCount || 20) + 20;
        renderSidebar();
        return;
      }

      const addSectionBtn = e.target.closest('.add-section-btn');
      if (addSectionBtn) {
        e.stopPropagation();
        const scriptId = addSectionBtn.dataset.scriptId;
        addSection(scriptId);
        return;
      }

      const sectionItem = e.target.closest('.script-section-item');
      if (sectionItem) {
        e.stopPropagation();
        selectSection(sectionItem.dataset.scriptId, sectionItem.dataset.sectionId);
        return;
      }
      
      const item = e.target.closest('.script-item');
      if (item) selectScript(item.dataset.id);
    });

    $('#scriptList').addEventListener('contextmenu', (e) => {
      const sectionItem = e.target.closest('.script-section-item');
      if (sectionItem) {
        e.preventDefault();
        const scriptId = sectionItem.dataset.scriptId;
        const sectionId = sectionItem.dataset.sectionId;
        showSectionContextMenu(e.clientX, e.clientY, scriptId, sectionId);
      }
    });

    // Nav tabs
    $$('.rail-tab[data-view]').forEach((tab) => {
      tab.addEventListener('click', () => {
        saveCurrentEditorContent();
        state.currentView = tab.dataset.view;
        render();
      });
    });

    const deleteBtn = $('#deleteScriptBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (state.activeScriptId) {
          const script = getActiveScript();
          const modalText = $('#deleteModalText');
          if (script && modalText) {
            modalText.textContent = script.status === 'deleted' 
              ? 'Are you sure you want to permanently delete this script? This cannot be undone.'
              : 'Are you sure you want to move this script to Trash?';
          }
          openModal('deleteModal');
        }
      });
    }

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
    $('#editor').addEventListener('input', (e) => {
      autoSave();
      updateEditorStats();
    });

    // Editor Tab Key (Table extension)
    $('#editor').addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const node = sel.anchorNode;
        const cell = node.nodeType === 3 ? node.parentNode.closest('td, th') : node.closest('td, th');
        if (cell) {
          const row = cell.closest('tr');
          const table = cell.closest('table');
          const isLastCellInRow = cell === row.lastElementChild;
          const isLastRowInTable = row === table.lastElementChild || row === table.querySelector('tbody')?.lastElementChild;
          
          if (isLastCellInRow && isLastRowInTable) {
            e.preventDefault();
            // Automatically add a new row at the bottom
            const clone = row.cloneNode(true);
            Array.from(clone.children).forEach(td => td.innerHTML = '');
            row.parentNode.appendChild(clone);
            
            // Move cursor to the first cell of the new row
            const firstNewCell = clone.firstElementChild;
            if (firstNewCell) {
              const newRange = document.createRange();
              newRange.selectNodeContents(firstNewCell);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
          }
        }
      }
    });

    // Markdown shortcuts
    $('#editor').addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const node = range.startContainer;
        
        if (node.nodeType === 3) { // Text node
          const text = node.textContent;
          const match = text.match(/^(#{1,3})\s/);
          if (match) {
            e.preventDefault();
            const level = match[1].length;
            const headingTag = 'h' + level;
            
            // Remove the markdown prefix
            node.textContent = text.substring(match[0].length);
            
            // Apply heading format
            document.execCommand('formatBlock', false, headingTag);
            
            // Move cursor to the end
            const newRange = document.createRange();
            newRange.selectNodeContents(node);
            newRange.collapse(false);
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        }
      }
    });

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

    const tpSectionSelect = $('#tpSectionSelect');
    if (tpSectionSelect) {
      tpSectionSelect.addEventListener('change', (e) => {
        const secIndex = parseInt(e.target.value, 10);
        const raw = tpScriptSections[secIndex] || '';
        // Sanitize: strip styles/classes
        const temp = document.createElement('div');
        temp.innerHTML = raw;
        temp.querySelectorAll('*').forEach(el => { el.removeAttribute('style'); el.removeAttribute('class'); });
        const clean = temp.innerHTML;
        // Highlight markers (only uppercase like [HOOK], [CTA])
        $('#tpContent').innerHTML = clean.replace(/\[([A-Z][A-Z0-9 _\-]*)\]/g, '<span class="tp-marker">[$1]</span>');
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

    // Teleprompter HUD Event Listeners
    const tpSettingsDrawer = $('#tpSettingsDrawer');
    const tpSettingsToggleBtn = $('#tpSettingsToggleBtn');
    const tpSettingsCloseBtn = $('#tpSettingsCloseBtn');
    if (tpSettingsDrawer && tpSettingsToggleBtn) {
      tpSettingsToggleBtn.addEventListener('click', () => tpSettingsDrawer.classList.toggle('open'));
      if (tpSettingsCloseBtn) tpSettingsCloseBtn.addEventListener('click', () => tpSettingsDrawer.classList.remove('open'));
    }

    const themeBtns = document.querySelectorAll('.theme-btn');
    themeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        themeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.tpTheme = btn.dataset.theme;
        updateTeleprompterStyles();
      });
    });

    const tpFontWeightSelect = $('#tpFontWeightSelect');
    if (tpFontWeightSelect) {
      tpFontWeightSelect.addEventListener('change', (e) => {
        state.tpFontWeight = e.target.value;
        updateTeleprompterStyles();
      });
    }

    const tpEyelineToggle = $('#tpEyelineToggle');
    if (tpEyelineToggle) {
      tpEyelineToggle.addEventListener('change', (e) => {
        state.tpEyeline = e.target.checked;
        const eyelineOverlay = $('#tpEyelineOverlay');
        if (eyelineOverlay) eyelineOverlay.hidden = !state.tpEyeline;
      });
    }

    // Custom Shortcuts Configuration Logic
    let activeShortcutBtn = null;
    let activeShortcutAction = null;
    const shortcutBtns = document.querySelectorAll('.shortcut-btn');
    
    function updateShortcutUI() {
      if (!state.tpShortcuts) return;
      document.querySelectorAll('.shortcut-btn').forEach(btn => {
        const action = btn.dataset.action;
        if (state.tpShortcuts[action]) {
          btn.textContent = state.tpShortcuts[action];
        }
      });
    }
    // Call it initially when teleprompter opens, or just let it update on load.
    // We will call updateShortcutUI inside openTeleprompter or here on load.
    setTimeout(updateShortcutUI, 100);

    shortcutBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Cancel previous if any
        if (activeShortcutBtn) {
          activeShortcutBtn.classList.remove('listening');
          activeShortcutBtn.textContent = state.tpShortcuts[activeShortcutAction] || 'Click to set';
        }
        
        activeShortcutBtn = btn;
        activeShortcutAction = btn.dataset.action;
        btn.classList.add('listening');
        btn.textContent = 'Listening...';
        e.stopPropagation();
      });
    });

    const tpBluetoothToggle = $('#tpBluetoothToggle');
    if (tpBluetoothToggle) {
      tpBluetoothToggle.addEventListener('change', (e) => {
        state.tpBluetoothMode = e.target.checked;
        save();
      });
    }

    // Keyboard Shortcuts for Teleprompter (including capturing config)
    window.addEventListener('keydown', (e) => {
      // 1. Focus interception - if Teleprompter is open, prevent default behavior of spacebar/arrows 
      //    even if some button or select is accidentally focused, unless it's explicitly a text input.
      const tpOverlay = $('#teleprompterOverlay');
      if (tpOverlay && !tpOverlay.hidden) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        // If we are configuring a shortcut
        if (activeShortcutBtn && activeShortcutAction) {
          e.preventDefault();
          e.stopPropagation();
          const code = e.code;
          state.tpShortcuts[activeShortcutAction] = code;
          save();
          activeShortcutBtn.textContent = code;
          activeShortcutBtn.classList.remove('listening');
          activeShortcutBtn = null;
          activeShortcutAction = null;
          return;
        }

        // 2. Determine which keys to listen to
        let playKey = 'Space';
        let upKey = 'ArrowUp';
        let downKey = 'ArrowDown';
        let scrollUpKey = 'PageUp';
        let scrollDownKey = 'PageDown';
        let exitKey = 'Escape';

        if (state.tpBluetoothMode && state.tpShortcuts) {
          playKey = state.tpShortcuts.playPause || playKey;
          upKey = state.tpShortcuts.speedUp || upKey;
          downKey = state.tpShortcuts.speedDown || downKey;
          scrollUpKey = state.tpShortcuts.scrollUp || scrollUpKey;
          scrollDownKey = state.tpShortcuts.scrollDown || scrollDownKey;
          exitKey = state.tpShortcuts.exit || exitKey;
        }

        // 3. Process the shortcut
        if (e.code === playKey) {
          e.preventDefault();
          e.stopPropagation();
          toggleTeleprompterPlay();
        } else if (e.code === exitKey) {
          e.preventDefault();
          e.stopPropagation();
          closeTeleprompter();
        } else if (e.code === upKey) {
          // SPEED UP (Increase speed value)
          e.preventDefault();
          e.stopPropagation();
          let currentSpeed = parseFloat(state.tpSpeed) || 70;
          currentSpeed = Math.min(250, currentSpeed + 10);
          state.tpSpeed = currentSpeed;
          const speedSlider = $('#tpSpeedSlider');
          if (speedSlider) speedSlider.value = currentSpeed;
        } else if (e.code === downKey) {
          // SPEED DOWN (Decrease speed value)
          e.preventDefault();
          e.stopPropagation();
          let currentSpeed = parseFloat(state.tpSpeed) || 70;
          currentSpeed = Math.max(10, currentSpeed - 10);
          state.tpSpeed = currentSpeed;
          const speedSlider = $('#tpSpeedSlider');
          if (speedSlider) speedSlider.value = currentSpeed;
        } else if (e.code === scrollUpKey) {
          e.preventDefault();
          e.stopPropagation();
          const tpScrollArea = $('#tpScrollArea');
          if (tpScrollArea) {
            tpScrollArea.scrollTop = Math.max(0, tpScrollArea.scrollTop - 200);
            tpExactScrollTop = tpScrollArea.scrollTop;
          }
        } else if (e.code === scrollDownKey) {
          e.preventDefault();
          e.stopPropagation();
          const tpScrollArea = $('#tpScrollArea');
          if (tpScrollArea) {
            tpScrollArea.scrollTop = Math.min(tpScrollArea.scrollHeight, tpScrollArea.scrollTop + 200);
            tpExactScrollTop = tpScrollArea.scrollTop;
          }
        }
      }
    }, true); // Use capture phase to intercept before focused elements swallow it

    // Handle clicks outside to cancel listening
    window.addEventListener('click', () => {
      if (activeShortcutBtn) {
        activeShortcutBtn.classList.remove('listening');
        activeShortcutBtn.textContent = state.tpShortcuts[activeShortcutAction] || 'Click to set';
        activeShortcutBtn = null;
        activeShortcutAction = null;
      }
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
        updateToolbarStates();
      });
    });

    function updateToolbarStates() {
      $$('.toolbar-btn[data-command]').forEach((btn) => {
        const cmd = btn.dataset.command;
        const val = btn.dataset.value;
        let isActive = false;
        
        try {
          if (cmd === 'formatBlock') {
            let currentBlock = document.queryCommandValue(cmd);
            if (currentBlock) {
               // queryCommandValue might return 'h1' or 'heading 1' or '"h1"' or '<h1>' depending on browser.
               // It's safer to check for inclusion for headers, or direct match
               currentBlock = currentBlock.replace(/['"<>\s]/g, '').toLowerCase();
               if (currentBlock === val.toLowerCase()) {
                 isActive = true;
               }
            }
          } else if (['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'].includes(cmd)) {
            isActive = document.queryCommandState(cmd);
          }
        } catch (e) {
          // Ignore unsupported commands
        }
        
        if (isActive) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    document.addEventListener('selectionchange', () => {
      const editor = $('#editor');
      if (document.activeElement === editor || editor.contains(document.activeElement)) {
        updateToolbarStates();
      }
    });

    // ── Context Menu Bridge ──────────────────────────────────
    // All context menu logic is now in context-menu.js (standalone, uses event delegation)
    // We expose needed app functions via window._smBridge for the external module
    window._smBridge = {
      saveEditor: function() {
        if (typeof saveCurrentEditorContent === 'function') saveCurrentEditorContent();
      },
      updateParts: function() {

      },
      toast: function(msg, type) {
        if (typeof showToast === 'function') showToast(msg, type || 'info');
      },
      save: function() {
        if (typeof save === 'function') save();
      }
    };


    // Font size slider
    const fontSizeSlider = $('#fontSizeSlider');
    const editor = $('#editor');
    if (fontSizeSlider && editor) {
      fontSizeSlider.addEventListener('input', (e) => {
        const size = e.target.value;
        editor.style.fontSize = `${size}px`;
      });
      fontSizeSlider.addEventListener('change', (e) => {
        state.editorFontSize = e.target.value;
        save();
      });
    }

    // Case Toggle (Aa)
    const caseToggleBtn = $('#caseToggleBtn');
    if (caseToggleBtn) {
      caseToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const text = sel.toString();
          const isUpper = text === text.toUpperCase();
          const newText = isUpper ? text.toLowerCase() : text.toUpperCase();
          document.execCommand('insertText', false, newText);
        }
      });
      caseToggleBtn.addEventListener('mousedown', (e) => e.preventDefault());
    }

    // Line Spacing Toggle
    const lineSpacingBtn = $('#lineSpacingBtn');
    if (lineSpacingBtn) {
      lineSpacingBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const currentLineHeight = editor.style.lineHeight || '1.6';
        if (currentLineHeight === '1.6') {
          editor.style.lineHeight = '2.5';
          lineSpacingBtn.classList.add('active');
        } else {
          editor.style.lineHeight = '1.6';
          lineSpacingBtn.classList.remove('active');
        }
        state.editorLineHeight = editor.style.lineHeight;
        save();
      });
      lineSpacingBtn.addEventListener('mousedown', (e) => e.preventDefault());
    }

    // Link button
    $('#linkBtn').addEventListener('click', (e) => {
      e.preventDefault();
      insertLink();
    });

    // Save link
    $('#saveLinkBtn').addEventListener('click', applyLink);

    // Color palette popup
    const colorBtn = $('#colorBtn');
    const colorPalette = $('#colorPalettePopup');
    const colorIndicator = $('#colorIndicator');
    let savedColorSelection = null;
    
    colorBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent focus loss
    });
    
    colorBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        savedColorSelection = sel.getRangeAt(0).cloneRange();
      }
      colorPalette.hidden = !colorPalette.hidden;
    });
    
    // Swatch clicks
    colorPalette.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('mousedown', (e) => e.preventDefault());
      swatch.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const color = swatch.dataset.color;
        if (savedColorSelection) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedColorSelection);
        }
        document.execCommand('foreColor', false, color);
        colorIndicator.style.background = color;
        colorPalette.hidden = true;
      });
    });
    
    // Custom color picker
    const customColorInput = $('#customColorPicker');
    if (customColorInput) {
      customColorInput.addEventListener('change', (e) => {
        if (savedColorSelection) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedColorSelection);
        }
        document.execCommand('foreColor', false, e.target.value);
        colorIndicator.style.background = e.target.value;
        colorPalette.hidden = true;
      });
    }
    
    // Remove color button
    $('#removeColorBtn').addEventListener('mousedown', (e) => e.preventDefault());
    $('#removeColorBtn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (savedColorSelection) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedColorSelection);
      }
      document.execCommand('removeFormat', false, null);
      colorIndicator.style.background = '#a599ff';
      colorPalette.hidden = true;
    });
    
    // Close palette on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.color-picker-wrapper')) {
        colorPalette.hidden = true;
      }
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
      if (script) {
        cdpSelectedDateStr = script.publishDate || null;
        if (cdpSelectedDateStr) {
          const parts = cdpSelectedDateStr.split('-');
          cdpCurrentDate = new Date(parts[0], parseInt(parts[1]) - 1, 1);
        } else {
          cdpCurrentDate = new Date();
          cdpCurrentDate.setDate(1);
        }
      }
      renderCustomDatePicker();
      openModal('dateModal');
    });

    $('#saveDateBtn').addEventListener('click', () => {
      const script = getActiveScript();
      if (script) {
        script.publishDate = cdpSelectedDateStr || null;
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
        // Disabled auto-assignment of active script on calendar click to prevent accidental changes.
        // Users can set the date explicitly from the editor view.
      }
    });

    // Upcoming items click
    $('#upcomingList').addEventListener('click', (e) => {
      const item = e.target.closest('.upcoming-item-premium');
      if (!item) return;
      
      const scriptId = item.dataset.scriptId;
      
      if (e.target.closest('.btn-mark-done')) {
        e.stopPropagation();
        const script = state.scripts.find(s => s.id === scriptId);
        if (script) {
          script.status = 'finished';
          save();
          renderCalendar();
          showToast('Script marked as finished!');
        }
        return;
      }
      
      selectScript(scriptId);
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
      const key = e.key ? e.key.toLowerCase() : '';
      
      // Ctrl+S — save (prevent default browser save)
      if (e.ctrlKey && key === 's') {
        e.preventDefault();
        saveCurrentEditorContent();
        showToast('Saved', 'success');
      }

      // Ctrl+P — Print
      if (e.ctrlKey && key === 'p') {
        e.preventDefault();
        if (state.currentView === 'editor') {
          openPrintPreview();
        }
      }

      // Escape — close modals, teleprompter, and find/replace
      if (e.key === 'Escape') {
        $$('.modal-overlay').forEach((m) => (m.hidden = true));
        closeTeleprompter();
        const frPanel = $('#findReplacePanel');
        if (frPanel) {
          frPanel.style.setProperty('display', 'none', 'important');
          frPanel.setAttribute('hidden', '');
        }
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

      // Find match count update handled in safe setup
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
    setupCustomDatePicker();
    applyTheme();

    // Background sync translations for old scripts
    setTimeout(async () => {
      let changed = false;
      for (let s of state.scripts) {
        if (s.title && (!s.titleEn || s.titleEn === '')) {
          const enText = await translateToEnglish(s.title);
          if (enText && enText.toLowerCase() !== s.title.toLowerCase()) {
            s.titleEn = enText;
            changed = true;
          }
          await new Promise(r => setTimeout(r, 600)); // Delay to prevent rate limits
        }
      }
      if (changed) save();
    }, 2000);

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

  // ── Comments Sidebar Logic ─────────────────────────────────
  function updateCommentsSidebar() {
    const commentsList = $('#commentsList');
    if (!commentsList) return;
    commentsList.innerHTML = '';
    
    const editorEl = $('#editor');
    if (!editorEl) return;
    
    const comments = Array.from(editorEl.querySelectorAll('.sm-comment-mark'));
    
    if (comments.length === 0) {
      commentsList.innerHTML = `
        <div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No comments yet. Select text and right-click to add one.
        </div>
      `;
      return;
    }

    comments.forEach(mark => {
      const author = mark.dataset.author || 'Anonymous';
      const text = mark.dataset.text || '';
      const timeStr = mark.dataset.time;
      let displayTime = '';
      if (timeStr) {
        const d = new Date(timeStr);
        displayTime = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      }

      const card = document.createElement('div');
      card.className = 'comment-card';
      card.dataset.commentId = mark.id;
      
      card.innerHTML = `
        <div class="comment-card-header">
          <span class="comment-card-author">${author}</span>
          <span class="comment-card-time">${displayTime}</span>
        </div>
        <div class="comment-card-text">${text}</div>
        <div class="comment-card-actions">
          <button class="btn-delete-comment" title="Delete Comment">Delete</button>
        </div>
      `;

      // Click card to scroll to comment
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-delete-comment')) return; // handled below
        
        // Highlight active card
        commentsList.querySelectorAll('.comment-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        // Highlight active mark
        editorEl.querySelectorAll('.sm-comment-mark').forEach(m => m.classList.remove('active'));
        mark.classList.add('active');

        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      // Delete comment
      const deleteBtn = card.querySelector('.btn-delete-comment');
      deleteBtn.addEventListener('click', () => {
        // Unwrap the text
        while (mark.firstChild) mark.parentNode.insertBefore(mark.firstChild, mark);
        mark.remove();
        updateCommentsSidebar();
        saveCurrentEditorContent();
        $('#inlineCommentPopover').hidden = true;
      });

      commentsList.appendChild(card);
    });
  }

  // Handle inline popover when clicking a comment in editor
  const popover = $('#inlineCommentPopover');
  if (popover) {
    document.addEventListener('click', (e) => {
      const mark = e.target.closest('.sm-comment-mark');
      if (mark) {
        const rect = mark.getBoundingClientRect();
        
        $('#popoverAuthor').textContent = mark.dataset.author || 'Anonymous';
        $('#popoverText').textContent = mark.dataset.text || '';
        
        let displayTime = '';
        if (mark.dataset.time) {
          const d = new Date(mark.dataset.time);
          displayTime = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
        $('#popoverTime').textContent = displayTime;

        popover.style.top = (rect.bottom + window.scrollY + 8) + 'px';
        popover.style.left = (rect.left + window.scrollX) + 'px';
        popover.hidden = false;

        // Sync sidebar active state
        const commentsList = $('#commentsList');
        if (commentsList) {
          commentsList.querySelectorAll('.comment-card').forEach(c => c.classList.remove('active'));
          const activeCard = commentsList.querySelector(`.comment-card[data-comment-id="${mark.id}"]`);
          if (activeCard) activeCard.classList.add('active');
        }
        
        $('#editor').querySelectorAll('.sm-comment-mark').forEach(m => m.classList.remove('active'));
        mark.classList.add('active');
      } else if (!e.target.closest('#inlineCommentPopover')) {
        popover.hidden = true;
        $('#editor')?.querySelectorAll('.sm-comment-mark').forEach(m => m.classList.remove('active'));
        $('#commentsList')?.querySelectorAll('.comment-card').forEach(c => c.classList.remove('active'));
      }
    });
  }

  window._smBridge = window._smBridge || {};
  window._smBridge.updateCommentsSidebar = updateCommentsSidebar;

  // ── Parts Sidebar Logic ────────────────────────────────────


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

  function setupToolsSidebar() {
    const tabBtns = document.querySelectorAll('.tools-tab-btn');
    const panels = document.querySelectorAll('.tools-panel');

    // Tab Switching
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        
        tabBtns.forEach(b => b.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById('tab-' + target).classList.add('active');
      });
    });

    // Block Insertion
    const insertBtns = document.querySelectorAll('.insert-block-btn');
    const editor = document.getElementById('editor');

    insertBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const blockType = btn.dataset.block;
        editor.focus();

        if (blockType === 'text') {
          document.execCommand('insertHTML', false, '<p><br></p>');
        } 
        else if (blockType === 'code') {
          const codeHTML = `<pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; font-family: monospace; border: 1px solid var(--border);"><code>// Code here...</code></pre><p><br></p>`;
          document.execCommand('insertHTML', false, codeHTML);
        }
        else if (blockType === 'table') {
          const tableHTML = `
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr><th style="border: 1px solid var(--border); padding: 8px; background: rgba(255,255,255,0.05);">Header 1</th><th style="border: 1px solid var(--border); padding: 8px; background: rgba(255,255,255,0.05);">Header 2</th></tr>
              <tr><td style="border: 1px solid var(--border); padding: 8px;">Data</td><td style="border: 1px solid var(--border); padding: 8px;">Data</td></tr>
              <tr><td style="border: 1px solid var(--border); padding: 8px;">Data</td><td style="border: 1px solid var(--border); padding: 8px;">Data</td></tr>
            </table><p><br></p>`;
          document.execCommand('insertHTML', false, tableHTML);
        }
        else if (blockType === 'line') {
          document.execCommand('insertHTML', false, '<hr style="border: 0; border-top: 1px solid var(--border); margin: 24px 0;"><p><br></p>');
        }
        else if (blockType === 'broll') {
          const brollHTML = `<span contenteditable="false" style="display: inline-flex; align-items: center; background: rgba(110, 106, 255, 0.15); color: #8e8aff; border: 1px solid rgba(110, 106, 255, 0.3); border-radius: 4px; padding: 2px 8px; font-size: 13px; font-weight: 600; font-family: monospace; user-select: all;">🎥 B-ROLL</span>&nbsp;`;
          document.execCommand('insertHTML', false, brollHTML);
        }
        else if (blockType === 'image') {
          document.getElementById('insertImageInput').click();
        }
      });

      // Drag and Drop Logic
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-sm-insert-block', btn.dataset.block);
        document.body.classList.add('dragging-insert-block');
      });

      btn.addEventListener('dragend', () => {
        document.body.classList.remove('dragging-insert-block');
        removeDropIndicator();
      });
    });

    // Drop indicator logic for editor
    let dropIndicator = null;

    function removeDropIndicator() {
      if (dropIndicator && dropIndicator.parentNode) {
        dropIndicator.parentNode.removeChild(dropIndicator);
      }
      dropIndicator = null;
    }

    editor.addEventListener('dragover', (e) => {
      const isInsertBlock = document.body.classList.contains('dragging-insert-block');
      if (!isInsertBlock) return;
      e.preventDefault();
      
      e.dataTransfer.dropEffect = 'copy';

      // Find insertion point
      const children = Array.from(editor.childNodes);
      let closestChild = null;
      let minDistance = Number.MAX_VALUE;

      children.forEach(child => {
        if (child.nodeType !== 1) return; // Only Elements
        if (child === dropIndicator) return;
        const rect = child.getBoundingClientRect();
        const yCenter = rect.top + rect.height / 2;
        const distance = Math.abs(e.clientY - yCenter);
        if (distance < minDistance) {
          minDistance = distance;
          closestChild = child;
        }
      });

      if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'drop-indicator';
      }

      if (closestChild) {
        const rect = closestChild.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          editor.insertBefore(dropIndicator, closestChild);
        } else {
          if (closestChild.nextSibling) {
            editor.insertBefore(dropIndicator, closestChild.nextSibling);
          } else {
            editor.appendChild(dropIndicator);
          }
        }
      } else {
        editor.appendChild(dropIndicator);
      }
    });

    editor.addEventListener('dragleave', (e) => {
      if (!editor.contains(e.relatedTarget)) {
        removeDropIndicator();
      }
    });

    editor.addEventListener('drop', (e) => {
      const blockType = e.dataTransfer.getData('application/x-sm-insert-block');
      if (!blockType) return;
      e.preventDefault();

      document.body.classList.remove('dragging-insert-block');
      
      const insertNode = document.createElement('div');
      
      if (blockType === 'text') {
        insertNode.innerHTML = '<p><br></p>';
      } else if (blockType === 'code') {
        insertNode.innerHTML = `<pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; font-family: monospace; border: 1px solid var(--border);"><code>// Code here...</code></pre><p><br></p>`;
      } else if (blockType === 'table') {
        insertNode.innerHTML = `
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><th style="border: 1px solid var(--border); padding: 8px; background: rgba(255,255,255,0.05);">Header 1</th><th style="border: 1px solid var(--border); padding: 8px; background: rgba(255,255,255,0.05);">Header 2</th></tr>
            <tr><td style="border: 1px solid var(--border); padding: 8px;">Data</td><td style="border: 1px solid var(--border); padding: 8px;">Data</td></tr>
            <tr><td style="border: 1px solid var(--border); padding: 8px;">Data</td><td style="border: 1px solid var(--border); padding: 8px;">Data</td></tr>
          </table><p><br></p>`;
      } else if (blockType === 'line') {
        insertNode.innerHTML = '<hr style="border: 0; border-top: 1px solid var(--border); margin: 24px 0;"><p><br></p>';
      } else if (blockType === 'broll') {
        insertNode.innerHTML = `<span contenteditable="false" style="display: inline-flex; align-items: center; background: rgba(110, 106, 255, 0.15); color: #8e8aff; border: 1px solid rgba(110, 106, 255, 0.3); border-radius: 4px; padding: 2px 8px; font-size: 13px; font-weight: 600; font-family: monospace; user-select: all;">🎥 B-ROLL</span>&nbsp;`;
      }

      if (blockType !== 'image') {
        const frag = document.createDocumentFragment();
        while (insertNode.firstChild) {
          frag.appendChild(insertNode.firstChild);
        }
        
        if (dropIndicator && dropIndicator.parentNode === editor) {
          editor.replaceChild(frag, dropIndicator);
          dropIndicator = null;
        } else {
          editor.appendChild(frag);
        }
        
        saveCurrentEditorContent();

      } else {
        removeDropIndicator();
        document.getElementById('insertImageInput').click();
      }
    });

    // Image Input Handle
    const imageInput = document.getElementById('insertImageInput');
    if (imageInput) {
      imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const url = URL.createObjectURL(file);
          editor.focus();
          document.execCommand('insertHTML', false, `<img src="${url}" style="max-width: 100%; border-radius: 8px; margin: 16px 0;"><p><br></p>`);
          // clear input
          imageInput.value = '';
        }
      });
    }
  }

  // ── Statistics Dashboard ─────────────────────────────────────
  function renderStatsDashboard() {
    const scripts = state.scripts;
    const finished = scripts.filter(s => (s.status || 'pending') === 'finished');
    const pending = scripts.filter(s => (s.status || 'pending') === 'pending');
    const rejected = scripts.filter(s => (s.status || 'pending') === 'rejected');
    const trashed = scripts.filter(s => (s.status || 'pending') === 'deleted');

    // KPI Cards
    const el = (id) => document.getElementById(id);
    el('statsTotalScripts').textContent = scripts.length;
    el('statsFinished').textContent = finished.length;
    el('statsPending').textContent = pending.length;
    el('statsRejected').textContent = rejected.length;
    el('statsTrashed').textContent = trashed.length;

    // Draw charts
    drawMonthlyChart(scripts);
    drawDonutChart(finished.length, pending.length, rejected.length, trashed.length);
    drawWeeklyChart(finished);

    // Fill dropdown tables
    fillDateTable(scripts);
    fillMonthlyTable(scripts);
    fillLengthAnalysis(scripts);
    fillRejectionReport(rejected);
    fillConsistencyInfo(finished);
    fillStatusSummary(scripts);
  }

  function getScriptWordCount(s) {
    const text = (s.content || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.split(/\s+/).length : 0;
  }

  function getScriptDate(s) {
    // Use publishDate if set, else use createdAt
    if (s.publishDate) return new Date(s.publishDate);
    if (s.createdAt) return new Date(s.createdAt);
    if (s.id) return new Date(parseInt(s.id)); // id is timestamp-based
    return new Date();
  }

  // ── Monthly Bar Chart (Canvas) ──────────────────────────────
  function drawMonthlyChart(scripts) {
    const canvas = document.getElementById('statsMonthlyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 260 * dpr;
    ctx.scale(dpr, dpr);
    const W = canvas.offsetWidth;
    const H = 260;
    ctx.clearRect(0, 0, W, H);

    // Aggregate by month (last 12 months)
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), year: d.getFullYear(), month: d.getMonth(), total: 0, finished: 0 });
    }

    scripts.forEach(s => {
      const d = getScriptDate(s);
      const m = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (m) {
        m.total++;
        if ((s.status || 'pending') === 'finished') m.finished++;
      }
    });

    const maxVal = Math.max(1, ...months.map(m => m.total));
    const pad = { left: 40, right: 16, top: 20, bottom: 40 };
    const barW = (W - pad.left - pad.right) / months.length;
    const chartH = H - pad.top - pad.bottom;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), pad.left - 6, y + 4);
    }

    months.forEach((m, i) => {
      const x = pad.left + i * barW + barW * 0.15;
      const bw = barW * 0.4;

      // Total bar
      const totalH = (m.total / maxVal) * chartH;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.roundRect(x, pad.top + chartH - totalH, bw, totalH, [3, 3, 0, 0]);
      ctx.fill();

      // Finished bar
      const finH = (m.finished / maxVal) * chartH;
      ctx.fillStyle = '#42a5f5';
      ctx.beginPath();
      ctx.roundRect(x + bw + 2, pad.top + chartH - finH, bw, finH, [3, 3, 0, 0]);
      ctx.fill();

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.label, pad.left + i * barW + barW / 2, H - pad.bottom + 16);
    });

    // Legend
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(W - 150, 8, 10, 10);
    ctx.fillStyle = '#42a5f5';
    ctx.fillRect(W - 80, 8, 10, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Total', W - 136, 17);
    ctx.fillText('Uploaded', W - 66, 17);
  }

  // ── Donut Chart (Canvas) ────────────────────────────────────
  function drawDonutChart(finished, pending, rejected, trashed) {
    const canvas = document.getElementById('statsDonutChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 260 * dpr;
    ctx.scale(dpr, dpr);
    const W = canvas.offsetWidth;
    const H = 260;
    ctx.clearRect(0, 0, W, H);

    const total = finished + pending + rejected + trashed;
    if (total === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data', W / 2, H / 2);
      return;
    }

    const slices = [
      { value: finished, color: '#42a5f5', label: 'Uploaded' },
      { value: pending, color: '#ffa726', label: 'Pending' },
      { value: rejected, color: '#f44336', label: 'Rejected' },
      { value: trashed, color: '#ab47bc', label: 'Trashed' },
    ].filter(s => s.value > 0);

    const cx = W / 2;
    const cy = 110;
    const r = 80;
    const innerR = 50;
    let angle = -Math.PI / 2;

    slices.forEach(s => {
      const sliceAngle = (s.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, angle, angle + sliceAngle);
      ctx.arc(cx, cy, innerR, angle + sliceAngle, angle, true);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      angle += sliceAngle;
    });

    // Center text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(total, cx, cy + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText('TOTAL', cx, cy + 16);

    // Legend below
    let lx = 10;
    const ly = 210;
    slices.forEach(s => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, ly, 8, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'left';
      const pct = Math.round((s.value / total) * 100);
      const text = `${s.label} (${s.value} — ${pct}%)`;
      ctx.fillText(text, lx + 12, ly + 8);
      lx += ctx.measureText(text).width + 24;
      if (lx > W - 40) { lx = 10; }
    });
  }

  // ── Weekly Consistency Chart ────────────────────────────────
  function drawWeeklyChart(finishedScripts) {
    const canvas = document.getElementById('statsWeeklyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 200 * dpr;
    ctx.scale(dpr, dpr);
    const W = canvas.offsetWidth;
    const H = 200;
    ctx.clearRect(0, 0, W, H);

    // Last 12 weeks
    const now = new Date();
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (i * 7));
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const count = finishedScripts.filter(s => {
        const d = getScriptDate(s);
        return d >= weekStart && d < weekEnd;
      }).length;
      const label = `W${12 - i}`;
      weeks.push({ label, count, start: weekStart });
    }

    const maxVal = Math.max(1, ...weeks.map(w => w.count));
    const pad = { left: 36, right: 16, top: 16, bottom: 34 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const barW = chartW / weeks.length;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (chartH / 3) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal - (maxVal / 3) * i), pad.left - 6, y + 4);
    }

    weeks.forEach((w, i) => {
      const x = pad.left + i * barW + barW * 0.2;
      const bw = barW * 0.6;
      const bh = (w.count / maxVal) * chartH;

      const gradient = ctx.createLinearGradient(x, pad.top + chartH - bh, x, pad.top + chartH);
      gradient.addColorStop(0, w.count > 0 ? '#66bb6a' : 'rgba(255,255,255,0.06)');
      gradient.addColorStop(1, w.count > 0 ? '#388e3c' : 'rgba(255,255,255,0.03)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, pad.top + chartH - bh, bw, bh || 2, [3, 3, 0, 0]);
      ctx.fill();

      // Count on top
      if (w.count > 0) {
        ctx.fillStyle = '#66bb6a';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(w.count, x + bw / 2, pad.top + chartH - bh - 6);
      }

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.label, pad.left + i * barW + barW / 2, H - pad.bottom + 16);
    });
  }

  // ── Dropdown Data Fillers ───────────────────────────────────
  function fillDateTable(scripts) {
    const el = document.getElementById('statsDateTable');
    if (!el) return;
    const sorted = [...scripts].sort((a, b) => getScriptDate(b) - getScriptDate(a));
    if (sorted.length === 0) { el.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No scripts to show.</p>'; return; }
    let html = `<table><thead><tr><th>#</th><th>Title</th><th>Status</th><th>Words</th><th>Date</th></tr></thead><tbody>`;
    sorted.forEach((s, i) => {
      const d = getScriptDate(s);
      const status = s.status || 'pending';
      html += `<tr>
        <td>${i + 1}</td>
        <td>${s.title || 'Untitled'}</td>
        <td><span class="stats-badge stats-badge-${status}">${status}</span></td>
        <td>${getScriptWordCount(s).toLocaleString()}</td>
        <td>${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function fillMonthlyTable(scripts) {
    const el = document.getElementById('statsMonthlyTable');
    if (!el) return;
    // Group by month
    const map = {};
    scripts.forEach(s => {
      const d = getScriptDate(s);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map[key]) map[key] = { total: 0, finished: 0, pending: 0, rejected: 0, deleted: 0, words: 0 };
      map[key].total++;
      const st = s.status || 'pending';
      if (map[key][st] !== undefined) map[key][st]++;
      map[key].words += getScriptWordCount(s);
    });
    const keys = Object.keys(map).sort().reverse();
    if (keys.length === 0) { el.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No data.</p>'; return; }
    let html = `<table><thead><tr><th>Month</th><th>Total</th><th>Uploaded</th><th>Pending</th><th>Rejected</th><th>Trashed</th><th>Avg Words</th></tr></thead><tbody>`;
    keys.forEach(k => {
      const m = map[k];
      const [y, mo] = k.split('-');
      const label = new Date(y, mo - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
      html += `<tr>
        <td>${label}</td>
        <td><strong>${m.total}</strong></td>
        <td>${m.finished}</td>
        <td>${m.pending}</td>
        <td>${m.rejected}</td>
        <td>${m.deleted}</td>
        <td>${m.total ? Math.round(m.words / m.total).toLocaleString() : '—'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function fillLengthAnalysis(scripts) {
    const el = document.getElementById('statsLengthInfo');
    if (!el) return;
    const wordCounts = scripts.map(getScriptWordCount);
    const total = wordCounts.reduce((a, b) => a + b, 0);
    const avg = scripts.length ? Math.round(total / scripts.length) : 0;
    const max = Math.max(0, ...wordCounts);
    const min = scripts.length ? Math.min(...wordCounts) : 0;
    const avgMinutes = Math.ceil(avg / 150);
    const longestScript = scripts[wordCounts.indexOf(max)];
    const shortestScript = scripts[wordCounts.indexOf(min)];

    el.innerHTML = `
      <div class="stats-info-item">
        <span class="info-label">Average Script Length</span>
        <span class="info-value">${avg.toLocaleString()}</span>
        <span class="info-sub">words (~${avgMinutes} min video)</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">Total Words Written</span>
        <span class="info-value">${total.toLocaleString()}</span>
        <span class="info-sub">across ${scripts.length} scripts</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">Longest Script</span>
        <span class="info-value">${max.toLocaleString()}</span>
        <span class="info-sub">${longestScript ? (longestScript.title || 'Untitled') : '—'}</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">Shortest Script</span>
        <span class="info-value">${min.toLocaleString()}</span>
        <span class="info-sub">${shortestScript ? (shortestScript.title || 'Untitled') : '—'}</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">Total Estimated Video Time</span>
        <span class="info-value">${Math.ceil(total / 150)} min</span>
        <span class="info-sub">${Math.round(total / 150 / 60)} hours of content</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">Avg Words Per Day</span>
        <span class="info-value">${scripts.length > 1 ? (() => {
          const dates = scripts.map(s => getScriptDate(s).getTime());
          const diff = (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24);
          return diff > 0 ? Math.round(total / diff) : total;
        })() : total}</span>
        <span class="info-sub">writing output</span>
      </div>
    `;
  }

  function fillRejectionReport(rejectedScripts) {
    const el = document.getElementById('statsRejectionInfo');
    if (!el) return;
    if (rejectedScripts.length === 0) {
      el.innerHTML = '<p style="color: var(--success); font-size: 13px; padding: 8px 0;">🎉 No rejected scripts! Great track record.</p>';
      return;
    }
    const totalScripts = state.scripts.length;
    const rejPct = totalScripts ? Math.round((rejectedScripts.length / totalScripts) * 100) : 0;

    let html = `<div style="margin-bottom: 14px; padding: 12px; background: rgba(244,67,54,0.08); border-radius: 8px; border: 1px solid rgba(244,67,54,0.2);">
      <strong style="color: #f44336;">${rejectedScripts.length}</strong> <span style="color: var(--text-secondary);">scripts rejected out of ${totalScripts} total (${rejPct}% rejection rate)</span>
    </div>`;
    html += `<table><thead><tr><th>#</th><th>Title</th><th>Words</th><th>Date</th></tr></thead><tbody>`;
    rejectedScripts.forEach((s, i) => {
      const d = getScriptDate(s);
      html += `<tr>
        <td>${i + 1}</td>
        <td>${s.title || 'Untitled'}</td>
        <td>${getScriptWordCount(s).toLocaleString()}</td>
        <td>${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function fillConsistencyInfo(finishedScripts) {
    const el = document.getElementById('statsConsistencyInfo');
    if (!el) return;

    // Calculate streaks and consistency
    const now = new Date();
    const thisWeek = finishedScripts.filter(s => {
      const d = getScriptDate(s);
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    }).length;

    const thisMonth = finishedScripts.filter(s => {
      const d = getScriptDate(s);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    // Weekly average (last 12 weeks)
    const last12Weeks = finishedScripts.filter(s => {
      const diff = (now - getScriptDate(s)) / (1000 * 60 * 60 * 24);
      return diff <= 84;
    }).length;
    const weeklyAvg = (last12Weeks / 12).toFixed(1);

    // Monthly average
    const allMonths = new Set();
    finishedScripts.forEach(s => {
      const d = getScriptDate(s);
      allMonths.add(`${d.getFullYear()}-${d.getMonth()}`);
    });
    const monthlyAvg = allMonths.size > 0 ? (finishedScripts.length / allMonths.size).toFixed(1) : '0';

    // Streak calculation (consecutive weeks with uploads)
    let streak = 0;
    for (let i = 0; i < 52; i++) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (i * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() - 7);
      const hasUpload = finishedScripts.some(s => {
        const d = getScriptDate(s);
        return d <= weekStart && d > weekEnd;
      });
      if (hasUpload) streak++;
      else break;
    }

    // Best month
    const monthMap = {};
    finishedScripts.forEach(s => {
      const d = getScriptDate(s);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthMap[key] = (monthMap[key] || 0) + 1;
    });
    const bestMonthKey = Object.keys(monthMap).sort((a, b) => monthMap[b] - monthMap[a])[0];
    let bestMonthLabel = '—';
    let bestMonthCount = 0;
    if (bestMonthKey) {
      const [y, m] = bestMonthKey.split('-');
      bestMonthLabel = new Date(y, m).toLocaleString('default', { month: 'long', year: 'numeric' });
      bestMonthCount = monthMap[bestMonthKey];
    }

    el.innerHTML = `
      <div class="stats-info-item">
        <span class="info-label">This Week</span>
        <span class="info-value">${thisWeek}</span>
        <span class="info-sub">videos uploaded</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">This Month</span>
        <span class="info-value">${thisMonth}</span>
        <span class="info-sub">videos uploaded</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">Weekly Average</span>
        <span class="info-value">${weeklyAvg}</span>
        <span class="info-sub">uploads / week (12w)</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">Monthly Average</span>
        <span class="info-value">${monthlyAvg}</span>
        <span class="info-sub">uploads / month</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">🔥 Current Streak</span>
        <span class="info-value">${streak} week${streak !== 1 ? 's' : ''}</span>
        <span class="info-sub">consecutive weeks uploading</span>
      </div>
      <div class="stats-info-item">
        <span class="info-label">🏆 Best Month</span>
        <span class="info-value">${bestMonthCount}</span>
        <span class="info-sub">${bestMonthLabel}</span>
      </div>
    `;
  }

  function fillStatusSummary(scripts) {
    const el = document.getElementById('statsStatusInfo');
    if (!el) return;
    const groups = {
      finished: { label: 'Uploaded (Finished)', scripts: [], color: '#42a5f5' },
      pending: { label: 'Pending', scripts: [], color: '#ffa726' },
      rejected: { label: 'Rejected', scripts: [], color: '#f44336' },
      deleted: { label: 'Trashed', scripts: [], color: '#ab47bc' },
    };
    scripts.forEach(s => {
      const st = s.status || 'pending';
      if (groups[st]) groups[st].scripts.push(s);
    });

    let html = '';
    Object.values(groups).forEach(g => {
      const count = g.scripts.length;
      const pct = scripts.length ? Math.round((count / scripts.length) * 100) : 0;
      const totalWords = g.scripts.reduce((sum, s) => sum + getScriptWordCount(s), 0);
      const avgWords = count ? Math.round(totalWords / count) : 0;

      html += `<div style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="width: 10px; height: 10px; border-radius: 50%; background: ${g.color}; display: inline-block;"></span>
          <strong style="color: var(--text-primary); font-size: 14px;">${g.label}</strong>
          <span style="color: var(--text-muted); font-size: 12px; margin-left: auto;">${count} scripts (${pct}%)</span>
        </div>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <div style="background: var(--bg-elevated); border: 1px solid var(--glass-border); border-radius: 8px; padding: 10px 14px; flex: 1; min-width: 120px;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Count</div>
            <div style="font-size: 18px; font-weight: 700; color: var(--text-primary);">${count}</div>
          </div>
          <div style="background: var(--bg-elevated); border: 1px solid var(--glass-border); border-radius: 8px; padding: 10px 14px; flex: 1; min-width: 120px;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Total Words</div>
            <div style="font-size: 18px; font-weight: 700; color: var(--text-primary);">${totalWords.toLocaleString()}</div>
          </div>
          <div style="background: var(--bg-elevated); border: 1px solid var(--glass-border); border-radius: 8px; padding: 10px 14px; flex: 1; min-width: 120px;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Avg Words</div>
            <div style="font-size: 18px; font-weight: 700; color: var(--text-primary);">${avgWords.toLocaleString()}</div>
          </div>
          <div style="background: var(--bg-elevated); border: 1px solid var(--glass-border); border-radius: 8px; padding: 10px 14px; flex: 1; min-width: 120px;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">% of Total</div>
            <div style="font-size: 18px; font-weight: 700; color: ${g.color};">${pct}%</div>
          </div>
        </div>
      </div>`;
    });
    el.innerHTML = html;
  }

  function setupStatsDropdowns() {
    document.querySelectorAll('.stats-dropdown-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const body = document.getElementById(targetId);
        const dropdown = btn.closest('.stats-dropdown');
        if (!body) return;
        const isOpen = !body.hidden;
        body.hidden = isOpen;
        dropdown.classList.toggle('open', !isOpen);
      });
    });
  }

  // ── Mobile Remote & IPC Listeners ───────────────────────
  $('#tpShowQRBtn')?.addEventListener('click', () => {
    if (!serverIP || serverIP === '127.0.0.1') {
      showToast('Connect PC to WiFi first', 'error');
      return;
    }
    const url = `http://${serverIP}:3456/remote`;
    const qrUrlText = $('#qrUrlText');
    const qrCodeContainer = $('#qrCodeContainer');
    
    qrUrlText.textContent = url;
    qrCodeContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}" style="display:block; width:200px; height:200px;" alt="QR Code">`;
    
    $('#qrModal').hidden = false;
  });

  ipcRenderer.on('server-ip', (event, ip) => {
    serverIP = ip;
  });

  ipcRenderer.on('tp-remote-action', (event, action) => {
    const tpOverlay = $('#teleprompterOverlay');
    if (!tpOverlay || tpOverlay.hidden) return; // Only process if teleprompter is open

    if (action === 'playPause') {
      toggleTeleprompterPlay();
    } else if (action === 'exit') {
      closeTeleprompter();
    } else if (action === 'speedUp') {
      let currentSpeed = parseFloat(state.tpSpeed) || 70;
      currentSpeed = Math.min(250, currentSpeed + 10);
      state.tpSpeed = currentSpeed;
      const speedSlider = $('#tpSpeedSlider');
      if (speedSlider) speedSlider.value = currentSpeed;
    } else if (action === 'speedDown') {
      let currentSpeed = parseFloat(state.tpSpeed) || 70;
      currentSpeed = Math.max(10, currentSpeed - 10);
      state.tpSpeed = currentSpeed;
      const speedSlider = $('#tpSpeedSlider');
      if (speedSlider) speedSlider.value = currentSpeed;
    } else if (action === 'scrollUp') {
      const tpScrollArea = $('#tpScrollArea');
      if (tpScrollArea) {
        tpScrollArea.scrollTop = Math.max(0, tpScrollArea.scrollTop - 200);
        tpExactScrollTop = tpScrollArea.scrollTop;
      }
    } else if (action === 'scrollDown') {
      const tpScrollArea = $('#tpScrollArea');
      if (tpScrollArea) {
        tpScrollArea.scrollTop = Math.min(tpScrollArea.scrollHeight, tpScrollArea.scrollTop + 200);
        tpExactScrollTop = tpScrollArea.scrollTop;
      }
    }
  });

  // ── Local Backup & Restore Logic ─────────────────────────────────────────
  function renderDriveDashboard() {
    if (state.driveLastBackup) {
      const d = new Date(state.driveLastBackup);
      $('#localLastBackupText').textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else {
      $('#localLastBackupText').textContent = 'Never';
    }

    // Auto Backup Settings Sync
    if (!state.autoBackup) {
      state.autoBackup = { enabled: false, frequency: 60, folderPath: null };
    }
    const abToggle = $('#autoBackupToggle');
    const abFreq = $('#autoBackupFrequency');
    const abFolderDisplay = $('#autoBackupFolderDisplay');
    const abSettingsArea = $('#autoBackupSettingsArea');
    if (abToggle) {
      abToggle.checked = state.autoBackup.enabled;
      abFreq.value = state.autoBackup.frequency.toString();
      abFolderDisplay.textContent = state.autoBackup.folderPath || 'Not selected';
      abFolderDisplay.title = state.autoBackup.folderPath || 'Not selected';
      abSettingsArea.style.display = state.autoBackup.enabled ? 'grid' : 'none';
    }
  }

  function showBackupOverlay(title, text) {
    $('#backupProgressOverlay').style.display = 'flex';
    $('#backupProgressTitle').textContent = title;
    $('#backupProgressText').textContent = text;
    $('#backupProgressBar').style.width = '0%';
    $('#backupCloseBtn').style.display = 'none';
    $('#backupSpinner').style.display = 'block';
  }

  $('#backupCloseBtn')?.addEventListener('click', () => {
    $('#backupProgressOverlay').style.display = 'none';
  });

  // -- Auto Backup UI Listeners --
  $('#autoBackupToggle')?.addEventListener('change', (e) => {
    if (!state.autoBackup) state.autoBackup = { enabled: false, frequency: 60, folderPath: null };
    state.autoBackup.enabled = e.target.checked;
    $('#autoBackupSettingsArea').style.display = state.autoBackup.enabled ? 'grid' : 'none';
    save();
    initAutoBackup();
    if (state.autoBackup.enabled && !state.autoBackup.folderPath) {
      showToast('Please select a backup folder', 'error');
    } else if (state.autoBackup.enabled) {
      showToast('Auto Backup enabled', 'success');
    }
  });

  $('#autoBackupFrequency')?.addEventListener('change', (e) => {
    if (!state.autoBackup) state.autoBackup = { enabled: false, frequency: 60, folderPath: null };
    state.autoBackup.frequency = parseInt(e.target.value, 10) || 60;
    save();
    initAutoBackup();
    showToast('Backup frequency updated', 'success');
  });

  $('#selectAutoBackupFolderBtn')?.addEventListener('click', async () => {
    try {
      const folder = await ipcRenderer.invoke('select-backup-folder');
      if (folder) {
        if (!state.autoBackup) state.autoBackup = { enabled: false, frequency: 60, folderPath: null };
        state.autoBackup.folderPath = folder;
        const disp = $('#autoBackupFolderDisplay');
        if (disp) {
          disp.textContent = folder;
          disp.title = folder;
        }
        save();
        initAutoBackup();
        showToast('Backup folder set', 'success');
      }
    } catch (err) {
      console.error('Failed to select folder:', err);
    }
  });

  $('#createBackupBtn')?.addEventListener('click', async () => {
    try {
      showBackupOverlay('Creating Backup...', 'Please choose where to save your backup file.');
      
      const res = await ipcRenderer.invoke('create-backup', state);
      if (res.canceled) {
        $('#backupProgressOverlay').style.display = 'none';
        return;
      }
      
      if (res.success) {
        $('#backupProgressBar').style.width = '100%';
        $('#backupProgressTitle').textContent = 'Success!';
        $('#backupProgressText').textContent = 'Your backup has been saved successfully.';
        $('#backupSpinner').style.display = 'none';
        $('#backupCloseBtn').style.display = 'inline-block';
        
        state.driveLastBackup = new Date().toISOString();
        save();
        renderDriveDashboard();
      } else {
        throw new Error(res.error);
      }
    } catch (e) {
      console.error(e);
      $('#backupProgressBar').style.width = '0%';
      $('#backupProgressTitle').textContent = 'Error';
      $('#backupProgressText').textContent = e.message || 'Failed to create backup.';
      $('#backupSpinner').style.display = 'none';
      $('#backupCloseBtn').style.display = 'inline-block';
    }
  });

  $('#restoreBackupBtn')?.addEventListener('click', async () => {
    try {
      showBackupOverlay('Importing Backup...', 'Please select your .smbackup file.');
      
      const res = await ipcRenderer.invoke('restore-backup');
      if (res.canceled) {
        $('#backupProgressOverlay').style.display = 'none';
        return;
      }
      
      if (res.success && res.data) {
        $('#backupProgressBar').style.width = '100%';
        $('#backupProgressTitle').textContent = 'Success!';
        $('#backupProgressText').textContent = 'Your backup has been restored. Reloading...';
        $('#backupSpinner').style.display = 'none';
        
        // Parse the restored data and overwrite state
        const restoredState = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (restoredState && Array.isArray(restoredState.scripts)) {
          state.scripts = restoredState.scripts;
          state.theme = restoredState.theme || state.theme;
          // Apply theme right away
          document.documentElement.dataset.theme = state.theme;
          save(); // Save to local storage
          
          setTimeout(() => {
            $('#backupProgressOverlay').style.display = 'none';
            render();
            showToast('Backup restored successfully!', 'success');
          }, 1500);
        } else {
          throw new Error('Invalid backup file format.');
        }
      } else {
        throw new Error(res.error || 'Failed to restore backup.');
      }
    } catch (e) {
      console.error(e);
      $('#backupProgressBar').style.width = '0%';
      $('#backupProgressTitle').textContent = 'Error';
      $('#backupProgressText').textContent = e.message || 'Failed to read backup file.';
      $('#backupSpinner').style.display = 'none';
      $('#backupCloseBtn').style.display = 'inline-block';
    }
  });

  function setupSidebarToggle() {
    const toggleBtn = $('#toggleSidebarsBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('sidebars-hidden');
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      init();
      setupToolsSidebar();
      setupSidebarToggle();
      setupStatsDropdowns();
      initRipples();
    } catch (err) {
      fs.writeFileSync('CRASH_REPORT.txt', err.stack || err.message || err.toString());
      alert('App crashed! See CRASH_REPORT.txt');
    }
  });
})();
