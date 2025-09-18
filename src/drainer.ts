import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, SendTransactionError } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { WalletData } from './types';
import { parseSecretKey } from './loadWallets';
import { sendSOL } from './tokenSend';

export type DrainMode = 'SOL' | 'TOKEN' | 'ALL';

export interface DrainOptions {
  solanaRpcUrl: string;
  solanaTokensRpcUrl: string;
  priorityFee?: number;
  maxRetries?: number;
  confirmationTimeout?: number;
  fromWallets: WalletData[];
  destinationAddress: string;
  mode: DrainMode;
  tokenMint?: string; // required when mode === 'TOKEN'
}

export interface DrainerProgress {
  walletAddress: string;
  step: 'tokens' | 'sol' | 'done' | 'skip';
  message: string;
  txid?: string;
  success?: boolean;
}

export interface DrainerResultPerWallet {
  walletAddress: string;
  tokenTxid?: string;
  solTxid?: string;
  success: boolean;
  error?: string;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Internal helper to fetch all non-NFT token balances (decimals > 0) for a wallet
async function fetchFungibleTokenBalances(connection: Connection, owner: PublicKey): Promise<Array<{ mint: string; amountRaw: bigint; decimals: number }>> {
  // Both legacy and Token-2022 programs
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

  const [legacyResp, token2022Resp] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  const allAccounts = [...legacyResp.value, ...token2022Resp.value];
  const balances: Array<{ mint: string; amountRaw: bigint; decimals: number }> = [];

  for (const acc of allAccounts) {
    const parsed = (acc.account.data as any)?.parsed;
    if (!parsed) continue;
    const info = parsed.info;
    const mint: string = info.mint;
    const amount: string = info.tokenAmount.amount;
    const decimals: number = info.tokenAmount.decimals;

    // skip NFTs and zero balances
    if (decimals === 0) continue;
    if (amount === '0') continue;

    balances.push({ mint, amountRaw: BigInt(amount), decimals });
  }
  return balances;
}

async function waitUntilNoTokens(
  connection: Connection,
  owner: PublicKey,
  mintsToCheck: string[],
  intervalMs: number = 3000,
  timeoutMs: number = 60000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const balances = await fetchFungibleTokenBalances(connection, owner);
    const set = new Map(balances.map(b => [b.mint, b.amountRaw]));
    const stillPresent = mintsToCheck.some(m => (set.get(m) ?? 0n) > 0n);
    if (!stillPresent) return true;
    await delay(intervalMs);
  }
  return false;
}

async function sendAllTokensInOneTransaction(params: {
  connection: Connection;
  fromKeypair: Keypair;
  toPubkey: PublicKey;
  tokens: Array<{ mint: string; amountRaw: bigint; decimals: number }>;
  priorityFee?: number;
}): Promise<string | null> {
  if (params.tokens.length === 0) return null;

  const { connection, fromKeypair, toPubkey, tokens, priorityFee } = params;
  const instructions: any[] = [];

  // Budget: allow big bundle by default
  const computeUnits = Math.max(400_000, 120_000 + tokens.length * 60_000);
  instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee || 50_000 }));

  for (const t of tokens) {
    const mintPubkey = new PublicKey(t.mint);
    const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, fromKeypair.publicKey);
    const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, toPubkey);

    const fromInfo = await connection.getAccountInfo(fromTokenAccount);
    if (!fromInfo) continue; // no ATA -> nothing to send

    const toInfo = await connection.getAccountInfo(toTokenAccount);
    if (!toInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          fromKeypair.publicKey,
          toTokenAccount,
          toPubkey,
          mintPubkey
        )
      );
    }

    if (t.amountRaw > 0n) {
      instructions.push(
        createTransferInstruction(
          fromTokenAccount,
          toTokenAccount,
          fromKeypair.publicKey,
          Number(t.amountRaw)
        )
      );
    }
  }

  if (instructions.length <= 2) {
    // only budget instructions, nothing to send
    return null;
  }

  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const messageV0 = new TransactionMessage({
    payerKey: fromKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions
  }).compileToV0Message();
  const tx = new VersionedTransaction(messageV0);
  tx.sign([fromKeypair]);
  const confirmWithTimeout = async (p: Promise<any>, ms: number) => {
    return Promise.race([
      p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), ms))
    ]) as Promise<{ ok: boolean; v?: any; e?: any; timeout?: boolean }>;
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const freshBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
    const messageV0Retry = new TransactionMessage({
      payerKey: fromKeypair.publicKey,
      recentBlockhash: freshBlockhash,
      instructions
    }).compileToV0Message();
    const txRetry = new VersionedTransaction(messageV0Retry);
    txRetry.sign([fromKeypair]);
    try {
      const txid = await connection.sendTransaction(txRetry, { skipPreflight: true });
      const conf = await confirmWithTimeout(connection.confirmTransaction(txid, 'confirmed'), 10000);
      if (conf.ok && !(conf.v && conf.v.value && conf.v.value.err)) {
        return txid;
      }
    } catch (err: any) {
      try {
        if (err instanceof SendTransactionError) {
          const logs = await err.getLogs(connection);
          const text = (Array.isArray(logs) ? logs.join('\n') : String(logs)).toLowerCase();
          if (text.includes('insufficient lamports')) {
            throw new Error('insufficient SOL');
          }
        }
      } catch {}
      if ((err?.message || '').toLowerCase().includes('insufficient lamports')) {
        throw new Error('insufficient SOL');
      }
      // otherwise will retry below
    }
    if (attempt < 3) {
      await delay(500); // небольшая пауза перед новой сборкой
    }
  }
  throw new Error('Token drain transaction not confirmed in 10s');
}

export async function drainFunds(options: DrainOptions, onProgress?: (p: DrainerProgress) => void): Promise<DrainerResultPerWallet[]> {
  const {
    solanaRpcUrl,
    solanaTokensRpcUrl,
    priorityFee,
    maxRetries,
    confirmationTimeout,
    fromWallets,
    destinationAddress,
    mode,
    tokenMint
  } = options;

  let toPubkey: PublicKey;
  try {
    toPubkey = new PublicKey(destinationAddress);
  } catch (e) {
    throw new Error('Invalid recipient address');
  }

  const tokenConn = new Connection(solanaTokensRpcUrl);

  // Process wallets in clusters of 5 to prevent overload
  const clusterSize = 5;
  const results: DrainerResultPerWallet[] = [];
  
  for (let i = 0; i < fromWallets.length; i += clusterSize) {
    const cluster = fromWallets.slice(i, i + clusterSize);
    onProgress?.({ walletAddress: '', step: 'tokens', message: `Processing cluster ${Math.floor(i/clusterSize) + 1}/${Math.ceil(fromWallets.length/clusterSize)} (${cluster.length} wallets)...` });
    
    const clusterTasks = cluster.map(async (wallet): Promise<DrainerResultPerWallet> => {
    const secret = parseSecretKey(wallet.secretKey);
    const keypair = Keypair.fromSecretKey(secret);
    const address = keypair.publicKey.toBase58();
    try {
      let tokenTxid: string | undefined;
      let solTxid: string | undefined;

      // 1) TOKENS
      let tokensToSend: Array<{ mint: string; amountRaw: bigint; decimals: number }> = [];
      if (mode === 'TOKEN' || mode === 'ALL') {
        const allTokens = await fetchFungibleTokenBalances(tokenConn, keypair.publicKey);
        tokensToSend = (mode === 'TOKEN' && tokenMint)
          ? allTokens.filter(t => t.mint === tokenMint)
          : allTokens;

        if (tokensToSend.length > 0) {
          onProgress?.({ walletAddress: address, step: 'tokens', message: `Sending ${tokensToSend.length} tokens...` });
          const txid = await sendAllTokensInOneTransaction({
            connection: tokenConn,
            fromKeypair: keypair,
            toPubkey,
            tokens: tokensToSend,
            priorityFee
          });
          if (txid) {
            tokenTxid = txid;
            onProgress?.({ walletAddress: address, step: 'tokens', message: 'Tokens sent', txid, success: true });

            // Ожидание обновления баланса токенов требуется только в режиме "ALL",
            // чтобы затем корректно слить SOL после актуализации токенных балансов.
            if (mode === 'ALL') {
              const mints = tokensToSend.map(t => t.mint);
              const drained = await waitUntilNoTokens(tokenConn, keypair.publicKey, mints, 3000, 60000);
              onProgress?.({ walletAddress: address, step: 'tokens', message: drained ? 'Token balance updated' : 'Timeout waiting for balance update', success: drained });
            }
          } else {
            onProgress?.({ walletAddress: address, step: 'tokens', message: 'No tokens to send', success: true });
          }
        } else {
          onProgress?.({ walletAddress: address, step: 'tokens', message: 'No tokens to send', success: true });
        }
      }

      // 2) SOL
      if (mode === 'SOL' || mode === 'ALL') {
        let sent = false;
        const attempts = Math.max(3, maxRetries || 0);
        for (let attempt = 1; attempt <= attempts; attempt++) {
          onProgress?.({ walletAddress: address, step: 'sol', message: `Sending SOL (attempt ${attempt})...` });
          const solRes = await sendSOL({
            rpcUrl: solanaTokensRpcUrl,
            fromWallet: keypair,
            toAddress: toPubkey.toBase58(),
            amount: '1000000',
            priorityFee: priorityFee || 50_000,
            maxRetries: 1,
            confirmationTimeout: 10
          });
          if (solRes.success) {
            solTxid = solRes.txid;
            onProgress?.({ walletAddress: address, step: 'sol', message: 'SOL sent', txid: solTxid, success: true });
            sent = true;
            break;
          } else {
            onProgress?.({ walletAddress: address, step: 'sol', message: solRes.error || 'Not confirmed in 10s, retrying...', success: false });
            if (attempt < attempts) {
              await delay(5000);
            }
          }
        }
        if (!sent) {
          onProgress?.({ walletAddress: address, step: 'sol', message: 'Failed to send SOL after retries', success: false });
        }
      }

      onProgress?.({ walletAddress: address, step: 'done', message: 'Done', success: true });
      return { walletAddress: address, tokenTxid, solTxid, success: true };
    } catch (e: any) {
      onProgress?.({ walletAddress: address, step: 'skip', message: e?.message || 'Error', success: false });
      return { walletAddress: address, success: false, error: e?.message || String(e) };
    }
  });

    const settled = await Promise.allSettled(clusterTasks);
    const clusterResults = settled.map(s => (s.status === 'fulfilled' ? s.value : { walletAddress: '', success: false, error: String(s.reason) }));
    results.push(...clusterResults);
    
    // Small delay between clusters to prevent RPC overload
    if (i + clusterSize < fromWallets.length) {
      await delay(2000);
    }
  }
  
  return results;
}

export default drainFunds;


