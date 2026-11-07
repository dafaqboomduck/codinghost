# CodingHost

Coding practice plans written by Claude, solved in an in-browser editor with real test runs. Python runs in Pyodide; JavaScript runs in a fresh Web Worker per run. It runs as a published claude.ai artifact; there is no server.

- Spec: [spec/codinghost-spec.md](spec/codinghost-spec.md)
- App source: `src/` (`html/`, `css/`, `js/`, `py/`); `build.py` inlines it into `app/codinghost.html`, one file with capabilities `sample`, `db`, `user`

## Supported languages
The artifact currently supports creating Python and JavaScript lessons. I am curently working on adding support for more languages, including SQL and Go. If you want support added for a specific language, please open an issue and I will prioritize it.

## Setup

```sh
npm install            # playwright-core, for the e2e test only
npm run vendor         # downloads Pyodide 0.26.4 core files into app/pyodide/
```

The artifact sandbox blocks runtime fetches from CDNs, so the Pyodide files are published next to the page. Artifacts do not serve `.zip`, so the vendor script also writes `python_stdlib.zip.b64.txt`, which the page decodes at load time.

## Build

```sh
python3 build.py       # or: npm run build
```

`build.py` inlines every local stylesheet and script that `src/html/codinghost.html` references. Scripts marked `data-bundle` are joined, in page order, into one strict-mode IIFE, so a file can use what earlier files declare. `app/codinghost.html` is build output and is not committed.

## Develop

```sh
npm run serve          # http://localhost:8765/codinghost.html?dev
```

`?dev` (only outside claude.ai) swaps in a local stand-in for Claude, the database and the user. Claude's replies come from `app/dev/sample-plan.json` (or `sample-plan-js.json` for JavaScript) and data goes to `localStorage`.

`--port` can be passed to `npm run serve` to change the port. The page will reload on changes to any file in `src/`. **Example**: `npm run serve -- --port 8080`.

## Test

```sh
npm test               # Python harness (Pyodide under Node) and JavaScript harness unit tests
npm run e2e            # full browser run in dev mode; set CHROMIUM_PATH if needed
```

## Publish

Run `python3 build.py`, then publish `app/codinghost.html` as an artifact with capabilities `{sample: {}, db: {}, user: {}}`, plus these files under `pyodide/`: `pyodide.js`, `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip.b64.txt` and `pyodide-lock.json`. Do not publish `python_stdlib.zip` or `app/dev/`.
