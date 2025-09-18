import React from 'react';
import { TransactionRecord, formatTransactionForDisplay } from '../transactionHistory';
import './index.css';

interface TransactionHistoryViewProps {
  transactions: TransactionRecord[];
  onCopyTxid: (txid: string) => void;
}

const TransactionHistoryView: React.FC<TransactionHistoryViewProps> = ({
  transactions,
  onCopyTxid
}) => {
  return (
    <div className="transaction-history-view">
      <div className="transaction-history-header">
        <h3>Transaction History</h3>
      </div>
      
      <div className="transaction-list">
        {transactions.length === 0 ? (
          <div className="empty-transactions">
            <p>No transactions yet</p>
          </div>
        ) : (
          transactions.map((tx) => {
            const display = formatTransactionForDisplay(tx);
            return (
              <div key={tx.id} className="transaction-item">
                <div className="transaction-icon">
                  <div className={`solana-logo ${tx.type === 'sent' ? 'sent' : 'received'}`}>
                    <div className="solana-bars">
                      <div className="bar purple"></div>
                      <div className="bar green"></div>
                      <div className="bar blue"></div>
                    </div>
                    <div className={`direction-arrow ${tx.type === 'sent' ? 'sent' : 'received'}`}>
                      {tx.type === 'sent' ? '→' : '↓'}
                    </div>
                  </div>
                </div>
                
                <div className="transaction-details">
                  <div className="transaction-type">{display.type}</div>
                  <div className="transaction-counterparty">
                    {display.direction}: {display.counterparty}
                  </div>
                  <div className="transaction-time">{display.time}</div>
                </div>
                
                <div className="transaction-amount">
                  <div className={`amount ${tx.type === 'sent' ? 'sent' : 'received'}`}>
                    {display.amount}
                  </div>
                  <button 
                    className="copy-txid-button"
                    onClick={() => onCopyTxid(display.txid)}
                    title="Copy TXID"
                  >
                    📋
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TransactionHistoryView;
