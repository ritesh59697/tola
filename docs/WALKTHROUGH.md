# Tola code walkthrough

Read this before you present. QIE requires that you understand your code and can explain the architecture to judges. If you can answer the questions at the end without looking, you're ready.

## The whole idea in plain words

A jeweller's gold plan normally works like this: you pay the shop every month, the shop spends your money, and at the end it owes you jewellery. If the shop fails, you're an unsecured creditor with no gold.

Tola changes one thing: **the money waits in a contract instead of going to the shop.** The shop gets paid when you confirm you received your jewellery.

That creates a new problem. If gold rises 20%, your locked grams are worth more than the money in the contract. Who covers the difference? The jeweller, through a **bond**, which is their own money locked alongside yours.

## The pieces

```
contracts/src/TolaRegistry.sol   Opens schemes and lists them. Holds no money.
contracts/src/TolaScheme.sol     One jeweller's plan. All the rules and all the money.
app/                             The website. Only reads the chain and sends transactions.
```

There's no backend, no database, no admin key and no upgrade path. Nobody, including us, can change a deployed scheme.

## TolaScheme.sol, section by section

### The numbers it keeps

| Variable | Meaning |
|---|---|
| `lockedPrincipal` | All customer instalments still locked |
| `totalGoldOz` | Total gold locked across all plans, in troy ounces, 18 decimals |
| `bond` | The jeweller's money, backing gains and bonus |
| `collectable` | Money customers have released, waiting for the jeweller to pull it |

**The key rule:** the contract's token balance is always at least `lockedPrincipal + bond + collectable`. The invariant test tries to break this with thousands of random action sequences.

### Paying in: `enrol` and `payInstalment`

`_takeInstalment` reads the oracle, works out `goldOz = amount * goldScale / price`, adds it to the plan and pulls the tokens.

- `goldScale` handles decimals, which it reads from the token and feed in the constructor. Nothing assumes 6 or 8.
- `_freshPrice` refuses a price that is too old, zero or negative. You can't lock gold at a bad price.
- Instalments can't be early. If they could, a customer could wait for a price dip and lock everything at once.

### The money shot: `collect`

```solidity
if (p.state != PlanState.DeliveryConfirmed) revert CustomerHasNotConfirmed(planId);
```

This is the only function that pays customer principal to the jeweller. The state only becomes `DeliveryConfirmed` through `confirmDelivery`, which only the plan's customer can call. **That's the whole promise.**

Why does the app send a real failing transaction? Normally apps check first and don't send. The app skips that check here so the refusal lands on the chain, where anyone can inspect it on the explorer.

### Leaving: `exit`

Refunds principal minus a fee. **It never reads the oracle**, so it still works if the price feed dies. The fee is zero while the scheme is flagged, so nobody is trapped.

### Not delivered: `cashOut`

After the delivery window, the customer can take the gold's value in cash. Principal comes from their locked money. Gain and bonus come from the bond. If the bond can't cover it, the call reverts and the customer should flag the scheme.

The jeweller still has the gold they would have delivered, so paying the gain doesn't simply lose them money.

### The bond: `_requiredBond`

```
required = max(flat minimum, current gold gain) + bonus owed
```

- **Flat minimum:** `bondBps` of locked principal, so there's always a buffer.
- **Gold gain:** the value of all locked gold minus principal. This is why rising gold raises the requirement.

The gain is measured across the whole scheme, which can only understate the sum of each plan's gain. If one plan is up and another down, they offset. So a flag raised on this number is never false, though it can be late. Say this if asked.

### When the bond falls short

1. `flagUnderbacked`: anyone can call it, and it reverts unless the bond really is short. New money stops and exits become free.
2. The jeweller has `cureWindow` seconds to add bond, then anyone calls `clearFlag`.
3. `declareDefault`: anyone, after the window, if it's still short. Freezes the price.
4. `tally`: adds up every plan's gain, in batches, so a huge plan count can't block it.
5. `claimInDefault`: each customer gets **all their principal** plus their gain. If the bond can't cover all gains, everyone gets the same fraction of theirs.
6. `returnResidualBond`: after every claim, any leftover bond goes back to the jeweller.

### What happens if the oracle breaks

`_readFeed` wraps the oracle call in `try/catch`, so a broken feed reads as "no usable price" instead of reverting.

| Action | With a stale or broken oracle |
|---|---|
| Pay or join | Refused. No gold locks at a bad price |
| Withdraw bond | Refused. The requirement can't be worked out |
| Exit | Works |
| Flag, default, claim | Work, using only the flat minimum and the last valid price |

## TolaRegistry.sol

Deploys schemes and enforces limits every scheme must respect: a maximum exit fee, a minimum bond and a maximum price age. Without these, a jeweller could set a 100% exit fee and hollow out the promise.

## How the price age was chosen

QIE's docs say the feed updates "every few minutes", but real gaps are much longer. `script/Deploy.s.sol` reads the feed's recent history, finds the longest gap and multiplies it by a safety factor. A fixed guess would either block customers during quiet periods or accept prices that are too old. On 2026-11-09 this measured a longest gap of about 56 hours.

## The app

| File | Job |
|---|---|
| `lib/wallet.tsx` | Finds wallets by EIP-6963 and prefers QIE Wallet (`me.qiewallet`), per QIE's guide |
| `lib/chain.ts` | Reads the chain, QIE ID names, event history and the rupee rate |
| `lib/tx.tsx` | Runs a transaction through each state and turns contract errors into plain sentences |
| `components/BackingPanel.tsx` | The meter, plus the "what if gold moves" simulation |
| `components/Passbook.tsx` | Customer side |
| `components/Counter.tsx` | Jeweller side, including the Refused card |
| `components/Watch.tsx` | Anyone's side: flag, default, tally |
| `components/GetStable.tsx` | Swaps QIE for QUSDC through QIEDEX's router |

**Which QIE products are used, honestly:** Oracle (core), QUSDC (core), QIE Wallet (connection), QIE ID (shows `.qie` names, only if they resolve back to the same address), QIEDEX (in-app swap). **Not QIE Pass:** we found no public contract to read, and we won't fake a badge.

## Known limits (say these before a judge finds them)

1. **No outside audit.** It has tests, invariants and a fork test against real contracts.
2. **Delivery is a customer's word.** The contract can't see jewellery. The customer taps confirm at the counter. A dishonest shop could take the tap and refuse to hand over the piece, so this needs a real process in-store, such as confirming as the piece is handed over.
3. **A customer's free option.** A customer can leave at a small fee if gold falls and stay if it rises. The exit fee partly prices this. A real scheme might need a higher fee or a minimum term.
4. **Stablecoin assumed to be $1.** QUSDC depegging isn't handled. Fee-on-transfer tokens aren't supported.
5. **Rupee on-ramp is missing.** Customers need QUSDC today. Real families would need UPI to stablecoin, which is the largest gap to real use.
6. **Regulation.** Indian rules on jewellers' deposit schemes would need legal review. We don't claim compliance.
7. **No real jewellers yet.** Everything on the site is a demo with small amounts.
8. **Spot price, not shop price.** The oracle gives international gold, not an Indian shop's rate with duty, GST and making charges.

## Questions judges may ask

**Why a blockchain? Why not a bank escrow account?**
Escrow needs a trusted bank and legal setup for each small jeweller, and customers can't verify it themselves. Here, anyone can check the balance and the rules, and nobody can change them.

**Why would an honest jeweller use this? They lose access to the float.**
That's the real trade-off. The pitch: the jeweller gives up the float in exchange for trust that big brands get from their name. A small-town jeweller can prove they can't run off. Whether that's worth it is the key thing to test with real jewellers.

**What stops the jeweller just not delivering?**
After the delivery window, the customer takes the gold's value in cash, from the locked money and the bond.

**What if gold doubles?**
The required bond rises. The jeweller must add more or be flagged. If they don't, customers get all principal plus a share of the bond. So principal is guaranteed, but the full gold gain only as far as the bond covers it. **Don't claim the gold gain is guaranteed.**

**What if gold falls?**
Customers can still get principal back. If they take delivery, the jeweller keeps the full payment and delivers fewer rupees' worth of gold.

**Can you, the developers, take the money?**
No. There's no admin function, no owner and no upgrade. Point to the contract on the explorer.

**How do I know a failed transaction proves anything?**
It shows the contract's check running, but the stronger evidence is the code and the invariant test: no path pays principal to the jeweller without confirmation.

**Did AI write this?**
Be honest: it was built with AI assistance, and you reviewed it and can explain it. The README says so too. QIE's FAQ encourages AI-assisted development, as long as you understand and can maintain the code.

## Check yourself

1. Which single line stops the jeweller taking the money?
2. Why doesn't `exit` read the oracle?
3. What two things decide the required bond?
4. In a default, what's guaranteed and what isn't?
5. Why can't the tally be blocked by having too many plans?
6. Why does the app send a failing transaction on purpose?
7. Which QIE products are used, and why not QIE Pass?
