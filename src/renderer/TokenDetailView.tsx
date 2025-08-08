import React from 'react';
import { TokenBalance } from '../types';

interface TokenDetailViewProps {
  token: TokenBalance;
  onBack: () => void;
  onCopyMint: (mint: string) => void;
  onSendClick: () => void;
}

const TokenDetailView: React.FC<TokenDetailViewProps> = ({ token, onBack, onCopyMint, onSendClick }) => {
  const formatUsdValue = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    } else if (value < 0.01) {
      return `$${value.toFixed(4)}`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  };

  const formatTokenAmountForDisplay = (amount: string, decimals: number) => {
    return amount; // Просто возвращаем то же значение, что пришло из основного окна
  };

  const formatPrice = (price: number) => {
    if (price === 0) return '$0.00';
    if (price < 0.000001) return `$${price.toExponential(2)}`;
    if (price < 0.01) return `$${price.toFixed(8)}`;
    if (price < 1) return `$${price.toFixed(6)}`;
    if (price < 100) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(2)}`;
  };

  return (
    <div className="token-detail-view">
      {/* Header with back button */}
      <div className="token-detail-header">
        <button className="back-button" onClick={onBack}>
          ‹
        </button>
        <div className="token-detail-title" onClick={() => onCopyMint(token.mint)}>
          <h3>{token.symbol || token.mint.slice(0, 8) + '...'}</h3>
        </div>
      </div>

      {/* Price section */}
      <div className="token-price-section">
        <div className="token-price">
          {token.usdPrice ? formatPrice(token.usdPrice) : 'Price not available'}
        </div>
        {token.usdValue && (
          <div className="token-usd-value">
            {formatUsdValue(token.usdValue)}
          </div>
        )}
      </div>

      {/* Token amount */}
      <div className="token-amount-section">
        <div className="token-amount-label">Balance</div>
        <div className="token-amount-value">
          {formatTokenAmountForDisplay(token.amount, token.decimals)}
        </div>
      </div>

      {/* Action buttons */}
      <div className="token-action-buttons">
        <button className="action-button send-button" onClick={onSendClick}>
          <span className="button-icon">📤</span>
          <span className="button-text">Send</span>
        </button>
        <button className="action-button swap-button">
          <span className="button-icon">🔄</span>
          <span className="button-text">Swap</span>
        </button>
        <button className="action-button more-button">
          <span className="button-icon">⋯</span>
          <span className="button-text">More</span>
        </button>
      </div>
    </div>
  );
};

export default TokenDetailView;
