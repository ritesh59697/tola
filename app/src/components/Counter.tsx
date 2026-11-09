import { useEffect, useState } from "react";
import { parseUnits } from "ethers";
import { Ban, ExternalLink } from "lucide-react";
import { explorerTx } from "../config";
import { schemeAbi } from "../lib/abi";
import { moneyFine, shortAddress } from "../lib/format";
import { PlanState, useNativeBalance, useTokenBalance } from "../lib/hooks";
import type { SchemeData } from "../lib/hooks";
import { useTx } from "../lib/tx";
import { useWallet } from "../lib/wallet";
import { GetStable } from "./GetStable";

const abi = schemeAbi as unknown as string[];

const stateText: Partial<Record<PlanState, string>> = {
  [PlanState.Active]: "Not confirmed",
  [PlanState.DeliveryConfirmed]: "Customer confirmed",
  [PlanState.Collected]: "Collected",
  [PlanState.Exited]: "Customer left",
  [PlanState.CashedOut]: "Paid out in cash",
  [PlanState.ClaimedInDefault]: "Claimed in default",
};

export function Counter({ scheme, onChange }: { scheme: SchemeData; onChange: () => void }) {
  const { status, address, connect } = useWallet();
  const { run, approveThenRun, transactions, dismiss } = useTx();
  const [amount, setAmount] = useState("");
  const [refusal, setRefusal] = useState<{ plan: number; hash?: string; message?: string } | null>(null);
  const [lastCollect, setLastCollect] = useState<{ id: number; plan: number } | null>(null);
  const { decimals, symbol, backing } = scheme;
  const isJeweller = address?.toLowerCase() === scheme.jeweller.toLowerCase();
  const balance = useTokenBalance(scheme.stablecoin, isJeweller ? address : null);
  const native = useNativeBalance(isJeweller ? address : null);

  const collect = (planId: number) => {
    setRefusal(null);
    setLastCollect({ id: Date.now(), plan: planId });
    void run(`Collect plan ${planId}'s instalments`, scheme.address, abi, "collect", [planId], { forceOnChain: true }).then(onChange);
  };

  // Show the contract's refusal as the page's main event.
  useEffect(() => {
    if (!lastCollect) return;
    const tx = [...transactions].reverse().find((t) => t.label === `Collect plan ${lastCollect.plan}'s instalments`);
    if (tx?.phase === "refused") {
      setRefusal({ plan: lastCollect.plan, hash: tx.hash, message: tx.message });
      dismiss(tx.id); // The panel shows it in full, so the small card would only cover it.
    }
  }, [transactions, lastCollect, dismiss]);

  const parsed = (() => {
    try {
      return amount ? parseUnits(amount, decimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const freeBond = backing.bond > backing.requiredBond ? backing.bond - backing.requiredBond : 0n;

  const openPlans = scheme.plans.filter((p) => p.state === PlanState.Active || p.state === PlanState.DeliveryConfirmed);

  return (
    <div className="stack">
      {!isJeweller && (
        <div className="notice">
          This is the jeweller's side of the counter, for <span className="mono">{shortAddress(scheme.jeweller)}</span>. Anyone can read it.
          {status !== "connected" && (
            <> <button className="link-button" onClick={() => void connect()}>Connect the jeweller's wallet</button> to act.</>
          )}
        </div>
      )}

      {refusal && (
        <div className="refused" role="alert">
          <h3><Ban size={24} className="icon-inline" aria-hidden /> Refused</h3>
          <p>{refusal.message}</p>
          {refusal.hash && (
            <p className="small">
              This attempt failed on the chain. Anyone can check it:{" "}
              <a href={explorerTx(refusal.hash)} target="_blank" rel="noreferrer">
                see the failed transaction <ExternalLink size={13} className="icon-inline" aria-hidden />
              </a>
            </p>
          )}
        </div>
      )}

      <div>
        <h3 style={{ fontSize: "var(--text-base)", fontFamily: "var(--font-body)", fontWeight: 600, marginBottom: 8 }}>Customers' money</h3>
        <div className="table-scroll">
          <table className="ledger">
            <caption className="visually-hidden">Customer plans in this scheme</caption>
            <thead>
              <tr><th>Plan</th><th>Customer</th><th className="num">Locked</th><th>Status</th><th><span className="visually-hidden">Action</span></th></tr>
            </thead>
            <tbody>
              {openPlans.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.id}</td>
                  <td className="mono">{shortAddress(p.customer)}</td>
                  <td className="num">{moneyFine(p.principal, decimals)}</td>
                  <td>{stateText[p.state]}</td>
                  <td style={{ textAlign: "right" }}>
                    {isJeweller && (
                      <button className={`btn ${p.state === PlanState.Active ? "btn-danger" : ""}`} onClick={() => collect(p.id)}>
                        Collect
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {openPlans.length === 0 && <tr><td colSpan={5} className="muted">No open plans.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="xs muted" style={{ marginTop: 8 }}>
          The contract pays the jeweller only after that customer confirms delivery. Pressing Collect on an unconfirmed plan sends a real transaction, which the chain refuses.
        </p>
      </div>

      {!scheme.defaulted && (
        <div>
          <h3 style={{ fontSize: "var(--text-base)", fontFamily: "var(--font-body)", fontWeight: 600, marginBottom: 8 }}>Your bond</h3>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Backs customers' gold gains and bonus. Bond {moneyFine(backing.bond, decimals)}, required {moneyFine(backing.requiredBond, decimals)}, free to withdraw {moneyFine(freeBond, decimals)}.
          </p>
          {isJeweller && (
            <div className="inline-form">
              <div className="field">
                <label htmlFor="bond-amount">Amount in {symbol}</label>
                <input id="bond-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <button
                className="btn"
                disabled={parsed === 0n}
                onClick={() => void approveThenRun(scheme.stablecoin, scheme.address, parsed, "Add to bond", scheme.address, abi, "depositBond", [parsed]).then((ok) => { if (ok) setAmount(""); onChange(); })}
              >
                Add
              </button>
              <button
                className="btn btn-quiet"
                disabled={parsed === 0n}
                onClick={() => void run("Withdraw from bond", scheme.address, abi, "withdrawBond", [parsed], { forceOnChain: false }).then((ok) => { if (ok) setAmount(""); onChange(); })}
              >
                Withdraw
              </button>
            </div>
          )}
        </div>
      )}

      {isJeweller && balance.data !== null && balance.data !== undefined && (
        <p className="xs muted">This wallet holds {moneyFine(balance.data, decimals)} {symbol}.{native.data === 0n ? " It needs a little QIE for gas." : ""}</p>
      )}
      {isJeweller && balance.data === 0n && native.data !== 0n && <GetStable onDone={() => void balance.refresh()} />}
    </div>
  );
}
