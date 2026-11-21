// Saves the join guide's QR card as an image people can forward on WhatsApp.
// Shoot it from the live site, so the QR code holds the public link, not localhost.
// Needs playwright-core and a local Chrome.
// Usage: node join-card.mjs <siteUrl> <outFile> [scale]
import { chromium } from "playwright-core";

const [site, out, scale = "2"] = process.argv.slice(2);
if (!site || !out) throw new Error("Usage: node join-card.mjs <siteUrl> <outFile> [scale]");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: Number(scale), viewport: { width: 1200, height: 1600 } });
  await page.goto(`${site.replace(/\/?$/, "/")}#/join`, { waitUntil: "networkidle" });
  const card = page.locator(".join-card");
  await card.locator(".join-qr svg").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: out });
  console.log("saved", out);
} finally {
  await browser.close();
}
