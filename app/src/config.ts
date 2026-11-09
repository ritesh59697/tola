import networks from "./config/networks.json";
import settings from "./config/settings.json";

export interface Network {
  name: string;
  isTest: boolean;
  rpcUrls: string[];
  explorer: string;
  currency: { name: string; symbol: string; decimals: number };
  qieIdReverseResolver: string | null;
  qieIdMetadata: string[];
  dexUrl: string | null;
  dexRouter: string | null;
  explorerApi: string | null;
  walletUrl: string;
}

export interface Deployment {
  chainId: number;
  registry: string;
  stablecoin: string;
  goldFeed: string;
  maxPriceAge: number;
  mocks: boolean;
}

export interface Proof {
  label: string;
  detail: string;
  tx: string;
}

const deploymentFiles = import.meta.glob<Deployment>("../../contracts/deployments/*.json", {
  eager: true,
  import: "default",
});
const proofFiles = import.meta.glob<Proof[]>("../../contracts/deployments/proofs-*.json", {
  eager: true,
  import: "default",
});

/** Which chain the site reads. Defaults to mainnet. */
export const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 1990);

const baseNetwork = (networks as Record<string, Network>)[String(chainId)];
if (!baseNetwork) throw new Error(`No network settings for chain ${chainId}`);

/** VITE_RPC_URL points the read side at another node, such as a local fork. */
const rpcOverride = import.meta.env.VITE_RPC_URL as string | undefined;
export const network: Network = rpcOverride ? { ...baseNetwork, rpcUrls: [rpcOverride] } : baseNetwork;

export const deployment: Deployment | null =
  Object.entries(deploymentFiles).find(([path]) => path.endsWith(`/${chainId}.json`))?.[1] ?? null;

export const proofs: Proof[] =
  Object.entries(proofFiles).find(([path]) => path.endsWith(`/proofs-${chainId}.json`))?.[1] ?? [];

export { settings };

export const explorerTx = (hash: string) => `${network.explorer}/tx/${hash}`;
export const explorerAddress = (address: string) => `${network.explorer}/address/${address}`;
