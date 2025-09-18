import React, { useState, useEffect } from 'react';
import { TokenBalance, WalletData, Config } from '../types';
import { getWalletPublicKey } from '../loadWallets';
import { formatUsdValue, formatAddress } from '../utils';
import { Connection, PublicKey, SystemProgram, TransactionMessage, ComputeBudgetProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

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
  const [transitionDir, setTransitionDir] = useState<'left' | 'right'>('right');
  const [maxSolCached, setMaxSolCached] = useState<number | null>(null);

  const computeMaxSol = async (): Promise<number> => {
    const rpcUrl = config.solanaTokensRpcUrl || config.solanaRpcUrl;
    const connection = new Connection(rpcUrl);
    const sender = new PublicKey(currentWalletAddress);

    // Получаем актуальный баланс
    const balanceLamports = await connection.getBalance(sender, 'finalized');

    // Оценка комиссии: черновой transfer и расчет feeForMessage
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    let toKey: PublicKey;
    try { toKey = new PublicKey(recipient); } catch { toKey = sender; }
    const draftIx = SystemProgram.transfer({ fromPubkey: sender, toPubkey: toKey, lamports: 0 });
    const feeMsg = new TransactionMessage({ payerKey: sender, recentBlockhash: blockhash, instructions: [draftIx] }).compileToV0Message();
    const feeRes = await connection.getFeeForMessage(feeMsg);
    const feeLamports = feeRes.value ?? 5000;

    // Приоритетная комиссия (та же логика, что при отправке)
    const computeUnitLimit = 200_000;
    const computeUnitPriceMicro = 1000;
    const priorityFeeLamports = Math.floor((computeUnitLimit * computeUnitPriceMicro) / 1_000_000);

    const maxSendable = Math.max(0, balanceLamports - feeLamports - priorityFeeLamports);
    const maxSol = maxSendable / LAMPORTS_PER_SOL;
    setMaxSolCached(maxSol);
    return maxSol;
  };

  const handleMaxClick = async () => {
    if (token.symbol === 'SOL') {
      try {
        const maxSol = await computeMaxSol();
        setAmount(maxSol.toFixed(9));
      } catch {
        setAmount((exactBalance || 0).toFixed(9));
      }
      return;
    }
    const decimals = token.decimals || 9;
    const currentBalance = parseFloat(token.amount);
    setAmount(currentBalance.toFixed(decimals));
  };

  const handleAmountChange = (val: string) => {
    const normalized = val.replace(',', '.');
    setAmount(normalized);
    const n = parseFloat(normalized);
    if (isNaN(n)) return;
    if (token.symbol === 'SOL') {
      const immediateCap = isNaN(exactBalance) ? n : exactBalance;
      if (n > immediateCap) {
        (maxSolCached !== null ? Promise.resolve(maxSolCached) : computeMaxSol())
          .then(m => setAmount(m.toFixed(9)))
          .catch(() => setAmount((exactBalance || 0).toFixed(9)));
      }
    } else {
      const max = parseFloat(token.amount);
      const decimals = token.decimals || 9;
      if (n > max) {
        setAmount(max.toFixed(decimals));
      }
    }
  };

  const handleNext = () => {
    if (recipient.trim() && amount.trim() && parseFloat(amount) > 0) {
      setTransitionDir('right');
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
      setTransitionDir('left');
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
      <div className={`token-send-view ${transitionDir === 'right' ? 'slide-in-right' : 'slide-in-left'}`}>
        {/* Header without back button */}
        <div className="token-send-header">
          <div className="token-send-title">
            <h3>Confirm Send</h3>
          </div>
        </div>

        {/* Token info */}
        <div className="token-info-section">
          <div className="token-icon">
            {token.symbol === 'SOL' ? '◎' : '🪙'}
          </div>
          <div className="token-details">
            <div className="token-name">{token.symbol || token.mint.slice(0, 8) + '...'}</div>
            <div className="token-balance">Balance: {token.amount}</div>
          </div>
        </div>

        {/* Confirmation details */}
        <div className="confirmation-details">
          <div className="detail-row">
            <span className="detail-label">Recipient:</span>
            <span className="detail-value">{formatAddress(recipient)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Amount:</span>
            <span className="detail-value">{amount} {token.symbol}</span>
          </div>
          {estimatedUsdValue > 0 && (
            <div className="detail-row">
              <span className="detail-label">Value:</span>
              <span className="detail-value">{formatUsdValue(estimatedUsdValue)}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="token-send-actions">
          <button className="action-button cancel-button" onClick={onBack}>
            Cancel
          </button>
          <button className="action-button confirm-button" onClick={handleConfirm} disabled={isSending}>
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`token-send-view ${transitionDir === 'right' ? 'slide-in-right' : 'slide-in-left'}`}>
      {/* Header without back button */}
      <div className="token-send-header">
        <div className="token-send-title">
          <h3>Send {token.symbol || 'token'}</h3>
        </div>
      </div>

      {/* Recipient input */}
      <div className="input-section">
        <label className="input-label">Recipient</label>
        <div className="input-container">
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Solana recipient address"
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
        <label className="input-label">Amount</label>
        <div className="input-container">
          <input
            type="text"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="0.0"
            className="amount-input"
          />
          <span className="token-symbol">{token.symbol}</span>
          <button className="max-button-small max-inline" onClick={handleMaxClick}>
            Max
          </button>
        </div>
        <div className="amount-info">
          <span className="usd-value">
            ~{formatUsdValue(estimatedUsdValue)}
          </span>
          <div className="available-balance-container">
            <span className="available-balance">
              Available {token.amount} {token.symbol}
            </span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="token-send-actions">
        <button className="action-button cancel-button" onClick={handleBack}>
          Cancel
        </button>
        <button 
          className="action-button next-button" 
          onClick={handleNext}
          disabled={!recipient.trim() || !amount.trim() || parseFloat(amount) <= 0}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default TokenSendView;
