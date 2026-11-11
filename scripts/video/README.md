# Demo video

The demo video is recorded by script on the live site, against QIE Mainnet. No screen is faked.

- `record.mjs` drives the site with Playwright. The jeweller and customer wallets sign in this Node process, so the page only sees addresses and transaction hashes. It marks where each scene starts and ends.
- `tts.py` reads `narration.json` with a neural male voice (`en-IN-PrabhatNeural`, through `edge-tts`) and keeps each word's timing.
- `edit.py` cuts out the waits between scenes, such as the jeweller's repair window, lays the narration over each scene, and burns in captions timed to the voice's word timings.

```bash
cd scripts/video && npm i playwright-core ethers dotenv && pip3 install edge-tts pillow
```

```bash
python3 tts.py en-IN-PrabhatNeural +8%
```

Then run `record.mjs` with the site URL, a fresh demo plan, a fully paid demo plan, the path to `contracts/.env` and an output folder, and `edit.py` with the take folders and the output file.
