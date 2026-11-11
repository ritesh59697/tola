// Records Tola's demo on the live site against QIE Mainnet.
// Two project wallets sign in this Node process; the page only ever sees addresses and transaction hashes.
// Usage: node record.mjs <siteUrl> <demoScheme> <happyScheme> <envFile> <outDir>
import { chromium } from "playwright-core";
import { JsonRpcProvider, Wallet, toBeHex } from "ethers";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "dotenv";

const [site, demo, happy, envFile, outDir, from = "problem"] = process.argv.slice(2);
const env = parse(readFileSync(envFile));
const durations = JSON.parse(readFileSync(new URL("./durations.json", import.meta.url)));
const rpc = new JsonRpcProvider(env.QIE_MAINNET_RPC);
const chainId = (await rpc.getNetwork()).chainId;
const wallets = { customer: new Wallet(env.CUSTOMER_KEY, rpc), jeweller: new Wallet(env.JEWELLER_KEY, rpc) };
let who = "customer";
const sent = [];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const size = { width: 1600, height: 900 };
const context = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size } });
const page = await context.newPage();
const t0 = Date.now();
const marks = [];
const mark = (name, kind) => { marks.push({ name, kind, t: (Date.now() - t0) / 1000 }); console.log(kind, name, ((Date.now() - t0) / 1000).toFixed(1)); };

await page.exposeFunction("__tolaWallet", async (json) => {
  const { method, params = [] } = JSON.parse(json);
  const w = wallets[who];
  try {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts": return JSON.stringify({ result: [w.address] });
      case "eth_chainId": return JSON.stringify({ result: toBeHex(chainId) });
      case "net_version": return JSON.stringify({ result: chainId.toString() });
      case "wallet_switchEthereumChain": return JSON.stringify({ result: null });
      case "eth_sendTransaction": {
        const p = params[0];
        const tx = await w.sendTransaction({ to: p.to, data: p.data, value: p.value ?? 0n, ...(p.gas ? { gasLimit: BigInt(p.gas) } : {}) });
        sent.push({ who, hash: tx.hash, data: p.data?.slice(0, 10) });
        console.log("tx", who, tx.hash);
        return JSON.stringify({ result: tx.hash });
      }
      default: return JSON.stringify({ result: await rpc.send(method, params) });
    }
  } catch (e) {
    const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
    return JSON.stringify({ error: { code: e?.info?.error?.code ?? e?.code ?? -32000, message: e?.shortMessage ?? e?.message ?? "error", data } });
  }
});

await page.addInitScript(() => {
  const listeners = {};
  window.ethereum = {
    request: async (args) => {
      const r = JSON.parse(await window.__tolaWallet(JSON.stringify(args)));
      if (r.error) { const err = new Error(r.error.message); Object.assign(err, r.error); throw err; }
      return r.result;
    },
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
  };
  window.__tolaEmit = (ev, data) => (listeners[ev] || []).forEach((f) => f(data));
  // A visible cursor, since headless recordings have none.
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;z-index:99999;left:0;top:0;width:22px;height:22px;pointer-events:none;transition:transform .05s linear";
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8-6 1.6L8 18z" fill="#111" stroke="#fff" stroke-width="1.5"/></svg>';
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mouse = { x: 800, y: 450 };
async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: 25 });
  mouse = { x, y };
  await sleep(350);
}
async function click(locator) { await moveTo(locator); await locator.click(); }
async function scene(name, body) {
  mark(name, "start");
  const start = Date.now();
  await body();
  const left = durations[name] * 1000 + 700 - (Date.now() - start);
  if (left > 0) await sleep(left);
  mark(name, "end");
}
async function smoothScrollTo(y, ms = 1800) {
  await page.evaluate(async ([y, ms]) => {
    const from = scrollY, steps = Math.round(ms / 16);
    for (let i = 1; i <= steps; i++) { scrollTo(0, from + ((y - from) * (1 - Math.cos((Math.PI * i) / steps))) / 2); await new Promise((r) => setTimeout(r, 16)); }
  }, [y, ms]);
}
async function switchTo(role) {
  who = role;
  await page.evaluate((a) => window.__tolaEmit("accountsChanged", [a]), wallets[role].address);
  await sleep(1500);
}
const tab = (name) => page.getByRole("tab", { name });
const button = (name) => page.getByRole("button", { name });
async function waitIdle() { // wait until the transaction tray has no pending items
  await page.waitForFunction(() => !/Waiting for|Confirm in your wallet|Sending|Pending/i.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
}

async function connectWallet() {
  const b = button("Connect wallet").first();
  if (await b.isVisible().catch(() => false)) { await click(b); await sleep(1500); }
}
try {
 if (from === "problem") {
  await page.goto(site, { waitUntil: "networkidle" });
  await page.getByText("Live plans").first().waitFor();
  await sleep(2500);

  await scene("problem", async () => {
    await sleep(3500);
    const cases = await page.getByText("When the shop shuts").first().evaluate((el) => el.getBoundingClientRect().top + scrollY - 80);
    await smoothScrollTo(cases, 2200);
  });
  await scene("idea", async () => {
    const promises = await page.getByText("What the contract promises").first().evaluate((el) => el.getBoundingClientRect().top + scrollY - 80);
    await smoothScrollTo(promises, 2000);
    await sleep(5500);
    await smoothScrollTo(0, 1800);
  });

  await page.goto(`${site}#/scheme/${demo}`, { waitUntil: "networkidle" });
  await page.getByText("Is this plan backed?").waitFor();
  await sleep(2000);
  await scene("connect", async () => {
    await sleep(2500);
    await click(page.getByRole("banner").getByRole("button", { name: /Connect wallet/ }).or(button("Connect wallet").first()).first());
    await page.getByRole("button", { name: /Join: pay/ }).waitFor({ timeout: 30000 });
  });
  await scene("join", async () => {
    await click(button(/Join: pay/));
    await page.getByText(/Instalment 2 opens in/).waitFor({ timeout: 120000 });
    await sleep(1500);
    const record = page.getByText("The public record").first();
    await record.scrollIntoViewIfNeeded();
    await sleep(2500);
    await smoothScrollTo(0, 1200);
  });
  mark("joined", "info");

  await scene("collect", async () => {
    await switchTo("jeweller");
    await click(tab("Jeweller's counter"));
    await sleep(800);
    await click(page.getByRole("button", { name: "Collect", exact: true }).first());
  });
  await scene("refused", async () => {
    await page.getByText(/Refused/i).first().waitFor({ timeout: 120000 });
    await moveTo(page.getByText(/Refused/i).first());
    await sleep(2500);
  });
  const refusedTx = [...sent].reverse().find((s) => s.who === "jeweller");
  const planUrl = page.url();
  await page.goto(`https://mainnet.qie.digital/tx/${refusedTx.hash}`, { waitUntil: "domcontentloaded" });
  await page.getByText(/failed to call/i).first().waitFor({ timeout: 60000 }).catch(() => {});
  await sleep(1500);
  await scene("explorer", async () => {
    await moveTo(page.getByText("Failed", { exact: true }).first()).catch(() => {});
  });
  await page.goto(planUrl, { waitUntil: "networkidle" });
  await page.getByText("Is this plan backed?").waitFor();
  await sleep(2500);

  await scene("slider", async () => {
    const slider = page.locator('input[type="range"]').first();
    await moveTo(slider);
    const max = Number(await slider.getAttribute("max"));
    const target = Math.min(30, max);
    for (let v = 0; v <= target; v += 1) {
      await slider.evaluate((el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, v);
      await sleep(110);
    }
    await sleep(3000);
    await slider.evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "0");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  await connectWallet();
 } else {
  await page.goto(`${site}#/scheme/${demo}`, { waitUntil: "networkidle" });
  await page.getByText("Is this plan backed?").waitFor();
  await sleep(1500);
  await connectWallet();
 }
  // Wait off camera until instalment 2 opens.
  await switchTo("customer");
  await click(tab("My passbook"));
  if (from !== "default") await page.getByRole("button", { name: /Pay instalment 2/ }).waitFor({ timeout: 180000 });
  await sleep(1500);
  if (from !== "default") {
  await scene("pay", async () => {
    await click(button(/Pay instalment 2/));
    await page.getByText(/Bond too low/i).first().waitFor({ timeout: 120000 });
    await moveTo(page.getByText(/Bond too low/i).first());
    await sleep(1500);
  });
  await scene("flag", async () => {
    await click(tab("Keep watch"));
    await sleep(800);
    await click(button("Flag the low bond"));
    await page.getByRole("button", { name: "Flag the low bond" }).isDisabled();
    await page.waitForFunction(() => /repair|cure|flagged/i.test(document.querySelector("#tab-panel")?.innerText || ""), null, { timeout: 120000 });
    await sleep(2000);
  });

  }
  await click(tab("Keep watch"));
  // Wait off camera for the repair window to close.
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Declare default");
    return b && !b.disabled;
  }, null, { timeout: 400000, polling: 1000 });
  await sleep(1500);
  await scene("default", async () => {
    await click(button("Declare default"));
    await page.getByText(/in default/i).first().waitFor({ timeout: 120000 });
    await sleep(1000);
  });
  await scene("claim", async () => {
    await click(tab("My passbook"));
    await sleep(800);
    await click(button("Claim your money"));
    await page.waitForFunction(() => !/Claim your money/.test(document.querySelector("#tab-panel")?.innerText || ""), null, { timeout: 180000 });
    await waitIdle();
    await sleep(1500);
    await page.getByText("The public record").first().scrollIntoViewIfNeeded();
    await sleep(3000);
    await smoothScrollTo(0, 1000);
  });

  await page.goto(`${site}#/scheme/${happy}`, { waitUntil: "networkidle" });
  await page.getByText("Is this plan backed?").waitFor();
  await click(tab("My passbook")).catch(() => {});
  await page.getByRole("button", { name: "I received my jewellery" }).waitFor({ timeout: 300000 });
  await sleep(1500);
  await scene("deliver", async () => {
    await sleep(2500);
    await click(button("I received my jewellery"));
    await page.getByRole("button", { name: "I received my jewellery" }).waitFor({ state: "detached", timeout: 120000 });
    await sleep(1000);
  });
  await scene("paid", async () => {
    await switchTo("jeweller");
    await click(tab("Jeweller's counter"));
    await sleep(800);
    await click(page.getByRole("button", { name: "Collect", exact: true }).first());
    await page.waitForFunction(() => /No open plans/.test(document.querySelector("#tab-panel")?.innerText || ""), null, { timeout: 120000 });
    await sleep(1500);
  });

  await page.goto(site, { waitUntil: "networkidle" });
  await sleep(1500);
  await scene("close", async () => { await sleep(1000); });
  await sleep(1500);
} catch (e) {
  console.error("FAILED", e.message);
  await page.screenshot({ path: `${outDir}/failure.png` });
  process.exitCode = 1;
} finally {
  writeFileSync(`${outDir}/marks.json`, JSON.stringify({ marks, sent }, null, 1));
  const video = page.video();
  await context.close();
  console.log("video", await video.path());
  await browser.close();
}
