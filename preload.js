const { contextBridge } = require('electron');

// Expose minimal API to renderer
contextBridge.exposeInMainWorld('mockdeskai', {
  platform: process.platform,
  isElectron: true,
});
