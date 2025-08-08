import React from 'react';
import { LoadingProgress } from '../balances';

interface LoadingIndicatorProps {
  progress: LoadingProgress;
  isVisible: boolean;
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ progress, isVisible }) => {
  // Дополнительные проверки для предотвращения отображения когда загрузка завершена
  const isActuallyLoading = progress.currentWallet !== '' && 
                           !progress.isComplete && 
                           progress.processedWallets < progress.totalWallets &&
                           progress.totalWallets > 0;

  if (!isVisible || !isActuallyLoading) {
    return null;
  }

  const { currentWallet, totalWallets, processedWallets } = progress;

  return (
    <div className="loading-indicator">
      <div className="loading-spinner"></div>
      <span>Loading wallet: {currentWallet} ({processedWallets + 1}/{totalWallets})</span>
    </div>
  );
};

export default LoadingIndicator; 