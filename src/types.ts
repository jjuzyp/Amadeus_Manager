export interface WalletData {
  name: string;
  secretKey: number[] | string;
}

export interface TokenBalance {
  mint: string;
  amount: string;
  decimals: number;
  symbol?: string;
  usdPrice?: number;
  usdValue?: number;
  // NFT specific
  nftName?: string;
  nftImageUrl?: string;
  isNft?: boolean;
}

export interface WalletBalances {
  [address: string]: {
    solBalance: number;
    tokenBalances: TokenBalance[];
    totalUsdValue?: number;
    solPrice?: number;
  };
}

export interface Config {
  solanaRpcUrl: string;
  solanaTokensRpcUrl: string;
  autoRefreshInterval: number;
  delayBetweenRequests: number;
  priorityFee: number; // Приоритетная комиссия в микролампортах (по умолчанию 50000)
  maxRetries: number; // Максимальное количество попыток отправки транзакции
  confirmationTimeout: number; // Таймаут подтверждения в секундах
}

declare global {
  interface Window {
    walletAPI: {
      saveWallets: (wallets: WalletData[]) => Promise<boolean>;
      loadWallets: () => Promise<WalletData[]>;
      getConfig: () => Promise<any>;
      saveConfig: (config: any) => Promise<boolean>;
      updateWalletName: (address: string, newName: string) => Promise<boolean>;
      openExternal: (url: string) => Promise<boolean>;
    };
  }
} 