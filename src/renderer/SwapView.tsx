import React, { useEffect, useMemo } from 'react';
import { WalletData, TokenBalance, Config } from '../types';
import { getWalletPublicKey, parseSecretKey } from '../loadWallets';
import { mountJupiterPlugin } from '../swap';
import { Connection, Keypair, VersionedTransaction, PublicKey, Transaction } from '@solana/web3.js';

interface SwapViewProps {
  token?: TokenBalance; // Необязательный токен: по умолчанию пользователь вводит всё сам
  wallet: WalletData;
  config: Config;
  onBack: () => void;
  onNotify: (msg: string) => void;
}

const SwapView: React.FC<SwapViewProps> = ({ token, wallet, config }) => {
  const containerId = useMemo(() => `jupiter-plugin-${getWalletPublicKey(wallet)}`, [wallet]);

  useEffect(() => {
    const init = async () => {
      // Готовим адаптер на основе карточки (для пасс-тру по запросу)
      const rpc = config.solanaTokensRpcUrl || config.solanaRpcUrl;
      const connection = new Connection(rpc);
      const secret = parseSecretKey(wallet.secretKey);
      const kp = Keypair.fromSecretKey(secret);
      const pubkey = new PublicKey(kp.publicKey);

      const robustSign = (t: any) => {
        if (t && typeof t.sign === 'function') {
          try { t.sign([kp]); return t; } catch {}
          try { t.sign(kp); return t; } catch {}
          if (typeof t.partialSign === 'function') { t.partialSign(kp); return t; }
        }
        if (t instanceof VersionedTransaction) { t.sign([kp]); return t; }
        if (t instanceof Transaction) { t.sign(kp); return t; }
        throw new Error('Unsupported transaction type');
      };

      const walletAdapter: any = {
        name: 'CardWallet',
        icon: '',
        publicKey: pubkey,
        connected: true,
        connecting: false,
        supportedTransactionVersions: new Set([0]) as any,
        signTransaction: async (tx: any) => {
          return robustSign(tx);
        },
        signAllTransactions: async (txs: any[]) => {
          txs.forEach((t) => { robustSign(t); });
          return txs;
        },
        sendTransaction: async (tx: any, conn: Connection) => {
          const signed = robustSign(tx);
          return await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true });
        },
        signAndSendTransaction: async (tx: any, opts: { connection: Connection }) => {
          const sig = await (walletAdapter as any).sendTransaction(tx, opts.connection);
          return { signature: sig } as any;
        },
        disconnect: async () => {}
      };

      // Инициализируем плагин; при клике Connect Wallet плагин вызовет onRequestConnectWallet,
      // где мы синхронизируем контекст через syncProps тем же адаптером
      mountJupiterPlugin(containerId, {
        initialInputMint: token?.mint,
        initialAmount: undefined,
        initialOutputMint: undefined,
        wallet: walletAdapter,
        connection
      });
    };

    init();
  }, [containerId, token?.mint, config.solanaTokensRpcUrl, config.solanaRpcUrl, wallet.secretKey]);

  return (
    <div className="swap-view">
      <div id={containerId} className="jupiter-plugin-container"></div>
    </div>
  );
};

export default SwapView;