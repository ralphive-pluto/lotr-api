# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is a monorepo for "The One API" (Lord of the Rings API). Four top-level workspaces:

- `backend/` — Express + Mongoose API (TypeScript, Node 22.x). Serves the API at `/v2/*` and `/auth/*`, and serves the built React app for everything else.
- `frontend/` — Create React App + react-router v5 (TypeScript). Pages for docs, signup/login, account.
- `sample-app/` — Separate React 17 demo app, deployed to GitHub Pages. Not part of the main runtime; CI only verifies it builds.
- `db/` — MongoDB seed data (BSON dumps in `db/bson/`, source CSVs in `db/csv/`) plus the mongo Dockerfile. `mongorestore` runs on container init to load the `lotr` database. To reset to seed data, stop containers and delete `db/db/` (the runtime data dir), then `make up`.

## Development workflow (Docker-based)

All dev work runs through Docker. Don't `npm install` on the host; use the CLI container so versions match CI.

```
make build      # build the CLI image and install backend + frontend node_modules
make up         # docker compose up (mongo on :27017, backend on :3001, frontend on :3000)
make down       # stop everything
make cli        # interactive bash in the CLI container, with backend/ and frontend/ mounted
```

Inside `make cli` you typically `cd backend` or `cd frontend` and run `npm` commands (test, install, outdated, etc.). Backend uses nodemon — `docker container logs -f lotr-backend-1` to tail.

## Tests

Backend (`backend/`):

- `npm test` — Jest via `ts-jest`, `testEnvironment: node`. Uses `mockingoose` to stub Mongoose models and `supertest` for HTTP-level tests. Co-located `*.test.ts` next to source.

Frontend (`frontend/`):

- `npm test` — Jest with `babel-jest` + `jest-environment-jsdom` + `@testing-library/react`. Note: this is **not** `react-scripts test` — it's a standalone Jest config, so `--watch` etc. behave like vanilla Jest.

Single test: `npm test -- path/to/file.test.ts` or `npm test -- -t "test name pattern"`.

## Backend architecture

Entry: `backend/server.ts`. Wiring order matters:

1. `helmet`, `express.json`, `cors`, and a static handler for `__BUILD/` (the compiled React app) come first.
2. Passport strategies registered at startup:
   - `BearerStrategy` — looks up `UserModel` by `access_token`. A special `DPWC_TOKEN` env var bypasses the DB lookup entirely (used for demos/hackathons). When debugging auth, check whether the caller is using this token before assuming a user record exists.
   - `LocalStrategy` (named `'login'`) — email/password against `UserModel`, bcrypt-compared.
3. A middleware gate before `/v2` and `/auth` requires `mongoose.connection.readyState === 1` and returns 500 with `"Service currently not available."` otherwise. Public routes (the React app) bypass this.
4. `/v2/` is rate-limited globally (`apiLimiter`: 100 req / 10 min). `/auth/register` has a stricter per-route limit (5 / hour). `/auth/login` has none.
5. SPA fallback `app.get('*')` serves `__BUILD/index.html` — the React build directory is one level up from `server.ts` at runtime.

### Routes (`routes/api.ts`)

Public: `/v2/book`, `/v2/book/:id`, `/v2/book/:id/chapter`.

Bearer-auth required: chapter, movie, character, quote endpoints. The auth middleware is applied per-route (`passportHelpers.authenticate`) rather than as a router-level `use`, so any new route must explicitly include it.

`router.route('*').get(pluralEndpointHandler)` is a catch-all that detects requests for the plural form of an endpoint (e.g. `/v2/books`) and returns a 404 suggesting the singular. Keep this last among the routes, before `errorHandler`.

### Query parsing (`helpers/config.ts`)

`getOptions(req)` is called by every list/detail controller. It:

- Parses the raw query string with `mongoose-query-parser` (blacklisting `offset`, `page`, `limit`, `sort`) to produce a Mongo `filter`.
- Builds a `sort` object from `?sort=field:asc|desc`.
- Reads `limit` (default and max `1000`), `page`, `offset`.

Controllers pass the result to `Model.paginate(filter, options)` from `mongoose-paginate`. Adding a new list endpoint means following this same pattern — don't bypass `getOptions` or pagination clients will break.

### Adding a resource

1. `models/<name>.model.ts` — Mongoose schema, `.plugin(mongoosePaginate)`, exported as `<Name>Model`.
2. `controllers/<name>.api.ts` — controller object with handlers that call `getOptions(req)` and `Model.paginate(...)`.
3. `routes/api.ts` — register routes; gate with `passportHelpers.authenticate` unless intentionally public.
4. Tests next to the controller; use `mockingoose` to stub Mongoose calls.

## Frontend architecture

`src/App.tsx` declares routes as a `Routes` array consumed by a `<Switch>`. The default `path: ''` route maps to `NotFoundPage` and acts as the catch-all — keep it last.

`src/helpers/api.ts` is the single API client. `src/pages/index.ts` re-exports pages under a `Pages` namespace so `App.tsx` can reference `Pages.Home` etc.

The frontend is served two ways:

- Dev: `react-scripts start` on `:3000` (via `make up`).
- Prod: built into `backend/__BUILD/` and served statically by Express. The backend's SPA fallback means deep links hit Express first, then load the React app.

## CI

`.github/workflows/build.yml` runs on push/PR (ignoring `db/**`): backend `npm ci && npm test`, frontend `npm ci || (npm install --package-lock-only && npm ci) && npm test`, then sample-app `npm ci && npm run build`. Node 22.x matrix. Keep `package-lock.json` in sync — the frontend step has a fallback but it's there because lockfile drift has bitten this repo before.

## PR Review Style

Whenever a new pull request is opened in this repository, Claude must automatically deliver a detailed review. The review must:

- Be written entirely in the voice of an Uruk-Hai warrior from Lord of the Rings (aggressive, blunt, guttural, battle-hardened)
- Include ASCII art visuals relevant to the PR content
- Cover: what the PR does, what's good, what's missing or risky, and a final verdict
