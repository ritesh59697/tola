import { Loader2, LogOut, TriangleAlert, Wallet } from "lucide-react";
import { network } from "../config";
import { shortAddress } from "../lib/format";
import { useQieName } from "../lib/hooks";
import { useWallet } from "../lib/wallet";

export function WalletButton() {
  const { status, address, connect, disconnect, switchNetwork, error, hasWallet } = useWallet();
  const name = useQieName(address);

  if (status === "connecting") {
    return (
      <button className="btn btn-quiet" disabled>
        <Loader2 size={16} className="spin" aria-hidden /> Check your wallet
      </button>
    );
  }
  if (status === "wrong-network") {
    return (
      <button className="btn btn-danger" onClick={() => void switchNetwork()}>
        <TriangleAlert size={16} aria-hidden /> Switch to {network.name}
      </button>
    );
  }
  if (status === "connected" && address) {
    return (
      <button className="btn btn-quiet" onClick={disconnect} title="Disconnect this wallet from Tola">
        <span className={name ? "" : "mono"}>{name ?? shortAddress(address)}</span>
        <LogOut size={16} aria-hidden />
        <span className="visually-hidden">Disconnect</span>
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {error && <span className="xs" role="alert" style={{ color: "var(--destructive)" }}>{error}</span>}
      {!hasWallet && (
        <a className="xs" href={network.walletUrl} target="_blank" rel="noreferrer">Get QIE Wallet</a>
      )}
      <button className="btn" onClick={() => void connect()}>
        <Wallet size={16} aria-hidden /> Connect wallet
      </button>
    </span>
  );
}
