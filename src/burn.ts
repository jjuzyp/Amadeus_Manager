import { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { SendResult } from './tokenSend';

export interface BurnTokenParams {
  rpcUrl: string;
  fromWallet: any; // Keypair
  tokenMint: string;
  decimals: number;
  priorityFee?: number;
  maxRetries?: number;
}

export const burnSPLToken = async (params: BurnTokenParams): Promise<SendResult> => {
  const { rpcUrl, fromWallet, tokenMint, decimals, priorityFee, maxRetries } = params;
  try {
    const connection = new Connection(rpcUrl);

    const mintPubkey = new PublicKey(tokenMint);
    const owner = fromWallet.publicKey;

    // Определяем токен-программу по владельцу mint аккаунта
    const mintInfo = await connection.getAccountInfo(mintPubkey);
    const programId = mintInfo?.owner?.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const ownerTokenAccount = await getAssociatedTokenAddress(mintPubkey, owner, false, programId);

    const ataInfo = await connection.getAccountInfo(ownerTokenAccount);
    if (!ataInfo) {
      return { success: false, error: 'У владельца нет токен-аккаунта для этого mint' };
    }

    // Узнаем баланс в минимальных единицах
    const tokenAccountBalance = await connection.getTokenAccountBalance(ownerTokenAccount);
    const burnAmountRaw = BigInt(tokenAccountBalance.value.amount || '0');
    if (burnAmountRaw === BigInt(0)) {
      return { success: false, error: 'Баланс токена равен 0' };
    }

    // Оценка compute units на одну burn инструкцию
    const limitInstruction = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
    const priceInstruction = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee || 50_000 });

    const burnIx = createBurnCheckedInstruction(
      ownerTokenAccount,
      mintPubkey,
      owner,
      Number(burnAmountRaw),
      decimals,
      [],
      programId
    );

    for (let attempt = 1; attempt <= (maxRetries || 3); attempt++) {
      try {
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        const msg = new TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions: [limitInstruction, priceInstruction, burnIx]
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([fromWallet]);

        const signature = await connection.sendTransaction(tx);
        const ok = await Promise.race([
          connection.confirmTransaction(signature, 'confirmed').then(v => ({ ok: !v.value.err })),
          new Promise(resolve => setTimeout(() => resolve({ ok: false, timeout: true }), 10000))
        ]) as { ok: boolean };

        if (ok.ok) {
          return { success: true, txid: signature };
        }
        // retry
      } catch (e) {
        if (attempt === (maxRetries || 3)) {
          return { success: false, error: e instanceof Error ? e.message : 'Ошибка burn транзакции' };
        }
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }

    return { success: false, error: 'Не удалось подтвердить транзакцию' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ошибка burn' };
  }
};


