import { useEffect, useState } from "react";
import { ArrowLeft, Clock, ExternalLink } from "lucide-react";
import { explorerAddress, settings } from "../config";
import { BackingPanel } from "../components/BackingPanel";
import { Counter } from "../components/Counter";
import { Passbook } from "../components/Passbook";
import { RecordTable } from "../components/RecordTable";
import { Watch } from "../components/Watch";
import { duration, money, pct, shortAddress } from "../lib/format";
import { useHistory, useQieName, useScheme } from "../lib/hooks";
import { useWallet } from "../lib/wallet";

type Tab = "passbook" | "counter" | "watch";
const tabs: { id: Tab; label: string }[] = [
  { id: "passbook", label: "My passbook" },
  { id: "counter", label: "Jeweller's counter" },
  { id: "watch", label: "Keep watch" },
];

export function SchemePage({ address }: { address: string }) {
  const { data: scheme, error, refresh } = useScheme(address);
  const history = useHistory(address);
  const { address: wallet } = useWallet();
  const jewellerName = useQieName(scheme?.jeweller);
  const [tab, setTab] = useState<Tab>("passbook");
  const [userChose, setUserChose] = useState(false);

  // Open on the side of the counter this wallet belongs to, until the viewer chooses otherwise.
  useEffect(() => {
    if (!userChose && scheme && wallet) {
      setTab(wallet.toLowerCase() === scheme.jeweller.toLowerCase() ? "counter" : "passbook");
    }
  }, [wallet, scheme?.jeweller, userChose]);

  const change = () => {
    void refresh();
    void history.refresh();
  };

  if (!scheme) {
    return (
      <div className="scheme-head">
        {error ? (
          <div className="notice notice-bad" role="alert">Could not read this plan from the chain. Check the link, or try again in a moment.</div>
        ) : (
          <p className="muted">Reading the plan from the chain…</p>
        )}
      </div>
    );
  }

  const { terms, decimals } = scheme;
  const shortTimers = terms.period < settings.shortTimerBelowSeconds;

  return (
    <>
      <div className="scheme-head">
        <a className="small" href="#/"><ArrowLeft size={14} className="icon-inline" aria-hidden /> All plans</a>
        <h1>{scheme.shopName}</h1>
        <div className="terms-line">
          <span>{money(terms.instalment, decimals)} × {terms.instalmentCount} instalments</span>
          <span>{pct(terms.bonusBps)} bonus when fully paid</span>
          <span>{pct(terms.exitFeeBps)} fee to leave early</span>
          <span>
            Jeweller{" "}
            <a href={explorerAddress(scheme.jeweller)} target="_blank" rel="noreferrer" className={jewellerName ? "" : "mono"}>{jewellerName ?? shortAddress(scheme.jeweller)}</a>
          </span>
          <span>
            <a href={explorerAddress(scheme.address)} target="_blank" rel="noreferrer">Contract <ExternalLink size={13} className="icon-inline" aria-hidden /></a>
          </span>
        </div>
        {shortTimers && (
          <div className="timer-note">
            <Clock size={15} aria-hidden /> Demo timers: one month here is {duration(terms.period)}, and the jeweller has {duration(terms.cureWindow)} to repair the bond. Real plans use real months.
          </div>
        )}
      </div>

      <div className="scheme-grid">
        <BackingPanel scheme={scheme} />
        <section className="panel" aria-label="Actions">
          <div className="tabs" role="tablist" aria-label="Plan sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="tab-panel"
                className="tab"
                onClick={() => { setTab(t.id); setUserChose(true); }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "passbook" && <Passbook scheme={scheme} history={history.data ?? []} onChange={change} />}
            {tab === "counter" && <Counter scheme={scheme} onChange={change} />}
            {tab === "watch" && <Watch scheme={scheme} onChange={change} />}
          </div>
        </section>
      </div>

      <RecordTable history={history.data ?? []} decimals={decimals} loading={history.data === null} />
    </>
  );
}
