import { 
  Connection, 
  PublicKey, 
  SystemProgram, 
  TransactionMessage, 
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  SendTransactionError,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { 
  createTransferInstruction, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import { calculateComputeUnits } from './utils';

export interface SendTokenParams {
  rpcUrl: string; // RPC URL для транзакций
  fromWallet: any; // Keypair или другой тип кошелька
  toAddress: string;
  amount: string;
  tokenMint?: string; // Если не указан, отправляем SOL
  decimals?: number; // Обязательно для SPL токенов
  priorityFee?: number; // Приоритетная комиссия в микролампортах
  maxRetries?: number; // Максимальное количество попыток
  confirmationTimeout?: number; // Таймаут подтверждения в секундах
}

export interface SendResult {
  success: boolean;
  txid?: string;
  error?: string;
}

export const sendSOL = async (params: SendTokenParams): Promise<SendResult> => {
  const { 
    rpcUrl, 
    fromWallet, 
    toAddress, 
    amount, 
    priorityFee, 
    maxRetries
  } = params;
  
  // Создаем новое соединение без WebSocket для транзакций
  const transactionConnection = new Connection(rpcUrl);
  
  // Проверяем валидность адреса получателя
  let toPubkey: PublicKey;
  try {
    toPubkey = new PublicKey(toAddress);
  } catch (error) {
    return {
      success: false,
      error: 'Неверный адрес получателя'
    };
  }
  
  // Получаем актуальный баланс с RPC прямо перед отправкой
  const balance = await transactionConnection.getBalance(fromWallet.publicKey);
  
  // Используем более точный расчет для избежания потери точности
  const requestedLamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);

  // 1) Получаем blockhash ОДИН раз (для оценки комиссии)
  const { blockhash, lastValidBlockHeight } = await transactionConnection.getLatestBlockhash('finalized');

  // 2) Точно считаем комиссию для сообщения (базовая комиссия за подпись)
  const draftTransferIx = SystemProgram.transfer({
    fromPubkey: fromWallet.publicKey,
    toPubkey: toPubkey,
    lamports: 0,
  });
  const feeMessage = new TransactionMessage({
    payerKey: fromWallet.publicKey,
    recentBlockhash: blockhash,
    instructions: [draftTransferIx]
  }).compileToV0Message();
  const feeForMessage = await transactionConnection.getFeeForMessage(feeMessage);
  const feeLamports = feeForMessage.value ?? 5000;

  // 3) Минимальный приоритет, чтобы валидатор скорее включал tx
  const computeUnitLimit = 200_000;
  const computeUnitPriceMicro = 1000; // 0.001 лампорта за CU
  const priorityFeeLamports = Math.floor((computeUnitLimit * computeUnitPriceMicro) / 1_000_000); // ~200 лампортов

  const maxSendable = Math.max(0, balance - feeLamports - priorityFeeLamports);
  let amountLamports = Math.min(requestedLamports, maxSendable);

  // Debug fee info removed in production
  if (amountLamports <= 0) {
    return {
      success: false,
      error: `Недостаточно SOL: комиссии ~ ${(feeLamports + priorityFeeLamports) / 1_000_000_000} SOL`
    };
  }

  // Retry логика
  for (let attempt = 1; attempt <= (maxRetries || 3); attempt++) {
    try {
      // Получаем свежий blockhash на каждую попытку
      const { blockhash, lastValidBlockHeight } = await transactionConnection.getLatestBlockhash('finalized');

      // Создаем транзакцию: минимальный приоритет + перевод
      const limitInstruction = ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit });
      const priceInstruction = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPriceMicro });
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: fromWallet.publicKey,
        toPubkey: toPubkey,
        lamports: amountLamports,
      });
      const messageV0 = new TransactionMessage({
        payerKey: fromWallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [limitInstruction, priceInstruction, transferInstruction],
      }).compileToV0Message();
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([fromWallet]);

      // Логи для инспектора в Solana Explorer
      // Inspector logs omitted in production
      const txid = await transactionConnection.sendTransaction(transaction, { skipPreflight: true });
      
      // Ждем подтверждения с увеличенным таймаутом
      const confirmation = await transactionConnection.confirmTransaction({
        signature: txid,
        blockhash,
        lastValidBlockHeight
      }, 'confirmed');
      
      if (confirmation.value.err) {
        if (attempt === maxRetries) {
          return {
            success: false,
            error: 'Транзакция не была подтверждена'
          };
        }
        // retry silently
        continue;
      }

      return {
        success: true,
        txid: txid
      };
    } catch (error) {
      console.error(`Error sending SOL (attempt ${attempt}):`, error);
      try {
        if (error instanceof SendTransactionError) {
          const logs = await error.getLogs(transactionConnection);
          console.error('Simulation logs:', logs);
        }
      } catch {}
      if (attempt === maxRetries) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Ошибка отправки SOL'
        };
      }
      // Ждем немного перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return {
    success: false,
    error: 'Превышено максимальное количество попыток'
  };
};



export const sendSPLToken = async (params: SendTokenParams): Promise<SendResult> => {
  const { 
    rpcUrl, 
    fromWallet, 
    toAddress, 
    amount, 
    tokenMint, 
    decimals,
    priorityFee, 
    maxRetries 
  } = params;
  
  // Валидация параметров
  if (!tokenMint) {
    return {
      success: false,
      error: 'Не указан mint токена'
    };
  }

  if (decimals === undefined) {
    return {
      success: false,
      error: 'Не указаны decimals токена'
    };
  }

  // Создаем соединение
  const connection = new Connection(rpcUrl);
  
  // Создаем PublicKey объекты
  const mintPubkey = new PublicKey(tokenMint);
  const toPubkey = new PublicKey(toAddress);
  
  // Конвертируем количество в наименьшие единицы токена
  const amountRaw = Math.floor(parseFloat(amount) * Math.pow(10, decimals));

  // Получаем адреса токен-аккаунтов
  const fromTokenAccount = await getAssociatedTokenAddress(
    mintPubkey,
    fromWallet.publicKey
  );

  const toTokenAccount = await getAssociatedTokenAddress(
    mintPubkey,
    toPubkey
  );

  // Создаем базовые инструкции для симуляции
  const baseInstructions = [];
  
  // Инструкция перевода токенов (всегда нужна)
  const baseTransferIx = createTransferInstruction(
    fromTokenAccount,
    toTokenAccount,
    fromWallet.publicKey,
    amountRaw
  );
  baseInstructions.push(baseTransferIx);

  // Получаем примерную оценку CU на перевод (без ComputeBudget инструкций)
  const baseComputeUnits = await calculateComputeUnits(
    connection,
    baseInstructions,
    fromWallet,
    priorityFee || 50000
  );

  // Делаем безопасный запас: минимум 200k CU, либо симуляция + 50k
  const computeUnits = Math.max(200_000, baseComputeUnits + 50_000);

  // Retry логика
  for (let attempt = 1; attempt <= (maxRetries || 3); attempt++) {
    try {
      const instructions = [];

      // Добавляем инструкцию для установки compute units
      const computeUnitsIx = ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits });
      instructions.push(computeUnitsIx);

      // Добавляем приоритетную комиссию
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee || 50000 });
      instructions.push(priorityFeeIx);

      // Проверяем существование токен-аккаунта отправителя
      const fromTokenAccountInfo = await connection.getAccountInfo(fromTokenAccount);
      
      // Если у отправителя нет токен-аккаунта, создаем его
      if (!fromTokenAccountInfo) {
        const createFromAtaIx = createAssociatedTokenAccountInstruction(
          fromWallet.publicKey,
          fromTokenAccount,
          fromWallet.publicKey,
          mintPubkey
        );
        instructions.push(createFromAtaIx);
      }

      // Проверяем существование токен-аккаунта получателя
      const toTokenAccountInfo = await connection.getAccountInfo(toTokenAccount);
      
      // Если у получателя нет токен-аккаунта, создаем его
      if (!toTokenAccountInfo) {
        const createToAtaIx = createAssociatedTokenAccountInstruction(
          fromWallet.publicKey,
          toTokenAccount,
          toPubkey,
          mintPubkey
        );
        instructions.push(createToAtaIx);
      }

      // Добавляем инструкцию перевода токенов
      const finalTransferIx = createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromWallet.publicKey,
        amountRaw
      );
      instructions.push(finalTransferIx);

      // Получаем последний blockhash
      const { blockhash } = await connection.getLatestBlockhash('finalized');

      // Создаем и подписываем транзакцию
      const messageV0 = new TransactionMessage({
        payerKey: fromWallet.publicKey,
        recentBlockhash: blockhash,
        instructions: instructions,
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([fromWallet]);

      // Отправляем транзакцию
      const txid = await connection.sendTransaction(transaction);
      
      // Ждем подтверждения
      const confirmation = await connection.confirmTransaction(txid, 'confirmed');
      
      if (confirmation.value.err) {
        if (attempt === maxRetries) {
          return {
            success: false,
            error: 'Транзакция не была подтверждена'
          };
        }
        console.log(`Попытка ${attempt} не удалась, повторяем...`);
        continue;
      }

      return {
        success: true,
        txid: txid
      };
    } catch (error) {
      console.error(`Error sending SPL token (attempt ${attempt}):`, error);
      try {
        if (error instanceof SendTransactionError) {
          const logs = await error.getLogs(connection);
          console.error('Simulation logs:', logs);
        }
      } catch {}
      if (attempt === maxRetries) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Ошибка отправки токена'
        };
      }
      // Ждем немного перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return {
    success: false,
    error: 'Превышено максимальное количество попыток'
  };
};


