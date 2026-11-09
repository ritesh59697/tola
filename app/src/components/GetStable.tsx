import { useEffect, useState } from "react";
import { Contract, formatUnits, parseEther } from "ethers";
import { ArrowDownUp } from "lucide-react";
import { deployment, network, settings } from "../config";
import { dexRouterAbi } from "../lib/abi";
import { reader, stablecoinMeta } from "../lib/chain";
import { useTx } from "../lib/tx";
import { useWallet } from "../lib/wallet";

/** Swaps QIE for the plan's stablecoin on QIEDEX, with the quote read live from its router. */
export function GetStable({ onDone }: { onDone?: () => void }) {
  const { address } = useWallet();
  const { run } = useTx();
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoteError, setQuoteError] = useState(false);
  const [meta, setMeta] = useState({ decimals: 6, symbol: "" });
  const routerAddress = network.dexRouter;

  useEffect(() => {
    void stablecoinMeta().then(setMeta);
  }, []);

  const value = (() => {
    try {
      return amount ? parseEther(amount) : 0n;
    } catch {
      return 0n;
    }
  })();

  useEffect(() => {
    setQuote(null);
    setQuoteError(false);
    if (!routerAddress || !deployment || value === 0n) return;
    let cancelled = false;
    (async () => {
      try {
        const router = new Contract(routerAddress, dexRouterAbi, reader);
        const wrapped: string = await router.WETH();
        const amounts: bigint[] = await router.getAmountsOut(value, [wrapped, deployment.stablecoin]);
        if (!cancelled) setQuote(amounts[amounts.length - 1]);
      } catch {
        if (!cancelled) setQuoteError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, routerAddress]);

  if (!routerAddress || !deployment) return null;
  const stablecoin = deployment.stablecoin;

  const swap = async () => {
    if (!quote || !address) return;
    const router = new Contract(routerAddress, dexRouterAbi, reader);
    const wrapped: string = await router.WETH();
    const minimum = (quote * BigInt(10_000 - settings.swapSlippageBps)) / 10_000n;
    const block = await reader.getBlock("latest");
    const deadline = (block?.timestamp ?? Math.floor(Date.now() / 1000)) + settings.swapDeadlineSeconds;
    const done = await run(
      `Swap ${amount} QIE on QIEDEX`,
      routerAddress,
      dexRouterAbi as unknown as string[],
      "swapExactETHForTokens",
      [minimum, [wrapped, stablecoin], address, deadline],
      { value },
    );
    if (done) {
      setAmount("");
      onDone?.();
    }
  };

  return (
    <div className="notice stack" style={{ gap: 8 }}>
      <strong style={{ fontWeight: 600 }}>Need {meta.symbol}? Swap QIE on QIEDEX</strong>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="swap-amount">QIE to swap</label>
          <input id="swap-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className={`hint ${quoteError ? "err" : ""}`} aria-live="polite">
            {quoteError
              ? "QIEDEX has no quote for this right now."
              : quote !== null
                ? `About ${Number(formatUnits(quote, meta.decimals)).toFixed(4)} ${meta.symbol}`
                : "Live quote from QIEDEX"}
          </span>
        </div>
        <button className="btn btn-quiet" disabled={!quote} onClick={() => void swap()}>
          <ArrowDownUp size={16} aria-hidden /> Swap
        </button>
      </div>
    </div>
  );
}
