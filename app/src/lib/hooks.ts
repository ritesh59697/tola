import { useCallback, useEffect, useRef, useState } from "react";
import { settings } from "../config";
import { qieName, readGold, readHistory, reader, scheme as schemeContract, stablecoinMeta, token, usdToLocal } from "./chain";
import type { GoldQuote, HistoryEntry } from "./chain";

/** Ticks once a second, for countdowns. */
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The chain's own clock: the latest block's timestamp. Time-gated actions use it rather than the browser's clock,
 * because the contract checks block.timestamp, which can trail the browser by a block or more.
 * Null until the first read.
 */
export function useChainNow() {
  const [chainNow, setChainNow] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => reader.getBlock("latest").then((b) => { if (live && b) setChainNow(b.timestamp); }).catch(() => {});
    void read();
    const timer = setInterval(read, settings.walletPollMs);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return chainNow;
}

/** Runs a read now and on a timer. Keeps the last good value through a failed poll. */
export function usePolled<T>(read: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(read);
  latest.current = read;

  const startedReads = useRef(0);
  const appliedRead = useRef(0);

  const refresh = useCallback(async () => {
    // A slow older read must not overwrite a newer one, or the page would show stale state after a transaction.
    const thisRead = ++startedReads.current;
    try {
      const value = await latest.current();
      if (thisRead < appliedRead.current) return;
      appliedRead.current = thisRead;
      setData(value);
      setError(null);
    } catch (e) {
      if (thisRead < appliedRead.current) return;
      console.warn("Read failed; keeping the last good value.", e);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), settings.pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refresh };
}

export const useGold = () => usePolled<GoldQuote | null>(readGold, []);

export function useRupeeRate() {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    void usdToLocal().then(setRate);
  }, []);
  return rate;
}

export function useQieName(address: string | null | undefined) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
    if (address) void qieName(address).then(setName);
  }, [address]);
  return name;
}

export interface Terms {
  instalment: bigint;
  instalmentCount: number;
  period: number;
  gracePeriod: number;
  deliveryWindow: number;
  cureWindow: number;
  maxPriceAge: number;
  bonusBps: number;
  bondBps: number;
  exitFeeBps: number;
}

export interface Backing {
  lockedPrincipal: bigint;
  bond: bigint;
  requiredBond: bigint;
  goldValue: bigint;
  liability: bigint;
  coverageBps: bigint;
  price: bigint;
  priceUpdatedAt: number;
  priceFresh: boolean;
}

export enum PlanState {
  None,
  Active,
  DeliveryConfirmed,
  Collected,
  Exited,
  CashedOut,
  ClaimedInDefault,
}

export interface Plan {
  id: number;
  customer: string;
  state: PlanState;
  paidCount: number;
  startedAt: number;
  principal: bigint;
  goldOz: bigint;
  maturesAt: number;
}

export interface SchemeData {
  address: string;
  shopName: string;
  jeweller: string;
  stablecoin: string;
  decimals: number;
  feedDecimals: number;
  symbol: string;
  terms: Terms;
  backing: Backing;
  plans: Plan[];
  flaggedAt: number;
  curesBy: number;
  defaulted: boolean;
  tallyCursor: number;
  unclaimedPlans: number;
  collectable: bigint;
  tokenBalance: bigint;
  chainTime: number;
}

const toTerms = (t: any): Terms => ({
  instalment: t.instalment,
  instalmentCount: Number(t.instalmentCount),
  period: Number(t.period),
  gracePeriod: Number(t.gracePeriod),
  deliveryWindow: Number(t.deliveryWindow),
  cureWindow: Number(t.cureWindow),
  maxPriceAge: Number(t.maxPriceAge),
  bonusBps: Number(t.bonusBps),
  bondBps: Number(t.bondBps),
  exitFeeBps: Number(t.exitFeeBps),
});

export async function readScheme(address: string): Promise<SchemeData> {
  const c = schemeContract(address);
  const [shopName, jeweller, stablecoin, rawTerms, rawBacking, planCount, flaggedAt, curesBy, defaulted, tallyCursor, unclaimedPlans, collectable, meta, block] =
    await Promise.all([
      c.shopName(),
      c.jeweller(),
      c.stablecoin(),
      c.terms(),
      c.backing(),
      c.planCount(),
      c.flaggedAt(),
      c.curesBy(),
      c.defaulted(),
      c.tallyCursor(),
      c.unclaimedPlans(),
      c.collectable(),
      stablecoinMeta(),
      reader.getBlock("latest"),
    ]);
  const gold = await readGold().catch(() => null);

  const ids = Array.from({ length: Number(planCount) }, (_, i) => i + 1);
  const plans = await Promise.all(
    ids.map(async (id) => {
      const [p, maturesAt] = await Promise.all([c.plan(id), c.maturesAt(id)]);
      return {
        id,
        customer: p.customer,
        state: Number(p.state) as PlanState,
        paidCount: Number(p.paidCount),
        startedAt: Number(p.startedAt),
        principal: p.principal,
        goldOz: p.goldOz,
        maturesAt: Number(maturesAt),
      } satisfies Plan;
    }),
  );

  const tokenBalance: bigint = await token(stablecoin).balanceOf(address);

  return {
    address,
    shopName,
    jeweller,
    stablecoin,
    decimals: meta.decimals,
    feedDecimals: gold?.decimals ?? Number(await schemeContract(address).feedDecimals()),
    symbol: meta.symbol,
    terms: toTerms(rawTerms),
    backing: {
      lockedPrincipal: rawBacking.lockedPrincipal,
      bond: rawBacking.bond,
      requiredBond: rawBacking.requiredBond,
      goldValue: rawBacking.goldValue,
      liability: rawBacking.liability,
      coverageBps: rawBacking.coverageBps,
      price: rawBacking.price,
      priceUpdatedAt: Number(rawBacking.priceUpdatedAt),
      priceFresh: rawBacking.priceFresh,
    },
    plans,
    flaggedAt: Number(flaggedAt),
    curesBy: Number(curesBy),
    defaulted,
    tallyCursor: Number(tallyCursor),
    unclaimedPlans: Number(unclaimedPlans),
    collectable,
    tokenBalance,
    chainTime: block?.timestamp ?? Math.floor(Date.now() / 1000),
  };
}

export const useScheme = (address: string) => usePolled(() => readScheme(address), [address]);

export function useHistory(address: string) {
  return usePolled<HistoryEntry[]>(() => readHistory(address), [address]);
}

export function useTokenBalance(tokenAddress: string | undefined, owner: string | null) {
  return usePolled<bigint | null>(
    async () => (tokenAddress && owner ? token(tokenAddress).balanceOf(owner) : null),
    [tokenAddress, owner],
  );
}

export function useNativeBalance(owner: string | null) {
  return usePolled<bigint | null>(async () => (owner ? reader.getBalance(owner) : null), [owner]);
}
