import { schemeAbi } from "../lib/abi";
import { duration, moneyFine } from "../lib/format";
import { useNow } from "../lib/hooks";
import type { SchemeData } from "../lib/hooks";
import { useTx } from "../lib/tx";
import { useWallet } from "../lib/wallet";

const abi = schemeAbi as unknown as string[];

/** The steps anyone can take. Nothing here needs permission from the jeweller or from Tola. */
export function Watch({ scheme, onChange }: { scheme: SchemeData; onChange: () => void }) {
  const { status, connect } = useWallet();
  const { run } = useTx();
  const now = useNow();
  const { backing, decimals, flaggedAt, curesBy, defaulted } = scheme;
  const short = backing.bond < backing.requiredBond;
  const flagged = flaggedAt !== 0;
  const repairOver = flagged && now >= curesBy;
  const tallyDone = scheme.tallyCursor > scheme.plans.length;
  const connected = status === "connected";

  const act = (label: string, method: string, args: unknown[] = []) =>
    void run(label, scheme.address, abi, method, args).then(onChange);

  return (
    <div className="stack">
      <p>
        You do not have to trust the jeweller or Tola to keep watch. Anyone can start these steps, and the contract checks the facts itself.
      </p>
      {!connected && (
        <div className="btn-row"><button className="btn" onClick={() => void connect()}>Connect wallet to act</button></div>
      )}

      {!flagged && !defaulted && (
        <div className="stack" style={{ gap: 8 }}>
          <div className={`notice ${short ? "notice-warn" : ""}`}>
            {short
              ? `The bond is ${moneyFine(backing.requiredBond - backing.bond, decimals)} short of what this scheme requires. You can flag it now.`
              : "The bond meets the requirement, so the contract would refuse a flag."}
          </div>
          <div className="btn-row">
            <button className="btn" disabled={!connected || !short} onClick={() => act("Flag the low bond", "flagUnderbacked")}>Flag the low bond</button>
          </div>
        </div>
      )}

      {flagged && !defaulted && (
        <div className="stack" style={{ gap: 8 }}>
          <div className={`notice ${repairOver ? "notice-bad" : "notice-warn"}`}>
            {repairOver
              ? short
                ? "The jeweller did not repair the bond in time. Anyone can now declare default."
                : "The jeweller repaired the bond. Anyone can clear the flag."
              : <>The jeweller has <span className="mono">{duration(curesBy - now)}</span> to repair the bond. Until then, new payments are paused and customers can leave free.</>}
          </div>
          <div className="btn-row">
            <button className="btn btn-danger" disabled={!connected || !repairOver || !short} onClick={() => act("Declare default", "declareDefault")}>Declare default</button>
            <button className="btn btn-quiet" disabled={!connected || short} onClick={() => act("Clear the flag", "clearFlag")}>Clear flag</button>
          </div>
        </div>
      )}

      {defaulted && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="notice notice-bad">
            This scheme is in default. Each customer can claim their full principal, plus their share of the bond for gold gains.
            {!tallyDone && " Customers' gains need adding up first; the first claim does this, or you can do it here."}
          </div>
          <div className="btn-row">
            {!tallyDone && (
              <button className="btn" disabled={!connected} onClick={() => act("Add up customers' gains", "tally", [scheme.plans.length])}>Add up gains</button>
            )}
            {tallyDone && scheme.unclaimedPlans === 0 && backing.bond > 0n && (
              <button className="btn btn-quiet" disabled={!connected} onClick={() => act("Return leftover bond to the jeweller", "returnResidualBond")}>Return leftover bond to the jeweller</button>
            )}
          </div>
          {tallyDone && <p className="small muted">{scheme.unclaimedPlans} plan{scheme.unclaimedPlans === 1 ? "" : "s"} still to claim.</p>}
        </div>
      )}
    </div>
  );
}
