// characters.js
// Handles the Character System UI inside the Tools Sidebar

let currentCharacterId = null;
let networkInstance = null;

function getActiveScriptCharacters() {
  if (!window.appState || !window.appState.activeScriptId) return [];
  const script = window.appState.scripts.find(s => s.id === window.appState.activeScriptId);
  if (!script) return [];
  if (!script.characters) script.characters = [];
  return script.characters;
}

function saveCharacters() {
  if (window.saveState) {
    window.saveState();
  }
}

function generateId() {
  return 'char_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function initCharacterSystem() {
  const addBtn = document.getElementById('addCharacterBtn');
  const backBtn = document.getElementById('backToCharListBtn');
  const openNodeBtn = document.getElementById('openNodeGraphBtn');
  const closeNodeBtn = document.getElementById('closeNodeGraphBtn');

  if (addBtn) {
    addBtn.onclick = () => {
      const chars = getActiveScriptCharacters();
      const newChar = {
        id: generateId(),
        name: 'New Character',
        role: '',
        age: '',
        color: '#6e6aff',
        description: '',
        relationships: []
      };
      chars.push(newChar);
      saveCharacters();
      
      currentCharacterId = newChar.id;
      showDetailPanel();
    };
  }

  if (backBtn) {
    backBtn.onclick = hideDetailPanel;
  }

  if (openNodeBtn) {
    openNodeBtn.onclick = showNodeGraphModal;
  }

  if (closeNodeBtn) {
    closeNodeBtn.onclick = () => {
      document.getElementById('nodeGraphModal').hidden = true;
      if (networkInstance) {
        networkInstance.destroy();
        networkInstance = null;
      }
    };
  }

  // Hook into app's script selection to re-render characters
  const originalSelectScript = window.selectScript;
  if (typeof originalSelectScript === 'function' && !window.charSystemHooked) {
    window.charSystemHooked = true;
    window.selectScript = function(id) {
      originalSelectScript(id);
      hideDetailPanel();
      renderCharactersList();
    };
  }
}

function showDetailPanel() {
  document.getElementById('characterDetailPanel').style.display = 'flex';
  renderCharacterContent();
}

function hideDetailPanel() {
  document.getElementById('characterDetailPanel').style.display = 'none';
  currentCharacterId = null;
  renderCharactersList();
}

function renderCharactersList() {
  const listEl = document.getElementById('charactersList');
  if (!listEl) return;
  
  const chars = getActiveScriptCharacters();
  listEl.innerHTML = '';

  if (chars.length === 0) {
    listEl.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted); font-size: 12px;">No characters in this script yet.</div>';
  }

  chars.forEach(char => {
    const item = document.createElement('div');
    item.className = 'character-item';
    item.style.padding = '8px';
    item.onclick = () => {
      currentCharacterId = char.id;
      showDetailPanel();
    };
    
    const initial = char.name ? char.name.charAt(0).toUpperCase() : '?';
    
    item.innerHTML = `
      <div class="character-avatar" style="background: ${char.color}; width: 28px; height: 28px; font-size: 12px;">${initial}</div>
      <div class="character-info">
        <div class="character-name" style="font-size: 13px;">${char.name}</div>
        <div class="character-role" style="font-size: 11px;">${char.role || 'No role'}</div>
      </div>
    `;
    listEl.appendChild(item);
  });
}

function renderCharacterContent() {
  const contentEl = document.getElementById('charContent');
  if (!contentEl) return;

  const chars = getActiveScriptCharacters();
  const char = chars.find(c => c.id === currentCharacterId);
  
  if (!char) {
    hideDetailPanel();
    return;
  }

  contentEl.innerHTML = `
    <div class="form-group" style="margin-bottom: 12px;">
      <label>Name</label>
      <input type="text" id="charName" class="form-control" value="${char.name || ''}">
    </div>
    <div class="form-group" style="margin-bottom: 12px;">
      <label>Color</label>
      <input type="color" id="charColor" class="form-control" value="${char.color || '#6e6aff'}" style="height: 32px; padding: 0;">
    </div>
    <div class="form-group" style="margin-bottom: 12px;">
      <label>Role</label>
      <input type="text" id="charRole" class="form-control" value="${char.role || ''}">
    </div>
    <div class="form-group" style="margin-bottom: 12px;">
      <label>Age</label>
      <input type="text" id="charAge" class="form-control" value="${char.age || ''}">
    </div>
    <div class="form-group" style="margin-bottom: 16px;">
      <label>Bio</label>
      <textarea id="charDesc" class="form-control" style="min-height: 80px;">${char.description || ''}</textarea>
    </div>
    
    <hr style="border:0; border-top:1px solid var(--border); margin: 16px 0;">
    
    <div class="form-group" style="margin-bottom: 12px;">
      <label>Add Relationship</label>
      <select id="relTarget" class="form-control" style="margin-bottom: 6px;">
        <option value="">Select character...</option>
        ${chars.filter(c => c.id !== char.id).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
      <select id="relType" class="form-control" style="margin-bottom: 6px;">
        <option value="friend">Friend / Ally</option>
        <option value="enemy">Enemy / Rival</option>
        <option value="relative">Relative / Family</option>
        <option value="romantic">Romantic</option>
        <option value="other">Other</option>
      </select>
      <button id="addRelBtn" class="btn-secondary" style="font-size: 11px;">Add Connection</button>
    </div>

    <hr style="border:0; border-top:1px solid var(--border); margin: 16px 0;">

    <button id="deleteCharBtn" class="btn-secondary" style="width: 100%; color: #ff6b81; border-color: rgba(255,107,129,0.3);">Delete Character</button>
  `;

  // Auto-save logic on input
  const inputs = ['charName', 'charColor', 'charRole', 'charAge', 'charDesc'];
  inputs.forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      char.name = document.getElementById('charName').value;
      char.color = document.getElementById('charColor').value;
      char.role = document.getElementById('charRole').value;
      char.age = document.getElementById('charAge').value;
      char.description = document.getElementById('charDesc').value;
      saveCharacters();
      
      // Update name in header
      updateCharacterFilter(chars);
    });
  });

  document.getElementById('addRelBtn').onclick = () => {
    const targetId = document.getElementById('relTarget').value;
    const type = document.getElementById('relType').value;
    if (!targetId) return;
    
    char.relationships = char.relationships || [];
    if (!char.relationships.some(r => r.targetId === targetId)) {
      char.relationships.push({ targetId, type });
      saveCharacters();
      if (typeof window.showToast === 'function') window.showToast('Relationship added', 'success');
      renderCharacterContent(); // refresh
    }
  };

  document.getElementById('deleteCharBtn').onclick = () => {
    if (confirm('Delete this character?')) {
      const idx = chars.findIndex(c => c.id === char.id);
      if (idx > -1) chars.splice(idx, 1);
      
      chars.forEach(c => {
        c.relationships = (c.relationships || []).filter(r => r.targetId !== char.id);
      });

      saveCharacters();
      hideDetailPanel();
    }
  };
}

function showNodeGraphModal() {
  try {
    const chars = getActiveScriptCharacters();
    if (chars.length === 0) {
      if (typeof window.showToast === 'function') window.showToast('Add characters first to see the graph', 'info');
      return;
    }

    const modal = document.getElementById('nodeGraphModal');
    if (!modal) {
      if (typeof window.showToast === 'function') window.showToast('Modal element not found', 'error');
      return;
    }
    
    modal.hidden = false;
    
    setTimeout(() => {
      try {
        const container = document.getElementById('characterNetwork');
        if (!container || typeof vis === 'undefined') {
          container.innerHTML = '<div style="padding:20px; color:#fff;">vis-network library is missing or container not found.</div>';
          if (typeof window.showToast === 'function') window.showToast('vis is undefined', 'error');
          return;
        }

        const nodes = chars.map(c => {
          return {
            id: c.id,
            label: c.name,
            shape: 'dot',
            size: 20,
            color: { background: c.color || '#6e6aff', border: '#fff' },
            font: { color: '#fff', size: 14 }
          };
        });

        const edges = [];
        chars.forEach(c => {
          if (c.relationships) {
            c.relationships.forEach(r => {
              let edgeColor = '#888';
              if (r.type === 'enemy') edgeColor = '#ff6b81';
              if (r.type === 'friend') edgeColor = '#2ed573';
              if (r.type === 'romantic') edgeColor = '#ff9ff3';
              if (r.type === 'relative') edgeColor = '#feca57';

              edges.push({
                from: c.id,
                to: r.targetId,
                label: r.type,
                color: edgeColor,
                font: { align: 'middle', color: '#aaa', size: 10 },
                arrows: 'to'
              });
            });
          }
        });

        const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
        const options = {
          physics: { stabilization: false, barnesHut: { springLength: 150 } },
          interaction: { hover: true }
        };

        if (networkInstance) networkInstance.destroy();
        networkInstance = new vis.Network(container, data, options);
      } catch (err) {
        if (typeof window.showToast === 'function') window.showToast('Error in timeout: ' + err.message, 'error');
      }
    }, 100);
  } catch (err) {
    if (typeof window.showToast === 'function') window.showToast('Error opening modal: ' + err.message, 'error');
  }
}

// Hook into the main app initialization
document.addEventListener('DOMContentLoaded', () => {
  initCharacterSystem();
  
  // Make sure to render characters when the app first loads
  setTimeout(renderCharactersList, 500);
});

// Expose for editor-mention.js and inline clicks
window.CharacterSystem = {
  getCharacters: getActiveScriptCharacters
};
window.showNodeGraphModal = showNodeGraphModal;
