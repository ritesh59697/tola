import { ExternalLink } from "lucide-react";
import { deployment, explorerAddress, explorerTx, proofs, settings } from "../config";
import { StatusPill } from "../components/BackingPanel";
import { registry } from "../lib/chain";
import { duration, money, moneyFine, pct } from "../lib/format";
import { readScheme, useGold, useNow, usePolled, useRupeeRate } from "../lib/hooks";
import type { SchemeData } from "../lib/hooks";
import { summarizeUsage } from "../lib/usage";
import type { Split } from "../lib/usage";

const cases = [
  { year: "2019", text: "Goodwin Jewellers, Thane. Owners reportedly vanished, with about 700 people owed Rs 21 crore.", href: "https://www.theweek.in/news/biz-tech/2019/10/28/case-untraceable-keralite-promoters-goodwin-jewellers-thane.html" },
  { year: "2019", text: "Rasiklal Sankalchand, Mumbai. Investors went to the police, with deposits reported at Rs 300 crore or more.", href: "https://www.thequint.com/news/india/investors-in-mumbai-jewellers-scheme-complain-to-eow-amid-crisis" },
  { year: "2017", text: "Nathella Jewellery, Chennai. A 77-year-old jeweller shut shop in a cash crunch.", href: "https://business-standard.com/amp/article/companies/77-year-old-nathella-jewellery-shuts-shop-due-to-financial-crunch-117102400808_1.html" },
];

/**
 * The hero: a passbook page filled in at QIE Oracle's live price. The monthly amount is a labelled example;
 * every gram figure is worked out from the live price, so nothing on it is made up.
 */
function HeroPassbook() {
  const { data: gold, error } = useGold();
  const rate = useRupeeRate();
  const now = useNow();
  const { localPerMonth, monthsFilled, linesRuled } = settings.heroExample;
  const perGram = gold ? Number(gold.price) / 10 ** gold.decimals / settings.gramsPerTroyOunce : null;
  const gramsPerMonth = perGram !== null && rate !== null ? localPerMonth / (perGram * rate) : null;
  const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
  const g = (v: number) => `${v.toFixed(2)} g`;
  const lines = Array.from({ length: linesRuled }, (_, i) => (i < monthsFilled ? i + 1 : null));

  return (
    <figure className="passbook" aria-label="A gold savings passbook page, filled in at today's live gold price">
      <div className="passbook-head">
        <span className="passbook-title">Gold savings passbook</span>
        <span className="xs muted">Tola, on QIE Mainnet</span>
      </div>

      <div className="passbook-rate">
        <div className="label">Today's gold rate, 10 grams, from QIE Oracle</div>
        <div className="figure">
          {perGram !== null ? `$${(perGram * 10).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : error ? "–" : "…"}
        </div>
        {perGram !== null && rate !== null && (
          <div className="small">about {rupees(perGram * 10 * rate)} <span className="muted">before Indian duty and GST</span></div>
        )}
        {!gold && (
          <div className="small muted" role={error ? "alert" : undefined}>
            {error ? "Could not reach QIE Oracle just now. Trying again." : "Reading the price from QIE Oracle…"}
          </div>
        )}
      </div>

      <table className="passbook-lines">
        <caption className="xs muted">
          {gramsPerMonth !== null
            ? `Example: ${rupees(localPerMonth)} a month, each month locked at today's rate`
            : `Example: ${rupees(localPerMonth)} a month. Grams appear once the live rates load.`}
        </caption>
        <thead>
          <tr><th scope="col">Month</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Gold locked</th><th scope="col" className="num">Total</th></tr>
        </thead>
        <tbody>
          {lines.map((month, i) => (
            <tr key={i}>
              <td className="mono">{month ?? ""}</td>
              <td className="num">{month ? rupees(localPerMonth) : ""}</td>
              <td className="num gold-figure">{month && gramsPerMonth !== null ? g(gramsPerMonth) : month ? "…" : ""}</td>
              <td className="num gold-figure">{month && gramsPerMonth !== null ? g(gramsPerMonth * month) : month ? "…" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stamp" aria-hidden>Locked until you have<br />your jewellery</div>

      {gold && (
        <figcaption className="xs muted">
          Price updated {duration(now - gold.updatedAt)} ago.{" "}
          {deployment && (
            <a href={explorerAddress(deployment.goldFeed)} target="_blank" rel="noreferrer">
              Read the feed <ExternalLink size={12} className="icon-inline" aria-hidden />
            </a>
          )}
        </figcaption>
      )}
    </figure>
  );
}

function SchemeRow({ scheme }: { scheme: SchemeData }) {
  const now = useNow();
  const { terms, decimals, backing } = scheme;
  return (
    <a className="scheme-row" href={`#/scheme/${scheme.address}`}>
      <div>
        <h3>{scheme.shopName}</h3>
        <span className="small muted">{money(terms.instalment, decimals)} × {terms.instalmentCount}, every {duration(terms.period)}</span>
      </div>
      <div className="small">
        {money(backing.lockedPrincipal, decimals, backing.lockedPrincipal < 10n ** BigInt(decimals + 1) ? 2 : 0)} locked for {scheme.plans.filter((p) => p.state === 1).length} active plan{scheme.plans.filter((p) => p.state === 1).length === 1 ? "" : "s"}, bond {money(backing.bond, decimals)}
        {backing.lockedPrincipal > 0n && <span className="muted"> · {pct(backing.coverageBps)} backed</span>}
      </div>
      <div><StatusPill scheme={scheme} now={now} /></div>
      {scheme.defaulted && scheme.plans.length > 0 && (
        <p className="xs muted scheme-note">
          This plan went through a default: {scheme.plans.length - scheme.unclaimedPlans} of {scheme.plans.length} customer plan{scheme.plans.length === 1 ? "" : "s"} took their money back from the contract.
        </p>
      )}
    </a>
  );
}

/** Every scheme in the registry, newest first. The plan list and the usage panel share this one read. */
function useAllSchemes() {
  return usePolled<SchemeData[]>(async () => {
    const c = registry();
    if (!c) return [];
    const addresses: string[] = await c.schemes();
    return Promise.all([...addresses].reverse().map(readScheme));
  }, []);
}

function LivePlans({ schemes, error }: { schemes: SchemeData[] | null; error: string | null }) {
  if (!deployment) return <p className="muted">Tola is not deployed on this network yet.</p>;
  if (error && !schemes) return <div className="notice notice-bad" role="alert">Could not reach the chain just now. Trying again.</div>;
  if (!schemes) return <p className="muted">Reading plans from the chain…</p>;
  if (!schemes.length) return <p className="muted">No plans have been opened yet. <a href="#/open">Open the first one.</a></p>;
  return <div className="scheme-rows">{schemes.map((s) => <SchemeRow key={s.address} scheme={s} />)}</div>;
}

function UsageRow({ label, value }: { label: string; value: Split<string> }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{value.outside}</td>
      <td className="num muted">{value.demo}</td>
    </tr>
  );
}

const counts = (v: Split<number>): Split<string> => ({ outside: String(v.outside), demo: String(v.demo) });

function Usage({ schemes }: { schemes: SchemeData[] | null }) {
  if (!deployment || !schemes) return <p className="muted">Reading from the chain…</p>;
  const u = summarizeUsage(schemes, deployment.demoWallets ?? []);
  const dollars = (v: Split<bigint>): Split<string> => ({ outside: moneyFine(v.outside, u.decimals), demo: moneyFine(v.demo, u.decimals) });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="small">
        Counted live from the contracts on QIE Mainnet. Activity from the Tola team's own demo wallets is kept in its own column, so it is never shown as real usage.
        {u.customers.outside === 0 ? " No outside wallet has joined a plan yet." : ""}
      </p>
      <div className="table-scroll">
        <table className="ledger">
          <thead>
            <tr><th scope="col">On the chain</th><th scope="col" className="num">Outside wallets</th><th scope="col" className="num">Tola team demos</th></tr>
          </thead>
          <tbody>
            <UsageRow label="Shops' plans opened" value={counts(u.schemes)} />
            <UsageRow label="Customer wallets" value={counts(u.customers)} />
            <UsageRow label="Customer plans joined" value={counts(u.plans)} />
            <UsageRow label="Instalments paid" value={counts(u.instalments)} />
            <UsageRow label="Paid in" value={dollars(u.paidIn)} />
            <UsageRow label="Delivered, then the jeweller was paid" value={counts(u.delivered)} />
            <UsageRow label="Paid back after a default" value={counts(u.refundedInDefault)} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Home() {
  const { data: schemes, error } = useAllSchemes();
  return (
    <>
      <section className="hero">
        <div>
          <h1>Gold savings your jeweller can't run away with.</h1>
          <p className="hero-lede">
            Pay every month and lock in gold at that day's price, like any jeweller's plan. The difference: the shop cannot touch your money until you have your jewellery.
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}>See a live plan</button>
            <a className="btn btn-quiet" href="#/open">Open a plan for your shop</a>
          </div>
          {proofs[0] && (
            <p className="small" style={{ marginTop: 16 }}>
              No wallet needed to check it:{" "}
              <a href={explorerTx(proofs[0].tx)} target="_blank" rel="noreferrer">
                see a jeweller's real attempt fail on the chain <ExternalLink size={13} className="icon-inline" aria-hidden />
              </a>
            </p>
          )}
        </div>
        <HeroPassbook />
      </section>

      <section className="split">
        <h2>When the shop shuts</h2>
        <div>
          <p className="story">
            Families across India save for weddings through jewellers' monthly plans. The money goes straight to the shop. When a shop fails, those families stand outside its shutters.
          </p>
          <ul className="case-list">
            {cases.map((c) => (
              <li key={c.href}>
                <span className="mono muted">{c.year}</span>
                <span>{c.text} <a href={c.href} target="_blank" rel="noreferrer">Report <ExternalLink size={12} className="icon-inline" aria-hidden /></a></span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="split">
        <h2>What the contract promises</h2>
        <ol className="promises">
          <li><div><strong>Your money stays locked.</strong> The jeweller is paid only after you confirm you received your jewellery. Any attempt before that fails on the chain.</div></li>
          <li><div><strong>Your gold price is fixed the day you pay.</strong> Each instalment locks a weight of gold at QIE Oracle's live price, and the record is public.</div></li>
          <li><div><strong>The jeweller stands behind the gold.</strong> A bond covers your gold gain and bonus. As gold rises, the required bond rises too, and anyone can see if it falls short.</div></li>
          <li><div><strong>If the jeweller fails, you are paid.</strong> Anyone can flag a short bond. If it isn't repaired in time, every customer takes back what they paid, plus their share of the bond for gold gains.</div></li>
          <li><div><strong>If nothing is delivered, you take cash.</strong> After the delivery window, you can take your gold's value in cash, at the current price.</div></li>
        </ol>
      </section>

      <section className="split" id="plans">
        <h2>Live plans</h2>
        <LivePlans schemes={schemes} error={error} />
      </section>

      <section className="split" id="usage">
        <h2>Use so far</h2>
        <Usage schemes={schemes} />
      </section>

      {proofs.length > 0 && (
        <section className="split">
          <h2>See it refuse</h2>
          <ul className="case-list">
            {proofs.map((proof) => (
              <li key={proof.tx} style={{ gridTemplateColumns: "1fr" }}>
                <span><strong style={{ fontWeight: 600 }}>{proof.label}.</strong> {proof.detail}{" "}
                  <a href={explorerTx(proof.tx)} target="_blank" rel="noreferrer">See it on the explorer <ExternalLink size={12} className="icon-inline" aria-hidden /></a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="footer">
        <p>Tola is a hackathon project for QIE Hackathon 3.0. The contracts have tests but no outside audit, the plans listed use small amounts, and no real jeweller is using it yet. Built with AI assistance. Prices are international spot, not an Indian shop's rate. Rupee figures are for display only.</p>
        <p>
          {deployment && <a href={explorerAddress(deployment.registry)} target="_blank" rel="noreferrer">Registry contract</a>}
        </p>
      </footer>
    </>
  );
}
