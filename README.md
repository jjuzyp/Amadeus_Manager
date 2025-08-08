# Wallet Manager

Десктопное приложение для управления Solana кошельками, построенное на Electron и React.

## Возможности

- Управление множественными Solana кошельками
- Просмотр балансов токенов
- Отправка токенов
- Автоматическое обновление балансов
- Современный пользовательский интерфейс

## Технологии

- **Frontend**: React, TypeScript
- **Backend**: Electron, Node.js
- **Blockchain**: Solana Web3.js
- **Build**: Webpack, TypeScript

## Установка

1. Клонируйте репозиторий:
```bash
git clone https://github.com/your-username/wallet-manager.git
cd wallet-manager
```

2. Установите зависимости:
```bash
npm install
```

3. Запустите приложение:
```bash
npm start
```

## Разработка

Для запуска в режиме разработки:
```bash
npm run dev
```

## Сборка

Для сборки приложения:
```bash
npm run build
```

## Конфигурация

Создайте файл wallets.json и заполните его кошельками в формате
[
  {
    "name": "Wallet 1",
    "secretKey": "ht2jhhy45u43KASi58sdfjnASh3ht2jhhy45u43KASi58sdfjnASh3ht2jhhy45u43KASi58sdfjnASh3"
  }
]

Настройки приложения находятся в файле `config.json`:

- `solanaRpcUrl` - RPC для получения балансов SOL
- `solanaTokensRpcUrl` - Main RPC
- `autoRefreshInterval` - интервал автоматического обновления
- `delayBetweenRequests` - задержка между запросами
- `priorityFee` - приоритетная комиссия
- `maxRetries` - максимальное количество попыток
- `confirmationTimeout` - таймаут подтверждения


## Лицензия

ISC
