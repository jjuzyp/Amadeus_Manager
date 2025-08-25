import React, { useState, useEffect, useCallback, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { loadWallets, getWalletPublicKey, parseSecretKey } from '../loadWallets';
import { processWalletBalances, LoadingProgress } from '../balances';
import { WalletData, TokenBalance, Config, WalletBalances } from '../types';
import { sendSOL, sendSPLToken } from '../tokenSend';
import { Connection, Keypair } from '@solana/web3.js';
import { formatUsdValue, formatAddress } from '../utils';
import LoadingIndicator from './LoadingIndicator';
import TokenDetailView from './TokenDetailView';
import TokenSendView from './TokenSendView';
import SwapView from './SwapView';
import './index.css';

// Error Boundary компонент для обработки ошибок
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Что-то пошло не так</h2>
          <p>Произошла ошибка в приложении. Попробуйте обновить страницу.</p>
          <button onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
          {this.state.error && (
            <details>
              <summary>Детали ошибки</summary>
              <pre>{this.state.error.toString()}</pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

// Компонент для основного вида кошелька
const WalletMainView: React.FC<{
  wallet: WalletData;
  balance: number;
  tokens: TokenBalance[];
  totalUsdValue?: number;
  solPrice?: number;
  address: string;
  isEditing: boolean;
  editName: string;
  onCopyAddress: (address: string) => void;
  onUpdateWalletName: (address: string, newName: string) => void;
  onTokenClick: (token: TokenBalance) => void;
  onNameClick: () => void;
  onNameChange: (name: string) => void;
  onNameSave: () => void;
  onNameCancel: () => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
}> = React.memo(({ 
  wallet, balance, tokens, totalUsdValue, solPrice, address,
  isEditing, editName, onCopyAddress, onUpdateWalletName, onTokenClick,
  onNameClick, onNameChange, onNameSave, onNameCancel, onKeyPress
}) => {


  const copyToClipboard = React.useCallback(async () => {
    try {
      // Проверяем, что документ в фокусе
      if (document.hasFocus()) {
        await navigator.clipboard.writeText(address);
        onCopyAddress(address);
      } else {
        // Fallback: используем старый API
        const textArea = document.createElement('textarea');
        textArea.value = address;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        onCopyAddress(address);
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      // Fallback: используем старый API
      try {
        const textArea = document.createElement('textarea');
        textArea.value = address;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        onCopyAddress(address);
      } catch (fallbackError) {
        console.error('Fallback copy also failed:', fallbackError);
        // Показываем адрес пользователю, если копирование не удалось
        alert(`Адрес: ${address}`);
      }
    }
  }, [address, onCopyAddress]);

  // Мемоизируем отсортированные токены
  const sortedTokens = React.useMemo(() => 
    tokens
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
      .map((token, index) => ({
        ...token,
        key: index
      })), [tokens]);

  return (
    <>
      {totalUsdValue !== undefined && (
        <div className="wallet-total-value">
          {formatUsdValue(totalUsdValue)}
        </div>
      )}
      <div className="wallet-header">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onNameCancel}
            onKeyDown={onKeyPress}
            className="wallet-name-edit"
            autoFocus
          />
        ) : (
          <h3 className="wallet-name" onClick={onNameClick}>
            {wallet.name}
          </h3>
        )}
      </div>
      <div className="wallet-address" onClick={copyToClipboard}>
        {formatAddress(address)}
      </div>
      <div className="wallet-balances">
        <div className="token-item" onClick={() => onTokenClick({
          mint: 'So11111111111111111111111111111111111111112',
          amount: isNaN(balance) ? '0' : balance.toString(),
          decimals: 9,
          symbol: 'SOL',
          usdPrice: solPrice,
          usdValue: solPrice && !isNaN(balance) ? balance * solPrice : undefined
        })}>
          <span className="token-mint">SOL</span>
          <span className="token-amount" title={solPrice && !isNaN(balance) ? `$${(balance * solPrice).toFixed(2)}` : ''}>
            {isNaN(balance) ? 'Loading...' : `${balance.toFixed(9)}`}
          </span>
        </div>
        {sortedTokens.map((token) => (
          <div key={token.key} className="token-item" onClick={() => onTokenClick({
            ...token,
            amount: token.amount // Передаем то же значение, что отображается в основном окне
          })}>
            <span className="token-mint">{token.symbol || token.mint.slice(0, 8) + '...'}</span>
            <span className="token-amount" title={token.usdValue ? `$${token.usdValue.toFixed(2)}` : ''}>
              {token.amount}
            </span>
          </div>
        ))}
      </div>
    </>
  );
});

const WalletCard: React.FC<{
  wallet: WalletData;
  balance: number;
  tokens: TokenBalance[];
  totalUsdValue?: number;
  solPrice?: number;
  availableWallets: WalletData[];
  config: Config;
  onCopyAddress: (address: string) => void;
  onCopyTokenAddress: (mint: string) => void;
  onUpdateWalletName: (address: string, newName: string) => void;
  onForceUpdate: () => void;
  onNotify: (message: string) => void;
}> = React.memo(({ wallet, balance, tokens, totalUsdValue, solPrice, availableWallets, config, onCopyAddress, onCopyTokenAddress, onUpdateWalletName, onForceUpdate, onNotify }) => {
  // Мемоизируем вычисление адреса
  const address = React.useMemo(() => getWalletPublicKey(wallet), [wallet]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(wallet.name);
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [showSendView, setShowSendView] = useState(false);
  const [showSwapView, setShowSwapView] = useState(false);

  const handleTokenClick = React.useCallback((token: TokenBalance) => {
    setSelectedToken(token);
  }, []);

  const handleBackToWallet = React.useCallback(() => {
    setSelectedToken(null);
    setShowSendView(false);
    setShowSwapView(false);
    // Принудительно обновляем состояние редактирования
    setIsEditing(false);
    setEditName(wallet.name);
  }, [wallet.name]);

  const handleSendClick = React.useCallback(() => {
    setShowSendView(true);
  }, []);

  const handleSwapClick = React.useCallback(() => {
    setShowSwapView(true);
  }, []);

  const handleSendToken = React.useCallback(async (recipient: string, amount: string): Promise<void> => {
    if (!selectedToken) return;
    
    try {
      // Создаем Keypair из secretKey
      const secretKey = parseSecretKey(wallet.secretKey);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      // Выполняем отправку токена
      let result;
      if (selectedToken.mint === 'So11111111111111111111111111111111111111112') {
        // Отправляем SOL - используем solanaTokensRpcUrl для всех транзакций
        result = await sendSOL({
          rpcUrl: config.solanaTokensRpcUrl,
          fromWallet: keypair,
          toAddress: recipient,
          amount: amount,
          priorityFee: config.priorityFee || 50000,
          maxRetries: config.maxRetries || 3,
          confirmationTimeout: config.confirmationTimeout || 60
        });
      } else {
        // Отправляем SPL токен - используем solanaTokensRpcUrl
        result = await sendSPLToken({
          rpcUrl: config.solanaTokensRpcUrl,
          fromWallet: keypair,
          toAddress: recipient,
          amount: amount,
          tokenMint: selectedToken.mint,
          decimals: selectedToken.decimals,
          priorityFee: config.priorityFee || 50000,
          maxRetries: config.maxRetries || 3,
          confirmationTimeout: config.confirmationTimeout || 60
        });
      }
      
      if (result.success) {
        console.log('Transaction successful:', result.txid);
        onNotify(`Транзакция успешно отправлена! TXID: ${result.txid}`);
      } else {
        console.error('Transaction failed:', result.error);
        onNotify(`Ошибка отправки: ${result.error}`);
      }
      
      // Возвращаемся к детальному просмотру
      setShowSendView(false);
      setSelectedToken(null);
    } catch (error) {
      console.error('Error sending token:', error);
      onNotify(`Ошибка отправки: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
      // Принудительно возвращаемся к детальному просмотру даже при ошибке
      setShowSendView(false);
      setSelectedToken(null);
    } finally {
      // Принудительно восстанавливаем состояние компонента
      setTimeout(() => {
        setShowSendView(false);
        setSelectedToken(null);
        setIsEditing(false);
        setEditName(wallet.name);
        // Принудительно обновляем компонент
        onForceUpdate();
        try { window.focus(); } catch {}
      }, 100);
    }
  }, [selectedToken, wallet, config, onNotify]);

  // Принудительно обновляем состояние при изменении wallet
  React.useEffect(() => {
    setEditName(wallet.name);
    setIsEditing(false);
  }, [wallet.name]);

  const handleNameClick = () => {
    setIsEditing(true);
    setEditName(wallet.name);
  };

  const handleNameSave = async () => {
    if (editName.trim() !== wallet.name) {
      try {
        await onUpdateWalletName(address, editName.trim());
      } catch (error) {
        console.error('Error updating wallet name:', error);
        // Возвращаем старое название при ошибке
        setEditName(wallet.name);
      }
    }
    setIsEditing(false);
  };

  const handleNameCancel = () => {
    setEditName(wallet.name);
    setIsEditing(false);
  };

  const handleNameBlur = () => {
    // Небольшая задержка чтобы избежать конфликтов с кликами
    setTimeout(() => {
      handleNameCancel();
    }, 100);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      handleNameCancel();
    }
  };

  const handleNameChange = (name: string) => {
    setEditName(name);
  };

  return (
    <div className="wallet-card" data-wallet={address}>
      {selectedToken ? (
        showSendView ? (
                     <TokenSendView
             token={selectedToken}
             availableWallets={availableWallets}
             currentWalletAddress={address}
             currentWallet={wallet}
             exactBalance={balance}
             config={config}
             onBack={() => setShowSendView(false)}
             onSend={handleSendToken}
           />
        ) : showSwapView ? (
          <SwapView
            token={selectedToken}
            wallet={wallet}
            config={config}
            onBack={() => setShowSwapView(false)}
            onNotify={onNotify}
          />
        ) : (
          <TokenDetailView 
            token={selectedToken} 
            onBack={handleBackToWallet}
            onCopyMint={onCopyTokenAddress}
            onSendClick={handleSendClick}
            onSwapClick={handleSwapClick}
          />
        )
      ) : (
        <WalletMainView
          wallet={wallet}
          balance={balance}
          tokens={tokens}
          totalUsdValue={totalUsdValue}
          solPrice={solPrice}
          address={address}
          isEditing={isEditing}
          editName={editName}
          onCopyAddress={onCopyAddress}
          onUpdateWalletName={onUpdateWalletName}
          onTokenClick={handleTokenClick}
          onNameClick={handleNameClick}
          onNameChange={handleNameChange}
          onNameSave={handleNameSave}
          onNameCancel={handleNameCancel}
          onKeyPress={handleKeyPress}
        />
      )}
    </div>
  );
});

const App: React.FC = () => {
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [balances, setBalances] = useState<WalletBalances>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'wallet' | 'token'>('wallet');
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress>({
    currentWallet: '',
    totalWallets: 0,
    processedWallets: 0,
    isComplete: false
  });
  const [config, setConfig] = useState<Config>({
    solanaRpcUrl: "",
    solanaTokensRpcUrl: "",
    autoRefreshInterval: 0,
    delayBetweenRequests: 0,
    priorityFee: 50000,
    maxRetries: 3,
    confirmationTimeout: 60
  });
  
  // Отдельное состояние для редактирования конфига
  const [editingConfig, setEditingConfig] = useState<Config>({
    solanaRpcUrl: "",
    solanaTokensRpcUrl: "",
    autoRefreshInterval: 0,
    delayBetweenRequests: 0,
    priorityFee: 50000,
    maxRetries: 3,
    confirmationTimeout: 60
  });
  const [showConfig, setShowConfig] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(0); // Ключ для принудительного обновления

  const loadConfig = async () => {
    try {
      const configData = await window.walletAPI.getConfig();
      setConfig(configData);
      setEditingConfig(configData); // Инициализируем editing config
    } catch (error) {
      console.error('Error loading config:', error);
    }
  };

  const saveConfig = async (newConfig: Config) => {
    try {
      await window.walletAPI.saveConfig(newConfig);
      setConfig(newConfig);
      setShowConfig(false);
      // Перезагружаем балансы с новым RPC
      await loadWalletsAndBalances();
    } catch (error) {
      console.error('Error saving config:', error);
    }
  };

  const handleConfigCancel = () => {
    setEditingConfig(config); // Возвращаем к исходному состоянию
    setShowConfig(false);
  };

  const loadWalletsAndBalances = async () => {
    setRefreshing(true);
    try {
      const loadedWallets = await loadWallets();
      setWallets(loadedWallets);
      
      const walletBalances = await processWalletBalances(
        loadedWallets, 
        config,
        (progress) => setLoadingProgress(progress),
        (address, balance) => {
          // Обновляем балансы по мере загрузки каждого кошелька
          setBalances((prev: WalletBalances) => ({
            ...prev,
            [address]: balance
          }));
        }
      );
      
      // Принудительно сбрасываем прогресс загрузки после завершения
      setTimeout(() => {
        setLoadingProgress({
          currentWallet: '',
          totalWallets: 0,
          processedWallets: 0,
          isComplete: true
        });
      }, 100);

    } catch (error) {
      console.error('Error loading wallets and balances:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    // Предотвращаем конфликт с автообновлением
    if (autoRefreshing) {
      console.log('Автообновление активно, пропускаем ручное обновление');
      return;
    }
    
    await loadWalletsAndBalances();
  };

  const handleCopyAddress = useCallback((address: string) => {
    // Очищаем предыдущий таймер если он существует
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    
    setCopiedAddress(address);
    setCopiedType('wallet');
    
    // Сохраняем ID нового таймера
    copyTimeoutRef.current = setTimeout(() => {
      setCopiedAddress(null);
      copyTimeoutRef.current = null;
    }, 2000);
  }, []);

  const handleCopyTokenAddress = useCallback((mint: string) => {
    // Очищаем предыдущий таймер если он существует
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    
    setCopiedAddress(mint);
    setCopiedType('token');
    
    // Сохраняем ID нового таймера
    copyTimeoutRef.current = setTimeout(() => {
      setCopiedAddress(null);
      copyTimeoutRef.current = null;
    }, 2000);
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 3500);
  }, []);

  const handleUpdateWalletName = useCallback(async (address: string, newName: string) => {
    try {
      await window.walletAPI.updateWalletName(address, newName);
      // Перезагружаем кошельки для обновления данных
      const updatedWallets = await loadWallets();
      setWallets(updatedWallets);
    } catch (error) {
      console.error('Error updating wallet name:', error);
    }
  }, []);



  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    loadWalletsAndBalances().then(() => {
      // Убираем loading экран после загрузки первого кошелька
      if (wallets.length > 0) {
        setLoading(false);
      }
    });
  }, [config]);

  // Показываем кошельки, если есть хотя бы один загруженный
  const hasLoadedWallets = wallets.length > 0 && Object.keys(balances).length > 0;

  useEffect(() => {
    if (config.autoRefreshInterval > 0) {
      console.log(`Устанавливаем автообновление каждые ${config.autoRefreshInterval}ms`);
      const interval = setInterval(async () => {
        // Проверяем, что нет ручного обновления
        if (!refreshing) {
          console.log('Автообновление балансов...');
          setAutoRefreshing(true);
          await loadWalletsAndBalances();
          setAutoRefreshing(false);
        } else {
          console.log('Ручное обновление активно, пропускаем автообновление');
        }
      }, config.autoRefreshInterval);
      
      return () => {
        console.log('Очищаем интервал автообновления');
        clearInterval(interval);
      };
    }
  }, [config.autoRefreshInterval, refreshing]);

  // Вычисляем общий баланс всех кошельков
  const totalBalance = React.useMemo(() => {
    return Object.values(balances).reduce((total, walletBalance) => {
      return total + (walletBalance.totalUsdValue || 0);
    }, 0);
  }, [balances]);



  // Очищаем таймер копирования при размонтировании компонента
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  if (loading && !hasLoadedWallets) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <span>Loading wallet: {loadingProgress.currentWallet || 'Initializing...'}</span>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <h1>Solana Wallet Manager</h1>
        <div className="header-balance">
          <span className="total-balance-label">Total Balance:</span>
          <span className="total-balance-value">{formatUsdValue(totalBalance)}</span>
        </div>
        <div className="header-controls">
          <button 
            className="config-button"
            onClick={() => {
              setShowConfig(!showConfig);
              // При открытии конфига обновляем editing config
              if (!showConfig) {
                setEditingConfig(config);
              }
            }}
          >
            ⚙️ Config
          </button>
          <button 
            className="refresh-button"
            onClick={handleRefresh}
            disabled={refreshing || autoRefreshing}
          >
            {refreshing ? '🔄 Refreshing...' : autoRefreshing ? '🔄 Auto-refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {showConfig && (
        <div className="config-panel">
          <h3>Configuration</h3>
          <div className="config-form">
            <div className="config-item">
              <label>SOL RPC URL:</label>
              <input
                type="text"
                value={editingConfig.solanaRpcUrl}
                onChange={(e) => setEditingConfig({...editingConfig, solanaRpcUrl: e.target.value})}
                placeholder="https://api.mainnet-beta.solana.com"
              />
            </div>
            <div className="config-item">
              <label>Tokens RPC URL:</label>
              <input
                type="text"
                value={editingConfig.solanaTokensRpcUrl}
                onChange={(e) => setEditingConfig({...editingConfig, solanaTokensRpcUrl: e.target.value})}
                placeholder="https://api.mainnet-beta.solana.com"
              />
            </div>
            <div className="config-item">
              <label>Auto Refresh (ms):</label>
              <input
                type="number"
                value={editingConfig.autoRefreshInterval}
                onChange={(e) => setEditingConfig({...editingConfig, autoRefreshInterval: parseInt(e.target.value)})}
              />
            </div>
            <div className="config-item">
              <label>Delay Between Requests (ms):</label>
              <input
                type="number"
                value={editingConfig.delayBetweenRequests}
                onChange={(e) => setEditingConfig({...editingConfig, delayBetweenRequests: parseInt(e.target.value)})}
              />
            </div>
            <div className="config-item">
              <label>Priority Fee (micro-lamports):</label>
              <input
                type="number"
                value={editingConfig.priorityFee}
                onChange={(e) => setEditingConfig({...editingConfig, priorityFee: parseInt(e.target.value)})}
                placeholder="50000"
              />
            </div>
            <div className="config-item">
              <label>Max Retries:</label>
              <input
                type="number"
                value={editingConfig.maxRetries}
                onChange={(e) => setEditingConfig({...editingConfig, maxRetries: parseInt(e.target.value)})}
                placeholder="3"
              />
            </div>
            <div className="config-item">
              <label>Confirmation Timeout (seconds):</label>
              <input
                type="number"
                value={editingConfig.confirmationTimeout}
                onChange={(e) => setEditingConfig({...editingConfig, confirmationTimeout: parseInt(e.target.value)})}
                placeholder="60"
              />
            </div>
            <div className="config-buttons">
              <button onClick={() => saveConfig(editingConfig)}>Save</button>
              <button onClick={handleConfigCancel}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {(toastMessage || copiedAddress) && (
        <div className="copy-notification">
          {toastMessage ? toastMessage : (copiedType === 'wallet' ? 'Address copied!' : 'Token address copied!')}
        </div>
      )}

      <LoadingIndicator 
        progress={loadingProgress} 
        isVisible={
          loadingProgress.totalWallets > 0 && 
          loadingProgress.currentWallet !== '' &&
          loadingProgress.processedWallets < loadingProgress.totalWallets
        }
      />

      {wallets.length === 0 ? (
        <div className="empty-state">
          <p>No wallets found. Add wallets to wallets.json file.</p>
        </div>
      ) : (
        <div className="wallets-grid">
          {wallets.map((wallet) => {
            const address = getWalletPublicKey(wallet);
            const walletBalance = balances[address];
            
            // Показываем только загруженные кошельки
            if (!walletBalance) {
              return null;
            }
            
                                     return (
              <WalletCard
                key={`wallet-${address}-${forceUpdate}`}
                wallet={wallet}
                balance={walletBalance.solBalance}
                tokens={walletBalance.tokenBalances}
                totalUsdValue={walletBalance.totalUsdValue}
                solPrice={walletBalance.solPrice}
                availableWallets={wallets}
                config={config}
                onCopyAddress={handleCopyAddress}
                onCopyTokenAddress={handleCopyTokenAddress}
                onUpdateWalletName={handleUpdateWalletName}
                onForceUpdate={() => setForceUpdate(prev => prev + 1)}
                onNotify={showToast}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default App;

// Рендеринг приложения
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
} 