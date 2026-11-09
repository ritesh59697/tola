import { useEffect, useState } from "react";
import { Contract, parseUnits } from "ethers";
import { deployment } from "../config";
import { registryAbi } from "../lib/abi";
import { registry, stablecoinMeta } from "../lib/chain";
import { pct } from "../lib/format";
import { useTx } from "../lib/tx";
import { useWallet } from "../lib/wallet";

const DAY = 86_400;
const abi = registryAbi as unknown as string[];

interface Limits { maxExitFeeBps: number; minBondBps: number; maxPriceAge: number }

/** Values a typical jeweller's plan uses. Each is shown for the jeweller to change. */
const initial = { name: "", instalment: "100", count: "11", periodDays: "30", graceDays: "7", deliveryDays: "30", cureDays: "3", bonus: "9", bond: "15", exitFee: "2" };

export function OpenScheme() {
  const { status, connect, address } = useWallet();
  const { run } = useTx();
  const [form, setForm] = useState(initial);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [decimals, setDecimals] = useState<number | null>(null);

  useEffect(() => {
    const c = registry();
    if (!c) return;
    void Promise.all([c.maxExitFeeBps(), c.minBondBps(), c.maxPriceAge()]).then(([maxExitFeeBps, minBondBps, maxPriceAge]) =>
      setLimits({ maxExitFeeBps: Number(maxExitFeeBps), minBondBps: Number(minBondBps), maxPriceAge: Number(maxPriceAge) }),
    );
    void stablecoinMeta().then((m) => setDecimals(m.decimals));
  }, []);

  const set = (key: keyof typeof initial) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const exitBps = Math.round(Number(form.exitFee) * 100);
  const bondBps = Math.round(Number(form.bond) * 100);
  const bonusBps = Math.round(Number(form.bonus) * 100);
  const exitBad = limits ? exitBps > limits.maxExitFeeBps : false;
  const bondBad = limits ? bondBps < limits.minBondBps : false;
  const numbersOk = [form.instalment, form.count, form.periodDays, form.cureDays].every((v) => Number(v) > 0);
  const ready = status === "connected" && limits && decimals !== null && form.name.trim() && numbersOk && !exitBad && !bondBad;

  const open = async () => {
    if (!ready || !deployment || !limits || decimals === null) return;
    const terms = [
      parseUnits(form.instalment, decimals),
      Number(form.count),
      Math.round(Number(form.periodDays) * DAY),
      Math.round(Number(form.graceDays) * DAY),
      Math.round(Number(form.deliveryDays) * DAY),
      Math.round(Number(form.cureDays) * DAY),
      limits.maxPriceAge,
      bonusBps,
      bondBps,
      exitBps,
    ];
    const ok = await run(`Open ${form.name.trim()}`, deployment.registry, abi, "openScheme", [form.name.trim(), terms]);
    if (ok && address) {
      const c = registry() as Contract;
      const mine: string[] = await c.schemesOf(address);
      window.location.hash = `#/scheme/${mine[mine.length - 1]}`;
    }
  };

  const fields: { key: keyof typeof initial; label: string; hint?: string; err?: boolean }[] = [
    { key: "instalment", label: "Instalment, in dollars" },
    { key: "count", label: "Number of instalments" },
    { key: "periodDays", label: "Days between instalments" },
    { key: "graceDays", label: "Days an instalment may be late" },
    { key: "deliveryDays", label: "Days to deliver after maturity" },
    { key: "cureDays", label: "Days to repair a short bond" },
    { key: "bonus", label: "Bonus when fully paid, in %", hint: "Many shops give one free instalment, about 9% on 11." },
    { key: "bond", label: "Your bond, in % of locked money", hint: limits ? `At least ${pct(limits.minBondBps)}.` : undefined, err: bondBad },
    { key: "exitFee", label: "Fee to leave early, in %", hint: limits ? `At most ${pct(limits.maxExitFeeBps)}.` : undefined, err: exitBad },
  ];

  return (
    <div className="scheme-head" style={{ maxWidth: "44rem", paddingBottom: 72 }}>
      <a className="small" href="#/">Back</a>
      <h1>Open a plan for your shop</h1>
      <p style={{ marginBottom: 24 }}>
        Show customers you are the kind of jeweller who doesn't need their trust. You receive each customer's money when you hand over their jewellery.
      </p>
      <div className="stack">
        <div className="field">
          <label htmlFor="shop-name">Shop name</label>
          <input id="shop-name" autoComplete="organization" value={form.name} onChange={set("name")} />
        </div>
        <div className="form-grid">
          {fields.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`f-${f.key}`}>{f.label}</label>
              <input id={`f-${f.key}`} inputMode="decimal" value={form[f.key]} onChange={set(f.key)} aria-invalid={f.err || undefined} />
              {f.hint && <span className={`hint ${f.err ? "err" : ""}`}>{f.hint}</span>}
            </div>
          ))}
        </div>
        {!deployment && <div className="notice notice-warn">Tola is not deployed on this network yet.</div>}
        <div className="btn-row">
          {status === "connected" ? (
            <button className="btn" disabled={!ready} onClick={() => void open()}>Open this plan</button>
          ) : (
            <button className="btn" onClick={() => void connect()}>Connect wallet to open a plan</button>
          )}
        </div>
      </div>
    </div>
  );
}
