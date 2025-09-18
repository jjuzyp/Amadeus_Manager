import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { WalletData } from './types';
import { getWalletPublicKey } from './loadWallets';

/**
 * Generate a batch of wallets with unique names and without duplicating addresses.
 * Returns only newly created wallets that don't exist in the provided list.
 */
export function generateWallets(count: number, namePrefix: string, existing: WalletData[]): WalletData[] {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) return [];

  const existingAddresses = new Set<string>(existing.map(w => getWalletPublicKey(w)));
  const created: WalletData[] = [];

  for (let i = 0; i < safeCount; i++) {
    const kp = Keypair.generate();
    const secret = bs58.encode(kp.secretKey);

    const base = (namePrefix?.trim() || 'Wallet');
    let name = `${base} ${existing.length + created.length + 1}`;
    let suffix = 2;
    while (existing.concat(created).some(w => w.name === name)) {
      name = `${base} ${existing.length + created.length + suffix}`;
      suffix++;
    }

    const addr = kp.publicKey.toBase58();
    if (existingAddresses.has(addr)) {
      // avoid duplicates by address; try again by continuing loop
      // but to avoid infinite loops in pathological cases, just skip
      continue;
    }
    existingAddresses.add(addr);
    created.push({ name, secretKey: secret });
  }

  return created;
}


