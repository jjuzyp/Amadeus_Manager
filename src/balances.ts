import { WalletData, TokenBalance, Config, WalletBalances } from './types';
import { getWalletPublicKey } from './loadWallets';
import { Connection, PublicKey } from '@solana/web3.js';

// Интерфейс для токена из Jupiter API V2
interface JupiterToken {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  isVerified?: boolean;
  organicScore?: number;
  usdPrice?: number;
  tags?: string[];
}

// Константа для TOKEN_PROGRAM_ID
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Кэш только для символов токенов (они не меняются)
const tokenSymbolCache = new Map<string, string>();

// Функция для очистки кэша символов (если нужно)
export function clearTokenSymbolCache() {
  tokenSymbolCache.clear();
}

// Функция для условного логирования (только в dev режиме)
const isDev = process.env.NODE_ENV === 'development';
const devLog = (..._args: any[]) => {/* noop in production; keep hook for local debugging */};

// Функция для получения полной информации о токене через Jupiter API V2
async function getTokenInfoFromJupiterV2(mint: string): Promise<JupiterToken | null> {
  try {
    const response = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    const tokens = await response.json();
    
    if (tokens && tokens.length > 0) {
      const token = tokens.find((t: any) => t.id === mint);
      if (token) {
        devLog(`token ${mint}: ${token.symbol}`);
        return token;
      }
    }
  } catch (error) {
    console.log(`Ошибка получения информации о токене из Jupiter V2 для ${mint}:`, error);
  }
  return null;
}

// Функция для получения тикера токена через Jupiter API V2
async function getTokenSymbolFromJupiterV2(mint: string): Promise<string | null> {
  const tokenInfo = await getTokenInfoFromJupiterV2(mint);
  return tokenInfo?.symbol || null;
}

// Функция для получения тикера токена
async function getTokenSymbol(mint: string, connection: Connection): Promise<string> {
  // Проверяем кэш
  if (tokenSymbolCache.has(mint)) {
    return tokenSymbolCache.get(mint)!;
  }

  // Пытаемся получить тикер из Jupiter API V2
  const jupiterSymbol = await getTokenSymbolFromJupiterV2(mint);
  if (jupiterSymbol) {
    tokenSymbolCache.set(mint, jupiterSymbol);
    return jupiterSymbol;
  }

  // Fallback - возвращаем первые 4 символа mint
  const fallbackSymbol = mint.slice(0, 4).toUpperCase();
  tokenSymbolCache.set(mint, fallbackSymbol);
  return fallbackSymbol;
}

// Функция для задержки между запросами
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// WalletBalances теперь импортируется из types.ts

export interface BalanceProcessingConfig {
  delayBetweenRequests: number;
  autoRefreshInterval: number;
}

export interface LoadingProgress {
  currentWallet: string;
  totalWallets: number;
  processedWallets: number;
  isComplete: boolean;
}

export async function getSolBalance(publicKey: string): Promise<number> {
  try {
    const config = await window.walletAPI.getConfig();
    
    const connection = new Connection(config.solanaRpcUrl);
    
    // Увеличиваем задержку для rate limiting
    await delay(config.delayBetweenRequests);
    const balanceLamports = await connection.getBalance(new PublicKey(publicKey));
    const solBalance = balanceLamports / 1e9;
    return solBalance;
  } catch (error) {
    console.error('Ошибка получения SOL баланса для', publicKey, ':', error);
    return NaN;
  }
}

export async function getTokenBalances(publicKey: string): Promise<TokenBalance[]> {
  try {
    const config = await window.walletAPI.getConfig();
    
    const connection = new Connection(config.solanaTokensRpcUrl);
    const owner = new PublicKey(publicKey);

    // Увеличиваем задержку для rate limiting
    await delay(config.delayBetweenRequests);

    const response = await connection.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey(TOKEN_PROGRAM_ID) }
    );

    
    const tokenBalances: TokenBalance[] = [];

    for (const accountInfo of response.value) {
      try {
        const parsedData = accountInfo.account.data;
        
        if (!parsedData || !parsedData.parsed) {
          continue;
        }

        const mint = parsedData.parsed.info.mint;
        const amount = parsedData.parsed.info.tokenAmount.amount;
        const decimals = parsedData.parsed.info.tokenAmount.decimals;


        // Пропускаем нулевые балансы
        if (amount === "0") {
          continue;
        }

        // Конвертируем amount в правильный формат
        const formattedAmount = (Number(amount) / Math.pow(10, decimals)).toString();

        // Получаем тикер токена
        const symbol = await getTokenSymbol(mint, connection);

        // Получаем цену токена (только для токенов с decimals > 0)
        let usdPrice: number | undefined;
        let usdValue: number | undefined;
        
        if (decimals > 0) {
          const price = await getTokenPriceFromJupiterV2(mint);
          if (price !== null) {
            usdPrice = price;
            // Рассчитываем общую стоимость: количество токенов * цена за токен
            const tokenAmount = parseFloat(formattedAmount);
            usdValue = tokenAmount * price;
          }
        }


        tokenBalances.push({
          mint,
          amount: formattedAmount,
          decimals,
          symbol,
          usdPrice,
          usdValue
        });
      } catch (_parseError) {
        continue;
      }
    }

    return tokenBalances;
  } catch (error) {
    console.error('Ошибка получения токенов для', publicKey, ':', error);
    return [];
  }
}

export async function processWalletBalances(
  wallets: WalletData[], 
  config: BalanceProcessingConfig,
  onProgress?: (progress: LoadingProgress) => void,
  onWalletLoaded?: (address: string, balance: { solBalance: number; tokenBalances: TokenBalance[]; totalUsdValue?: number }) => void
): Promise<WalletBalances> {
  const balances: WalletBalances = {};

  // Получаем цену SOL один раз для всех кошельков
  const solPrice = await getSolPrice();

  // Обрабатываем каждый кошелек полностью
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const address = getWalletPublicKey(wallet);
    
    if (address !== 'Invalid wallet') {
      
      
      // Уведомляем о прогрессе
      onProgress?.({
        currentWallet: wallet.name,
        totalWallets: wallets.length,
        processedWallets: i,
        isComplete: false
      });
      
      // Загружаем SOL баланс
      await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
      const solBalance = await getSolBalance(address);

      // Загружаем токены для этого кошелька
      await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
      const tokenBalances = await getTokenBalances(address);
      
      // Рассчитываем общую стоимость кошелька
      const totalUsdValue = calculateWalletTotalValue(solBalance, solPrice, tokenBalances);
      
      const walletBalance = {
        solBalance,
        tokenBalances,
        totalUsdValue,
        solPrice
      };
      
      balances[address] = walletBalance;
      
      // Уведомляем о загрузке кошелька
      onWalletLoaded?.(address, walletBalance);
    }
  }

  // Уведомляем о завершении только если есть кошельки
  if (wallets.length > 0) {
    onProgress?.({
      currentWallet: '',
      totalWallets: wallets.length,
      processedWallets: wallets.length,
      isComplete: true
    });
  }

  return balances;
} 

// Функция для получения цены токена через Jupiter API V2 (всегда актуальная)
async function getTokenPriceFromJupiterV2(mint: string): Promise<number | null> {
  try {
    const tokenInfo = await getTokenInfoFromJupiterV2(mint);
    return tokenInfo?.usdPrice || null;
  } catch (error) {
    console.log(`Ошибка получения цены из Jupiter V2 для ${mint}:`, error);
  }
  return null;
}

// Функция для получения цены SOL
async function getSolPrice(): Promise<number> {
  try {
    const tokenInfo = await getTokenInfoFromJupiterV2('So11111111111111111111111111111111111111112');
    return tokenInfo?.usdPrice || 0;
  } catch (error) {
    console.log('Ошибка получения цены SOL:', error);
    return 0;
  }
}

// Функция для расчета общей стоимости кошелька
function calculateWalletTotalValue(solBalance: number, solPrice: number, tokenBalances: TokenBalance[]): number {
  let totalValue = solBalance * solPrice;
  
  for (const token of tokenBalances) {
    if (token.usdValue) {
      totalValue += token.usdValue;
    }
  }
  
  return totalValue;
} 