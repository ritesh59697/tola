# Demo video

The demo video is recorded by script on the live site, against QIE Mainnet. No screen is faked.

- `record.mjs` drives the site with Playwright. The jeweller and customer wallets sign in this Node process, so the page only sees addresses and transaction hashes. It marks where each scene starts and ends.
- `edit.py` cuts out the waits between scenes, such as the jeweller's repair window, and lays the narration over each scene.
- `narration.json` is the voice-over, read by macOS `say` with the Rishi voice.

```bash
cd scripts/video && npm i playwright-core ethers dotenv
```

```bash
for k in $(python3 -c "import json;print(' '.join(json.load(open('narration.json'))))"); do say -v Rishi -r 172 -o n_$k.aiff "$(python3 -c "import json,sys;print(json.load(open('narration.json'))[sys.argv[1]])" $k)"; done
```

Then run `record.mjs` with the site URL, a fresh demo plan, a fully paid demo plan, the path to `contracts/.env` and an output folder, and `edit.py` with the take folders and the output file.
