const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('CityRailDesktop', {
  platform: process.platform,
  getReleaseManifest: () => ipcRenderer.invoke('cityrail:get-release-manifest'),
  reloadOnline: () => ipcRenderer.invoke('cityrail:reload-online')
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('cityrail-desktop-client');
});
