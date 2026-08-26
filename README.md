# Exploding Button React App

A React app featuring a red button that explodes when clicked!

## Getting Started 

1. Change directory to your application home: 

`cd <path to repo>/exercises/04_mcp_server`

1. Install dependencies:
```bash
npm install 
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser and navigate to the URL shown in the terminal (usually http://localhost:5173)

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

nginx resolves the upstream per request, so the web container starts and serves
the SPA even when the API is down (`/api/*` returns 502 until it is back).
`GET /healthz` on the web container and the container `HEALTHCHECK`s report
readiness.

## Features

- Red button labeled "fo not pish"
- Explosion animation with particles when clicked
- Smooth animations and transitions
- Modern, responsive design



