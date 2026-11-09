import { Ban, CircleAlert, CircleCheck, ExternalLink, Loader2, Wallet, X } from "lucide-react";
import { explorerTx } from "../config";
import { useTx } from "../lib/tx";
import type { TxPhase } from "../lib/tx";

const heading: Record<TxPhase, string> = {
  wallet: "Confirm in your wallet",
  pending: "Waiting for the chain",
  confirmed: "Done",
  refused: "Refused by the contract",
  failed: "Did not go through",
};

function PhaseIcon({ phase }: { phase: TxPhase }) {
  if (phase === "wallet") return <Wallet size={18} aria-hidden />;
  if (phase === "pending") return <Loader2 size={18} className="spin" aria-hidden />;
  if (phase === "confirmed") return <CircleCheck size={18} color="var(--accent)" aria-hidden />;
  if (phase === "refused") return <Ban size={18} color="var(--destructive)" aria-hidden />;
  return <CircleAlert size={18} color="var(--warning)" aria-hidden />;
}

export function TxTray() {
  const { transactions, dismiss } = useTx();
  if (!transactions.length) return null;
  return (
    <div className="tx-tray" role="status" aria-live="polite">
      {transactions.map((t) => (
        <div key={t.id} className={`tx-card ${t.phase === "refused" ? "refused-card" : ""}`}>
          <PhaseIcon phase={t.phase} />
          <div>
            <strong style={{ fontWeight: 600 }}>{heading[t.phase]}</strong>
            <div className="muted">{t.label}</div>
            {t.message && <div>{t.message}</div>}
            {t.hash && (
              <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer">
                See transaction <ExternalLink size={13} className="icon-inline" aria-hidden />
              </a>
            )}
          </div>
          <button className="tx-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
