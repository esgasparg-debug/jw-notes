// Tells the Angular app it runs on desktop and gives it access to JW Library's database.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jwNotesDesktop', {
  platform: process.platform,
  deviceName: () => ipcRenderer.invoke('device:name'),
  focus: () => ipcRenderer.invoke('window:focus'),
  jwLibrary: {
    locate: () => ipcRenderer.invoke('jwlibrary:locate'),
    read: () => ipcRenderer.invoke('jwlibrary:read'),
    apply: (database) => ipcRenderer.invoke('jwlibrary:apply', database),
    openBackup: (bytes, name) => ipcRenderer.invoke('jwlibrary:open-backup', bytes, name),
  },
});
