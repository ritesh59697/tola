import { Contract, FallbackProvider, Interface, JsonRpcProvider, Network as EthersNetwork } from "ethers";
import type { AbstractProvider } from "ethers";
import { chainId, deployment, network, settings } from "../config";
import { erc20Abi, feedAbi, qieIdMetadataAbi, qieIdReverseAbi, registryAbi, schemeAbi } from "./abi";

const staticNetwork = EthersNetwork.from(chainId);

function makeProvider(): AbstractProvider {
  const nodes = network.rpcUrls.map((url) => new JsonRpcProvider(url, staticNetwork, { staticNetwork }));
  if (nodes.length === 1) return nodes[0];
  return new FallbackProvider(
    nodes.map((provider, index) => ({ provider, priority: index + 1, stallTimeout: 2500 })),
    staticNetwork,
    { quorum: 1 },
  );
}

/** Read-only connection, so the site works with no wallet. */
export const reader = makeProvider();

export const schemeInterface = new Interface(schemeAbi);
export const scheme = (address: string) => new Contract(address, schemeAbi, reader);
export const token = (address: string) => new Contract(address, erc20Abi, reader);
export const registry = () => (deployment ? new Contract(deployment.registry, registryAbi, reader) : null);
export const feed = () => (deployment ? new Contract(deployment.goldFeed, feedAbi, reader) : null);

export interface GoldQuote {
  price: bigint;
  decimals: number;
  updatedAt: number;
  description: string;
}

let feedMeta: { decimals: number; description: string } | null = null;

export async function readGold(): Promise<GoldQuote | null> {
  const c = feed();
  if (!c) return null;
  if (!feedMeta) {
    const [decimals, description] = await Promise.all([c.decimals(), c.description()]);
    feedMeta = { decimals: Number(decimals), description };
  }
  const round = await c.latestRoundData();
  return { price: round[1], updatedAt: Number(round[3]), ...feedMeta };
}

let stableMeta: { decimals: number; symbol: string } | null = null;

export async function stablecoinMeta() {
  if (!deployment) return { decimals: 6, symbol: "USD" };
  if (!stableMeta) {
    const c = token(deployment.stablecoin);
    const [decimals, symbol] = await Promise.all([c.decimals(), c.symbol()]);
    stableMeta = { decimals: Number(decimals), symbol };
  }
  return stableMeta;
}

const nameCache = new Map<string, string | null>();

/**
 * Finds the owner's .qie name. A name is only shown if it resolves back to the same address, so
 * nobody can display a shop name they do not own.
 */
export async function qieName(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  if (nameCache.has(key)) return nameCache.get(key) ?? null;
  let result: string | null = null;
  try {
    if (network.qieIdReverseResolver) {
      const reverse = new Contract(network.qieIdReverseResolver, qieIdReverseAbi, reader);
      const name: string = await reverse.resolve(address);
      if (name && (await resolveName(name))?.toLowerCase() === key) result = name;
    }
  } catch {
    result = null;
  }
  nameCache.set(key, result);
  return result;
}

export async function resolveName(name: string): Promise<string | null> {
  for (const metadata of network.qieIdMetadata) {
    const contract = new Contract(metadata, qieIdMetadataAbi, reader);
    for (const key of ["evm", "qie"]) {
      try {
        const value: string = await contract.resolveMetadata(name, key);
        if (value && !/^0x0+$/.test(value)) return value;
      } catch {
        // This contract does not hold the name; try the next one.
      }
    }
  }
  return null;
}

let fxCache: Promise<number | null> | null = null;

/** Live rupee rate for display only. Nothing on-chain uses it, and the page copes without it. */
export function usdToLocal(): Promise<number | null> {
  fxCache ??= fetch(settings.fxUrl)
    .then((response) => response.json())
    .then((data) => {
      const rate = data?.rates?.[settings.fxCurrency];
      return typeof rate === "number" ? rate : null;
    })
    .catch(() => null);
  return fxCache;
}

export interface HistoryEntry {
  name: string;
  args: Record<string, unknown>;
  blockNumber: number;
  hash: string;
  index: number;
  timestamp?: number;
}

const blockTimes = new Map<number, number>();

function toEntry(topics: string[], data: string, blockNumber: number, hash: string, index: number): HistoryEntry | null {
  const parsed = schemeInterface.parseLog({ topics, data });
  if (!parsed) return null;
  const args: Record<string, unknown> = {};
  parsed.fragment.inputs.forEach((input, n) => (args[input.name] = parsed.args[n]));
  return { name: parsed.name, args, blockNumber, hash, index };
}

/** The node only serves short log ranges, so the explorer's index is the first choice. */
async function logsFromExplorer(address: string): Promise<HistoryEntry[] | null> {
  if (!network.explorerApi) return null;
  try {
    const entries: HistoryEntry[] = [];
    let query = "";
    for (let page = 0; page < settings.logMaxChunks; page++) {
      const response = await fetch(`${network.explorerApi}/addresses/${address}/logs${query}`);
      if (!response.ok) return null;
      const body = await response.json();
      for (const item of body.items ?? []) {
        const topics = (item.topics as (string | null)[]).filter((t): t is string => Boolean(t));
        const entry = toEntry(topics, item.data, item.block_number, item.transaction_hash ?? item.tx_hash, item.index);
        if (entry) entries.push(entry);
      }
      if (!body.next_page_params) break;
      query = `?${new URLSearchParams(body.next_page_params).toString()}`;
    }
    return entries;
  } catch {
    return null;
  }
}

async function logsFromNode(address: string): Promise<HistoryEntry[]> {
  const latest = await reader.getBlockNumber();
  const entries: HistoryEntry[] = [];
  let to = latest;
  for (let i = 0; i < settings.logMaxChunks && to > 0; i++) {
    const from = Math.max(0, to - settings.logChunkBlocks + 1);
    const logs = await reader.getLogs({ address, fromBlock: from, toBlock: to });
    for (const log of logs) {
      const entry = toEntry([...log.topics], log.data, log.blockNumber, log.transactionHash, log.index);
      if (entry) entries.push(entry);
    }
    to = from - 1;
  }
  return entries;
}

/** A scheme's public record, oldest first. */
export async function readHistory(address: string): Promise<HistoryEntry[]> {
  const entries = (await logsFromExplorer(address)) ?? (await logsFromNode(address));
  const missing = [...new Set(entries.map((e) => e.blockNumber))].filter((b) => !blockTimes.has(b));
  await Promise.all(
    missing.map(async (b) => {
      const block = await reader.getBlock(b);
      if (block) blockTimes.set(b, block.timestamp);
    }),
  );
  entries.forEach((e) => (e.timestamp = blockTimes.get(e.blockNumber)));
  return entries.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
}
