import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BrowserProvider, toBeHex } from "ethers";
import type { Eip1193Provider, JsonRpcSigner } from "ethers";
import { chainId, network } from "../config";

interface WalletInfo {
  name: string;
  rdns: string;
  provider: Eip1193Provider & { on?: Function; removeListener?: Function };
}

type Status = "disconnected" | "connecting" | "connected" | "wrong-network";

interface WalletState {
  status: Status;
  address: string | null;
  walletName: string | null;
  hasWallet: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  getSigner: () => Promise<JsonRpcSigner>;
}

const WalletContext = createContext<WalletState | null>(null);
const QIE_WALLET_RDNS = "me.qiewallet";
const CHAIN_HEX = toBeHex(chainId);

/** Finds wallets through EIP-6963 and prefers QIE Wallet, as QIE's integration guide recommends. */
function useWalletDiscovery() {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setWallets((current) =>
        current.some((w) => w.rdns === detail.info.rdns)
          ? current
          : [...current, { name: detail.info.name, rdns: detail.info.rdns, provider: detail.provider }],
      );
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);
  return wallets;
}

function pickWallet(wallets: WalletInfo[]): WalletInfo | null {
  const qie = wallets.find((w) => w.rdns === QIE_WALLET_RDNS);
  if (qie) return qie;
  if (wallets.length) return wallets[0];
  const injected = window as unknown as { qie?: WalletInfo["provider"]; ethereum?: WalletInfo["provider"] };
  if (injected.qie) return { name: "QIE Wallet", rdns: QIE_WALLET_RDNS, provider: injected.qie };
  if (injected.ethereum) return { name: "Browser wallet", rdns: "injected", provider: injected.ethereum };
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useWalletDiscovery();
  const [status, setStatus] = useState<Status>("disconnected");
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<WalletInfo | null>(null);

  const refresh = useCallback(async (wallet: WalletInfo) => {
    const accounts = (await wallet.provider.request({ method: "eth_accounts" })) as string[];
    if (!accounts.length) {
      setAddress(null);
      setStatus("disconnected");
      return;
    }
    const current = (await wallet.provider.request({ method: "eth_chainId" })) as string;
    setAddress(accounts[0]);
    setStatus(BigInt(current) === BigInt(chainId) ? "connected" : "wrong-network");
  }, []);

  const addOrSwitch = useCallback(async (wallet: WalletInfo) => {
    try {
      await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await wallet.provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_HEX,
            chainName: network.name,
            nativeCurrency: network.currency,
            rpcUrls: network.rpcUrls,
            blockExplorerUrls: [network.explorer],
          },
        ],
      });
    }
  }, []);

  const connect = useCallback(async () => {
    const wallet = pickWallet(wallets);
    if (!wallet) {
      setError("No wallet found. Install QIE Wallet to take part.");
      return;
    }
    setError(null);
    setStatus("connecting");
    try {
      await wallet.provider.request({ method: "eth_requestAccounts" });
      active.current = wallet;
      await refresh(wallet);
    } catch (e) {
      setStatus("disconnected");
      setError((e as { code?: number }).code === 4001 ? "Connection cancelled in your wallet." : "Could not connect to your wallet.");
    }
  }, [wallets, refresh]);

  const switchNetwork = useCallback(async () => {
    if (!active.current) return;
    setError(null);
    try {
      await addOrSwitch(active.current);
      await refresh(active.current);
    } catch {
      setError(`Switch your wallet to ${network.name} to continue.`);
    }
  }, [addOrSwitch, refresh]);

  const disconnect = useCallback(() => {
    active.current = null;
    setAddress(null);
    setStatus("disconnected");
  }, []);

  // Follow account and network changes made inside the wallet.
  useEffect(() => {
    const wallet = active.current;
    if (!wallet?.provider.on) return;
    const onChange = () => void refresh(wallet);
    wallet.provider.on("accountsChanged", onChange);
    wallet.provider.on("chainChanged", onChange);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", onChange);
      wallet.provider.removeListener?.("chainChanged", onChange);
    };
  }, [status, refresh]);

  const getSigner = useCallback(async () => {
    if (!active.current) throw new Error("Connect your wallet first.");
    return new BrowserProvider(active.current.provider).getSigner();
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      status,
      address,
      walletName: active.current?.name ?? null,
      hasWallet: Boolean(pickWallet(wallets)),
      error,
      connect,
      disconnect,
      switchNetwork,
      getSigner,
    }),
    [status, address, wallets, error, connect, disconnect, switchNetwork, getSigner],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet outside WalletProvider");
  return context;
}
