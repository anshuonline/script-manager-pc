// editor-mention.js
// Handles the @ mention system in the rich text editor

document.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('editor');
  if (!editor) return;

  // Create the dropdown menu element
  const dropdown = document.createElement('div');
  dropdown.id = 'mentionDropdown';
  dropdown.className = 'mention-dropdown';
  document.body.appendChild(dropdown);

  let isMentioning = false;
  let mentionStartIndex = -1;
  let mentionQuery = '';
  let selectedIndex = 0;

  editor.addEventListener('input', (e) => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    
    // Only process text nodes
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const textContent = textNode.textContent;
    const cursorPos = range.startOffset;

    // Check if user just typed '@' or is currently in a mention
    const lastAtPos = textContent.lastIndexOf('@', cursorPos - 1);
    
    // Ensure the '@' is either at the beginning of the text or preceded by a space/newline
    if (lastAtPos !== -1) {
      const isStartOrSpaced = lastAtPos === 0 || /\s/.test(textContent.charAt(lastAtPos - 1));
      
      if (isStartOrSpaced) {
        const query = textContent.substring(lastAtPos + 1, cursorPos);
        
        // If there's a space after '@', cancel mention mode
        if (/\s/.test(query)) {
          closeDropdown();
        } else {
          isMentioning = true;
          mentionStartIndex = lastAtPos;
          mentionQuery = query;
          showDropdown(range);
        }
      } else {
        closeDropdown();
      }
    } else {
      closeDropdown();
    }
  });

  editor.addEventListener('keydown', (e) => {
    if (!isMentioning) return;

    const items = dropdown.querySelectorAll('.mention-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedItem = items[selectedIndex];
      if (selectedItem) {
        insertMention(selectedItem.dataset.id, selectedItem.dataset.name, selectedItem.dataset.color);
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  function showDropdown(range) {
    if (!window.CharacterSystem) return;
    
    const chars = window.CharacterSystem.getCharacters();
    const filtered = chars.filter(c => c.name.toLowerCase().includes(mentionQuery.toLowerCase()));

    if (filtered.length === 0) {
      closeDropdown();
      return;
    }

    dropdown.innerHTML = '';
    filtered.forEach((char, index) => {
      const item = document.createElement('div');
      item.className = 'mention-item' + (index === selectedIndex ? ' selected' : '');
      item.dataset.id = char.id;
      item.dataset.name = char.name;
      item.dataset.color = char.color;
      
      const initial = char.name.charAt(0).toUpperCase();
      item.innerHTML = `
        <div class="character-avatar" style="background: ${char.color}; width: 24px; height: 24px; font-size: 10px;">${initial}</div>
        <span>${char.name}</span>
      `;
      
      item.onmousedown = (e) => {
        e.preventDefault(); // Prevent blur
        insertMention(char.id, char.name, char.color);
      };
      
      dropdown.appendChild(item);
    });

    // Position dropdown below cursor
    const rect = range.getBoundingClientRect();
    dropdown.style.display = 'block';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 5}px`;
  }

  function updateSelection(items) {
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  function insertMention(id, name, color) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    
    // Create the tag element
    const tag = document.createElement('span');
    tag.className = 'character-tag';
    tag.dataset.charId = id;
    tag.textContent = `@${name}`;
    tag.style.backgroundColor = color + '22'; // 22 is hex for ~13% opacity
    tag.style.color = color;
    tag.contentEditable = 'false'; // Keep tag atomic

    // Remove the typed '@query' text
    const textContent = textNode.textContent;
    const beforeText = textContent.substring(0, mentionStartIndex);
    const afterText = textContent.substring(range.startOffset);

    // Replace the text node
    const parent = textNode.parentNode;
    const beforeNode = document.createTextNode(beforeText);
    const afterNode = document.createTextNode(afterText + ' '); // Add space after mention
    
    parent.insertBefore(beforeNode, textNode);
    parent.insertBefore(tag, textNode);
    parent.insertBefore(afterNode, textNode);
    parent.removeChild(textNode);

    // Move cursor after the inserted mention
    range.setStart(afterNode, 1);
    range.setEnd(afterNode, 1);
    selection.removeAllRanges();
    selection.addRange(range);

    closeDropdown();
    
    // Trigger input event to update app state (e.g. mark as modified)
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function closeDropdown() {
    isMentioning = false;
    dropdown.style.display = 'none';
    selectedIndex = 0;
  }

  // Close dropdown if clicking outside
  document.addEventListener('mousedown', (e) => {
    if (isMentioning && !dropdown.contains(e.target) && e.target !== editor) {
      closeDropdown();
    }
  });
});
