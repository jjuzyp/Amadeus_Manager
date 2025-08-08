import { 
  Connection, 
  PublicKey, 
  SystemProgram, 
  TransactionMessage, 
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { 
  createTransferInstruction, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';

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
  
  const amountLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
  
  // Получаем актуальный баланс с RPC прямо перед отправкой
  const balance = await transactionConnection.getBalance(fromWallet.publicKey);
  console.log('tokenSend.ts - Raw balance from RPC:', balance);
  console.log('tokenSend.ts - Balance in SOL:', balance / 1_000_000_000);
  const baseFeeLamports = 5000; // Базовая комиссия в лампортах
  console.log('tokenSend.ts - priorityFee from params:', priorityFee);
  const priorityFeeLamports = (priorityFee || 50000) / 1_000_000; // Приоритетная комиссия в лампортах (делим на 1_000_000)
  const totalFee = baseFeeLamports + priorityFeeLamports; // Базовая комиссия + приоритетная
  
  console.log('Final balance check:');
  console.log('Balance:', balance);
  console.log('Amount lamports:', amountLamports);
  console.log('Is sufficient:', balance >= amountLamports);
  
  if (balance < amountLamports) {
    return {
      success: false,
      error: 'Недостаточно SOL для отправки'
    };
  }

  // Создаем инструкцию для установки приоритетной комиссии
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFee || 50000
  });

  // Создаем инструкцию для перевода SOL
  const transferIx = SystemProgram.transfer({
    fromPubkey: fromWallet.publicKey,
    toPubkey: toPubkey,
    lamports: amountLamports,
  });

  // Retry логика
  for (let attempt = 1; attempt <= (maxRetries || 3); attempt++) {
    try {
      // Получаем последний blockhash
      const { blockhash } = await transactionConnection.getLatestBlockhash('finalized');

      // Создаем и подписываем транзакцию
      const messageV0 = new TransactionMessage({
        payerKey: fromWallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [priorityFeeIx, transferIx],
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([fromWallet]);

      // Отправляем транзакцию
      const txid = await transactionConnection.sendTransaction(transaction);
      
      // Ждем подтверждения с увеличенным таймаутом
      const confirmation = await transactionConnection.confirmTransaction(
        txid, 
        'confirmed'
      );
      
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
      console.error(`Error sending SOL (attempt ${attempt}):`, error);
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
  
  // Создаем новое соединение без WebSocket для транзакций
  const transactionConnection = new Connection(rpcUrl);

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

  // Проверяем существование токен-аккаунта получателя
  const toTokenAccountInfo = await transactionConnection.getAccountInfo(toTokenAccount);
  
  // Retry логика
  for (let attempt = 1; attempt <= (maxRetries || 3); attempt++) {
    try {
      const instructions = [];

      // Создаем инструкцию для установки приоритетной комиссии
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFee || 50000
      });
      instructions.push(priorityFeeIx);

      // Если токен-аккаунт получателя не существует, создаем его
      if (!toTokenAccountInfo) {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          fromWallet.publicKey,
          toTokenAccount,
          toPubkey,
          mintPubkey
        );
        instructions.push(createAtaIx);
      }

      // Создаем инструкцию перевода токенов
      const transferIx = createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromWallet.publicKey,
        amountRaw
      );
      instructions.push(transferIx);

      // Получаем последний blockhash
      const { blockhash } = await transactionConnection.getLatestBlockhash('finalized');

      // Создаем и подписываем транзакцию
      const messageV0 = new TransactionMessage({
        payerKey: fromWallet.publicKey,
        recentBlockhash: blockhash,
        instructions: instructions,
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([fromWallet]);

      // Отправляем транзакцию
      const txid = await transactionConnection.sendTransaction(transaction);
      
      // Ждем подтверждения
      const confirmation = await transactionConnection.confirmTransaction(txid, 'confirmed');
      
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


