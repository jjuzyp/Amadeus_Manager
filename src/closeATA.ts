import { Connection, PublicKey, Keypair, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createCloseAccountInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import { WalletData } from './types';
import { parseSecretKey } from './loadWallets';

export interface EmptyAtaInfo {
  walletAddress: string;
  ataAddress: string;
  programId: string;
  lamports: number;
}

export interface EmptyAtaScanResult {
  totalAccounts: number;
  totalLamports: number;
  byWallet: Record<string, { accounts: EmptyAtaInfo[]; totalLamports: number }>;
}

export interface RedeemOptions {
  rpcUrl: string;
  wallets: WalletData[];
  priorityFee?: number; // micro-lamports
  maxRetries?: number;
  confirmationTimeout?: number; // seconds
}

export interface RedeemProgress {
  walletAddress: string;
  step: 'scan' | 'build' | 'send' | 'confirm' | 'skip' | 'done' | 'error';
  message: string;
  txid?: string;
}

export async function searchEmptyATAs(rpcUrl: string, wallets: WalletData[], delayBetweenRequests: number = 0): Promise<EmptyAtaScanResult> {
  const connection = new Connection(rpcUrl);
  const result: EmptyAtaScanResult = { totalAccounts: 0, totalLamports: 0, byWallet: {} };

  for (const w of wallets) {
    const owner = new PublicKey(getWalletAddress(w));

    if (delayBetweenRequests > 0) {
      await delay(delayBetweenRequests);
    }

    const [legacy, t22] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID })
    ]);

    const all = [...legacy.value, ...t22.value];
    for (const acc of all) {
      const parsed: any = (acc.account as any)?.data?.parsed;
      if (!parsed) continue;
      const info = parsed.info;
      const amount: string = info?.tokenAmount?.amount ?? '0';
      if (amount !== '0') continue; // only empty

      const lamports = (acc.account as any)?.lamports as number;
      const programIdStr = (acc.account as any)?.owner?.toBase58?.() || '';

      const item: EmptyAtaInfo = {
        walletAddress: owner.toBase58(),
        ataAddress: acc.pubkey.toBase58(),
        programId: programIdStr,
        lamports: lamports || 0
      };

      if (!result.byWallet[item.walletAddress]) {
        result.byWallet[item.walletAddress] = { accounts: [], totalLamports: 0 };
      }
      result.byWallet[item.walletAddress].accounts.push(item);
      result.byWallet[item.walletAddress].totalLamports += item.lamports;
      result.totalAccounts += 1;
      result.totalLamports += item.lamports;
    }
  }

  return result;
}

export async function redeemEmptyATAs(options: RedeemOptions, scan: EmptyAtaScanResult, onProgress?: (p: RedeemProgress) => void): Promise<void> {
  const { rpcUrl, wallets, priorityFee, maxRetries, confirmationTimeout } = options;
  const connection = new Connection(rpcUrl);
  const confirmMs = (confirmationTimeout || 10) * 1000;

  // Build quick map walletAddress -> WalletData
  const addressToWallet = new Map<string, WalletData>();
  for (const w of wallets) {
    addressToWallet.set(getWalletAddress(w), w);
  }

  for (const [walletAddress, group] of Object.entries(scan.byWallet)) {
    const w = addressToWallet.get(walletAddress);
    if (!w) continue;
    const secretKey = parseSecretKey(w.secretKey);
    const keypair = Keypair.fromSecretKey(secretKey);

    // Balance check: need some lamports to pay fee
    const balanceLamports = await connection.getBalance(keypair.publicKey, 'processed');
    if (balanceLamports < 5000) {
      onProgress?.({ walletAddress, step: 'skip', message: 'Insufficient SOL for fees' });
      continue;
    }

    // Split into chunks to avoid oversized tx
    const chunkSize = 8;
    for (let i = 0; i < group.accounts.length; i += chunkSize) {
      const chunk = group.accounts.slice(i, i + chunkSize);
      const instructions: any[] = [];
      // Add compute budget for priority fee
      const computeUnits = Math.max(200_000, 80_000 + chunk.length * 40_000);
      instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
      if (priorityFee && priorityFee > 0) {
        instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }));
      }

      for (const item of chunk) {
        const ataPubkey = new PublicKey(item.ataAddress);
        const programId = item.programId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const ix = createCloseAccountInstruction(
          ataPubkey,
          keypair.publicKey,
          keypair.publicKey,
          [],
          programId
        );
        instructions.push(ix);
      }

      if (instructions.length === 0) continue;

      onProgress?.({ walletAddress, step: 'build', message: `Instructions: ${instructions.length}` });

      const { blockhash } = await connection.getLatestBlockhash('finalized');
      const msg = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: blockhash,
        instructions
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([keypair]);

      const attempts = Math.max(3, maxRetries || 0);
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          onProgress?.({ walletAddress, step: 'send', message: `Sending batch ${i / chunkSize + 1}/${Math.ceil(group.accounts.length / chunkSize)} (attempt ${attempt})` });
          const sig = await connection.sendTransaction(tx, { skipPreflight: true });
          onProgress?.({ walletAddress, step: 'confirm', message: 'Waiting for confirmation...', txid: sig });

          const conf = await confirmWithTimeout(connection.confirmTransaction(sig, 'confirmed'), confirmMs);
          if (conf.ok && !(conf.v && conf.v.value && conf.v.value.err)) {
            onProgress?.({ walletAddress, step: 'done', message: 'Some ATAs closed', txid: sig });
            break;
          }
        } catch (e: any) {
          onProgress?.({ walletAddress, step: 'error', message: e?.message || 'Send error' });
        }
        if (attempt < attempts) {
          await delay(500 * attempt);
        }
      }
      // proceed to next chunk regardless
    }
  }
}

function getWalletAddress(w: WalletData): string {
  try {
    // WalletData already stores publicKey or secretKey; reuse helper from loadWallets consumers
    const maybe = (w as any).publicKey as string | undefined;
    if (maybe) return maybe;
  } catch {}
  // Fallback: derive from secret key
  try {
    const kp = Keypair.fromSecretKey(parseSecretKey(w.secretKey));
    return kp.publicKey.toBase58();
  } catch {
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmWithTimeout(p: Promise<any>, ms: number): Promise<{ ok: boolean; v?: any; e?: any; timeout?: boolean }> {
  return Promise.race([
    p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), ms))
  ]) as Promise<{ ok: boolean; v?: any; e?: any; timeout?: boolean }>;
}


