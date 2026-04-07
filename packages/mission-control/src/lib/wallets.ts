export interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  mint?: string;
  contract?: string;
}

export interface WalletBalance {
  chain: 'solana' | 'ethereum' | 'base' | 'arbitrum';
  address: string;
  label?: string;
  nativeBalance: number;
  nativeUsdValue: number;
  tokens: TokenBalance[];
  totalUsdValue: number;
}

interface WalletConfig {
  chain: WalletBalance['chain'];
  address: string;
  label?: string;
}

const RPC_URLS: Record<string, string> = {
  solana: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  ethereum: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
};

const LAMPORTS_PER_SOL = 1_000_000_000;
const WEI_PER_ETH = 1e18;

function getWalletConfigs(): WalletConfig[] {
  const env = process.env.WALLET_CONFIG;
  if (env) {
    try { return JSON.parse(env); } catch { return []; }
  }
  return [];
}

async function fetchPrices(): Promise<Record<string, number>> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum&vs_currencies=usd',
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return {};
    const data = await res.json();
    return {
      SOL: data.solana?.usd ?? 0,
      ETH: data.ethereum?.usd ?? 0,
    };
  } catch {
    return {};
  }
}

async function rpcCall(chain: string, method: string, params: unknown[]): Promise<unknown> {
  const url = RPC_URLS[chain];
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result;
  } catch {
    return null;
  }
}

async function getSolanaBalance(address: string, prices: Record<string, number>): Promise<WalletBalance> {
  const result = await rpcCall('solana', 'getBalance', [address]) as { value: number } | null;
  const lamports = result?.value ?? 0;
  const balance = lamports / LAMPORTS_PER_SOL;
  const usdValue = balance * (prices.SOL ?? 0);
  return {
    chain: 'solana',
    address,
    nativeBalance: balance,
    nativeUsdValue: usdValue,
    tokens: [],
    totalUsdValue: usdValue,
  };
}

async function getEvmBalance(chain: WalletBalance['chain'], address: string, prices: Record<string, number>): Promise<WalletBalance> {
  const result = await rpcCall(chain, 'eth_getBalance', [address, 'latest']) as string | null;
  const wei = result ? parseInt(result, 16) : 0;
  const balance = wei / WEI_PER_ETH;
  const usdValue = balance * (prices.ETH ?? 0);
  return {
    chain,
    address,
    nativeBalance: balance,
    nativeUsdValue: usdValue,
    tokens: [],
    totalUsdValue: usdValue,
  };
}

export async function getWalletBalances(): Promise<WalletBalance[]> {
  const configs = getWalletConfigs();
  if (configs.length === 0) return [];

  const prices = await fetchPrices();

  const results = await Promise.all(
    configs.map(async (cfg) => {
      let wallet: WalletBalance;
      if (cfg.chain === 'solana') {
        wallet = await getSolanaBalance(cfg.address, prices);
      } else {
        wallet = await getEvmBalance(cfg.chain, cfg.address, prices);
      }
      wallet.label = cfg.label;
      return wallet;
    })
  );

  return results;
}

export function getTotalPortfolioValue(wallets: WalletBalance[]): number {
  return wallets.reduce((sum, w) => sum + w.totalUsdValue, 0);
}
