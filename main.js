const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { startSyncServer, stopSyncServer, getLocalIP } = require('./sync-server');

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
    icon: path.join(__dirname, 'icon.ico'),
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

  // Load the app
  mainWindow.loadFile('index.html');

  // Show window when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Start the WiFi sync server for mobile app connectivity
    const serverInfo = startSyncServer(mainWindow);
    const ip = getLocalIP();
    console.log(`[Script Manager] Sync server started at http://${ip}:3456`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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
