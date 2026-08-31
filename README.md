# Exploding Button React App

A React app featuring a red button that explodes when clicked — plus a stats
API that keeps a leaderboard of who pressed it most.

## Getting Started

1. Change directory to your application home:

```bash
cd <path to repo>/simple_react_app
```

2. Install dependencies:

```bash
npm install
```

3. Start the two dev processes in separate terminals — the Vite dev server and
   the Express stats API. The dev server proxies `/api/*` to the API on port
   3001, so the Button League page needs both running:

```bash
npm run dev     # http://localhost:5173
npm run server  # http://localhost:3001
```

Without `npm run server` the app still works, but the stats page reports
"Unable to load stats" and presses aren't recorded.

4. Open your browser and navigate to the URL shown in the terminal (usually
   http://localhost:5173)

Press counts are stored in `data/stats.json`, which is gitignored and created
on first press. Delete it to reset the league, or set `ADMIN_TOKEN` (api) and
`VITE_ADMIN_TOKEN` (web, build-time) to matching values to enable the Clear
Stats button — see Configuration below.

## Accounts

Sign up from the nav to claim a name for the Button League. Presses are
attributed to whoever the session token identifies, so signed-out players score
as `Anonymous` and nobody can post a press under a name they do not hold.

The account store lives on the API, not in the browser:

- `data/users.json` holds `username -> {salt, hash, createdAt}`, written with
  the same atomic temp-file/fsync/rename path as `stats.json`, at mode `0600`.
  It is gitignored.
- Passwords are hashed with PBKDF2-HMAC-SHA512, 210,000 iterations, 16-byte
  per-account salt, using Node's built-in `crypto` -- no added dependency. The
  browser never hashes or stores a password.
- `POST /api/auth/signup` and `POST /api/auth/login` return a session token.
  The client keeps only that token, and sends it as `Authorization: Bearer`.
- `POST /api/stats/press` and `POST /api/stats/register` take the username from
  the token. Neither reads a name from the request body.

Known limits:

- **Sessions are in-memory**, so restarting the API signs everyone out.
  Accounts themselves persist; you just log in again.
- **No transport security of its own.** Tokens over plain http are sniffable;
  put it behind https for anything real.
- **No login rate limiting.** Password guessing is only slowed by the PBKDF2
  cost.
- Deleting `data/users.json` deletes every account.

## Running in containers

Two images: `web` (the `nginx:mainline` Debian image serving the built SPA and
proxying `/api/*`) and `api` (the Express stats server).

```bash
docker compose up --build
# http://localhost:8080
```

`docker compose down` stops it; `docker compose down -v` also drops the
`stats-data` volume that keeps `data/stats.json` between restarts.

### Registry credentials

`package-lock.json` resolves part of the dependency tree through the
authenticated Endor package firewall, so an in-image `npm ci` needs
credentials. Pass them as a BuildKit secret — they never land in a layer:

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -t simple-react-app-web .
docker build --secret id=npmrc,src=$HOME/.npmrc -t simple-react-app-api -f Dockerfile.api .
```

Where the registry isn't reachable from the build, both Dockerfiles can take
artifacts built on the host instead:

```bash
npm run build        # -> dist/,   used by DIST_SOURCE=prebuilt
npm run vendor:api   # -> vendor/, used by DEPS_SOURCE=prebuilt
DIST_SOURCE=prebuilt DEPS_SOURCE=prebuilt docker compose up --build
```

`vendor/node_modules` is installed on the host, so use this path only for
dependency trees without platform-specific binaries (`express` and `cors`
are pure JavaScript).

### Configuration

| Variable | Service | Default | Purpose |
| --- | --- | --- | --- |
| `API_UPSTREAM` | web | `http://api:3001` | Where nginx forwards `/api/*`; rendered into the config at container start |
| `PORT` | api | `3001` | Port the Express server listens on |
| `ADMIN_TOKEN` | api | unset | Shared secret required (as an `x-admin-token` header) to call `POST /api/stats/clear`. Unset disables the endpoint (503). |
| `VITE_ADMIN_TOKEN` | web (build-time) | unset | Baked into the SPA bundle at `npm run build` / image build time so the Clear Stats button can send `ADMIN_TOKEN` above. Must match the api service's `ADMIN_TOKEN`. Unset hides the Clear Stats button. Note: because this is a client-bundled value, it is visible to anyone who views the page source — treat it as a demo-grade shared secret, not a real credential, for any public deployment. |

nginx resolves the upstream per request, so the web container starts and serves
the SPA even when the API is down (`/api/*` returns 502 until it is back).
`GET /healthz` on the web container and the container `HEALTHCHECK`s report
readiness.

## Features

- Red button labeled "DO NOT PUSH. NEVER, EVER. OR ELSE!" that explodes on click
- Explosion animation with particles, followed by an apology prompt
- Optional name field, woven into the apology and forgiveness messages
- Live press counter in the corner of the page
- Button League stats page ranking players by press count, backed by the
  Express API and persisted to disk
- Modern, responsive design

## Todo

Various security fixes
