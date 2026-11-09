import { ExternalLink } from "lucide-react";
import { deployment, explorerAddress, explorerTx, proofs, settings } from "../config";
import { StatusPill } from "../components/BackingPanel";
import { registry } from "../lib/chain";
import { duration, money, pct } from "../lib/format";
import { readScheme, useGold, useNow, usePolled, useRupeeRate } from "../lib/hooks";
import type { SchemeData } from "../lib/hooks";

const cases = [
  { year: "2019", text: "Goodwin Jewellers, Thane. Owners reportedly vanished, with about 700 people owed Rs 21 crore.", href: "https://www.theweek.in/news/biz-tech/2019/10/28/case-untraceable-keralite-promoters-goodwin-jewellers-thane.html" },
  { year: "2019", text: "Rasiklal Sankalchand, Mumbai. Investors went to the police, with deposits reported at Rs 300 crore or more.", href: "https://www.thequint.com/news/india/investors-in-mumbai-jewellers-scheme-complain-to-eow-amid-crisis" },
  { year: "2017", text: "Nathella Jewellery, Chennai. A 77-year-old jeweller shut shop in a cash crunch.", href: "https://business-standard.com/amp/article/companies/77-year-old-nathella-jewellery-shuts-shop-due-to-financial-crunch-117102400808_1.html" },
];

function GoldCard() {
  const { data: gold } = useGold();
  const rate = useRupeeRate();
  const now = useNow();
  const per10g = gold ? (Number(gold.price) / 10 ** gold.decimals / settings.gramsPerTroyOunce) * 10 : null;
  return (
    <aside className="gold-card" aria-label="Live gold price">
      <div className="label">Gold, 10 grams, from QIE Oracle</div>
      <div className="figure">{per10g !== null ? `$${per10g.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "…"}</div>
      {per10g !== null && rate !== null && (
        <div className="small">about ₹{Math.round(per10g * rate).toLocaleString("en-IN")} <span className="muted">before Indian duty and GST</span></div>
      )}
      {gold && (
        <p className="xs muted" style={{ marginTop: 12 }}>
          Updated {duration(now - gold.updatedAt)} ago.{" "}
          {deployment && (
            <a href={explorerAddress(deployment.goldFeed)} target="_blank" rel="noreferrer">
              Read the feed <ExternalLink size={12} className="icon-inline" aria-hidden />
            </a>
          )}
        </p>
      )}
    </aside>
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
    </a>
  );
}

function LivePlans() {
  const { data: schemes, error } = usePolled<SchemeData[]>(async () => {
    const c = registry();
    if (!c) return [];
    const addresses: string[] = await c.schemes();
    return Promise.all([...addresses].reverse().map(readScheme));
  }, []);

  if (!deployment) return <p className="muted">Tola is not deployed on this network yet.</p>;
  if (error && !schemes) return <div className="notice notice-bad" role="alert">Could not reach the chain just now. Trying again.</div>;
  if (!schemes) return <p className="muted">Reading plans from the chain…</p>;
  if (!schemes.length) return <p className="muted">No plans have been opened yet. <a href="#/open">Open the first one.</a></p>;
  return <div className="scheme-rows">{schemes.map((s) => <SchemeRow key={s.address} scheme={s} />)}</div>;
}

export function Home() {
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
        </div>
        <GoldCard />
      </section>

      <section className="split">
        <h2>When the shop shuts</h2>
        <div>
          <p className="story">
            Millions of families save for weddings through jewellers' monthly plans. The money goes straight to the shop. When a shop fails, those families stand outside its shutters.
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
        <LivePlans />
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
