import React, { useMemo, useState, useEffect } from 'react';
import { WalletData, TokenBalance, Config } from '../types';
import { parseSecretKey, getWalletPublicKey } from '../loadWallets';
import { Keypair } from '@solana/web3.js';
import { executeSwap, getQuote, toRawAmount, QuoteResponseV6, getMintDecimals, formatTokenAmountFromRaw } from '../swap';

interface SwapViewProps {
  token: TokenBalance;
  wallet: WalletData;
  config: Config;
  onBack: () => void;
  onNotify: (msg: string) => void;
}

const SwapView: React.FC<SwapViewProps> = ({ token, wallet, config, onBack, onNotify }) => {
  const [amountUi, setAmountUi] = useState('');
  const [outputMint, setOutputMint] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [quote, setQuote] = useState<QuoteResponseV6 | null>(null);
  const [outDecimals, setOutDecimals] = useState<number | null>(null);
  const [isProgressVisible, setIsProgressVisible] = useState(false);

  const inputMint = token.mint;
  const inputDecimals = token.decimals || 9;

  const canQuote = useMemo(() => {
    return !!outputMint && !!amountUi && parseFloat(amountUi) > 0;
  }, [outputMint, amountUi]);

  const handleQuote = async () => {
    if (!canQuote) return;
    setIsQuoting(true);
    try {
      const amountRaw = toRawAmount(amountUi, inputDecimals);
      const q = await getQuote({ inputMint, outputMint, amountRaw, slippageBps });
      setQuote(q);
      // Подгружаем decimals для output токена автоматически
      try {
        const rpc = config.solanaTokensRpcUrl || config.solanaRpcUrl;
        const decimals = await getMintDecimals(new (await import('@solana/web3.js')).Connection(rpc), outputMint);
        setOutDecimals(decimals);
      } catch {}
    } catch (e) {
      onNotify(`Quote error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setQuote(null);
    } finally {
      setIsQuoting(false);
    }
  };

  const handleSwap = async () => {
    if (!quote) return;
    setIsSwapping(true);
    setIsProgressVisible(true);
    try {
      const kp = Keypair.fromSecretKey(parseSecretKey(wallet.secretKey));
      const res = await executeSwap({ rpcUrl: config.solanaTokensRpcUrl || config.solanaRpcUrl, userKeypair: kp, quote });
      if (res.success) {
        onNotify(`Swap successful! TXID: ${res.txid}`);
        onBack();
      } else {
        onNotify(`Swap failed: ${res.error}`);
      }
    } catch (e) {
      onNotify(`Swap error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsSwapping(false);
      setTimeout(() => setIsProgressVisible(false), 400);
    }
  };

  // Популярные токены для выпадающего списка
  const popularTokens: { label: string; mint: string }[] = [
    { label: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    { label: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
    { label: 'SOL (wSOL)', mint: 'So11111111111111111111111111111111111111112' },
    { label: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
    { label: 'JitoSOL', mint: 'J1toXLrJ9Qn2cV4VyHA6BvJY7agufkUZ8Z8D3jCxh6C' }
  ];

  return (
    <div className="token-detail-view">
      <div className="token-detail-header">
        <button className="back-button" onClick={onBack}>‹</button>
        <div className="token-detail-title">
          <h3>Swap</h3>
        </div>
      </div>

      <div className="token-amount-section">
        <div className="token-amount-label">Вы заплатите</div>
        <div className="input-section">
          <div className="input-container">
            <input
              className="amount-input"
              type="text"
              value={amountUi}
              onChange={(e) => setAmountUi(e.target.value)}
              placeholder="0"
            />
            <span className="token-symbol">{token.symbol || 'TOKEN'}</span>
          </div>
          <div className="amount-info">
            <span className="available-balance">Доступно {token.amount} {token.symbol}</span>
          </div>
        </div>
      </div>

      <div className="token-amount-section">
        <div className="token-amount-label">Вы получите</div>
        <div className="input-section">
          <div className="input-container">
            <input
              className="recipient-input"
              type="text"
              value={outputMint}
              onChange={(e) => setOutputMint(e.target.value)}
              placeholder="Token mint адрес контракта"
            />
            <select
              className="wallet-select-button"
              value={''}
              onChange={(e) => {
                if (e.target.value) setOutputMint(e.target.value);
                e.currentTarget.value = '';
              }}
            >
              <option value="">Популярные</option>
              {popularTokens.map((t) => (
                <option key={t.mint} value={t.mint}>{t.label}</option>
              ))}
            </select>
          </div>
          {quote && (
            <div className="amount-info">
              <span className="usd-value">
                ~{outDecimals != null ? formatTokenAmountFromRaw(quote.outAmount, outDecimals) : quote.outAmount}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="token-amount-section">
        <div className="token-amount-label">Слиппедж (bps)</div>
        <div className="input-section">
          <div className="input-container">
            <input
              className="amount-input"
              type="number"
              value={slippageBps}
              onChange={(e) => setSlippageBps(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>

      <div className="token-action-buttons">
        <button className="action-button more-button" onClick={handleQuote} disabled={!canQuote || isQuoting}>
          <span className="button-icon">🔎</span>
          <span className="button-text">Quote</span>
        </button>
        <button className="action-button send-button" onClick={handleSwap} disabled={!quote || isSwapping}>
          <span className="button-icon">🔄</span>
          <span className="button-text">Swap</span>
        </button>
      </div>

      {isProgressVisible && (
        <div className="swap-progress-pill">
          <div className="loading-spinner"></div>
          <span>Обмен {token.symbol || 'TOKEN'} → {(quote && outDecimals != null) ? '' : ''}...</span>
        </div>
      )}
    </div>
  );
};

export default SwapView;


