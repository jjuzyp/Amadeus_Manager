import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import secret from './key.json';
import bs58 from 'bs58';
import fs from 'fs';

// Настройки
const QUICKNODE_RPC = 'https://mainnet.helius-rpc.com/?api-key=7e808e9e-3c6f-4e49-89d4-5fd3ff44b83a'; // Замените на ваш RPC-узел
const SOLANA_CONNECTION = new Connection(QUICKNODE_RPC);

// Кошелек, на который будут отправлены все SOL
const DESTINATION_WALLET = new PublicKey('2V12XT7WtYPQNocoYbmaPWdqPxV7d4KyY53CP2Xbtfqw'); // Укажите ваш публичный адрес кошелька

// Чтение всех кошельков из key.json и преобразование Base58 в Keypair
const WALLETS = secret.map(key => Keypair.fromSecretKey(
    Uint8Array.from(key)
));

// Логирование в файл
function logToFile(message: string) {
    fs.appendFileSync("log.txt", message + "\n");
}

// Функция для создания рамки
function createBox(message: string): string {
    const lines = message.split("\n");
    const maxLength = Math.max(...lines.map(line => line.length));
    const border = "╭" + "─".repeat(maxLength + 2);
    const content = lines.map(line => `│ ${line}`).join("\n");
    const bottom = "╰" + "─".repeat(maxLength + 2);
    return `${border}\n${content}\n${bottom}`;
}

// Функция для сбора SOL с кошельков
async function collectSOL() {
    for (let i = 0; i < WALLETS.length; i++) {
        const WALLET = WALLETS[i];
        const walletNumber = i + 1;

        // Создаем рамку для кошелька
        let boxContent = `Processing Wallet ${walletNumber}: ${WALLET.publicKey.toString()}\n`;

        try {
            // Получаем баланс кошелька
            const balance = await SOLANA_CONNECTION.getBalance(WALLET.publicKey);
            const solBalance = balance / LAMPORTS_PER_SOL;

            boxContent += `Balance: ${solBalance} SOL\n`;

            if (solBalance > 0) {
                // Создаем транзакцию для перевода SOL
                const transferIx = SystemProgram.transfer({
                    fromPubkey: WALLET.publicKey,
                    toPubkey: DESTINATION_WALLET,
                    lamports: balance - 5000, // Оставляем немного SOL для оплаты комиссии
                });

                // Получаем последний blockhash
                const { blockhash } = await SOLANA_CONNECTION.getLatestBlockhash('finalized');

                // Создаем и подписываем транзакцию
                const messageV0 = new TransactionMessage({
                    payerKey: WALLET.publicKey,
                    recentBlockhash: blockhash,
                    instructions: [transferIx],
                }).compileToV0Message();
                const transaction = new VersionedTransaction(messageV0);
                transaction.sign([WALLET]);

                boxContent += "✅ - Transaction Created and Signed\n";

                // Отправляем транзакцию
                const txid = await SOLANA_CONNECTION.sendTransaction(transaction);
                boxContent += `✅ - Transaction sent: ${txid}\n`;

                // Ожидаем подтверждения транзакции
                const confirmation = await confirmTransaction(SOLANA_CONNECTION, txid);
                if (confirmation.err) {
                    throw new Error("❌ - Transaction not confirmed.");
                }

                boxContent += '🔥 SUCCESSFUL TRANSFER! 🔥\n';
                boxContent += `https://explorer.solana.com/tx/${txid}\n`;
            } else {
                boxContent += '🟡 - No SOL to transfer.\n';
            }
        } catch (error) {
            boxContent += `❌ - Error processing Wallet ${walletNumber}: ${error}\n`;
        }

        // Выводим рамку
        const box = createBox(boxContent);
        console.log(box);
        logToFile(box);
    }
}

// Функция для подтверждения транзакции
async function confirmTransaction(
    connection: Connection,
    signature: string,
    desiredConfirmationStatus: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
    timeout: number = 30000, // 30 секунд
    pollInterval: number = 1000,
    searchTransactionHistory: boolean = false
): Promise<any> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const { value: statuses } = await connection.getSignatureStatuses([signature], { searchTransactionHistory });

        if (!statuses || statuses.length === 0) {
            throw new Error('Failed to get signature status');
        }

        const status = statuses[0];

        if (status === null) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            continue;
        }

        if (status.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }

        if (status.confirmationStatus && status.confirmationStatus === desiredConfirmationStatus) {
            return status;
        }

        if (status.confirmationStatus === 'finalized') {
            return status;
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
}

// Основная функция
(async () => {
    console.log("Starting SOL collection...");
    logToFile("Starting SOL collection...");

    await collectSOL(); // Собираем SOL со всех кошельков

    console.log("SOL collection completed.");
    logToFile("SOL collection completed.");
})();