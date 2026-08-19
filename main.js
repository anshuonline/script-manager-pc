const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { startSyncServer, stopSyncServer, getLocalIP } = require('./sync-server');
const JSZip = require('jszip');

// Keep a global reference to prevent garbage collection
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Script Manager',
    backgroundColor: '#08080d',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    // Frameless with custom titlebar feel — but keep native controls
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon1.ico'),
  });

  // Force external links to open in the user's default browser (e.g., Chrome)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Remove the default menu bar
  Menu.setApplicationMenu(null);

  // Native Context Menu (Copy, Paste, Spell Check)
  mainWindow.webContents.on('context-menu', (event, params) => {
    const { selectionText, isEditable } = params;
    const template = [];

    // Spelling suggestions
    if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
      params.dictionarySuggestions.forEach(suggestion => {
        template.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion)
        });
      });
      template.push({ type: 'separator' });
      template.push({
        label: 'Add to Dictionary',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      template.push({ type: 'separator' });
    }

    if (isEditable) {
      template.push({ role: 'undo' });
      template.push({ role: 'redo' });
      template.push({ type: 'separator' });
      template.push({ role: 'cut' });
    }
    
    if (selectionText || isEditable) {
      template.push({ role: 'copy' });
    }

    if (isEditable) {
      template.push({ role: 'paste' });
      template.push({ role: 'pasteAndMatchStyle' });
      
      template.push({ type: 'separator' });
      
      if (selectionText && selectionText.trim() !== '') {
        template.push({
          label: '🎬 Make Part',
          click: () => mainWindow.webContents.send('context-menu-action', 'make-part')
        });
        template.push({
          label: '🖍️ Highlight Yellow',
          click: () => mainWindow.webContents.send('context-menu-action', 'highlight')
        });
        template.push({
          label: 'Aa Toggle Case',
          click: () => mainWindow.webContents.send('context-menu-action', 'case-toggle')
        });
        template.push({
          label: 'T✕ Clear Formatting',
          click: () => mainWindow.webContents.send('context-menu-action', 'clear-format')
        });
        template.push({ type: 'separator' });
      }
      
      template.push({
        label: '📽️ Insert B-Roll Marker',
        click: () => mainWindow.webContents.send('context-menu-action', 'insert-broll')
      });
    }
    
    template.push({ type: 'separator' });
    template.push({ role: 'selectAll' });

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow, x: params.x, y: params.y });
  });

  // Load the app
  mainWindow.loadFile('index.html');

  // Show window when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Start the WiFi sync server for mobile app connectivity
    const serverInfo = startSyncServer(mainWindow);
    const ip = getLocalIP();
    console.log(`[Script Manager] Sync server started at http://${ip}:3456`);
    mainWindow.webContents.send('server-ip', ip);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Local Backup & Restore Handlers ──
ipcMain.handle('create-backup', async (event, stateData) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Script Manager Backup',
      defaultPath: 'ScriptManager_Backup.smbackup',
      filters: [{ name: 'Script Manager Backup', extensions: ['smbackup'] }]
    });

    if (canceled) {
      return { success: false, canceled: true };
    }

    const zip = new JSZip();
    
    // Add data.json
    zip.file('data.json', JSON.stringify(stateData));
    
    // Include images from the user's data folder if they exist
    const userDataPath = path.join(process.env.APPDATA || process.env.USERPROFILE, 'ScriptManagerData');
    if (fs.existsSync(userDataPath)) {
      const files = fs.readdirSync(userDataPath);
      for (const file of files) {
        if (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg')) {
          const content = fs.readFileSync(path.join(userDataPath, file));
          zip.file(file, content);
        }
      }
    }

    // Generate zip content
    const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    
    // Write to selected path
    fs.writeFileSync(filePath, content);

    return { success: true };
  } catch (err) {
    console.error('Backup Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('restore-backup', async (event) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Script Manager Backup',
      filters: [{ name: 'Script Manager Backup', extensions: ['smbackup'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const backupPath = filePaths[0];
    const buffer = fs.readFileSync(backupPath);
    const zip = await JSZip.loadAsync(buffer);

    // Read data.json
    const dataFile = zip.file('data.json');
    if (!dataFile) {
      return { success: false, error: 'Invalid backup file: data.json is missing.' };
    }
    const stateJson = await dataFile.async('string');

    // Restore images to the userdata path
    const userDataPath = path.join(process.env.APPDATA || process.env.USERPROFILE, 'ScriptManagerData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    const files = Object.keys(zip.files);
    for (const fileName of files) {
      if (fileName !== 'data.json' && !zip.files[fileName].dir) {
        const fileContent = await zip.file(fileName).async('nodebuffer');
        fs.writeFileSync(path.join(userDataPath, fileName), fileContent);
      }
    }

    return { success: true, data: stateJson };
  } catch (err) {
    console.error('Restore Error:', err);
    return { success: false, error: err.message };
  }
});

// IPC handler for printing to PDF to get native preview
ipcMain.on('print-to-pdf', async (event, title) => {
  try {
    const safeTitle = (title || 'Script').replace(/[<>:"/\\|?*]/g, '_');
    
    // Prompt the user for the save location
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: `${safeTitle}.pdf`,
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) return;

    const data = await mainWindow.webContents.printToPDF({
      marginsType: 0,
      pageSize: 'A4',
      printBackground: false,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>', // Empty header
      footerTemplate: `
        <div style="font-size: 11px; font-family: 'Inter', sans-serif; color: #666; width: 100%; padding: 0 40px; display: flex; justify-content: space-between;">
          <span>created with script manager made with love in India by Rajdeep</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `,
      printSelectionOnly: false,
      landscape: false
    });
    fs.writeFileSync(filePath, data);
    // Open the PDF using the system default viewer (which has native print preview)
    shell.openPath(filePath);
  } catch (error) {
    console.error('Failed to print to PDF:', error);
  }
});

// App lifecycle
// Explicitly set the App User Model ID so Windows Taskbar pins remain across updates
app.setAppUserModelId("com.scriptmanager.app");

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopSyncServer();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
