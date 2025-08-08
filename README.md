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
- **Blockchain**: Solana Web3.js, SPL Token
- **Build**: Webpack, TypeScript
- **UI**: CSS Modules, React DOM

## Установка

### Требования
- Node.js (версия 16 или выше)
- npm или yarn
- Подключение к интернету для работы с Solana RPC

### Шаги установки

1. Клонируйте репозиторий:
```bash
git clone https://github.com/jjuzyp/WorkNameWalletManager.git
cd wallet-manager
```

2. Установите зависимости:
```bash
npm install
```

3. Создайте файл `wallets.json` в корне проекта:
```json
[
  {
    "name": "Wallet 1",
    "secretKey": "your-secret-key-here"
  }
]
```

## Запуск

Для сборки приложения:
```bash
npm run build
```

Запустите приложение:
```bash
npm start
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

Это все писала нейросеть я чуть отредачил