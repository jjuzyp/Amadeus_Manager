import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { WalletData } from './types';

export function parseSecretKey(secretKey: number[] | string): Uint8Array {
  if (typeof secretKey === 'string') {
    try {
      const privateKeyBytes = bs58.decode(secretKey);
      return privateKeyBytes;
    } catch (error) {
      throw new Error('Invalid base58 secret key format');
    }
  } else {
    return new Uint8Array(secretKey);
  }
}

export function validateWallet(wallet: any): wallet is WalletData {
  return (
    wallet &&
    typeof wallet.name === 'string' &&
    (Array.isArray(wallet.secretKey) || typeof wallet.secretKey === 'string')
  );
}

export async function loadWallets(): Promise<WalletData[]> {
  const wallets = await window.walletAPI.loadWallets();
  return wallets.filter(validateWallet);
}

export function getWalletPublicKey(wallet: WalletData): string {
  try {
    const secretKey = parseSecretKey(wallet.secretKey);
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.publicKey.toBase58();
  } catch (error) {
    console.error('Error parsing wallet:', wallet.name, error);
    return 'Invalid wallet';
  }
} 