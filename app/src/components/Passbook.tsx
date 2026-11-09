import { useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import { schemeAbi } from "../lib/abi";
import { dateTime, duration, grams, money, moneyFine, ozToGrams, pct } from "../lib/format";
import { PlanState, useNativeBalance, useNow, useTokenBalance } from "../lib/hooks";
import type { Plan, SchemeData } from "../lib/hooks";
import type { HistoryEntry } from "../lib/chain";
import { useTx } from "../lib/tx";
import { useWallet } from "../lib/wallet";
import { GetStable } from "./GetStable";
import { formatEther } from "ethers";
import { network } from "../config";

const abi = schemeAbi as unknown as string[];

const planStateLabel: Record<PlanState, string> = {
  [PlanState.None]: "",
  [PlanState.Active]: "Active",
  [PlanState.DeliveryConfirmed]: "You confirmed delivery",
  [PlanState.Collected]: "Delivered and settled",
  [PlanState.Exited]: "You left this plan",
  [PlanState.CashedOut]: "Paid out in cash",
  [PlanState.ClaimedInDefault]: "Claimed after default",
};

function PlanView({ scheme, plan, history, onChange }: { scheme: SchemeData; plan: Plan; history: HistoryEntry[]; onChange: () => void }) {
  const { run, approveThenRun } = useTx();
  const now = useNow();
  const { terms, decimals, backing, feedDecimals } = scheme;
  const active = plan.state === PlanState.Active;

  const goldValue = (plan.goldOz * backing.price) / 10n ** BigInt(18 + feedDecimals - decimals);
  const gain = goldValue > plan.principal ? goldValue - plan.principal : 0n;
  const fullyPaid = plan.paidCount >= terms.instalmentCount;
  const nextDue = plan.startedAt + plan.paidCount * terms.period;
  const lastDue = nextDue + terms.gracePeriod;
  const matured = now >= plan.maturesAt;
  const deliveryCloses = plan.maturesAt + terms.deliveryWindow;
  const flagged = scheme.flaggedAt !== 0;

  const rows = history.filter((h) => h.name === "InstalmentPaid" && Number(h.args.planId) === plan.id);

  const claim = async () => {
    if (scheme.tallyCursor <= scheme.plans.length) {
      const ok = await run("Add up customers' gains", scheme.address, abi, "tally", [scheme.plans.length]);
      if (!ok) return;
    }
    await run("Claim your money", scheme.address, abi, "claimInDefault", [plan.id]);
    onChange();
  };

  return (
    <div className="stack">
      <div className="status-line" style={{ marginBottom: 0 }}>
        <strong style={{ fontWeight: 600 }}>Plan {plan.id}</strong>
        <span className={`pill ${active ? "pill-ok" : "pill-quiet"}`}>{planStateLabel[plan.state]}</span>
      </div>

      <div className="stat-trio">
        <div><div className="label">Paid in</div><div className="value">{moneyFine(plan.principal, decimals)}</div></div>
        <div><div className="label">Gold locked</div><div className="value gold-figure">{grams(plan.goldOz)}</div></div>
        <div><div className="label">Worth now</div><div className="value">{moneyFine(goldValue, decimals)}</div></div>
      </div>

      <div className="table-scroll">
        <table className="ledger">
          <caption className="visually-hidden">Instalments paid on this plan</caption>
          <thead>
            <tr><th>No.</th><th>Date</th><th className="num">Paid</th><th className="num">Gold price</th><th className="num">Gold locked</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.hash + row.index}>
                <td className="mono">{String(row.args.paidCount)}/{terms.instalmentCount}</td>
                <td>{row.timestamp ? dateTime(row.timestamp) : ""}</td>
                <td className="num">{money(row.args.amount as bigint, decimals)}</td>
                <td className="num">${(Number(row.args.price) / 10 ** feedDecimals).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td className="num gold-figure">{grams(row.args.goldOz as bigint)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Loading your instalments…</td></tr>}
          </tbody>
        </table>
      </div>

      {active && scheme.defaulted && (
        <>
          <div className="notice notice-bad">
            This jeweller defaulted. Your {moneyFine(plan.principal, decimals)} is locked for you, and the bond pays your share of any gold gain.
          </div>
          <div className="btn-row"><button className="btn" onClick={() => void claim()}>Claim your money</button></div>
        </>
      )}

      {active && !scheme.defaulted && (
        <>
          {flagged && (
            <div className="notice notice-warn">
              This scheme is flagged as under-backed. New payments are paused, and you can leave now with no fee.
            </div>
          )}
          {!fullyPaid && !flagged && (
            now > lastDue ? (
              <div className="notice">The time to pay instalment {plan.paidCount + 1} has passed. Your gold stays locked, and the plan's bonus no longer applies.</div>
            ) : now < nextDue ? (
              <div className="notice">Instalment {plan.paidCount + 1} opens in <span className="mono">{duration(nextDue - now)}</span>.</div>
            ) : (
              <div className="btn-row">
                <button
                  className="btn"
                  onClick={() => void approveThenRun(scheme.stablecoin, scheme.address, terms.instalment, `Pay instalment ${plan.paidCount + 1}`, scheme.address, abi, "payInstalment", [plan.id]).then(onChange)}
                >
                  Pay instalment {plan.paidCount + 1}: {money(terms.instalment, decimals)}
                </button>
              </div>
            )
          )}

          {matured && now <= deliveryCloses && (
            <div className="notice">
              At the counter? Confirm once you have your jewellery. That is the only thing that releases this money to the jeweller.
              If nothing is delivered in <span className="mono">{duration(deliveryCloses - now)}</span>, you can take the gold value in cash instead.
            </div>
          )}
          {!matured && (
            <p className="small muted">Matures in <span className="mono">{duration(plan.maturesAt - now)}</span>. Then collect {grams(plan.goldOz)} of jewellery{fullyPaid ? ` plus a ${pct(terms.bonusBps)} bonus` : ""}. Gain so far: {moneyFine(gain, decimals)}.</p>
          )}

          <div className="btn-row">
            {matured && (
              <button className="btn" onClick={() => void run("Confirm delivery", scheme.address, abi, "confirmDelivery", [plan.id]).then(onChange)}>
                I received my jewellery
              </button>
            )}
            {now > deliveryCloses && (
              <button className="btn" onClick={() => void run("Take the gold value in cash", scheme.address, abi, "cashOut", [plan.id]).then(onChange)}>
                Not delivered: take gold value in cash
              </button>
            )}
            <button className="btn btn-quiet" onClick={() => void run("Leave this plan", scheme.address, abi, "exit", [plan.id]).then(onChange)}>
              Leave plan{flagged ? " (no fee)" : ` (${pct(terms.exitFeeBps)} fee)`}
            </button>
          </div>
          {ozToGrams(plan.goldOz) === 0 && <p className="xs muted">No gold locked yet.</p>}
        </>
      )}
    </div>
  );
}

export function Passbook({ scheme, history, onChange }: { scheme: SchemeData; history: HistoryEntry[]; onChange: () => void }) {
  const { status, address, connect } = useWallet();
  const { approveThenRun } = useTx();
  const [showAll, setShowAll] = useState(false);
  const balance = useTokenBalance(scheme.stablecoin, address);
  const native = useNativeBalance(address);
  const { terms, decimals, symbol } = scheme;

  const mine = useMemo(
    () => (address ? scheme.plans.filter((p) => p.customer.toLowerCase() === address.toLowerCase()).reverse() : []),
    [scheme.plans, address],
  );
  const openPlans = mine.filter((p) => p.state === PlanState.Active || p.state === PlanState.DeliveryConfirmed);
  const shown = showAll ? mine : openPlans.length ? openPlans : mine.slice(0, 1);
  const lowOnStable = balance.data !== null && balance.data !== undefined && balance.data < terms.instalment;
  const noGas = native.data === 0n;

  if (status !== "connected") {
    return (
      <div className="stack">
        <div className="notice"><BookOpen size={16} className="icon-inline" aria-hidden /> Connect your wallet to see your passbook or join this plan.</div>
        <div className="btn-row"><button className="btn" onClick={() => void connect()}>Connect wallet</button></div>
      </div>
    );
  }

  const canJoin = !scheme.defaulted && scheme.flaggedAt === 0 && scheme.backing.priceFresh;

  return (
    <div className="stack">
      {shown.map((plan) => (
        <PlanView key={plan.id} scheme={scheme} plan={plan} history={history} onChange={onChange} />
      ))}
      {mine.length > shown.length && (
        <button className="link-button small" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll(true)}>Show all {mine.length} of your plans</button>
      )}

      {openPlans.length === 0 && (
        <div className="stack" style={{ gap: 12 }}>
          {mine.length === 0 && (
            <p>
              Pay {money(terms.instalment, decimals)} every {duration(terms.period)}, {terms.instalmentCount} times.
              Each one locks gold at that moment's oracle price.
            </p>
          )}
          {!scheme.backing.priceFresh && (
            <div className="notice notice-warn">The oracle's gold price is too old to lock in. Joining opens again after its next update.</div>
          )}
          {scheme.flaggedAt !== 0 && !scheme.defaulted && <div className="notice notice-warn">This scheme is flagged as under-backed, so it is not taking new customers.</div>}
          {scheme.defaulted && <div className="notice notice-bad">This scheme is in default and is closed to new customers.</div>}
          <div className="btn-row">
            <button
              className="btn"
              disabled={!canJoin || lowOnStable}
              onClick={() => void approveThenRun(scheme.stablecoin, scheme.address, terms.instalment, "Join and pay instalment 1", scheme.address, abi, "enrol").then(onChange)}
            >
              Join: pay {money(terms.instalment, decimals)}
            </button>
          </div>
        </div>
      )}

      <p className="xs muted">
        This wallet holds {balance.data !== null && balance.data !== undefined ? moneyFine(balance.data, decimals) : "…"} {symbol}
        {native.data !== null && native.data !== undefined ? ` and ${Number(formatEther(native.data)).toFixed(3)} ${network.currency.symbol} for gas` : ""}.
      </p>
      {noGas && <div className="notice notice-warn">This wallet needs a little {network.currency.symbol} to pay for gas.</div>}
      {lowOnStable && !noGas && <GetStable onDone={() => { void balance.refresh(); void native.refresh(); }} />}
    </div>
  );
}
