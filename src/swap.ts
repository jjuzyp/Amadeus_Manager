// ==============================
// Jupiter Plugin integration
// ==============================

type JupiterInit = {
  displayMode: 'modal' | 'integrated' | 'widget';
  integratedTargetId?: string;
  containerClassName?: string;
  defaultExplorer?: 'Solana Explorer' | 'Solscan' | 'Solana Beach' | 'SolanaFM';
  enableWalletPassthrough?: boolean;
  localStoragePrefix?: string;
  passthroughWalletContextState?: any;
  context?: any;
  onRequestConnectWallet?: () => void | Promise<void>;
  formProps?: {
    swapMode?: 'ExactInOrOut' | 'ExactIn' | 'ExactOut';
    initialAmount?: string;
    initialInputMint?: string;
    initialOutputMint?: string;
    fixedAmount?: boolean;
    fixedMint?: string;
    referralAccount?: string;
    referralFee?: number;
  };
  onSuccess?: (args: any) => void;
  onSwapError?: (args: any) => void;
  onFormUpdate?: (form: any) => void;
};

declare global {
  interface Window {
    Jupiter?: {
      init: (props: JupiterInit) => void;
      close: () => void;
      resume: () => void;
      syncProps?: (props: any) => void;
    };
  }
}

// Jupiter v1 фактически синглтон. Отслеживаем активную цель и явно
// закрываем предыдущий инстанс перед инициализацией нового, чтобы
// избежать конфликтов и «серых» пустых окон.
let activeTargetId: string | null = null;

async function ensureJupiterScriptLoaded(): Promise<void> {
  if (typeof window !== 'undefined' && window.Jupiter) return;
  const existing = document.querySelector('script[src^="https://plugin.jup.ag/plugin-v1.js"]') as HTMLScriptElement | null;
  if (existing) {
    await new Promise<void>((resolve) => {
      if ((window as any).Jupiter) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => resolve());
    });
    return;
  }
  await new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://plugin.jup.ag/plugin-v1.js';
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

export interface MountPluginOptions {
  initialInputMint?: string;
  initialOutputMint?: string;
  initialAmount?: string; // UI units
  // Wallet passthrough context
  wallet?: {
    publicKey: any;
    signTransaction: (tx: any) => Promise<any>;
    signAllTransactions?: (txs: any[]) => Promise<any[]>;
    connected?: boolean;
    connecting?: boolean;
    sendTransaction?: (tx: any, conn: any) => Promise<string>;
    signAndSendTransaction?: (tx: any, opts: { connection: any }) => Promise<any>;
    disconnect?: () => Promise<void> | void;
  };
  connection?: any;
}

export async function mountJupiterPlugin(targetElementId: string, opts: MountPluginOptions = {}): Promise<void> {
  await ensureJupiterScriptLoaded();
  if (!window.Jupiter) {
    console.error('[JupiterPlugin] Failed to load window.Jupiter');
    return;
  }
  // Закрываем предыдущий инстанс, если он был запущен в другой карточке
  try {
    if (activeTargetId && activeTargetId !== targetElementId) {
      window.Jupiter?.close?.();
      const prev = document.getElementById(activeTargetId);
      if (prev) prev.innerHTML = '';
    }
  } catch (e) {
    console.error('[JupiterPlugin] failed to close previous instance', e);
  }
  // reduce noise: keep only errors
  const buildPassthroughContext = () => {
    if (!(opts.wallet && opts.connection)) return undefined;
    const wallet = opts.wallet;
    const contextState: any = {
      connection: opts.connection,
      publicKey: wallet.publicKey,
      connected: wallet.connected ?? true,
      connecting: wallet.connecting ?? false,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
      sendTransaction: wallet.sendTransaction,
      signAndSendTransaction: wallet.signAndSendTransaction,
      disconnect: wallet.disconnect,
      wallet: {
        adapter: {
          name: (wallet as any).name || 'CardWallet',
          icon: (wallet as any).icon || '',
          publicKey: wallet.publicKey,
          connected: wallet.connected ?? true,
          connecting: wallet.connecting ?? false,
          supportedTransactionVersions: (wallet as any).supportedTransactionVersions,
          signTransaction: wallet.signTransaction,
          signAllTransactions: wallet.signAllTransactions,
          sendTransaction: wallet.sendTransaction,
          signAndSendTransaction: wallet.signAndSendTransaction,
          disconnect: wallet.disconnect
        }
      }
    };
    return contextState;
  };
  window.Jupiter.init({
    displayMode: 'integrated',
    integratedTargetId: targetElementId,
    defaultExplorer: 'Solscan',
    containerClassName: 'jupiter-plugin-container',
    enableWalletPassthrough: !!(opts.wallet && opts.connection),
    localStoragePrefix: targetElementId,
    // Provide context up-front so each instance keeps its own wallet
    passthroughWalletContextState: buildPassthroughContext(),
    onRequestConnectWallet: async () => {
      try {
        if (!window.Jupiter?.syncProps) return;
        const contextState = buildPassthroughContext();
        if (!contextState) return;
        window.Jupiter.syncProps({ passthroughWalletContextState: contextState });
      } catch (e) {
        console.error('[JupiterPlugin] onRequestConnectWallet failed', e);
      }
    },
    formProps: {
      swapMode: 'ExactInOrOut',
      initialAmount: opts.initialAmount,
      initialInputMint: opts.initialInputMint,
      initialOutputMint: opts.initialOutputMint
    },
    onFormUpdate: () => {},
    onSuccess: () => {},
    onSwapError: ({ error, quoteResponseMeta }) => {
      // Печатаем ошибки подробнее, чтобы диагностировать "e is not iterable"
      try {
        const details = error && typeof error === 'object' && 'message' in (error as any)
          ? (error as any).message
          : (error && typeof error === 'object' ? JSON.stringify(error) : String(error));
        console.error('[JupiterPlugin][swapError] details:', details);
      } catch {}
      console.error('[JupiterPlugin][swapError]', error, quoteResponseMeta);
    }
  });

  // Avoid global sync after init; context is already provided via init options
  activeTargetId = targetElementId;
}

export function unmountJupiterPlugin(): void {
  try {
    window.Jupiter?.close?.();
  } finally {
    activeTargetId = null;
  }
}

