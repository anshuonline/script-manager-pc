const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ⚠️ SET MOCK_MODE TO FALSE AND ADD CREDENTIALS FOR PRODUCTION ⚠️
const MOCK_MODE = true; 
const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';
const CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET';
const REDIRECT_URI = 'http://localhost:3456/oauth2callback';

let oauth2Client;
if (!MOCK_MODE) {
  oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

let connectedEmail = null;

function getAuthUrl() {
  if (MOCK_MODE) {
    return 'mock://auth';
  }
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/userinfo.email']
  });
}

async function handleCallback(code) {
  if (MOCK_MODE) {
    connectedEmail = 'user.name@gmail.com';
    return { email: connectedEmail };
  }
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  connectedEmail = userInfo.data.email;
  
  return { email: connectedEmail, tokens };
}

async function syncScripts(scripts, onProgress) {
  if (MOCK_MODE) {
    const total = scripts.length > 0 ? scripts.length : 1;
    for (let i = 0; i < total; i++) {
      await new Promise(r => setTimeout(r, 600)); // Simulate network upload
      if (onProgress) onProgress(i + 1, total);
    }
    return true;
  }
  
  // REAL IMPLEMENTATION
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  
  // 1. Find or create ScriptManager folder
  let folderId;
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and name='ScriptManager' and trashed=false",
    fields: 'files(id, name)',
    spaces: 'drive'
  });
  
  if (res.data.files.length > 0) {
    folderId = res.data.files[0].id;
  } else {
    const folderMetadata = {
      name: 'ScriptManager',
      mimeType: 'application/vnd.google-apps.folder'
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: 'id'
    });
    folderId = folder.data.id;
  }
  
  // 2. Upload scripts as .md files
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    const fileMetadata = {
      name: `${s.title || 'Untitled'}.md`,
      parents: [folderId]
    };
    
    // We convert HTML content to plain markdown or just save the content text
    const cleanText = s.content ? s.content.replace(/<[^>]*>?/gm, '') : '';
    const media = {
      mimeType: 'text/markdown',
      body: `# ${s.title || 'Untitled'}\n\n${cleanText}`
    };
    
    await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });
    
    if (onProgress) onProgress(i + 1, scripts.length);
  }
  
  return true;
}

module.exports = { getAuthUrl, handleCallback, syncScripts, MOCK_MODE };
