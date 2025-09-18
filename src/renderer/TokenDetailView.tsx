import React from 'react';
import { TokenBalance } from '../types';

interface TokenDetailViewProps {
  token: TokenBalance;
  onBack: () => void;
  onCopyMint: (mint: string) => void;
  onSendClick: () => void;
}

const TokenDetailView: React.FC<TokenDetailViewProps> = ({ token, onBack, onCopyMint, onSendClick }) => {
  const [showMore, setShowMore] = React.useState(false);
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

  const handleMoreClick = () => {
    setShowMore((prev) => !prev);
  };

  const handleViewInSolscan = () => {
    const url = `https://solscan.io/token/${token.mint}`;
    if (window.walletAPI && window.walletAPI.openExternal) {
      window.walletAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleBurnClick = () => {
    const event = new CustomEvent('token-burn-requested', { detail: { mint: token.mint } });
    window.dispatchEvent(event);
  };

  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const isSol = token.mint === SOL_MINT || token.symbol === 'SOL';
  const isNft = token.decimals === 0 || token.isNft;

  return (
    <div className="token-detail-view">
      {/* Header with back button */}
      <div className="token-detail-header">
        <button className="back-button" onClick={onBack} aria-label="Back">
          <img
            src="https://icons.veryicon.com/png/o/miscellaneous/medical-system-icon/return-button.png"
            alt=""
            className="back-button-icon"
          />
        </button>
        <div className="token-detail-title" onClick={() => onCopyMint(token.mint)}>
          <h3>{token.symbol || token.mint.slice(0, 8) + '...'}</h3>
        </div>
      </div>

      {/* Price section */}
      <div className="token-price-section">
        {isNft ? (
          <div className="token-nft-preview" style={{ display: 'flex', justifyContent: 'center' }}>
            {token.nftImageUrl ? (
              <img src={token.nftImageUrl} alt={token.nftName || token.mint} style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8 }} />
            ) : (
              <div style={{ color: '#888' }}>Image not available</div>
            )}
          </div>
        ) : (
          <>
            <div className="token-price">
              {token.usdPrice ? formatPrice(token.usdPrice) : 'Price not available'}
            </div>
            {token.usdValue && (
              <div className="token-usd-value">
                {formatUsdValue(token.usdValue)}
              </div>
            )}
          </>
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
          <span className="button-icon">
            <img
              src="https://icones.pro/wp-content/uploads/2021/06/icone-fleche-droite-grise.png"
              alt=""
              className="button-icon-img"
            />
          </span>
          <span className="button-text">Send</span>
        </button>
        <div className="more-button-wrapper">
          {showMore && (
            <div className="more-overlay-list">
              <button className="mini-action-button view-solscan-mini" onClick={handleViewInSolscan}>
                <img className="mini-action-icon solscan-mini-icon" src="https://avatars.githubusercontent.com/u/92743431?v=4" alt="" />
                <span>View in Solscan</span>
              </button>
              {!isSol && (
                <button className="mini-action-button burn-mini" onClick={handleBurnClick}>
                  <img className="mini-action-icon burn-mini-icon" src="https://icons.veryicon.com/png/o/miscellaneous/jujiasuan-official-icon-library/fire-57.png" alt="" />
                  <span>Burn</span>
                </button>
              )}
            </div>
          )}
          <button className="action-button more-button" onClick={handleMoreClick}>
            <span className="button-icon">⋯</span>
            <span className="button-text">More</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TokenDetailView;
