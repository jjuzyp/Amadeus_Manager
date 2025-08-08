import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ipcMain } from 'electron';
import * as fs from 'fs';
import { getWalletPublicKey } from './loadWallets';

const WALLET_PATH = 'wallets.json';
const CONFIG_PATH = 'config.json';

// Функция для чтения конфига
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    // Создаем дефолтный конфиг если файла нет
    const defaultConfig = {
      solanaRpcUrl: "https://api.mainnet-beta.solana.com",
      solanaTokensRpcUrl: "https://api.mainnet-beta.solana.com",
      autoRefreshInterval: 10000,
      delayBetweenRequests: 100,
      priorityFee: 50000,
      maxRetries: 3,
      confirmationTimeout: 60
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }
  const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(data);
  
  // Добавляем недостающие поля если их нет
  if (!config.hasOwnProperty('priorityFee')) config.priorityFee = 50000;
  if (!config.hasOwnProperty('maxRetries')) config.maxRetries = 3;
  if (!config.hasOwnProperty('confirmationTimeout')) config.confirmationTimeout = 60;
  
  return config;
}

ipcMain.handle('save-wallets', async (_event, wallets) => {
  fs.writeFileSync(WALLET_PATH, JSON.stringify(wallets, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('load-wallets', async () => {
  if (!fs.existsSync(WALLET_PATH)) return [];
  const data = fs.readFileSync(WALLET_PATH, 'utf-8');
  return JSON.parse(data);
});

// Новый обработчик для получения конфига
ipcMain.handle('get-config', async () => {
  return loadConfig();
});

// Обработчик для сохранения конфига
ipcMain.handle('save-config', async (_event, config) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  return true;
});

// Обработчик для обновления имени кошелька
ipcMain.handle('update-wallet-name', async (_event, address: string, newName: string) => {
  try {
    const walletsData = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
    
    // Находим кошелек по адресу и обновляем имя
    for (const wallet of walletsData) {
      const walletAddress = getWalletPublicKey(wallet);
      if (walletAddress === address) {
        wallet.name = newName;
        break;
      }
    }
    
    // Сохраняем обновленные данные
    fs.writeFileSync(WALLET_PATH, JSON.stringify(walletsData, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error updating wallet name:', error);
    return false;
  }
});



function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 