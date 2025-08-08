import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadWallets, getWalletPublicKey, parseSecretKey } from '../loadWallets';
import { processWalletBalances, LoadingProgress } from '../balances';
import { WalletData, TokenBalance, Config, WalletBalances } from '../types';
import { sendSOL, sendSPLToken } from '../tokenSend';
import { Connection, Keypair } from '@solana/web3.js';
import LoadingIndicator from './LoadingIndicator';
import TokenDetailView from './TokenDetailView';
import TokenSendView from './TokenSendView';
import './index.css';

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
  const formatAddress = React.useCallback((addr: string) => {
    return addr.length > 8 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
  }, []);

  const formatUsdValue = React.useCallback((value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  }, []);

  const copyToClipboard = React.useCallback(() => {
    navigator.clipboard.writeText(address);
    onCopyAddress(address);
  }, [address, onCopyAddress]);

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
           amount: isNaN(balance) ? '0' : balance.toFixed(6),
           decimals: 9,
           symbol: 'SOL',
           usdPrice: solPrice,
           usdValue: solPrice && !isNaN(balance) ? balance * solPrice : undefined
         })}>
           <span className="token-mint">SOL</span>
           <span className="token-amount" title={solPrice && !isNaN(balance) ? `$${(balance * solPrice).toFixed(2)}` : ''}>
             {isNaN(balance) ? 'Loading...' : `${balance.toFixed(6)}`}
           </span>
         </div>
        {tokens.length > 0 && (
          <>
            {React.useMemo(() => 
              tokens
                .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
                .map((token, index) => (
                <div key={index} className="token-item" onClick={() => onTokenClick({
                  ...token,
                  amount: token.amount // Передаем то же значение, что отображается в основном окне
                })}>
                  <span className="token-mint">{token.symbol || token.mint.slice(0, 8) + '...'}</span>
                  <span className="token-amount" title={token.usdValue ? `$${token.usdValue.toFixed(2)}` : ''}>
                    {token.amount}
                  </span>
                </div>
              )), [tokens, onTokenClick])}
          </>
        )}
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
}> = React.memo(({ wallet, balance, tokens, totalUsdValue, solPrice, availableWallets, config, onCopyAddress, onCopyTokenAddress, onUpdateWalletName }) => {
  // Мемоизируем вычисление адреса
  const address = React.useMemo(() => getWalletPublicKey(wallet), [wallet]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(wallet.name);
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [showSendView, setShowSendView] = useState(false);

  const handleTokenClick = React.useCallback((token: TokenBalance) => {
    setSelectedToken(token);
  }, []);

  const handleBackToWallet = React.useCallback(() => {
    setSelectedToken(null);
    setShowSendView(false);
  }, []);

  const handleSendClick = React.useCallback(() => {
    setShowSendView(true);
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
        // Можно добавить уведомление об успешной отправке
        alert(`Транзакция успешно отправлена! TXID: ${result.txid}`);
      } else {
        console.error('Transaction failed:', result.error);
        alert(`Ошибка отправки: ${result.error}`);
      }
      
      // Возвращаемся к детальному просмотру
      setShowSendView(false);
    } catch (error) {
      console.error('Error sending token:', error);
      alert(`Ошибка отправки: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    }
  }, [selectedToken, wallet, config]);

  const handleNameClick = () => {
    setIsEditing(true);
    setEditName(wallet.name);
  };

  const handleNameSave = () => {
    if (editName.trim() !== wallet.name) {
      onUpdateWalletName(address, editName.trim());
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
        ) : (
          <TokenDetailView 
            token={selectedToken} 
            onBack={handleBackToWallet}
            onCopyMint={onCopyTokenAddress}
            onSendClick={handleSendClick}
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
          onNameCancel={handleNameBlur}
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
  const [showConfig, setShowConfig] = useState(false);

  const loadConfig = async () => {
    try {
      const configData = await window.walletAPI.getConfig();
      setConfig(configData);
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

  // Очищаем таймер копирования при размонтировании компонента
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
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
        <div className="header-controls">
          <button 
            className="config-button"
            onClick={() => setShowConfig(!showConfig)}
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
                value={config.solanaRpcUrl}
                onChange={(e) => setConfig({...config, solanaRpcUrl: e.target.value})}
                placeholder="https://api.mainnet-beta.solana.com"
              />
            </div>
            <div className="config-item">
              <label>Tokens RPC URL:</label>
              <input
                type="text"
                value={config.solanaTokensRpcUrl}
                onChange={(e) => setConfig({...config, solanaTokensRpcUrl: e.target.value})}
                placeholder="https://api.mainnet-beta.solana.com"
              />
            </div>
            <div className="config-item">
              <label>Auto Refresh (ms):</label>
              <input
                type="number"
                value={config.autoRefreshInterval}
                onChange={(e) => setConfig({...config, autoRefreshInterval: parseInt(e.target.value)})}
              />
            </div>
            <div className="config-item">
              <label>Delay Between Requests (ms):</label>
              <input
                type="number"
                value={config.delayBetweenRequests}
                onChange={(e) => setConfig({...config, delayBetweenRequests: parseInt(e.target.value)})}
              />
            </div>
            <div className="config-item">
              <label>Priority Fee (micro-lamports):</label>
              <input
                type="number"
                value={config.priorityFee}
                onChange={(e) => setConfig({...config, priorityFee: parseInt(e.target.value)})}
                placeholder="50000"
              />
            </div>
            <div className="config-item">
              <label>Max Retries:</label>
              <input
                type="number"
                value={config.maxRetries}
                onChange={(e) => setConfig({...config, maxRetries: parseInt(e.target.value)})}
                placeholder="3"
              />
            </div>
            <div className="config-item">
              <label>Confirmation Timeout (seconds):</label>
              <input
                type="number"
                value={config.confirmationTimeout}
                onChange={(e) => setConfig({...config, confirmationTimeout: parseInt(e.target.value)})}
                placeholder="60"
              />
            </div>
            <div className="config-buttons">
              <button onClick={() => saveConfig(config)}>Save</button>
              <button onClick={() => setShowConfig(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {copiedAddress && (
        <div className="copy-notification">
          {copiedType === 'wallet' ? 'Address copied!' : 'Token address copied!'}
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
                 key={`wallet-${address}`}
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
  root.render(<App />);
} 