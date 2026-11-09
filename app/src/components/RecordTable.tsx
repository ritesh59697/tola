import { ExternalLink } from "lucide-react";
import { explorerTx } from "../config";
import type { HistoryEntry } from "../lib/chain";
import { dateTime, grams, moneyFine, shortAddress } from "../lib/format";

function describe(entry: HistoryEntry, decimals: number): string {
  const a = entry.args as Record<string, any>;
  const m = (v: bigint) => moneyFine(v, decimals);
  switch (entry.name) {
    case "Enrolled": return `${shortAddress(a.customer)} joined as plan ${a.planId}`;
    case "InstalmentPaid": return `Plan ${a.planId} paid ${m(a.amount)}, locking ${grams(a.goldOz)} of gold`;
    case "BondDeposited": return `Bond raised by ${m(a.amount)} to ${m(a.bond)}`;
    case "BondWithdrawn": return `Bond lowered by ${m(a.amount)} to ${m(a.bond)}`;
    case "DeliveryConfirmed": return `Plan ${a.planId}: customer confirmed delivery`;
    case "Collected": return `Plan ${a.planId}: jeweller collected ${m(a.principal)} after confirmation`;
    case "Exited": return `Plan ${a.planId}: customer left, refunded ${m(a.refund)}`;
    case "CashedOut": return `Plan ${a.planId}: not delivered, customer paid ${m(a.paid)}`;
    case "Flagged": return `Flagged for a low bond: ${m(a.bond)} held, ${m(a.requiredBond)} required`;
    case "FlagCleared": return `Flag cleared: bond ${m(a.bond)}, required ${m(a.requiredBond)}`;
    case "Defaulted": return `Default declared, with bond at ${m(a.bond)}`;
    case "ClaimedInDefault": return `Plan ${a.planId}: customer claimed ${m(a.principal)} principal and ${m(a.fromBond)} from the bond`;
    case "ResidualBondReturned": return `Leftover bond of ${m(a.amount)} returned to the jeweller`;
    default: return entry.name;
  }
}

export function RecordTable({ history, decimals, loading }: { history: HistoryEntry[]; decimals: number; loading: boolean }) {
  const rows = [...history].reverse();
  return (
    <section className="record" aria-labelledby="record-title">
      <h2 id="record-title">The public record</h2>
      <p className="small muted" style={{ marginBottom: 12 }}>Everything that has happened to this plan's money, read from the chain.</p>
      <div className="table-scroll">
        <table className="ledger">
          <caption className="visually-hidden">Scheme events, newest first</caption>
          <thead><tr><th>When</th><th>What happened</th><th><span className="visually-hidden">Transaction</span></th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.hash + row.index}>
                <td style={{ whiteSpace: "nowrap" }}>{row.timestamp ? dateTime(row.timestamp) : ""}</td>
                <td>{describe(row, decimals)}</td>
                <td style={{ textAlign: "right" }}>
                  <a href={explorerTx(row.hash)} target="_blank" rel="noreferrer" aria-label="See transaction on the explorer">
                    <ExternalLink size={15} aria-hidden />
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="muted">{loading ? "Reading the chain…" : "Nothing yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
