const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('walletAPI', {
  saveWallets: (wallets) => ipcRenderer.invoke('save-wallets', wallets),
  loadWallets: () => ipcRenderer.invoke('load-wallets'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  updateWalletName: (address, newName) => ipcRenderer.invoke('update-wallet-name', address, newName),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
}); 