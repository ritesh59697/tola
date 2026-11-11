# Submission answers

Copy these into the form at https://hackathon.qie.digital. Fields marked *after launch* are filled in once Tola is on mainnet.

| Field | Answer |
|---|---|
| Project name | Tola |
| Track | Commerce & Real World |
| Repository | https://github.com/ritesh59697/tola |
| Live demo | https://ritesh59697.github.io/tola/ |
| Contract address | *after launch*: the registry address in `contracts/deployments/1990.json` |
| Demo video | *your YouTube link* |
| Team | Ritesh (student, solo) |

## One-line description

Gold savings your jeweller can't run away with: a jeweller's monthly gold plan on QIE, where instalments stay locked until the customer confirms they received their jewellery.

## Description

Families across India save for weddings through jewellers' monthly gold plans. The money goes straight to the shop, and when a shop fails, customers are left with nothing. In 2019, the owners of Goodwin Jewellers reportedly vanished owing about 700 people Rs 21 crore.

Tola keeps the plan customers already know, with one change: the money waits in a contract.

- Each instalment locks a weight of gold at QIE Oracle's live gold price.
- The jeweller is paid only after the customer confirms delivery. Any attempt before that fails on-chain.
- A jeweller's bond covers customers' gold gains and bonus, and the required bond rises with gold.
- Anyone can flag a short bond. If it isn't repaired in time, every customer takes back all they paid, plus a share of the bond for gold gains.
- If the jeweller doesn't deliver, the customer can take the gold's value in cash.

QIE products used: QIE Oracle (gold price, central to the contract), QUSDC (holds instalments and bonds), QIE Wallet (preferred through EIP-6963), QIE ID (shows a jeweller's .qie name, only if it resolves back to their address), and QIEDEX (in-app swap from QIE to QUSDC).

Engineering: 60 tests, including invariants and a fork test against the real gold feed and QUSDC. There's no owner, admin key or upgrade path. A dead oracle can't trap customers, and the contract's price-age limit was measured from the feed's real history.

Honest limits: no outside audit and no real jewellers yet. Demo plans use 5-cent instalments with short timers. Built with AI assistance; Ritesh reviewed the code and can explain it.

## Message to QIE before you go offline

Send this through their Telegram or to info@qie.digital, edited as you like:

> Hi, I'm Ritesh, and I've submitted Tola to Hackathon 3.0 (Commerce & Real World). I'm a student. Two questions: how do I enter the Best Student Team award, and can the team presentation for demo week be pre-recorded? I'll have very limited internet from 12 November, so a recorded presentation would help. My demo video and README are in the submission. Thank you!
