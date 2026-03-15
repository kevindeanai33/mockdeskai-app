const { app, BrowserWindow } = require('electron');
const path = require('path');

// Start the Express + WebSocket server
const { startServer } = require('./server/index');

let mainWindow;
let serverInstance;

const SERVER_PORT = 3456;
const VITE_DEV_PORT = 5173;

async function checkViteDev() {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${VITE_DEV_PORT}`, () => resolve(true));
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
    });
  } catch { return false; }
}

async function createWindow() {
  // Start backend server
  serverInstance = await startServer(SERVER_PORT);
  console.log(`Server running on port ${SERVER_PORT}`);

  const useViteDev = await checkViteDev();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'MockDeskAI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (useViteDev) {
    // Vite dev server is running — use it for HMR
    mainWindow.loadURL(`http://localhost:${VITE_DEV_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    // Load from built files served by Express
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
  }
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
