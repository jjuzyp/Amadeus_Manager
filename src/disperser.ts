import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getMint
} from '@solana/spl-token';
import { WalletData } from './types';
import { parseSecretKey } from './loadWallets';

export type DisperseMode = 'SOL' | 'TOKEN';

export interface DisperseOptions {
  solanaRpcUrl: string;
  solanaTokensRpcUrl: string;
  priorityFee?: number;
  maxRetries?: number;
  confirmationTimeout?: number;
  fromWallet: WalletData;
  recipients: string[];
  mode: DisperseMode;
  amountPerRecipient: string; // human units (SOL or tokens)
  tokenMint?: string; // required when mode === 'TOKEN'
}

export interface DisperserProgress {
  step: 'build' | 'check' | 'send' | 'done' | 'error';
  message: string;
  txid?: string;
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function disperseFunds(
  options: DisperseOptions,
  onProgress?: (p: DisperserProgress) => void
): Promise<{ success: boolean; txid?: string; error?: string }> {
  const {
    solanaTokensRpcUrl,
    priorityFee,
    maxRetries,
    confirmationTimeout,
    fromWallet,
    recipients,
    mode,
    amountPerRecipient,
    tokenMint
  } = options;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { success: false, error: 'No recipients for disperse' };
  }

  const connection = new Connection(solanaTokensRpcUrl);

  // Helper to avoid hanging RPC calls during checks
  const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Request timeout: ${label}`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
    });
  };

  // Resolve sender keypair
  const secret = parseSecretKey(fromWallet.secretKey);
  const fromKeypair = Keypair.fromSecretKey(secret);

  // Parse recipients
  let toPubkeys: PublicKey[];
  try {
    toPubkeys = recipients.map((a) => new PublicKey(a));
  } catch {
    return { success: false, error: 'Invalid address among recipients' };
  }

  // Self-check: exclude self
  const fromAddress = fromKeypair.publicKey.toBase58();
  if (toPubkeys.some(pk => pk.toBase58() === fromAddress)) {
    return { success: false, error: 'Sender should not be among recipients' };
  }

  onProgress?.({ step: 'check', message: 'Checking sufficient funds...' });
  onProgress?.({ step: 'check', message: `Mode: ${mode}, recipients: ${recipients.length}` });
  if (mode === 'TOKEN') {
    onProgress?.({ step: 'check', message: `Mint: ${tokenMint}` });
  }
  onProgress?.({ step: 'check', message: `Amount per wallet: ${amountPerRecipient}` });

  const microLamports = priorityFee || 50_000;
  const confirmMs = (confirmationTimeout || 10) * 1000;
  

  const instructions: any[] = [];

  if (mode === 'SOL') {
    // Convert SOL amount
    const perLamports = Math.round(parseFloat(amountPerRecipient) * 1_000_000_000);
    if (!Number.isFinite(perLamports) || perLamports <= 0) {
      return { success: false, error: 'Invalid SOL amount per recipient' };
    }
    

    // Balance check: at least amount*recipients
    let balance = 0;
    try {
      balance = await withTimeout(
        connection.getBalance(fromKeypair.publicKey, 'finalized'),
        8000,
        'getBalance'
      );
      
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to get SOL balance (timeout)' };
    }
    const totalRequired = BigInt(perLamports) * BigInt(toPubkeys.length);
    onProgress?.({ step: 'check', message: `Required: ${totalRequired.toString()} lamports, available: ${balance}` });
    if (BigInt(balance) < totalRequired) {
      return { success: false, error: 'Insufficient SOL on wallet for disperse' };
    }

    // Compute budget
    const computeUnits = Math.max(200_000, 80_000 + toPubkeys.length * 30_000);
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
    

    // Multiple transfers in one tx
    for (const to of toPubkeys) {
      instructions.push(SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: to,
        lamports: perLamports
      }));
    }
    
    onProgress?.({ step: 'build', message: `Instructions collected: ${instructions.length}` });
  } else {
    // TOKEN
    if (!tokenMint) return { success: false, error: 'Token mint not specified' };
    const mintPubkey = new PublicKey(tokenMint);
    let mintInfo;
    try {
      onProgress?.({ step: 'check', message: 'getMint: start' });
      mintInfo = await withTimeout(getMint(connection, mintPubkey), 8000, 'getMint');
      onProgress?.({ step: 'check', message: `getMint: done, decimals=${mintInfo.decimals}` });
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to get mint data (timeout)' };
    }
    const decimals = mintInfo.decimals;
    const perAmountRaw = Math.floor(parseFloat(amountPerRecipient) * Math.pow(10, decimals));
    if (!Number.isFinite(perAmountRaw) || perAmountRaw <= 0) {
      return { success: false, error: 'Invalid token amount per recipient' };
    }
    

    // Check sender token balance
    const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, fromKeypair.publicKey);
    
    let fromTokenAccInfo: any = null;
    try {
      onProgress?.({ step: 'check', message: `getTokenAccountBalance: start (${fromTokenAccount.toBase58()})` });
      fromTokenAccInfo = await withTimeout(
        connection.getTokenAccountBalance(fromTokenAccount),
        8000,
        'getTokenAccountBalance'
      ).catch(() => null);
      onProgress?.({ step: 'check', message: `getTokenAccountBalance: done -> ${(fromTokenAccInfo?.value?.amount ?? '0')}` });
    } catch (e: any) {
      // treat as no balance
      fromTokenAccInfo = null;
    }
    const senderRaw = BigInt(fromTokenAccInfo?.value?.amount || '0');
    const totalNeededRaw = BigInt(perAmountRaw) * BigInt(toPubkeys.length);
    onProgress?.({ step: 'check', message: `Required raw: ${totalNeededRaw.toString()}, available raw: ${senderRaw.toString()}` });
    if (senderRaw < totalNeededRaw) {
      return { success: false, error: 'Insufficient tokens for disperse' };
    }

    // Compute budget generous for ATA creations + transfers
    const computeUnits = Math.max(300_000, 150_000 + toPubkeys.length * 120_000);
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
    

    for (const to of toPubkeys) {
      const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, to);
      let toInfo = null;
      try {
        onProgress?.({ step: 'check', message: `getAccountInfo(ATA): start (${toTokenAccount.toBase58()})` });
        toInfo = await withTimeout(
          connection.getAccountInfo(toTokenAccount, 'finalized'),
          8000,
          'getAccountInfo(ATA)'
        );
        onProgress?.({ step: 'check', message: `getAccountInfo(ATA): ${toInfo ? 'exists' : 'missing'}` });
      } catch {
        toInfo = null;
      }
      if (!toInfo) {
        // Create ATA for recipient
        instructions.push(createAssociatedTokenAccountInstruction(
          fromKeypair.publicKey,
          toTokenAccount,
          to,
          mintPubkey
        ));
        
      }
      instructions.push(createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromKeypair.publicKey,
        perAmountRaw
      ));
      
    }
    onProgress?.({ step: 'build', message: `Instructions collected: ${instructions.length}` });
  }

  if (instructions.length === 0) {
    return { success: false, error: 'No instructions to send' };
  }

  const confirmWithTimeout = async (p: Promise<any>, ms: number) => {
    return Promise.race([
      p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), ms))
    ]) as Promise<{ ok: boolean; v?: any; e?: any; timeout?: boolean }>;
  };

  onProgress?.({ step: 'build', message: 'Building transaction...' });

  const attempts = Math.max(3, maxRetries || 0);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { blockhash } = await connection.getLatestBlockhash('finalized');
      const messageV0 = new TransactionMessage({
        payerKey: fromKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions
      }).compileToV0Message();

      const tx = new VersionedTransaction(messageV0);
      tx.sign([fromKeypair]);
      

      onProgress?.({ step: 'send', message: `Sending transaction (attempt ${attempt})...` });
      const txid = await connection.sendTransaction(tx, { skipPreflight: true });
      const conf = await confirmWithTimeout(connection.confirmTransaction(txid, 'confirmed'), confirmMs);
      if (conf.ok && !(conf.v && conf.v.value && conf.v.value.err)) {
        onProgress?.({ step: 'done', message: 'Transaction confirmed', txid });
        return { success: true, txid };
      }
      
      if (attempt < attempts) {
        await delay(500);
      }
    } catch (e: any) {
      if (attempt === attempts) {
        onProgress?.({ step: 'error', message: e?.message || 'Send error' });
        return { success: false, error: e?.message || 'Send error' };
      }
      
      await delay(500 * attempt);
    }
  }

  return { success: false, error: 'Failed to confirm transaction' };
}

export default disperseFunds;


