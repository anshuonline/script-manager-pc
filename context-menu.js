// context-menu.js — Standalone Context Menu for Script Manager
// Loaded AFTER app.js. Uses event delegation so #editor doesn't need to exist at init time.
// Communicates with app.js via window._smBridge for save/update operations.
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const PART_COLORS = ['#6e6aff', '#ff9f43', '#2ed573', '#ff6b81', '#1e90ff'];
  let partCounter = 0; // incremented each time a part is created in this session

  // ---------------------------------------------------------------------------
  // 1. Inject Styles
  // ---------------------------------------------------------------------------

  const style = document.createElement('style');
  style.textContent = /* css */ `
    /* ---- Context Menu ---- */
    #ctxMenu {
      position: fixed;
      z-index: 999999;
      min-width: 210px;
      padding: 6px 0;
      background: rgba(20, 20, 30, 0.95);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.45),
        0 2px 8px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.04);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #e0e0e0;
      opacity: 0;
      transform: scale(0.95);
      transform-origin: top left;
      pointer-events: none;
      transition: opacity 0.15s ease, transform 0.15s ease;
      user-select: none;
    }

    #ctxMenu.ctx-visible {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }

    .ctx-item {
      padding: 10px 16px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.12s ease, color 0.12s ease;
      border-radius: 0;
    }

    .ctx-item:first-child { border-radius: 6px 6px 0 0; }
    .ctx-item:last-child  { border-radius: 0 0 6px 6px; }

    .ctx-item:hover {
      background: rgba(110, 106, 255, 0.15);
      color: #fff;
    }

    .ctx-item.ctx-danger {
      color: #ff6b81;
    }

    .ctx-item.ctx-danger:hover {
      background: rgba(255, 107, 129, 0.15);
      color: #ff6b81;
    }

    .ctx-separator {
      height: 1px;
      margin: 5px 12px;
      background: rgba(255, 255, 255, 0.06);
    }

    /* ---- Make-Part Prompt Modal ---- */
    #ctxPartOverlay {
      position: fixed;
      inset: 0;
      z-index: 1000000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }

    #ctxPartOverlay.ctx-modal-visible {
      opacity: 1;
      pointer-events: auto;
    }

    #ctxPartModal, #ctxErrorModal {
      width: 360px;
      padding: 24px;
      background: rgba(26, 26, 40, 0.97);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      box-shadow:
        0 12px 48px rgba(0, 0, 0, 0.5),
        0 4px 12px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.05);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e0e0e0;
      transform: scale(0.92) translateY(8px);
      transition: transform 0.2s ease, opacity 0.2s ease;
      opacity: 0;
    }

    #ctxErrorOverlay {
      position: fixed;
      inset: 0;
      z-index: 1000000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }
    #ctxErrorOverlay.ctx-modal-visible {
      opacity: 1;
      pointer-events: auto;
    }
    #ctxErrorModal h3 {
      color: #ff6b81;
    }
    #ctxErrorMessage {
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 20px;
    }


    #ctxPartOverlay.ctx-modal-visible #ctxPartModal,
    #ctxErrorOverlay.ctx-modal-visible #ctxErrorModal {
      transform: scale(1) translateY(0);
      opacity: 1;
    }

    #ctxPartModal h3, #ctxErrorModal h3 {
      margin: 0 0 16px;
      font-size: 15px;
      font-weight: 600;
      color: #fff;
    }

    #ctxPartInput {
      width: 100%;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      color: #f0f0f0;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
      box-sizing: border-box;
    }

    #ctxPartInput:focus {
      border-color: rgba(110, 106, 255, 0.5);
      box-shadow: 0 0 0 3px rgba(110, 106, 255, 0.15);
    }

    .ctx-modal-btns {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 18px;
    }

    .ctx-modal-btn {
      padding: 8px 20px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease;
    }

    .ctx-modal-btn:active { transform: scale(0.97); }

    .ctx-modal-btn-cancel {
      background: rgba(255, 255, 255, 0.07);
      color: #aaa;
    }

    .ctx-modal-btn-cancel:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ccc;
    }

    .ctx-modal-btn-ok {
      background: #6e6aff;
      color: #fff;
    }

    .ctx-modal-btn-ok:hover {
      background: #5b57e0;
    }
  `;
  document.head.appendChild(style);

  // ---------------------------------------------------------------------------
  // 2. Create Context Menu DOM
  // ---------------------------------------------------------------------------

  const menu = document.createElement('div');
  menu.id = 'ctxMenu';
  document.body.appendChild(menu);

  // ---------------------------------------------------------------------------
  // 3. Create Make-Part Prompt Modal DOM
  // ---------------------------------------------------------------------------

  const overlay = document.createElement('div');
  overlay.id = 'ctxPartOverlay';
  overlay.innerHTML = `
    <div id="ctxPartModal">
      <h3>Name this Part</h3>
      <input id="ctxPartInput" type="text" spellcheck="false" autocomplete="off" />
      <div class="ctx-modal-btns">
        <button class="ctx-modal-btn ctx-modal-btn-cancel" id="ctxPartCancel">Cancel</button>
        <button class="ctx-modal-btn ctx-modal-btn-ok" id="ctxPartOk">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const partInput = document.getElementById('ctxPartInput');
  const partBtnOk = document.getElementById('ctxPartOk');
  const partBtnCancel = document.getElementById('ctxPartCancel');

  const errorOverlay = document.createElement('div');
  errorOverlay.id = 'ctxErrorOverlay';
  errorOverlay.innerHTML = `
    <div id="ctxErrorModal">
      <h3>Wait!</h3>
      <p id="ctxErrorMessage"></p>
      <div class="ctx-modal-btns">
        <button class="ctx-modal-btn ctx-modal-btn-ok" id="ctxErrorOk">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(errorOverlay);

  const errorMsg = document.getElementById('ctxErrorMessage');
  const errorBtnOk = document.getElementById('ctxErrorOk');

  function showErrorPrompt(msg) {
    errorMsg.textContent = msg;
    errorOverlay.classList.add('ctx-modal-visible');
  }

  function hideErrorPrompt() {
    errorOverlay.classList.remove('ctx-modal-visible');
  }
  
  errorBtnOk.addEventListener('click', hideErrorPrompt);

  // ---------------------------------------------------------------------------
  // 4. Utility helpers
  // ---------------------------------------------------------------------------

  /** Generate a short random id like "part-a3f9c" */
  function uid() {
    return 'part-' + Math.random().toString(36).substring(2, 7);
  }

  /** Find the closest <td> or <th> ancestor of a node, within the editor */
  function closestCell(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el.id !== 'editor') {
      if (el.tagName === 'TD' || el.tagName === 'TH') return el;
      el = el.parentElement;
    }
    return null;
  }

  /** Find the closest <table> ancestor of a node, within the editor */
  function closestTable(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el.id !== 'editor') {
      if (el.tagName === 'TABLE') return el;
      el = el.parentElement;
    }
    return null;
  }



  // ---------------------------------------------------------------------------
  // 5. Menu show / hide
  // ---------------------------------------------------------------------------

  function showMenu(x, y, insideTable) {
    // Build menu items
    const items = [
      { label: 'Make Part',          action: 'makePart' },
      { label: 'Highlight',          action: 'highlight' },
      { label: 'Remove Highlight',   action: 'removeHighlight' },
      { label: 'Toggle Case',        action: 'toggleCase' },
      { label: 'Clear Formatting',   action: 'clearFormatting' },
    ];

    if (insideTable) {
      items.push({ separator: true });
      items.push({ label: 'Insert Row Above',    action: 'insertRowAbove' });
      items.push({ label: 'Insert Row Below',     action: 'insertRowBelow' });
      items.push({ label: 'Insert Column Left',   action: 'insertColLeft' });
      items.push({ label: 'Insert Column Right',  action: 'insertColRight' });
      items.push({ label: 'Delete Row',           action: 'deleteRow',    danger: true });
      items.push({ label: 'Delete Column',        action: 'deleteCol',    danger: true });
    }

    menu.innerHTML = items.map(it => {
      if (it.separator) return '<div class="ctx-separator"></div>';
      const cls = 'ctx-item' + (it.danger ? ' ctx-danger' : '');
      return `<div class="${cls}" data-action="${it.action}">${it.label}</div>`;
    }).join('');

    // Position — keep within viewport
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.classList.add('ctx-visible');

    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let finalX = x;
    let finalY = y;
    if (x + mw > vw - 8) finalX = vw - mw - 8;
    if (y + mh > vh - 8) finalY = vh - mh - 8;
    if (finalX < 4) finalX = 4;
    if (finalY < 4) finalY = 4;

    menu.style.left = finalX + 'px';
    menu.style.top = finalY + 'px';
  }

  function hideMenu() {
    menu.classList.remove('ctx-visible');
  }

  // ---------------------------------------------------------------------------
  // 6. Part Prompt Modal
  // ---------------------------------------------------------------------------

  let savedRange = null; // the selection range at the moment the user right-clicked

  function showPartPrompt(defaultName) {
    partInput.value = defaultName;
    overlay.classList.add('ctx-modal-visible');
    // Defer focus so the animation has started
    requestAnimationFrame(() => {
      partInput.focus();
      partInput.select();
    });
  }

  function hidePartPrompt() {
    overlay.classList.remove('ctx-modal-visible');
  }

  function confirmPart() {
    const name = partInput.value.trim() || ('Part ' + partCounter);
    hidePartPrompt();
    wrapSelectionAsPart(name);
  }

  partBtnOk.addEventListener('click', confirmPart);
  partBtnCancel.addEventListener('click', hidePartPrompt);

  partInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); confirmPart(); }
    if (e.key === 'Escape') { e.preventDefault(); hidePartPrompt(); }
  });

  overlay.addEventListener('mousedown', function (e) {
    if (e.target === overlay) hidePartPrompt();
  });

  // ---------------------------------------------------------------------------
  // 7. Actions
  // ---------------------------------------------------------------------------

  /** Save the current selection range for later use */
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange = sel.getRangeAt(0).cloneRange();
    } else {
      savedRange = null;
    }
  }

  /** Restore a previously saved selection range */
  function restoreSelection() {
    if (!savedRange) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  }

  /** Wrap the saved selection in a .script-part div */
  function wrapSelectionAsPart(name) {
    if (!restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const colorIndex = (partCounter++ % PART_COLORS.length);
    const color = PART_COLORS[colorIndex];
    const id = uid();

    const wrapper = document.createElement('div');
    wrapper.className = 'script-part';
    wrapper.id = id;
    wrapper.setAttribute('data-part-name', name);
    wrapper.setAttribute('data-part-color', String(colorIndex + 1));

    try {
      range.surroundContents(wrapper);
    } catch (_err) {
      // surroundContents fails if the selection crosses element boundaries,
      // fall back to extracting and re-inserting
      const fragment = range.extractContents();
      wrapper.appendChild(fragment);
      range.insertNode(wrapper);
    }

    sel.removeAllRanges();

    // Notify app.js via bridge
    if (window._smBridge) {
      if (typeof window._smBridge.saveEditor === 'function') window._smBridge.saveEditor();
      if (typeof window._smBridge.updateParts === 'function') window._smBridge.updateParts();
    }
  }

  /** Apply a yellow highlight to the current selection */
  function applyHighlight() {
    if (!restoreSelection()) return;
    document.execCommand('hiliteColor', false, '#ffe066');
  }

  /** Remove highlight (background color) from current selection */
  function removeHighlight() {
    if (!restoreSelection()) return;
    document.execCommand('hiliteColor', false, 'transparent');
  }

  /** Toggle case: if all-uppercase → lowercase, otherwise → uppercase */
  function toggleCase() {
    if (!restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const text = sel.toString();
    if (!text) return;

    const toggled = (text === text.toUpperCase()) ? text.toLowerCase() : text.toUpperCase();
    document.execCommand('insertText', false, toggled);
  }

  /** Remove all formatting from current selection */
  function clearFormatting() {
    if (!restoreSelection()) return;
    document.execCommand('removeFormat', false, null);
  }

  // ---- Table helpers ----

  /** Get the cell, row, table, and column index for the right-click target */
  function getTableContext(target) {
    const cell = closestCell(target);
    if (!cell) return null;
    const row = cell.parentElement;
    const table = closestTable(cell);
    if (!table || !row) return null;
    const colIndex = Array.from(row.children).indexOf(cell);
    const rowIndex = Array.from(table.rows).indexOf(row);
    return { cell, row, table, colIndex, rowIndex };
  }

  function insertRowAbove(target) {
    const ctx = getTableContext(target);
    if (!ctx) return;
    const newRow = ctx.table.insertRow(ctx.rowIndex);
    for (let i = 0; i < ctx.row.cells.length; i++) {
      const td = newRow.insertCell();
      td.innerHTML = '&nbsp;';
    }
    bridgeSave();
  }

  function insertRowBelow(target) {
    const ctx = getTableContext(target);
    if (!ctx) return;
    const newRow = ctx.table.insertRow(ctx.rowIndex + 1);
    for (let i = 0; i < ctx.row.cells.length; i++) {
      const td = newRow.insertCell();
      td.innerHTML = '&nbsp;';
    }
    bridgeSave();
  }

  function insertColLeft(target) {
    const ctx = getTableContext(target);
    if (!ctx) return;
    for (const row of ctx.table.rows) {
      const td = row.insertCell(ctx.colIndex);
      td.innerHTML = '&nbsp;';
    }
    bridgeSave();
  }

  function insertColRight(target) {
    const ctx = getTableContext(target);
    if (!ctx) return;
    for (const row of ctx.table.rows) {
      const insertAt = Math.min(ctx.colIndex + 1, row.cells.length);
      const td = row.insertCell(insertAt);
      td.innerHTML = '&nbsp;';
    }
    bridgeSave();
  }

  function deleteRow(target) {
    const ctx = getTableContext(target);
    if (!ctx) return;
    // Don't delete the last row
    if (ctx.table.rows.length <= 1) return;
    ctx.table.deleteRow(ctx.rowIndex);
    bridgeSave();
  }

  function deleteCol(target) {
    const ctx = getTableContext(target);
    if (!ctx) return;
    // Don't delete the last column
    if (ctx.row.cells.length <= 1) return;
    for (const row of ctx.table.rows) {
      if (ctx.colIndex < row.cells.length) {
        row.deleteCell(ctx.colIndex);
      }
    }
    bridgeSave();
  }

  /** Convenience: call saveEditor on the bridge if available */
  function bridgeSave() {
    if (window._smBridge && typeof window._smBridge.saveEditor === 'function') {
      window._smBridge.saveEditor();
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Event delegation — contextmenu on document (capture phase)
  // ---------------------------------------------------------------------------

  let contextTarget = null; // the element that was right-clicked

  document.addEventListener('contextmenu', function (e) {
    const editor = document.getElementById('editor');
    if (!editor || !editor.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    contextTarget = e.target;
    saveSelection();

    const insideTable = !!closestTable(e.target);
    showMenu(e.clientX, e.clientY, insideTable);
  }, true); // capture phase so we intercept before anything else

  // ---------------------------------------------------------------------------
  // 9. Handle menu item clicks
  // ---------------------------------------------------------------------------

  menu.addEventListener('click', function (e) {
    const item = e.target.closest('.ctx-item');
    if (!item) return;

    const action = item.dataset.action;
    hideMenu();

    switch (action) {
      case 'makePart': {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          showErrorPrompt("Please select some text first.");
          break;
        }

        const range = sel.getRangeAt(0);

        // Check if selection is already inside a part
        let node = range.commonAncestorContainer;
        if (node.nodeType === 3) node = node.parentElement;
        const insidePart = node.closest('.script-part');

        // Check if selection contains a part
        const containsPart = range.cloneContents().querySelector('.script-part');

        if (insidePart || containsPart) {
          showErrorPrompt("Some selected text is already in another part. Please select text outside existing parts to make a new part.");
          break;
        }

        // Count existing parts to suggest a default name
        const editor = document.getElementById('editor');
        const existing = editor ? editor.querySelectorAll('.script-part').length : 0;
        showPartPrompt('Part ' + (existing + 1));
        break;
      }
      case 'highlight':
        applyHighlight();
        bridgeSave();
        break;
      case 'removeHighlight':
        removeHighlight();
        bridgeSave();
        break;
      case 'toggleCase':
        toggleCase();
        bridgeSave();
        break;
      case 'clearFormatting':
        clearFormatting();
        bridgeSave();
        break;
      case 'insertRowAbove':
        insertRowAbove(contextTarget);
        break;
      case 'insertRowBelow':
        insertRowBelow(contextTarget);
        break;
      case 'insertColLeft':
        insertColLeft(contextTarget);
        break;
      case 'insertColRight':
        insertColRight(contextTarget);
        break;
      case 'deleteRow':
        deleteRow(contextTarget);
        break;
      case 'deleteCol':
        deleteCol(contextTarget);
        break;
    }
  });

  // ---------------------------------------------------------------------------
  // 10. Close menu on outside click / Escape
  // ---------------------------------------------------------------------------

  document.addEventListener('mousedown', function (e) {
    if (!menu.contains(e.target)) hideMenu();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideMenu();
  }, true);

  // Also close on window blur / scroll
  window.addEventListener('blur', hideMenu);
  window.addEventListener('scroll', hideMenu, true);

  // ---------------------------------------------------------------------------
  // 11. Signal readiness
  // ---------------------------------------------------------------------------

  window._ctxMenuReady = true;

})();
