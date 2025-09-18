import { WalletData } from './types';

export interface TransactionRecord {
  id: string;
  walletAddress: string;
  type: 'sent' | 'received';
  amount: string;
  tokenSymbol: string;
  tokenMint: string;
  counterpartyAddress: string;
  txid: string;
  timestamp: number;
  blockTime?: number;
}

export interface TransactionHistory {
  [walletAddress: string]: TransactionRecord[];
}

// In-memory storage for transaction history
let transactionHistory: TransactionHistory = {};

export function addTransaction(transaction: Omit<TransactionRecord, 'id' | 'timestamp'>): void {
  const id = `${transaction.txid}_${Date.now()}`;
  const record: TransactionRecord = {
    ...transaction,
    id,
    timestamp: Date.now()
  };

  if (!transactionHistory[transaction.walletAddress]) {
    transactionHistory[transaction.walletAddress] = [];
  }

  // Add to beginning of array (most recent first)
  transactionHistory[transaction.walletAddress].unshift(record);

  // Keep only last 100 transactions per wallet to prevent memory bloat
  if (transactionHistory[transaction.walletAddress].length > 100) {
    transactionHistory[transaction.walletAddress] = transactionHistory[transaction.walletAddress].slice(0, 100);
  }
}

export function getTransactionHistory(walletAddress: string): TransactionRecord[] {
  return transactionHistory[walletAddress] || [];
}

export function getAllTransactionHistory(): TransactionHistory {
  return transactionHistory;
}

export function clearTransactionHistory(walletAddress?: string): void {
  if (walletAddress) {
    delete transactionHistory[walletAddress];
  } else {
    transactionHistory = {};
  }
}

// Helper function to format transaction for display
export function formatTransactionForDisplay(tx: TransactionRecord): {
  type: string;
  direction: string;
  amount: string;
  counterparty: string;
  txid: string;
  time: string;
} {
  const type = tx.type === 'sent' ? 'Sent' : 'Received';
  const direction = tx.type === 'sent' ? 'To' : 'From';
  const amount = `${tx.type === 'sent' ? '-' : '+'}${tx.amount} ${tx.tokenSymbol}`;
  const counterparty = `${tx.counterpartyAddress.slice(0, 4)}...${tx.counterpartyAddress.slice(-4)}`;
  
  const date = new Date(tx.timestamp);
  const time = date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return {
    type,
    direction,
    amount,
    counterparty,
    txid: tx.txid,
    time
  };
}
