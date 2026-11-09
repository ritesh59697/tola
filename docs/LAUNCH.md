# Going live

The contracts, site and scripts are finished and rehearsed on a local fork of QIE mainnet. These are the steps that need real money or your accounts.

## 1. Create the wallets

```bash
scripts/new-wallets.sh
```

This makes three fresh wallets, saves them to `contracts/.env` (never committed) and prints one address. **Back up that file somewhere safe, and don't share it.**

## 2. Fund it

Send **105 QIE** on QIE Mainnet (chain 1990) to the printed address. At about $0.11 per QIE, that's about $12. The script swaps most of it into QUSDC for the demo, and what's left stays in the wallets.

Don't reuse a wallet that holds your savings.

## 3. Launch

```bash
scripts/launch.sh
```

This shares out the QIE, swaps to QUSDC on QIEDEX, deploys the registry, opens a real-months plan and a demo plan, adds a customer, and makes one real failed attempt to take their money. It takes a few minutes and prints every address.

## 4. Publish the code and site

Check first that no key will be published:

```bash
git status --short | grep -E '\.env$'
```

That should print nothing. Then:

```bash
git add -A && git commit -m "Add QIE mainnet deployment"
```

```bash
gh repo create tola --public --source=. --push
```

```bash
gh api repos/{owner}/tola/pages -X POST -f build_type=workflow
```

The site appears at `https://<your-username>.github.io/tola/` once the workflow finishes.

## 5. Fill in the README

Replace these four placeholders at the top of `README.md`, then commit and push: `LIVE_APP_URL`, `VIDEO_URL`, `REGISTRY_EXPLORER_URL`, `FAILED_TX_EXPLORER_URL`. Also replace `docs/refused.jpg` with a screenshot from the live site.

## 6. Record the video

Open fresh plans just before recording, because their timers start when customers join:

```bash
scripts/new-demo-plan.sh "Meera Gold House (demo)"
```

To act as the jeweller and customer, import `JEWELLER_KEY` and `CUSTOMER_KEY` from `contracts/.env` into QIE Wallet. The script is in [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md).

## 7. Submit

Register at <https://hackathon.qie.digital/register> and submit **well before 23:59 CET on 30 November** (04:29 IST on 1 December).

| Form field | Value |
|---|---|
| Repository | Your public repo URL |
| Demo URL | The GitHub Pages URL |
| Contract | The registry address from step 3 |
| Track | Commerce & Real World |

Also needed: the demo video, documentation (the README and walkthrough) and the team presentation (the deck). Ask QIE how to enter Best Student Team, as the rules aren't published. Have proof of student status ready.

## Before judging

Read [WALKTHROUGH.md](WALKTHROUGH.md) and answer its seven questions without looking.

Demo week is 1–5 December and winners are on 10 December. Check that the site still loads on those days, and check your email for messages from QIE.
