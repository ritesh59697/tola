import { formatUnits } from "ethers";
import { settings } from "../config";

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function money(value: bigint, decimals: number, digits = 2): string {
  const n = Number(formatUnits(value, decimals));
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Shows two places, unless that would hide a small amount's real value. */
export function moneyFine(value: bigint, decimals: number): string {
  const n = Number(formatUnits(value, decimals));
  return money(value, decimals, Math.abs(n - Math.round(n * 100) / 100) < 0.00005 ? 2 : 4);
}

export const ozToGrams = (goldOz: bigint) => Number(formatUnits(goldOz, 18)) * settings.gramsPerTroyOunce;

export function grams(goldOz: bigint): string {
  const g = ozToGrams(goldOz);
  if (g === 0) return "0 g";
  if (g < 1) return `${(g * 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} mg`;
  return `${g.toLocaleString("en-US", { maximumFractionDigits: 3 })} g`;
}

export function usdPrice(price: bigint, feedDecimals: number): string {
  const value = Number(price) / 10 ** feedDecimals;
  return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const pct = (bps: number | bigint, digits = 0) => `${(Number(bps) / 100).toFixed(digits)}%`;

export function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} sec`;
  if (s < 3600) {
    const secs = s % 60;
    return secs ? `${Math.floor(s / 60)} min ${secs} sec` : `${Math.floor(s / 60)} min`;
  }
  if (s < 86400) {
    const mins = Math.floor((s % 3600) / 60);
    return mins ? `${Math.floor(s / 3600)} hr ${mins} min` : `${Math.floor(s / 3600)} hr`;
  }
  const days = Math.round(s / 86400);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export const dateTime = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function rupees(usd: number, rate: number | null): string | null {
  if (rate === null) return null;
  return `₹${Math.round(usd * rate).toLocaleString("en-IN")}`;
}
