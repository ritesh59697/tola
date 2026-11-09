import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { settings } from "../config";
import { dateTime, duration, money, moneyFine, pct } from "../lib/format";
import { useNow } from "../lib/hooks";
import type { SchemeData } from "../lib/hooks";

export type SchemeStatus = "backed" | "under" | "flagged" | "repair-over" | "default" | "empty";

export function schemeStatus(s: SchemeData, now: number): SchemeStatus {
  if (s.defaulted) return "default";
  if (s.flaggedAt !== 0) return now >= s.curesBy ? "repair-over" : "flagged";
  if (s.backing.bond < s.backing.requiredBond) return "under";
  if (s.backing.lockedPrincipal === 0n) return "empty";
  return "backed";
}

export function StatusPill({ scheme, now }: { scheme: SchemeData; now: number }) {
  const status = schemeStatus(scheme, now);
  if (status === "default") return <span className="pill pill-bad">In default</span>;
  if (status === "repair-over") return <span className="pill pill-bad">Repair time over</span>;
  if (status === "flagged") return <span className="pill pill-warn">Flagged, {duration(scheme.curesBy - now)} to repair</span>;
  if (status === "under") return <span className="pill pill-warn">Under-backed</span>;
  if (status === "empty") return <span className="pill pill-quiet">No customers yet</span>;
  return <span className="pill pill-ok">Fully backed</span>;
}

/**
 * Mirrors the contract's own sums so the "what if gold moves" slider can show the effect at once.
 * At 0% these equal what the contract reports; the slider changes nothing on-chain.
 */
function project(s: SchemeData, movePercent: number) {
  const { lockedPrincipal, bond, goldValue, requiredBond, liability, coverageBps } = s.backing;
  if (movePercent === 0) return { goldValue, requiredBond, liability, coverageBps };
  const basis = BigInt(10_000 + movePercent * 100);
  const moved = (goldValue * basis) / 10_000n;
  const bonus = (lockedPrincipal * BigInt(s.terms.bonusBps)) / 10_000n;
  const floor = (lockedPrincipal * BigInt(s.terms.bondBps)) / 10_000n;
  const gain = moved > lockedPrincipal ? moved - lockedPrincipal : 0n;
  const owed = (moved > lockedPrincipal ? moved : lockedPrincipal) + bonus;
  return {
    goldValue: moved,
    requiredBond: (gain > floor ? gain : floor) + bonus,
    liability: owed,
    coverageBps: owed === 0n ? 10_000n : ((lockedPrincipal + bond) * 10_000n) / owed,
  };
}

export function BackingPanel({ scheme }: { scheme: SchemeData }) {
  const now = useNow();
  const [move, setMove] = useState(0);
  const { backing: b, decimals } = scheme;
  const p = project(scheme, move);
  const assets = b.lockedPrincipal + b.bond;
  const scale = assets > p.liability ? assets : p.liability;
  const share = (value: bigint) => (scale === 0n ? 0 : Number((value * 10_000n) / scale) / 100);
  const underwater = p.coverageBps < 10_000n && b.lockedPrincipal > 0n;
  const priceAge = now - b.priceUpdatedAt;
  const { min, max, step } = settings.simulationRange;

  return (
    <section className="panel" aria-labelledby="backing-title">
      <div className="status-line">
        <h2 id="backing-title" style={{ margin: 0 }}>Is this plan backed?</h2>
        <StatusPill scheme={scheme} now={now} />
      </div>

      <div className={`coverage ${underwater ? "bad" : ""}`}>
        {b.lockedPrincipal === 0n ? "–" : pct(p.coverageBps)}
      </div>
      <p className="small muted">
        {b.lockedPrincipal === 0n
          ? "Backing appears here when the first customer joins."
          : "Money held by the contract, against everything owed to customers."}
      </p>

      <div className="bar" role="img" aria-label={`Instalments ${share(b.lockedPrincipal)}%, bond ${share(b.bond)}%, owed marker at ${share(p.liability)}%`}>
        <div className="bar-seg bar-principal" style={{ left: 0, width: `${share(b.lockedPrincipal)}%` }} />
        <div className="bar-seg bar-bond" style={{ left: `${share(b.lockedPrincipal)}%`, width: `${share(b.bond)}%` }} />
        {p.liability > 0n && <div className="bar-mark" style={{ left: `calc(${share(p.liability)}% - 2px)` }} />}
      </div>
      <div className="bar-legend">
        <span><span className="swatch" style={{ background: "var(--accent)" }} />Customers' locked instalments</span>
        <span><span className="swatch" style={{ background: "var(--bond)" }} />Jeweller's bond</span>
        <span><span className="swatch" style={{ background: "var(--destructive)" }} />Owed to customers</span>
      </div>

      <div className="sim">
        <label htmlFor="sim-move">
          <span><FlaskConical size={14} className="icon-inline" aria-hidden /> What if gold moves?</span>
          <span className="mono">{move > 0 ? "+" : ""}{move}%</span>
        </label>
        <input id="sim-move" type="range" min={min} max={max} step={step} value={move} onChange={(e) => setMove(Number(e.target.value))} />
        <span className="xs muted">
          Simulation only. {move !== 0 && p.requiredBond > b.bond
            ? `The jeweller would need ${money(p.requiredBond - b.bond, decimals)} more bond.`
            : "The real price below comes from the oracle."}
        </span>
      </div>

      <dl className="kv">
        <dt>Locked instalments</dt>
        <dd>{moneyFine(b.lockedPrincipal, decimals)}</dd>
        <dt>Jeweller's bond</dt>
        <dd>{moneyFine(b.bond, decimals)}</dd>
        <dt>Bond required{move !== 0 ? " (simulated)" : ""}</dt>
        <dd>{moneyFine(p.requiredBond, decimals)}</dd>
        <dt>Gold value{move !== 0 ? " (simulated)" : " now"}</dt>
        <dd>{moneyFine(p.goldValue, decimals)}</dd>
        <dt>Held by the contract</dt>
        <dd>{moneyFine(scheme.tokenBalance, decimals)}</dd>
        <dt>Gold price per ounce</dt>
        <dd>${(Number(b.price) / 10 ** scheme.feedDecimals).toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd>
      </dl>
      <p className={`xs ${b.priceFresh ? "muted" : ""}`} style={{ marginTop: 8, color: b.priceFresh ? undefined : "var(--destructive)" }} title={dateTime(b.priceUpdatedAt)}>
        {b.priceFresh ? "From QIE Oracle" : "QIE Oracle's price is too old to use"}, updated {duration(priceAge)} ago.
      </p>
    </section>
  );
}
