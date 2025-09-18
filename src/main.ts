import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { ipcMain } from 'electron';
import * as fs from 'fs';
import { getWalletPublicKey } from './loadWallets';

function getDataDir(): string {
  // Для portable-сборки electron-builder выставляет PORTABLE_EXECUTABLE_DIR
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && portableDir.length > 0) {
    return portableDir;
  }
  // В проде используем путь к исполняемому файлу (можно вызывать до app.whenReady)
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  // В dev режиме — корень проекта
  return process.cwd();
}

function resolveDataPath(filename: string): string {
  const base = getDataDir();
  return path.join(base, filename);
}

const WALLET_PATH = resolveDataPath('wallets.json');
const CONFIG_PATH = resolveDataPath('config.json');

function ensureFileExists(filePath: string, defaultContent: any) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      const data = typeof defaultContent === 'string' ? defaultContent : JSON.stringify(defaultContent, null, 2);
      fs.writeFileSync(filePath, data, 'utf-8');
    }
  } catch (e) {
    console.error('Failed to ensure file exists:', filePath, e);
  }
}

// Функция для чтения конфига
function loadConfig() {
  // Создаем дефолтный конфиг, если отсутствует
  const defaultConfig = {
    solanaRpcUrl: "",
    solanaTokensRpcUrl: "",
    autoRefreshInterval: 10000,
    delayBetweenRequests: 100,
    priorityFee: 50000,
    maxRetries: 3,
    confirmationTimeout: 60
  };
  if (!fs.existsSync(CONFIG_PATH)) {
    ensureFileExists(CONFIG_PATH, defaultConfig);
    return defaultConfig;
  }
  const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(data);
  
  // Добавляем недостающие поля если их нет
  if (!config.hasOwnProperty('priorityFee')) config.priorityFee = 50000;
  if (!config.hasOwnProperty('maxRetries')) config.maxRetries = 3;
  if (!config.hasOwnProperty('confirmationTimeout')) config.confirmationTimeout = 60;
  if (!config.hasOwnProperty('solanaRpcUrl')) config.solanaRpcUrl = "";
  if (!config.hasOwnProperty('solanaTokensRpcUrl')) config.solanaTokensRpcUrl = "";
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8'); } catch {}
  return config;
}

ipcMain.handle('save-wallets', async (_event, wallets) => {
  ensureFileExists(WALLET_PATH, '[]');
  fs.writeFileSync(WALLET_PATH, JSON.stringify(wallets, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('load-wallets', async () => {
  if (!fs.existsSync(WALLET_PATH)) {
    ensureFileExists(WALLET_PATH, '[]');
    return [];
  }
  try {
    const data = fs.readFileSync(WALLET_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to read wallets.json, returning empty list', e);
    return [];
  }
});

// Новый обработчик для получения конфига
ipcMain.handle('get-config', async () => {
  return loadConfig();
});

// Обработчик для сохранения конфига
ipcMain.handle('save-config', async (_event, config) => {
  ensureFileExists(CONFIG_PATH, {});
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  return true;
});

// Обработчик для открытия внешних ссылок в системном браузере
ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.error('Failed to open external URL:', url, error);
    return false;
  }
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
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset'
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