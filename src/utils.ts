import { Connection, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

// Общая функция для расчета compute units через симуляцию
export const calculateComputeUnits = async (
  connection: Connection,
  instructions: any[],
  fromWallet: any,
  priorityFee: number
): Promise<number> => {
  try {
    // Симулируем транзакцию для получения точного количества compute units
    // НЕ добавляем ComputeBudgetProgram инструкции в симуляцию!
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    const tempMessage = new TransactionMessage({
      payerKey: fromWallet.publicKey,
      recentBlockhash: blockhash,
      instructions: instructions, // Только основные инструкции
    }).compileToV0Message();
    
    const tempTransaction = new VersionedTransaction(tempMessage);
    tempTransaction.sign([fromWallet]);
    
    // Симулируем транзакцию для получения compute units
    const simulation = await connection.simulateTransaction(tempTransaction);
    const computeUnits = simulation.value.unitsConsumed || 200000;
    return computeUnits;
  } catch (error) {
    console.error('Error simulating transaction for compute units:', error);
    // Fallback к приблизительным значениям в зависимости от типа транзакции
    const instructionCount = instructions.length;
    if (instructionCount <= 2) {
      return 200000; // Простой перевод SOL
    } else if (instructionCount <= 4) {
      return 300000; // SPL токен с созданием аккаунта
    } else {
      return 400000; // Сложные транзакции
    }
  }
};



// Общая функция форматирования USD значения
export const formatUsdValue = (value: number): string => {
  // Если значение фактически ноль, показываем коротко
  if (!isFinite(value) || Math.abs(value) === 0 || Math.abs(value) < 1e-9) {
    return `$0`;
  }
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(2)}K`;
  } else if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  } else {
    return `$${value.toFixed(2)}`;
  }
};

// Общая функция форматирования адреса
export const formatAddress = (addr: string): string => {
  return addr.length > 8 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
};
