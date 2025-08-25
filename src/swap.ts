import { Connection, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amountRaw: string; // amount in smallest units of input mint
  slippageBps?: number; // default 50 (0.5%)
  onlyDirectRoutes?: boolean;
}

export interface QuoteResponseV6 {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: number;
  routePlan: any[];
  contextSlot: number;
}

export interface SwapParams {
  rpcUrl: string;
  userKeypair: any; // Keypair
  quote: QuoteResponseV6;
  wrapAndUnwrapSol?: boolean;
}

export interface SwapResult {
  success: boolean;
  txid?: string;
  error?: string;
}

const JUP_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUP_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';

export async function getQuote(params: QuoteParams): Promise<QuoteResponseV6> {
  const { inputMint, outputMint, amountRaw, slippageBps = 50, onlyDirectRoutes = false } = params;
  const url = new URL(JUP_QUOTE_URL);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amountRaw);
  url.searchParams.set('slippageBps', String(slippageBps));
  url.searchParams.set('onlyDirectRoutes', String(onlyDirectRoutes));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Quote request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  // Jupiter may return array or object depending on endpoint; ensure we pick best route
  const route = Array.isArray(data) ? data[0] : data;
  if (!route || !route.inAmount || !route.outAmount) {
    throw new Error('No valid route returned from Jupiter');
  }
  return route as QuoteResponseV6;
}

export async function executeSwap(params: SwapParams): Promise<SwapResult> {
  const { rpcUrl, userKeypair, quote, wrapAndUnwrapSol = true } = params;
  try {
    const connection = new Connection(rpcUrl);
    const userPublicKey = userKeypair.publicKey.toBase58();

    const swapRes = await fetch(JUP_SWAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol,
        asLegacyTransaction: false
      })
    });
    if (!swapRes.ok) {
      const text = await swapRes.text();
      throw new Error(`Swap request failed: ${swapRes.status} ${swapRes.statusText} - ${text}`);
    }
    const swapJson = await swapRes.json();
    const swapTxBase64 = swapJson.swapTransaction as string;
    if (!swapTxBase64) {
      throw new Error('No swapTransaction received from Jupiter');
    }
    const swapTxBuffer = Buffer.from(swapTxBase64, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTxBuffer);
    transaction.sign([userKeypair]);

    const txid = await connection.sendTransaction(transaction, { skipPreflight: true });
    const conf = await connection.confirmTransaction(txid, 'confirmed');
    if (conf.value.err) {
      return { success: false, error: 'Транзакция свопа не подтверждена' };
    }
    return { success: true, txid };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Swap error' };
  }
}

export function toRawAmount(amountUi: string, decimals: number): string {
  const n = parseFloat(amountUi || '0');
  if (!isFinite(n) || n <= 0) return '0';
  return Math.floor(n * Math.pow(10, decimals)).toString();
}

export async function getMintDecimals(connection: Connection, mintAddress: string): Promise<number> {
  const mint = await getMint(connection, new PublicKey(mintAddress));
  return mint.decimals;
}

export function formatTokenAmountFromRaw(raw: string, decimals: number): string {
  const bn = Number(raw);
  if (!isFinite(bn)) return '0';
  const value = bn / Math.pow(10, decimals);
  if (value === 0) return '0';
  if (value < 0.01) return '<0.01';
  if (value < 1) return value.toFixed(6);
  if (value < 100) return value.toFixed(4);
  if (value < 10000) return value.toFixed(3);
  return value.toFixed(2);
}


