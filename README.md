# Amadeus Manager

Desktop application for managing Solana wallets, built on Electron and React.


## Technology

- **Frontend**: React, TypeScript
- **Backend**: Electron, Node.js
- **Blockchain**: Solana Web3.js, SPL Token
- **Build**: Webpack, TypeScript
- **UI**: CSS Modules, React DOM

## Installation

### Requirements
- Node.js (version 16 or above )
- npm or yarn

### Installation steps

1. Clone repository:
```bash
git clone https://github.com/jjuzyp/Amadeus_Manager.git
```

2. Install dependencies:
```bash
npm install
```


## Start

Build the application:
```bash
npm run build
```

Start app:
```bash
npm start
```

## Configuration

The application configurations are located in `config.json`:

- `solanaRpcUrl` - RPC for SOL Balance
- `solanaTokensRpcUrl` - Main RPC
- `autoRefreshInterval` - Auto-redfresh interval
- `delayBetweenRequests` - Delay between requests
- `priorityFee` - Priority fee
- `maxRetries` - Max transaction retries
- `confirmationTimeout` - confirmation timeout