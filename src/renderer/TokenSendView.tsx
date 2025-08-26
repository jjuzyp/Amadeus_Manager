import React, { useState, useEffect } from 'react';
import { TokenBalance, WalletData, Config } from '../types';
import { getWalletPublicKey } from '../loadWallets';
import { formatUsdValue, formatAddress } from '../utils';

interface TokenSendViewProps {
  token: TokenBalance;
  availableWallets: WalletData[];
  currentWalletAddress: string; // Add current wallet address
  currentWallet: WalletData; // Добавляем текущий кошелек
  exactBalance: number; // Точный баланс из balances
  config: Config; // Добавляем конфигурацию
  onBack: () => void;
  onSend: (recipient: string, amount: string) => Promise<void>;
}

const TokenSendView: React.FC<TokenSendViewProps> = ({ 
  token, 
  availableWallets, 
  currentWalletAddress,
  currentWallet,
  exactBalance,
  config,
  onBack, 
  onSend 
}) => {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [showWalletList, setShowWalletList] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [isSending, setIsSending] = useState(false);

  const handleMaxClick = async () => {
    if (token.symbol === 'SOL') {
      // Max for SOL temporarily disabled while we rewrite the logic
      return;
    }
    const decimals = token.decimals || 9;
    const currentBalance = parseFloat(token.amount);
    setAmount(currentBalance.toFixed(decimals));
  };

  const handleNext = () => {
    if (recipient.trim() && amount.trim() && parseFloat(amount) > 0) {
      setStep('confirm');
    }
  };

  const handleConfirm = async () => {
    if (recipient.trim() && amount.trim() && parseFloat(amount) > 0) {
      // sending info logged by parent toast
      setIsSending(true);
      try {
        await onSend(recipient.trim(), amount);
      } finally {
        setIsSending(false);
      }
    }
  };

  const handleCancel = () => {
    setRecipient('');
    setAmount('');
    setStep('input');
  };

  const handleBack = () => {
    if (step === 'confirm') {
      setStep('input');
    } else {
      onBack();
    }
  };

  const selectWallet = (wallet: WalletData) => {
    const walletAddress = getWalletAddress(wallet);
    setRecipient(walletAddress);
    setShowWalletList(false);
  };



  const estimatedUsdValue = token.usdPrice && amount ? 
    parseFloat(amount) * token.usdPrice : 0;

  // Filter out current wallet and get wallet addresses
  const filteredWallets = availableWallets.filter(wallet => {
    const walletAddress = getWalletPublicKey(wallet);
    return walletAddress !== currentWalletAddress;
  });
  
  const getWalletAddress = (wallet: WalletData): string => {
    return getWalletPublicKey(wallet);
  };

  if (step === 'confirm') {
    return (
      <div className="token-send-view">
        {/* Header */}
        <div className="token-send-header">
          <button className="back-button" onClick={handleBack}>
            ‹
          </button>
          <div className="token-send-title">
            <h3>Подтверждение отправки</h3>
          </div>
        </div>

        {/* Token info */}
        <div className="token-info-section">
          <div className="token-icon">
            {token.symbol === 'SOL' ? '◎' : '🪙'}
          </div>
          <div className="token-details">
            <div className="token-name">{token.symbol || token.mint.slice(0, 8) + '...'}</div>
            <div className="token-balance">Баланс: {token.amount}</div>
          </div>
        </div>

        {/* Confirmation details */}
        <div className="confirmation-details">
          <div className="detail-row">
            <span className="detail-label">Получатель:</span>
            <span className="detail-value">{formatAddress(recipient)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Сумма:</span>
            <span className="detail-value">{amount} {token.symbol}</span>
          </div>
          {estimatedUsdValue > 0 && (
            <div className="detail-row">
              <span className="detail-label">Стоимость:</span>
              <span className="detail-value">{formatUsdValue(estimatedUsdValue)}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="token-send-actions">
          <button className="action-button cancel-button" onClick={handleCancel} disabled={isSending}>
            Отмена
          </button>
          <button className="action-button confirm-button" onClick={handleConfirm} disabled={isSending}>
            {isSending ? 'Отправка...' : 'Отправить'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="token-send-view">
      {/* Header */}
      <div className="token-send-header">
        <button className="back-button" onClick={handleBack}>
          ‹
        </button>
        <div className="token-send-title">
          <h3>Отправить {token.symbol || 'токен'}</h3>
        </div>
      </div>

      {/* Recipient input */}
      <div className="input-section">
        <label className="input-label">Получатель</label>
        <div className="input-container">
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Адрес получателя Solana"
            className="recipient-input"
          />
          <button 
            className="wallet-select-button"
            onClick={() => setShowWalletList(!showWalletList)}
          >
            ☰
          </button>
        </div>
        {showWalletList && (
          <div className="wallet-list">
            {filteredWallets.map((wallet, index) => (
              <div 
                key={index} 
                className="wallet-item"
                onClick={() => selectWallet(wallet)}
              >
                <span className="wallet-name">{wallet.name}</span>
                <span className="wallet-address">({formatAddress(getWalletAddress(wallet))})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Amount input */}
      <div className="input-section">
        <label className="input-label">Сумма</label>
        <div className="input-container">
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="amount-input"
          />
          <span className="token-symbol">{token.symbol}</span>
        </div>
        <div className="amount-info">
          <span className="usd-value">
            ~{formatUsdValue(estimatedUsdValue)}
          </span>
          <div className="available-balance-container">
            <span className="available-balance">
              Доступно {token.amount} {token.symbol}
            </span>
            {token.symbol !== 'SOL' && (
              <button className="max-button-small" onClick={handleMaxClick}>
                Max
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="token-send-actions">
        <button className="action-button cancel-button" onClick={handleBack}>
          Отмена
        </button>
        <button 
          className="action-button next-button" 
          onClick={handleNext}
          disabled={!recipient.trim() || !amount.trim() || parseFloat(amount) <= 0}
        >
          Далее
        </button>
      </div>
    </div>
  );
};

export default TokenSendView;
