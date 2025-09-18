import React, { useState, useEffect, useCallback, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { UnifiedWalletProvider, UnifiedWalletButton } from '@jup-ag/wallet-adapter';
import { loadWallets, getWalletPublicKey, parseSecretKey } from '../loadWallets';
import { processWalletBalances, LoadingProgress } from '../balances';
import { WalletData, TokenBalance, Config, WalletBalances } from '../types';
import { sendSOL, sendSPLToken } from '../tokenSend';
import { burnSPLToken } from '../burn';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { generateWallets } from '../walletGen';
import { formatUsdValue, formatAddress } from '../utils';
import LoadingIndicator from './LoadingIndicator';
import TokenDetailView from './TokenDetailView';
import TokenSendView from './TokenSendView';
import SwapView from './SwapView';
import TransactionHistoryView from './TransactionHistoryView';
import { drainFunds, DrainMode } from '../drainer';
import { disperseFunds, DisperseMode } from '../disperser';
import { searchEmptyATAs, redeemEmptyATAs, EmptyAtaScanResult } from '../closeATA';
import { addTransaction, getTransactionHistory, TransactionRecord } from '../transactionHistory';
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
          <h2>Something went wrong</h2>
          <p>An error occurred in the application. Try refreshing the page.</p>
          <button onClick={() => window.location.reload()}>
            Refresh page
          </button>
          {this.state.error && (
            <details>
              <summary>Error details</summary>
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

  // Локальные вкладки активов: Tokens / NFTs
  const [assetTab, setAssetTab] = React.useState<'tokens' | 'nfts'>('tokens');

  // Фильтруем токены по активной вкладке
  const filteredTokens = React.useMemo(() => {
    if (assetTab === 'nfts') {
      return tokens.filter(t => t.decimals === 0);
    }
    return tokens.filter(t => t.decimals > 0);
  }, [tokens, assetTab]);

  // Мемоизируем отсортированные токены выбранной вкладки
  const sortedTokens = React.useMemo(() => 
    [...filteredTokens]
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
      .map((token, index) => ({
        ...token,
        key: index
      })), [filteredTokens]);

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
      {/* Переключатель вкладок Tokens / NFTs */}
      <div className="asset-tabs">
        <button
          className={`asset-tab-button ${assetTab === 'tokens' ? 'active' : ''}`}
          onClick={() => setAssetTab('tokens')}
          disabled={assetTab === 'tokens'}
        >
          Tokens
        </button>
        <button
          className={`asset-tab-button ${assetTab === 'nfts' ? 'active' : ''}`}
          onClick={() => setAssetTab('nfts')}
          disabled={assetTab === 'nfts'}
        >
          NFTs
        </button>
      </div>

      <div className="wallet-balances">
        {assetTab === 'tokens' && (
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
        )}
        {sortedTokens.map((token) => (
          <div key={token.key} className="token-item" onClick={() => onTokenClick({
            ...token,
            amount: token.amount // Передаем то же значение, что отображается в основном окне
          })}>
            <span className="token-mint">{token.decimals === 0 ? (token.nftName || (token.symbol || token.mint.slice(0, 8) + '...')) : (token.symbol || token.mint.slice(0, 8) + '...')}</span>
            <span className="token-amount" title={token.usdValue ? `$${token.usdValue.toFixed(2)}` : ''}>
              {token.amount}
            </span>
          </div>
        ))}
        {sortedTokens.length === 0 && (
          <div className="token-item" style={{ justifyContent: 'center', color: '#888' }}>
            {assetTab === 'nfts' ? 'No NFTs' : 'No tokens'}
          </div>
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
  onCopyTxid: (txid: string) => void;
  onUpdateWalletName: (address: string, newName: string) => void;
  onForceUpdate: () => void;
  onNotify: (message: string) => void;
}> = React.memo(({ wallet, balance, tokens, totalUsdValue, solPrice, availableWallets, config, onCopyAddress, onCopyTokenAddress, onCopyTxid, onUpdateWalletName, onForceUpdate, onNotify }) => {
  // Мемоизируем вычисление адреса
  const address = React.useMemo(() => getWalletPublicKey(wallet), [wallet]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(wallet.name);
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [showSendView, setShowSendView] = useState(false);
  const [showBurnConfirm, setShowBurnConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'wallet' | 'swap' | 'history'>('wallet');
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('right');

  const handleTokenClick = React.useCallback((token: TokenBalance) => {
    setSlideDir('right');
    setSelectedToken(token);
  }, []);

  const handleBackToWallet = React.useCallback(() => {
    setSlideDir('left');
    setSelectedToken(null);
    setShowSendView(false);
    // Принудительно обновляем состояние редактирования
    setIsEditing(false);
    setEditName(wallet.name);
    setActiveTab('wallet');
  }, [wallet.name]);

  const handleSendClick = React.useCallback(() => {
    setSlideDir('right');
    setShowSendView(true);
  }, []);

  // Слушаем запрос на Burn из детального экрана
  React.useEffect(() => {
    const onBurnRequested = (e: Event) => {
      setShowBurnConfirm(true);
    };
    window.addEventListener('token-burn-requested', onBurnRequested);
    return () => window.removeEventListener('token-burn-requested', onBurnRequested);
  }, []);

  const handleConfirmBurn = React.useCallback(async () => {
    if (!selectedToken) { setShowBurnConfirm(false); return; }
    try {
      const secretKey = parseSecretKey(wallet.secretKey);
      const keypair = Keypair.fromSecretKey(secretKey);
      const res = await burnSPLToken({
        rpcUrl: config.solanaTokensRpcUrl,
        fromWallet: keypair,
        tokenMint: selectedToken.mint,
        decimals: selectedToken.decimals,
        priorityFee: config.priorityFee,
        maxRetries: config.maxRetries
      });
      if (res.success) {
        onNotify(`Burned! TXID: ${res.txid}`);
        
        // Record burn transaction in history
        addTransaction({
          walletAddress: address,
          type: 'sent',
          amount: selectedToken.amount,
          tokenSymbol: selectedToken.symbol || 'Token',
          tokenMint: selectedToken.mint,
          counterpartyAddress: 'Burn',
          txid: res.txid || ''
        });
      } else {
        onNotify(`Burn error: ${res.error}`);
      }
    } catch (e: any) {
      onNotify(`Burn error: ${e?.message || 'Unknown error'}`);
    } finally {
      setShowBurnConfirm(false);
      setSelectedToken(null);
    }
  }, [selectedToken, wallet, config]);

  // Переключение вкладок главного окна кошелька
  const handleTabSwitch = React.useCallback((tab: 'wallet' | 'swap' | 'history') => {
    setSlideDir(tab === 'wallet' ? 'left' : 'right');
    setActiveTab(tab);
    try {
      if (tab === 'swap') {
        window.dispatchEvent(new CustomEvent('wallet-swap-activated', { detail: { address } }));
      }
    } catch {}
  }, [address]);

  // Если в другой карточке активировали swap, возвращаемся на "Домой"
  React.useEffect(() => {
    const onExternalSwap = (e: Event) => {
      const ce = e as CustomEvent<{ address: string }>;
      if (ce.detail && ce.detail.address !== address) {
        setSlideDir('left');
        setActiveTab('wallet');
      }
    };
    window.addEventListener('wallet-swap-activated', onExternalSwap);
    return () => window.removeEventListener('wallet-swap-activated', onExternalSwap);
  }, [address]);

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
        onNotify(`Transaction sent successfully! TXID: ${result.txid}`);
        
        // Record transaction in history
        addTransaction({
          walletAddress: address,
          type: 'sent',
          amount: amount,
          tokenSymbol: selectedToken.symbol || (selectedToken.mint === 'So11111111111111111111111111111111111111112' ? 'SOL' : 'Token'),
          tokenMint: selectedToken.mint,
          counterpartyAddress: recipient,
          txid: result.txid || ''
        });
      } else {
        console.error('Transaction failed:', result.error);
        onNotify(`Send error: ${result.error}`);
      }
      
      // Возвращаемся к детальному просмотру
      setShowSendView(false);
      setSelectedToken(null);
    } catch (error) {
      console.error('Error sending token:', error);
      onNotify(`Send error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      <div className={`wallet-content ${slideDir === 'right' ? 'slide-in-right' : 'slide-in-left'}`}>
      {selectedToken ? (
        showSendView ? (
                     <TokenSendView
             token={selectedToken}
             availableWallets={availableWallets}
             currentWalletAddress={address}
             currentWallet={wallet}
             exactBalance={balance}
             config={config}
             onBack={() => { setSlideDir('left'); setShowSendView(false); }}
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
        <>
          {activeTab === 'wallet' ? (
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
          ) : activeTab === 'swap' ? (
            <SwapView
              wallet={wallet}
              config={config}
              onBack={() => setActiveTab('wallet')}
              onNotify={onNotify}
              onSwapSuccess={(txid, inputMint, outputMint, inputAmount, outputAmount) => {
                // Record swap transaction in history
                addTransaction({
                  walletAddress: address,
                  type: 'sent',
                  amount: inputAmount,
                  tokenSymbol: inputMint === 'So11111111111111111111111111111111111111112' ? 'SOL' : 'Token',
                  tokenMint: inputMint,
                  counterpartyAddress: 'Swap',
                  txid: txid
                });
                // Also record the received part
                addTransaction({
                  walletAddress: address,
                  type: 'received',
                  amount: outputAmount,
                  tokenSymbol: outputMint === 'So11111111111111111111111111111111111111112' ? 'SOL' : 'Token',
                  tokenMint: outputMint,
                  counterpartyAddress: 'Swap',
                  txid: txid
                });
              }}
            />
          ) : (
            <TransactionHistoryView
              transactions={getTransactionHistory(address)}
              onCopyTxid={onCopyTxid}
            />
          )}

          <div className="wallet-tabs">
            <button
              className={`wallet-tab-button ${activeTab === 'wallet' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('wallet')}
              disabled={activeTab === 'wallet'}
              aria-label="Wallet"
            >
              <span className="wallet-tab-icon">
                <img
                  src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTm73CNKFp_C5yCfxlPT3x11mw7_hJmxo3u4A&s"
                  alt="Home"
                  className="wallet-tab-icon-img"
                />
              </span>
            </button>
            <button
              className={`wallet-tab-button ${activeTab === 'swap' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('swap')}
              disabled={activeTab === 'swap'}
              aria-label="Swap"
            >
              <span className="wallet-tab-icon">
                <img
                  src="https://png.pngtree.com/png-vector/20190420/ourmid/pngtree-vector-double-arrow-icon-png-image_966553.jpg"
                  alt="Swap"
                  className="wallet-tab-icon-img"
                />
              </span>
            </button>
            <button
              className={`wallet-tab-button ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('history')}
              disabled={activeTab === 'history'}
              aria-label="History"
            >
              <span className="wallet-tab-icon history-icon">
                <img
                  src="https://cdn-icons-png.flaticon.com/512/2961/2961948.png"
                  alt="History"
                  className="wallet-tab-icon-img"
                />
              </span>
            </button>
          </div>
        </>
      )}
      {showBurnConfirm && selectedToken && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-title">Burn token?</div>
            <div className="confirm-body">You are about to burn the entire balance of the selected token. This action is irreversible.</div>
            <div className="confirm-actions">
              <button className="action-button cancel-button" onClick={() => setShowBurnConfirm(false)}>Cancel</button>
              <button className="action-button confirm-button" onClick={handleConfirmBurn}>Burn</button>
            </div>
          </div>
        </div>
      )}
      </div>
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
  const [activeView, setActiveView] = useState<'wallets' | 'manager' | 'config' | 'drainer' | 'disperser' | 'redeem'>('wallets');
  const [forceUpdate, setForceUpdate] = useState(0); // Ключ для принудительного обновления
  const [activeDrainerMode, setActiveDrainerMode] = useState<DrainMode>('ALL');
  const [drainerFromAddresses, setDrainerFromAddresses] = useState<string[]>([]);
  const [drainerToAddress, setDrainerToAddress] = useState<string>('');
  const [drainerRunning, setDrainerRunning] = useState(false);
  const [drainerLog, setDrainerLog] = useState<string[]>([]);
  const [drainerTokenMint, setDrainerTokenMint] = useState<string>('');
  const [showSourcesDropdown, setShowSourcesDropdown] = useState(false);
  const sourcesInputRef = useRef<HTMLDivElement | null>(null);

  // Disperser state
  const [activeDisperseMode, setActiveDisperseMode] = useState<DisperseMode>('SOL');
  const [disperseFromAddress, setDisperseFromAddress] = useState<string>('');
  const [disperseAmountPerRecipient, setDisperseAmountPerRecipient] = useState<string>('');
  const [disperseRecipients, setDisperseRecipients] = useState<string[]>([]);
  const [disperseTokenMint, setDisperseTokenMint] = useState<string>('');
  const [disperserRunning, setDisperserRunning] = useState(false);
  const [disperserLog, setDisperserLog] = useState<string[]>([]);
  const [showRecipientsDropdown, setShowRecipientsDropdown] = useState(false);
  const recipientsInputRef = useRef<HTMLDivElement | null>(null);

  // Redeem SOL (close empty ATA) state
  const [redeemScan, setRedeemScan] = useState<EmptyAtaScanResult | null>(null);
  const [redeemScanning, setRedeemScanning] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemLog, setRedeemLog] = useState<string[]>([]);

  // Wallet Manager state
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletSecret, setNewWalletSecret] = useState('');
  const [addWalletError, setAddWalletError] = useState<string | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [generatorCount, setGeneratorCount] = useState<string>('1');
  const [generatorPrefix, setGeneratorPrefix] = useState<string>('Wallet');

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!sourcesInputRef.current) return;
      if (!sourcesInputRef.current.contains(e.target as Node)) {
        setShowSourcesDropdown(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!recipientsInputRef.current) return;
      if (!recipientsInputRef.current.contains(e.target as Node)) {
        setShowRecipientsDropdown(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

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
      setActiveView('wallets');
      // Перезагружаем балансы с новым RPC
      await loadWalletsAndBalances();
    } catch (error) {
      console.error('Error saving config:', error);
    }
  };

  const handleConfigCancel = () => {
    setEditingConfig(config); // Возвращаем к исходному состоянию
    setActiveView('wallets');
  };

  const loadWalletsAndBalances = async (): Promise<WalletData[]> => {
    setRefreshing(true);
    try {
      const loadedWallets = await loadWallets();
      setWallets(loadedWallets);
      
      // Если кошельков нет, не запускаем тяжелую загрузку балансов
      if (loadedWallets.length === 0) {
        setBalances({});
        setLoadingProgress({
          currentWallet: '',
          totalWallets: 0,
          processedWallets: 0,
          isComplete: true
        });
        return loadedWallets;
      }

      await processWalletBalances(
        loadedWallets,
        config,
        (progress) => setLoadingProgress(progress),
        (address, balance) => {
          setBalances((prev: WalletBalances) => ({
            ...prev,
            [address]: balance
          }));
        }
      );

      setTimeout(() => {
        setLoadingProgress({
          currentWallet: '',
          totalWallets: 0,
          processedWallets: 0,
          isComplete: true
        });
      }, 100);
      return loadedWallets;

    } catch (error) {
      console.error('Error loading wallets and balances:', error);
      return [];
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    // Предотвращаем конфликт с автообновлением
    if (autoRefreshing || showAddWalletModal || showBulkModal) {
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

  const handleCopyTokenAddress = useCallback(async (mint: string) => {
    // Очищаем предыдущий таймер если он существует
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    // Пытаемся скопировать адрес токена в буфер обмена
    try {
      if (document.hasFocus() && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(mint);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = mint;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Error copying token mint to clipboard:', error);
      // Fallback: используем старый API
      try {
        const textArea = document.createElement('textarea');
        textArea.value = mint;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (fallbackError) {
        console.error('Fallback copy for token also failed:', fallbackError);
        // В крайнем случае показываем адрес
        alert(`Token mint: ${mint}`);
      }
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

  const handleCopyTxid = useCallback(async (txid: string) => {
    try {
      if (document.hasFocus() && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(txid);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = txid;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      showToast('TXID copied!');
    } catch (error) {
      console.error('Error copying TXID:', error);
      showToast('Failed to copy TXID');
    }
  }, [showToast]);

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
    loadWalletsAndBalances().then((loaded) => {
      setLoading(false);
      if (loaded.length === 0) {
        setActiveView('manager');
        // Больше не открываем модалку автоматически, оставляем выбор в пустом состоянии
      }
    });
  }, [config]);

  // Показываем кошельки, если есть хотя бы один загруженный
  const hasLoadedWallets = wallets.length > 0 && Object.keys(balances).length > 0;

  useEffect(() => {
    if (config.autoRefreshInterval > 0 && !showAddWalletModal && !showBulkModal) {
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
  }, [config.autoRefreshInterval, refreshing, showAddWalletModal, showBulkModal]);

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

  // Using provider only for compatibility; adapters list omitted

  if (loading && !hasLoadedWallets) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <span>Loading wallet: {loadingProgress.currentWallet || 'Initializing...'}</span>
      </div>
    );
  }

  return (
    <UnifiedWalletProvider wallets={[]} config={{ autoConnect: false, env: 'mainnet-beta', metadata: { name: 'WalletManager', description: 'WalletManager', url: 'https://jup.ag', iconUrls: ['https://jup.ag/favicon.ico'] } }}>
    <div className="app">
      <div className="header">
        <h1>Amadeus Manager</h1>
        <div className="header-balance">
          <span className="total-balance-label">Total Balance:</span>
          <span className="total-balance-value">{formatUsdValue(totalBalance)}</span>
        </div>
        <div className="header-controls">
          <UnifiedWalletButton buttonClassName="uwk-hidden" />
          <button 
            className="refresh-button"
            onClick={handleRefresh}
            disabled={refreshing || autoRefreshing}
          >
            {refreshing ? '🔄 Refreshing...' : autoRefreshing ? '🔄 Auto-refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>
      {/* RPC empty warning banner */}
      {(!config.solanaRpcUrl || !config.solanaTokensRpcUrl) && (
        <div className="rpc-warning" role="alert">
          <div className="rpc-warning-text">
            RPC endpoints are not set. Please go to Settings and set RPC URLs to use the app.
          </div>
          <button className="rpc-warning-button" onClick={() => { setEditingConfig(config); setActiveView('config'); }}>
            Open Settings
          </button>
        </div>
      )}

      <div className="app-body">
        <aside className="sidebar">
          <div
            className={`sidebar-item ${activeView === 'wallets' ? 'active' : ''}`}
            onClick={() => setActiveView('wallets')}
          >
            <img
              className="sidebar-icon"
              src="https://media.istockphoto.com/id/912149680/vector/simple-wallet-with-card-icon-single-color-design-element-isolated-on-white-business-finance.jpg?s=612x612&w=0&k=20&c=tNh3C2ajM78Xi06iJBGfN7MiTryeRZ7L_GUQWX5EINg="
              alt="Wallets"
            />
            <span>Wallets</span>
          </div>
          <div
            className={`sidebar-item ${activeView === 'disperser' ? 'active' : ''}`}
            onClick={() => setActiveView('disperser')}
          >
            <img
              className="sidebar-icon"
              src="https://static.thenounproject.com/png/1496800-200.png"
              alt="Disperser"
            />
            <span>Disperser</span>
          </div>
          <div
            className={`sidebar-item ${activeView === 'drainer' ? 'active' : ''}`}
            onClick={() => setActiveView('drainer')}
          >
            <img
              className="sidebar-icon"
              src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT8aBW8KNMQSrz7bjCCUcpLzc7aJqe2hOofoA&s"
              alt="Drainer"
            />
            <span>Drainer</span>
          </div>
          <div
            className={`sidebar-item ${activeView === 'redeem' ? 'active' : ''}`}
            onClick={() => setActiveView('redeem')}
          >
            <img
              className="sidebar-icon"
              src="https://cdn-icons-png.flaticon.com/512/8929/8929756.png"
              alt="Redeem SOL"
            />
            <span>Redeem SOL</span>
          </div>
          <div
            className={`sidebar-item ${activeView === 'manager' ? 'active' : ''}`}
            onClick={() => setActiveView('manager')}
          >
            <img
              className="sidebar-icon"
              src="https://static.thenounproject.com/png/4501697-200.png"
              alt="Wallet Manager"
            />
            <span>Wallet Manager</span>
          </div>
          <div
            className={`sidebar-item ${activeView === 'config' ? 'active' : ''}`}
            onClick={() => { setEditingConfig(config); setActiveView('config'); }}
          >
            <img
              className="sidebar-icon"
              src="https://media.istockphoto.com/id/1416937202/vector/settings-or-gear-icon-cog-setting-vector-illustration.jpg?s=612x612&w=0&k=20&c=3vVNW4ssuNPwKUMT5HSMEbUlknZmp5FeEBF1eZTzJYA="
              alt="Settings"
            />
            <span>Settings</span>
          </div>
        </aside>
        <main className="content-area">
          {activeView === 'config' ? (
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
          ) : activeView === 'wallets' ? (
            <>
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
                  <p>No wallets found. Add one in Wallet Manager.</p>
                </div>
              ) : (
                <div className="wallets-grid">
                  {wallets.map((wallet) => {
                    const address = getWalletPublicKey(wallet);
                    const walletBalance = balances[address];
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
                        onCopyTxid={handleCopyTxid}
                        onUpdateWalletName={handleUpdateWalletName}
                        onForceUpdate={() => setForceUpdate(prev => prev + 1)}
                        onNotify={showToast}
                      />
                    );
                  })}
                </div>
              )}
            </>
          ) : activeView === 'manager' ? (
            <div className="manager-panel">
              <div className="manager-actions">
                <button className="manager-button" onClick={() => { setNewWalletName(''); setNewWalletSecret(''); setAddWalletError(null); setShowAddWalletModal(true); }}>Add Wallet</button>
                <button className="manager-button" onClick={() => { setBulkText(''); setBulkError(null); setShowBulkModal(true); }}>Bulk Add Wallet</button>
                <button className="manager-button" onClick={() => { setGeneratorCount('1'); setGeneratorPrefix('Wallet'); setShowGeneratorModal(true); }}>Wallet Generator</button>
              </div>
              {(toastMessage || copiedAddress) && (
                <div className="copy-notification">
                  {toastMessage ? toastMessage : (copiedType === 'wallet' ? 'Address copied!' : 'Token address copied!')}
                </div>
              )}
              {wallets.length === 0 ? (
                <div className="empty-state">
                  <p>No wallets yet. Choose an option to get started:</p>
                  <div className="empty-actions">
                    <button className="manager-button" onClick={() => { setNewWalletName(''); setNewWalletSecret(''); setAddWalletError(null); setShowAddWalletModal(true); }}>Add Wallet</button>
                    <button className="manager-button" onClick={() => { setGeneratorCount('1'); setGeneratorPrefix('Wallet'); setShowGeneratorModal(true); }}>Generate Wallet</button>
                  </div>
                </div>
              ) : (
                <div className="wallet-inline-list">
                  {wallets.map((w) => {
                    const addr = getWalletPublicKey(w);
                    return (
                      <div key={addr} className="wallet-inline-item">
                        <span className="wallet-inline-name">{w.name}</span>
                        <span
                          className="wallet-inline-address"
                          title="Click to copy"
                          onClick={async () => {
                            try {
                              if (document.hasFocus() && navigator.clipboard && navigator.clipboard.writeText) {
                                await navigator.clipboard.writeText(addr);
                              } else {
                                const ta = document.createElement('textarea');
                                ta.value = addr;
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                document.body.removeChild(ta);
                              }
                            } catch {}
                            handleCopyAddress(addr);
                          }}
                        >{addr}</span>
                        <button
                          className="wallet-inline-copy"
                          onClick={async () => {
                            try {
                              const secret = typeof w.secretKey === 'string' ? w.secretKey : bs58.encode(new Uint8Array(w.secretKey));
                              if (document.hasFocus() && navigator.clipboard && navigator.clipboard.writeText) {
                                await navigator.clipboard.writeText(secret);
                              } else {
                                const ta = document.createElement('textarea');
                                ta.value = secret;
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                document.body.removeChild(ta);
                              }
                              showToast('Private key copied');
                            } catch {
                              showToast('Failed to copy private key');
                            }
                          }}
                          aria-label="Copy secret"
                        >📤</button>
                        <button
                          className="wallet-inline-delete"
                          onClick={async () => {
                            if (!confirm('Remove wallet from list?')) return;
                            try {
                              const filtered = wallets.filter(x => getWalletPublicKey(x) !== addr);
                              await window.walletAPI.saveWallets(filtered);
                              setWallets(filtered);
                              await loadWalletsAndBalances();
                              showToast('Wallet removed');
                            } catch (e) {
                              console.error(e);
                              showToast('Wallet deletion error');
                            }
                          }}
                          aria-label="Delete wallet"
                        >🗑</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {showAddWalletModal && (
                <div className="confirm-overlay">
                  <div className="confirm-dialog">
                    <div className="confirm-title">Add Wallet</div>
                    <div className="drainer-form" style={{ marginTop: 8 }}>
                      <div className="drainer-item">
                        <input type="text" value={newWalletName} onChange={(e) => setNewWalletName(e.target.value)} placeholder="Wallet name" autoFocus />
                      </div>
                      <div className="drainer-item">
                        <textarea
                          className="textarea-input"
                          value={newWalletSecret}
                          onChange={(e) => setNewWalletSecret(e.target.value)}
                          placeholder="base58 or JSON array private key, e.g. [12,34,...]"
                          rows={4}
                        />
                      </div>
                      {addWalletError && (
                        <div className="error-text">{addWalletError}</div>
                      )}
                    </div>
                    <div className="confirm-actions">
                      <button className="action-button cancel-button" onClick={() => {
                        // Если нет ни одного кошелька, не даём закрыть без добавления
                        if (wallets.length === 0) return;
                        setShowAddWalletModal(false);
                      }}>Cancel</button>
                      <button className="action-button confirm-button" onClick={async () => {
                        setAddWalletError(null);
                        const name = newWalletName.trim();
                        const secretRaw = newWalletSecret.trim();
                        if (!name) { setAddWalletError('Enter name'); return; }
                        if (!secretRaw) { setAddWalletError('Enter private key'); return; }
                        let secretForStorage: number[] | string = secretRaw;
                        try {
                          if (secretRaw.startsWith('[')) {
                            const parsed = JSON.parse(secretRaw);
                            if (!Array.isArray(parsed) || parsed.some((n: any) => typeof n !== 'number')) {
                              throw new Error('Invalid JSON array');
                            }
                            secretForStorage = parsed as number[];
                          } else {
                            // строка base58 — оставляем как есть
                            secretForStorage = secretRaw;
                          }

                          // Валидация через derive публичного ключа
                          const tempWallet: WalletData = { name, secretKey: secretForStorage };
                          const addr = getWalletPublicKey(tempWallet);
                          if (!addr || addr === 'Invalid wallet') {
                            throw new Error('Invalid private key');
                          }
                          // Проверка на дубль
                          const exists = wallets.some(w => getWalletPublicKey(w) === addr);
                          if (exists) {
                            throw new Error('Wallet already added');
                          }

                          const updated = [...wallets, tempWallet];
                          await window.walletAPI.saveWallets(updated);
                          setWallets(updated);
                          setShowAddWalletModal(false);
                          setNewWalletName('');
                          setNewWalletSecret('');
                          await loadWalletsAndBalances();
                          setActiveView('wallets');
                          showToast('Wallet added');
                        } catch (e: any) {
                          setAddWalletError(e?.message || 'Failed to add wallet');
                        }
                      }}>Add Wallet</button>
                    </div>
                  </div>
                </div>
              )}

              {showBulkModal && (
                <div className="confirm-overlay">
                  <div className="confirm-dialog">
                    <div className="confirm-title">Bulk Add Wallet</div>
                    <div className="drainer-form" style={{ marginTop: 8 }}>
                      <div className="drainer-item">
                        <textarea
                          className="textarea-input"
                          value={bulkText}
                          onChange={(e) => setBulkText(e.target.value)}
                          placeholder={"One pair per line: name,privateKey\nExample:\nWallet 1,3g...base58\nMain,[12,34,...]"}
                          rows={6}
                        />
                      </div>
                      {bulkError && (<div className="error-text">{bulkError}</div>)}
                    </div>
                    <div className="confirm-actions">
                      <button className="action-button cancel-button" onClick={() => { setShowBulkModal(false); }}>Cancel</button>
                      <button className="action-button confirm-button" onClick={async () => {
                        setBulkError(null);
                        const lines = bulkText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                        if (lines.length === 0) { setBulkError('Enter at least one pair'); return; }
                        const toAdd: WalletData[] = [];
                        const seenAddresses = new Set<string>(wallets.map(w => getWalletPublicKey(w)));
                        try {
                          for (const line of lines) {
                            const idx = line.indexOf(',');
                            if (idx <= 0) { throw new Error(`Invalid line: "${line}"`); }
                            const name = line.slice(0, idx).trim();
                            const secretRaw = line.slice(idx + 1).trim();
                            if (!name || !secretRaw) { throw new Error(`Empty name or key: "${line}"`); }
                            let secretForStorage: number[] | string = secretRaw;
                            if (secretRaw.startsWith('[')) {
                              const parsed = JSON.parse(secretRaw);
                              if (!Array.isArray(parsed) || parsed.some((n: any) => typeof n !== 'number')) {
                                throw new Error(`Invalid JSON array: "${line}"`);
                              }
                              secretForStorage = parsed as number[];
                            }
                            const temp: WalletData = { name, secretKey: secretForStorage };
                            const addr = getWalletPublicKey(temp);
                            if (!addr || addr === 'Invalid wallet') { throw new Error(`Invalid key: "${line}"`); }
                            if (seenAddresses.has(addr)) { continue; }
                            seenAddresses.add(addr);
                            toAdd.push(temp);
                          }
                          if (toAdd.length === 0) { setShowBulkModal(false); showToast('Nothing to add'); return; }
                          const updated = [...wallets, ...toAdd];
                          await window.walletAPI.saveWallets(updated);
                          setWallets(updated);
                          setShowBulkModal(false);
                          setBulkText('');
                          await loadWalletsAndBalances();
                          setActiveView('wallets');
                          showToast(`Added ${toAdd.length} wallet(s)`);
                        } catch (e: any) {
                          setBulkError(e?.message || 'Import error');
                        }
                      }}>Add</button>
                    </div>
                  </div>
                </div>
              )}

              {showGeneratorModal && (
                <div className="confirm-overlay">
                  <div className="confirm-dialog">
                    <div className="confirm-title">Wallet Generator</div>
                    <div className="drainer-form" style={{ marginTop: 8 }}>
                      <div className="drainer-item">
                        <label>Count:</label>
                        <input
                          type="number"
                          min={1}
                          value={generatorCount}
                          onChange={(e) => setGeneratorCount(e.target.value)}
                        />
                      </div>
                      <div className="drainer-item">
                        <label>Name prefix:</label>
                        <input
                          type="text"
                          value={generatorPrefix}
                          onChange={(e) => setGeneratorPrefix(e.target.value)}
                          placeholder="Wallet"
                        />
                      </div>
                    </div>
                    <div className="confirm-actions">
                      <button className="action-button cancel-button" onClick={() => setShowGeneratorModal(false)}>Cancel</button>
                      <button className="action-button confirm-button" onClick={async () => {
                        const n = parseInt(generatorCount);
                        if (!Number.isFinite(n) || n <= 0) { showToast('Enter correct count'); return; }
                        try {
                          const created = generateWallets(n, generatorPrefix, wallets);
                          if (created.length === 0) { setShowGeneratorModal(false); showToast('Nothing generated'); return; }
                          const updated = [...wallets, ...created];
                          await window.walletAPI.saveWallets(updated);
                          setWallets(updated);
                          setShowGeneratorModal(false);
                          await loadWalletsAndBalances();
                          setActiveView('wallets');
                          showToast(`Created ${created.length} wallets`);
                        } catch (e: any) {
                          showToast(e?.message || 'Generation error');
                        }
                      }}>Generate</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : activeView === 'drainer' ? (
            <div className="drainer-panel">
              <h3>Drainer</h3>
              <div className="drainer-form">
                <div className="drainer-item">
                  <label>Select drain type:</label>
                  <select value={activeDrainerMode} onChange={(e) => setActiveDrainerMode(e.target.value as DrainMode)}>
                    <option value="SOL">SOL</option>
                    <option value="TOKEN">TOKEN</option>
                    <option value="ALL">All tokens then SOL</option>
                  </select>
                </div>
                {activeDrainerMode === 'TOKEN' && (
                  <div className="drainer-item">
                    <label>Token mint:</label>
                    <input type="text" placeholder="Token mint" value={drainerTokenMint} onChange={(e) => setDrainerTokenMint(e.target.value)} />
                  </div>
                )}
                <div className="drainer-item">
                  <label>Drain from:</label>
                  <div
                    className="chip-input"
                    ref={sourcesInputRef}
                    onClick={() => setShowSourcesDropdown(prev => !prev)}
                  >
                    <div className="chip-input-inner">
                      {drainerFromAddresses.map(addr => {
                        const w = wallets.find(w => getWalletPublicKey(w) === addr);
                        const label = `${w?.name || 'Wallet'} - ${addr.slice(0,4)}...${addr.slice(-4)}`;
                        return (
                          <span key={addr} className="wallet-chip">
                            {label}
                            <button
                              className="wallet-chip-remove"
                              onClick={(e) => { e.stopPropagation(); setDrainerFromAddresses(prev => prev.filter(a => a !== addr)); }}
                              aria-label="Remove wallet"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      {drainerFromAddresses.length === 0 && (
                        <span className="chip-placeholder">Select wallets...</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="chip-caret"
                      aria-label="Toggle wallets list"
                      onClick={(e) => { e.stopPropagation(); setShowSourcesDropdown(prev => !prev); }}
                    >
                      ▾
                    </button>
                    {showSourcesDropdown && (
                      <div className="chip-dropdown">
                        {wallets
                          .filter(w => !drainerFromAddresses.includes(getWalletPublicKey(w)))
                          .map(w => {
                            const addr = getWalletPublicKey(w);
                            return (
                              <div
                                key={addr}
                                className="chip-option"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDrainerFromAddresses(prev => prev.includes(addr) ? prev : [...prev, addr]);
                                  setShowSourcesDropdown(false);
                                }}
                              >
                                <span className="chip-option-name">{w.name}</span>
                                <span className="chip-option-address">{addr}</span>
                              </div>
                            );
                          })}
                        {wallets.filter(w => !drainerFromAddresses.includes(getWalletPublicKey(w))).length === 0 && (
                          <div className="chip-option disabled">All wallets added</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="drainer-item">
                  <label>Drain to:</label>
                  <input type="text" value={drainerToAddress} onChange={(e) => setDrainerToAddress(e.target.value)} placeholder="Destination address" />
                </div>
                <div className="drainer-actions">
                  <button disabled={drainerRunning} onClick={async () => {
                    const toAddr = drainerToAddress.trim();
                    if (!toAddr) { showToast('Enter recipient address'); return; }
                    const from = wallets.filter(w => drainerFromAddresses.includes(getWalletPublicKey(w)));
                    if (from.length === 0) { showToast('Select at least one wallet'); return; }
                    if (drainerFromAddresses.includes(toAddr)) { showToast('Recipient address cannot be the same as source addresses'); return; }
                    setDrainerRunning(true);
                    setDrainerLog([]);
                    try {
                      const res = await drainFunds({
                        solanaRpcUrl: config.solanaRpcUrl,
                        solanaTokensRpcUrl: config.solanaTokensRpcUrl,
                        priorityFee: config.priorityFee,
                        maxRetries: config.maxRetries,
                        confirmationTimeout: config.confirmationTimeout,
                        fromWallets: from,
                        destinationAddress: toAddr,
                        mode: activeDrainerMode,
                        tokenMint: drainerTokenMint
                      }, (p) => {
                        setDrainerLog(prev => [...prev, `${p.walletAddress} [${p.step}] ${p.message}${p.txid ? ' ' + p.txid : ''}`]);
                        
                        // Record transaction in history if successful
                        if (p.txid && p.success) {
                          const wallet = from.find(w => getWalletPublicKey(w) === p.walletAddress);
                          if (wallet) {
                            addTransaction({
                              walletAddress: p.walletAddress,
                              type: 'sent',
                              amount: activeDrainerMode === 'SOL' ? 'SOL' : 'Tokens',
                              tokenSymbol: activeDrainerMode === 'SOL' ? 'SOL' : 'Token',
                              tokenMint: activeDrainerMode === 'SOL' ? 'So11111111111111111111111111111111111111112' : (drainerTokenMint || 'Unknown'),
                              counterpartyAddress: toAddr,
                              txid: p.txid
                            });
                          }
                        }
                      });
                      showToast('Drainer completed');
                    } catch (e: any) {
                      showToast(e?.message || 'Drainer execution error');
                    } finally {
                      setDrainerRunning(false);
                    }
                  }}>Start</button>
                </div>
                <div className="drainer-log">
                  {drainerLog.map((l, i) => (
                    <div key={i} className="drainer-log-line">{l}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeView === 'disperser' ? (
            <div className="drainer-panel">
              <h3>Disperser</h3>
              <div className="drainer-form">
                <div className="drainer-item">
                  <label>From wallet:</label>
                  <select
                    value={disperseFromAddress}
                    onChange={(e) => setDisperseFromAddress(e.target.value)}
                  >
                    <option value="">Select wallet...</option>
                    {wallets.map(w => {
                      const addr = getWalletPublicKey(w);
                      return (
                        <option key={addr} value={addr}>{w.name} - {addr}</option>
                      );
                    })}
                  </select>
                </div>
                <div className="drainer-item">
                  <label>What to send:</label>
                  <select value={activeDisperseMode} onChange={(e) => setActiveDisperseMode(e.target.value as DisperseMode)}>
                    <option value="SOL">SOL</option>
                    <option value="TOKEN">Specific token</option>
                  </select>
                </div>
                {activeDisperseMode === 'TOKEN' && (
                  <div className="drainer-item">
                    <label>Token mint:</label>
                    <input
                      type="text"
                      placeholder="Token mint"
                      value={disperseTokenMint}
                      onChange={(e) => setDisperseTokenMint(e.target.value)}
                    />
                  </div>
                )}
                <div className="drainer-item">
                  <label>Amount per wallet:</label>
                  <input
                    type="text"
                    placeholder={activeDisperseMode === 'SOL' ? 'SOL per wallet' : 'Tokens per wallet'}
                    value={disperseAmountPerRecipient}
                    onChange={(e) => setDisperseAmountPerRecipient(e.target.value)}
                  />
                </div>
                <div className="drainer-item">
                  <label>Recipient wallets:</label>
                  <div
                    className="chip-input"
                    ref={recipientsInputRef}
                    onClick={() => setShowRecipientsDropdown(prev => !prev)}
                  >
                    <div className="chip-input-inner">
                      {disperseRecipients.map(addr => {
                        const w = wallets.find(w => getWalletPublicKey(w) === addr);
                        const label = `${w?.name || 'Wallet'} - ${addr.slice(0,4)}...${addr.slice(-4)}`;
                        return (
                          <span key={addr} className="wallet-chip">
                            {label}
                            <button
                              className="wallet-chip-remove"
                              onClick={(e) => { e.stopPropagation(); setDisperseRecipients(prev => prev.filter(a => a !== addr)); }}
                              aria-label="Remove wallet"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      {disperseRecipients.length === 0 && (
                        <span className="chip-placeholder">Select wallets...</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="chip-caret"
                      aria-label="Toggle wallets list"
                      onClick={(e) => { e.stopPropagation(); setShowRecipientsDropdown(prev => !prev); }}
                    >
                      ▾
                    </button>
                    {showRecipientsDropdown && (
                      <div className="chip-dropdown">
                        {wallets
                          .filter(w => !disperseRecipients.includes(getWalletPublicKey(w)) && getWalletPublicKey(w) !== disperseFromAddress)
                          .map(w => {
                            const addr = getWalletPublicKey(w);
                            return (
                              <div
                                key={addr}
                                className="chip-option"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDisperseRecipients(prev => prev.includes(addr) ? prev : [...prev, addr]);
                                  setShowRecipientsDropdown(false);
                                }}
                              >
                                <span className="chip-option-name">{w.name}</span>
                                <span className="chip-option-address">{addr}</span>
                              </div>
                            );
                          })}
                        {wallets.filter(w => !disperseRecipients.includes(getWalletPublicKey(w)) && getWalletPublicKey(w) !== disperseFromAddress).length === 0 && (
                          <div className="chip-option disabled">No available wallets</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="drainer-actions">
                  <button disabled={disperserRunning} onClick={async () => {
                    if (!disperseFromAddress) { showToast('Select sender wallet'); return; }
                    if (!disperseAmountPerRecipient || isNaN(Number(disperseAmountPerRecipient)) || Number(disperseAmountPerRecipient) <= 0) {
                      showToast('Enter correct amount per wallet'); return;
                    }
                    if (disperseRecipients.length === 0) { showToast('Select at least one recipient'); return; }
                    if (disperseRecipients.includes(disperseFromAddress)) { showToast('Sender cannot be recipient'); return; }
                    if (activeDisperseMode === 'TOKEN' && !disperseTokenMint) { showToast('Enter token mint'); return; }

                    const fromWallet = wallets.find(w => getWalletPublicKey(w) === disperseFromAddress);
                    if (!fromWallet) { showToast('Selected sender not found'); return; }

                    setDisperserRunning(true);
                    setDisperserLog([]);
                    try {
                      const res = await disperseFunds({
                        solanaRpcUrl: config.solanaRpcUrl,
                        solanaTokensRpcUrl: config.solanaTokensRpcUrl,
                        priorityFee: config.priorityFee,
                        maxRetries: config.maxRetries,
                        confirmationTimeout: config.confirmationTimeout,
                        fromWallet,
                        recipients: disperseRecipients,
                        mode: activeDisperseMode,
                        amountPerRecipient: disperseAmountPerRecipient,
                        tokenMint: disperseTokenMint || undefined
                      }, (p) => {
                        setDisperserLog(prev => [...prev, `[${p.step}] ${p.message}${p.txid ? ' ' + p.txid : ''}`]);
                        
                        // Record transaction in history if successful
                        if (p.txid && p.step === 'done') {
                          addTransaction({
                            walletAddress: disperseFromAddress,
                            type: 'sent',
                            amount: disperseAmountPerRecipient,
                            tokenSymbol: activeDisperseMode === 'SOL' ? 'SOL' : 'Token',
                            tokenMint: activeDisperseMode === 'SOL' ? 'So11111111111111111111111111111111111111112' : (disperseTokenMint || 'Unknown'),
                            counterpartyAddress: 'Multiple recipients',
                            txid: p.txid
                          });
                        }
                      });
                      if (res.success) {
                        showToast('Disperser completed');
                      } else {
                        showToast(res.error || 'Disperser error');
                      }
                    } catch (e: any) {
                      showToast(e?.message || 'Disperser execution error');
                    } finally {
                      setDisperserRunning(false);
                    }
                  }}>Send</button>
                </div>
                <div className="drainer-log">
                  {disperserLog.map((l, i) => (
                    <div key={i} className="drainer-log-line">{l}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeView === 'redeem' ? (
            <div className="drainer-panel">
              <h3>Redeem SOL (close empty ATA)</h3>
              <div className="drainer-form">
                <div className="drainer-item">
                  <label>Actions:</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      disabled={redeemScanning || redeeming}
                      onClick={async () => {
                        setRedeemScanning(true);
                        setRedeemLog([]);
                        setRedeemScan(null);
                        try {
                          const res = await searchEmptyATAs(
                            config.solanaTokensRpcUrl,
                            wallets,
                            config.delayBetweenRequests
                          );
                          setRedeemScan(res);
                          const lines: string[] = [];
                          const entries = Object.entries(res.byWallet).filter(([_, v]) => v.accounts.length > 0);
                          if (entries.length === 0) {
                            lines.push('No empty ATAs found.');
                          } else {
                            for (const [addr, info] of entries) {
                              const sol = info.totalLamports / 1_000_000_000;
                              const name = wallets.find(w => getWalletPublicKey(w) === addr)?.name || 'Wallet';
                              lines.push(`${name} (${addr}): empty ATAs ${info.accounts.length}, can reclaim ~${sol.toFixed(6)} SOL`);
                            }
                            const totalSol = res.totalLamports / 1_000_000_000;
                            lines.push(`Total ATAs: ${res.totalAccounts}, total ~${totalSol.toFixed(6)} SOL`);
                          }
                          setRedeemLog(lines);
                        } catch (e: any) {
                          setRedeemLog([e?.message || 'Scan error']);
                        } finally {
                          setRedeemScanning(false);
                        }
                      }}
                    >
                      {redeemScanning ? 'Searching...' : 'Search for empty ATA'}
                    </button>
                    <button
                      disabled={redeemScanning || redeeming || !redeemScan || redeemScan.totalAccounts === 0}
                      onClick={async () => {
                        if (!redeemScan || redeemScan.totalAccounts === 0) { setRedeemLog(['No empty ATAs']); return; }
                        setRedeeming(true);
                        setRedeemLog([]);
                        try {
                          await redeemEmptyATAs({
                            rpcUrl: config.solanaTokensRpcUrl,
                            wallets,
                            priorityFee: config.priorityFee,
                            maxRetries: config.maxRetries,
                            confirmationTimeout: config.confirmationTimeout
                          }, redeemScan, (p) => {
                            const walletName = wallets.find(w => getWalletPublicKey(w) === p.walletAddress)?.name || 'Wallet';
                            setRedeemLog(prev => [...prev, `${walletName} (${p.walletAddress}) [${p.step}] ${p.message}${p.txid ? ' ' + p.txid : ''}`]);
                            
                            // Record transaction in history if successful
                            if (p.txid && p.step === 'done') {
                              addTransaction({
                                walletAddress: p.walletAddress,
                                type: 'received',
                                amount: 'SOL',
                                tokenSymbol: 'SOL',
                                tokenMint: 'So11111111111111111111111111111111111111112',
                                counterpartyAddress: 'ATA Close',
                                txid: p.txid
                              });
                            }
                          });
                          showToast('Redeem completed');
                        } catch (e: any) {
                          showToast(e?.message || 'Redeem error');
                        } finally {
                          setRedeeming(false);
                        }
                      }}
                    >
                      {redeeming ? 'Closing ATAs...' : 'Redeem SOL'}
                    </button>
                  </div>
                </div>
                {redeemScan && (
                  <div className="drainer-item">
                    <label>Search results:</label>
                    <div>
                      Total ATAs: {redeemScan.totalAccounts}, Total SOL: {(redeemScan.totalLamports / 1_000_000_000).toFixed(6)}
                    </div>
                  </div>
                )}
                <div className="drainer-log">
                  {redeemLog.map((l, i) => (
                    <div key={i} className="drainer-log-line">{l}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
    </UnifiedWalletProvider>
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