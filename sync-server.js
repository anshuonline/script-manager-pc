// ============================================================
// Script Manager — WiFi Sync Server
// Allows mobile app to sync scripts over local network
// ============================================================

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const userDataPath = path.join(process.env.APPDATA || process.env.USERPROFILE, 'ScriptManagerData');
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}
const DATA_FILE = path.join(userDataPath, 'data.json');
const PORT = 3456;

let server = null;
let mainWindowRef = null;

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to read data.json:', e);
  }
  return { scripts: [], editorFontSize: 15, theme: 'dark' };
}

function startSyncServer(mainWindow) {
  mainWindowRef = mainWindow;
  
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // ── Health Check ──
  app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', app: 'Script Manager', version: '1.2.1' });
  });

  // ── Get All Scripts ──
  app.get('/api/scripts', (req, res) => {
    try {
      const data = readData();
      // Send scripts without heavy cover images for list view
      const lightScripts = (data.scripts || []).map(s => ({
        id: s.id,
        title: s.title || 'Untitled Script',
        content: s.content || '',
        coverImage: s.coverImage || null,
        publishDate: s.publishDate || null,
        status: s.status || 'pending',
        createdAt: s.createdAt || new Date().toISOString(),
        updatedAt: s.updatedAt || new Date().toISOString(),
      }));
      res.json({ scripts: lightScripts, theme: data.theme || 'dark' });
    } catch (e) {
      res.status(500).json({ error: 'Failed to read scripts' });
    }
  });

  // ── Get Single Script ──
  app.get('/api/script/:id', (req, res) => {
    try {
      const data = readData();
      const script = (data.scripts || []).find(s => s.id === req.params.id);
      if (script) {
        res.json(script);
      } else {
        res.status(404).json({ error: 'Script not found' });
      }
    } catch (e) {
      res.status(500).json({ error: 'Failed to read script' });
    }
  });

  // ── Delete Single Script ──
  app.delete('/api/script/:id', (req, res) => {
    try {
      const data = readData();
      const initialLength = (data.scripts || []).length;
      data.scripts = (data.scripts || []).filter(s => s.id !== req.params.id);
      if (data.scripts.length !== initialLength) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        
        // Notify the frontend to refresh the scripts list
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.webContents.executeJavaScript(`
            if (typeof window.loadScripts === 'function') {
              window.loadScripts();
            }
          `).catch(err => console.error(err));
        }
        res.json({ status: 'ok' });
      } else {
        res.status(404).json({ error: 'Script not found' });
      }
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete script' });
    }
  });

  // ── Teleprompter Remote Control ──
  app.post('/api/teleprompter/control', (req, res) => {
    try {
      const { action, value } = req.body;
      
      if (!action) {
        return res.status(400).json({ error: 'Action is required' });
      }

      // Send command to the renderer process via IPC
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.executeJavaScript(`
          (function() {
            const event = new CustomEvent('teleprompter-remote', { 
              detail: { action: '${action}', value: ${value || 'null'} }
            });
            window.dispatchEvent(event);
          })();
        `);
        res.json({ status: 'ok', action, value });
      } else {
        res.status(503).json({ error: 'App window not available' });
      }
    } catch (e) {
      res.status(500).json({ error: 'Failed to send command' });
    }
  });

  // ── Server Info ──
  app.get('/api/info', (req, res) => {
    const ip = getLocalIP();
    res.json({ 
      ip, 
      port: PORT, 
      url: `http://${ip}:${PORT}`,
      scriptsCount: (readData().scripts || []).length
    });
  });

  // Start the server
  server = app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`[Sync Server] Running at http://${ip}:${PORT}`);
    console.log(`[Sync Server] Mobile app can connect to this address`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Sync Server] Port ${PORT} already in use, skipping...`);
    } else {
      console.error('[Sync Server] Error:', err);
    }
  });

  return { ip: getLocalIP(), port: PORT };
}

function stopSyncServer() {
  if (server) {
    server.close();
    server = null;
    console.log('[Sync Server] Stopped');
  }
}

module.exports = { startSyncServer, stopSyncServer, getLocalIP };
