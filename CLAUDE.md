# Samba AD Manager — CLAUDE.md

## Project Overview

A monorepo for the overview, health and management of an Active Directory run by Samba AD
domain controllers. Abbreviated **sadm**. Consists of:
- **server/backend** — Fastify API server: measures the domain controllers, reads and changes
  the directory
- **server/frontend** — React SPA
- **client** — The agent: an optional Node.js daemon in a domain controller's container,
  which reports what cannot be read over the network
- **shared** — Common TypeScript types, Zod schemas, constants

Built from keepalived-status-monitor (kasm), whose stack and conventions it keeps. The
server talks to every domain controller over the network, and that is the whole of what a
domain controller needs: **the agent is optional, per domain controller**, and one without
it is measured like any other. **Data is read from structured sources only, never parsed
out of text**: LDAPS for directory objects, rootDSE, FSMO roles, topology, replication
(`repsFrom` / `repsTo`, decoded here) and the DNS zones (`dnsRecord`, decoded here); DNS and
Kerberos asked in their own protocol for whether they answer.

The agent is built like kasm's client -- a persistent WebSocket to the server, registration
by token or by setup PIN, both connection modes -- and does less: it **reads** what only the
domain controller itself can say (Samba's services over its internal messaging, supervisord's
programs over XML-RPC, storage, the sysvol) and runs Samba's database check. **It never
reads or changes the directory's objects**; that stays with the server. The one thing it
writes is Samba's own fix of what the database check finds, when asked and only where its
operator allowed it (`report.dbcheckAllowFix`). It gets into a domain
controller's image by being copied out of an image that carries it (`docker/Dockerfile.client`,
`docs/agent.md`); the image of a real domain controller is
[stefgo/samba-ad](https://github.com/stefgo/samba-ad), which is not part of this repository.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22+, Fastify 5, SQLite (better-sqlite3), Pino, ldapts |
| Frontend | React 19, Vite 7, TanStack Query 5, Zustand, Tailwind CSS 3, React Router 7 |
| Client | Node.js 22, Fastify 5, ws, Pino — and Samba's own Python modules, through a helper script it runs |
| Shared | TypeScript, Zod 4 |
| Auth | JWT + optional OIDC |
| DB Migrations | Umzug |
| UI Components | @stefgo/react-ui-components |
| Icons | lucide-react |

## Monorepo Structure

```
samba-ad-manager/
├── shared/              # Types, Zod schemas, constants
├── client/              # The agent
├── server/
│   ├── backend/         # Fastify REST + WebSocket API
│   └── frontend/        # React SPA (Vite)
├── docs/                # Documentation, published to GitHub Pages (mkdocs.yml)
├── docker/              # Dockerfiles; docker/dev/ holds the dev domain's entrypoint, docker/client/ what the agent's image adds
├── compose.yaml         # Production Docker Compose
├── compose.dev.yaml     # Dev stack: server and the domain SADM.TEST (dc1, dc2), each DC with the agent
└── compose.dev.bind.yaml  # Laid over it: the domain on BIND9_DLZ, and a secondary name server (ns2)
```

## Development Commands

```bash
# Root-level
npm run dev:server       # Backend in watch mode
npm run dev:frontend     # Frontend dev server (Vite)
npm run dev:client       # Agent in watch mode
npm run build            # Build all workspaces
npm run clean            # Clean build artifacts
npm run lint             # ESLint over shared, client and server/backend
npm run lint:frontend    # ESLint over server/frontend (its own config)
npm test                 # Vitest over shared, the frontend, client and the backend, once
npm run test:watch       # Vitest, re-running what a change touches

# Frontend only (server/frontend)
npm run lint                 # ESLint
npm run typecheck            # tsc against the installed UI library, then over vite.config.ts
npm run typecheck:local-ui   # tsc against a sibling checkout of the UI library
```

The Vite build does not type-check, so `typecheck` is the frontend's only type gate. Its
second run covers `vite.config.ts` through `tsconfig.node.json`, the files Node runs rather
than the browser.

`build` names its workspaces one by one instead of using `--workspaces`, because
`shared` has to be built first and the others need its output. `--workspaces` would
build `shared` a second time, and its ordering would rest only on the position of
`shared` in the `workspaces` array. **A new workspace has to be added to that list by hand.**

There is no `start:frontend`: the frontend is a Vite SPA that builds into
`server/dist/public`, which the backend serves itself (see `server/backend/src/index.ts`).
`npm run start:server` therefore serves the frontend too. To look at a production
bundle without the backend, use `npm run preview -w server/frontend`.

## Architecture Patterns

### Backend (server/backend)
- **Controller** → handles HTTP/WS routes
- **Service** → business logic (AuthService, ActivityService, HealthScheduler, DcHealthService,
  DomainControllerService, DirectoryService)
- **Repository** → data access (UserRepository, DomainControllerRepository, etc.)
- SQLite with WAL mode; schema managed via Umzug migrations in `core/migrations/`
- **Which domain controllers there are is the directory's to say.** `HealthScheduler`
  measures every one on a timer (`health_interval_seconds`, a setting read every round) and
  hands what they list to `DomainControllerService.sync`, which brings the
  `domain_controllers` table in line. Nothing adds or removes one by hand;
  `directory.urls` only says where to ask first. A domain controller is identified by the
  **GUID of its NTDS settings** — what `repsFrom` names a partner by and what the dbcheck
  script reports itself as.
- `dc/` is everything that talks to a domain controller. `DcLdap` is one LDAPS connection
  as an **instance** — there is one per domain controller (`DcConnections`), never a
  singleton. `measure.ts` takes one measurement; `probes/` asks a service in its own
  protocol (`kerberos.ts` writes its AS-REQ by hand, `dns.ts` uses `node:dns`); `repsBlob.ts`
  decodes a replication link. **A new measurement is a field of `DcMeasurementSchema` in
  `shared` and a part of `measureDc`**; a part that cannot be read is left out and named in
  `errors`.
- A service that speaks a protocol the server knows is asked in it (`check: "protocol"` in
  `DC_SERVICES`), because **a process that hangs keeps its port open**. A TCP connect is the
  fallback, not the default.
- DNS is asked with a query of this server's own (`probes/dnsMessage.ts`, pure, and
  `probes/dns.ts`): it has to go out without recursion and the answer's authority bit has
  to be read, neither of which `node:dns` offers. A domain controller's measurement asks
  its DNS server for every zone its directory holds (`dns` in `DcMeasurementSchema`)
- Which DNS records a domain controller registers for itself is `expectedDcRecords` in
  `shared` -- Samba's `dns_update_list`, line by line, with a test that holds it against
  what `samba_dnsupdate` registered in the development domain. A measurement looks them up
  in the directory (`dcRecords`); `buildDomainHealth` lays the domain controllers' views
  together into `ControllerHealth.dnsRecords` and one finding per domain controller
- The name servers that are no domain controllers -- secondaries -- are not configured:
  `HealthScheduler` reads them off the zones' NS records after each slow round and has
  `DnsServerHealthService` ask them. Since when one has been out of step is state
  (`trackOutOfSync`, pure, kept in `dns_server_health`); whether that is too long is
  `buildDomainHealth`'s to say, which takes the name servers as its fourth argument
- The names applications reach the directory under -- a virtual address, in any domain --
  are `directory.serviceUrls`. `ServiceUrlHealthService` asks them after each slow round
  (rootDSE without a bind, and a TLS handshake, after StartTLS for `ldap://`;
  `probes/tls.ts`, with `probes/startTlsMessage.ts` written by hand and pure) and keeps the
  answers in memory; `buildDomainHealth` takes them as its fifth argument. Their host names
  also count in a domain controller's certificate (`serverIdentityCheck`): Samba presents
  one certificate under every name. A domain controller's own certificate is a slow part of
  its measurement (`certificate`)
- `DcHealthService` keeps three things per domain controller: the last measurement, and
  what its agent last reported -- what it reads locally (`local`) and the database check.
  The three arrive independently, which is why they are three tables.
- **An agent belongs to exactly one domain controller** and is identified by it: there is
  no list of agents apart from the list of domain controllers (`DomainController.agent`).
  `DcAgentService` is the whole of it on the server -- who may register, who is connected,
  what is asked. `agent/` holds the transport: `AgentHub` (the one way anything is sent to
  an agent), `AgentSession` (the `AUTH` handshake, the same for both directions),
  `agentDial.ts` (dialling an agent's own port), `agentToken.ts` (pure, tested).
- **What an agent may be asked is four things, with no parameter a login could choose
  freely**: to report now, to run the database check now, to fix what the check finds, and
  to replicate now from every inbound partner (over DRSUAPI, as the domain controller's own
  account; not held back by `readOnly`, since it pulls only what the partners hold). The fix
  and the replication carry a correlation id the server made and how often and how far apart
  to try again -- numbers within fixed bounds the agent checks (`AgentSeriesRequestSchema`).
  It runs as root next to the directory's database, so nothing a login of this application
  could turn into a command is sent to it. A new request needs the same property.
- **The agent tries a fix and a replication again itself** while they do not succeed, and
  keeps where the operation stands in its data directory; every report carries it
  (`series`). The server records each attempt that is tried again as a trace step and the
  last as the outcome, all under the request's correlation id (`agent/agentSeries.ts`, pure).
  What the server keeps of an operation is only whether its outcome is late (`pending` in
  `DcAgentService`, in memory), and it reuses the id of one under way for a second request. The fix is the one that writes, and
  is held back twice: the agent names the capability `dbcheck-fix` only where its operator
  allowed it and drops the request otherwise, and `DcAgentService.requestDbcheckFix`
  refuses it while `directory.readOnly` is set. Who asked and how it went are both in the
  activity
- An agent says which domain controller it runs on (`dcId`, the GUID of its NTDS settings,
  read from the local database) at registration and on every connection; one that names
  another than its identity is refused. Every token is kept as its hash. The token of an
  agent the server dials is derived from a nonce and `jwtSecret` rather than stored.
- What the agent reads is judged like everything else, in `buildDomainHealth`, and **only
  while the agent is connected**: a report it left behind describes the moment it left.
- `DomainEventService` turns the findings of `buildDomainHealth` into events by **incident**:
  one per domain controller, one for the findings about no domain controller. An incident is
  opened when its first finding has lasted its report wait, extended by each finding after
  that, escalated when a reported warning has lasted as an error, resolved when every finding
  has been gone for the resolve wait -- or discarded, off by default
  (`ACTIVITY_KINDS_OFF_BY_DEFAULT`), when that happens before anything was reported. Every
  event carries all findings of its incident with what each went through
  (`services/issueHistory.ts`, repeats folded with a count). The waits are settings
  (`issueTimingFromSettings` in `shared`), per kind of finding; a gap shorter than the resolve
  wait is no gap. The tracking is a pure function, `trackIncidents`
  (`services/domainIncidentTracker.ts`), and lives in memory; only what a restart must not
  forget -- the reported incidents and their reported findings -- is kept in
  `domain_incidents` and `domain_incident_findings`, so a restart neither repeats nor forgets
  an alert, and a waiting finding starts its wait again. Where each finding stands is pushed
  to the dashboards (`DOMAIN_ISSUES_UPDATE`). A finding is told apart by `DomainIssue.id`,
  never by its text
- `DirectoryService.change` is the one way a change to the directory is made: it picks the
  domain controller (the PDC emulator first), runs the change, and records who did what to
  which object in the activity. A new kind of change needs its `directory.*` activity kind.
  The operations themselves are `directory/DirectoryOperations.ts`: every change reads the
  object first and refuses what is protected (`isCriticalSystemObject`, a domain
  controller's account, the account the server binds as), and checks `readOnly` itself —
  it is the last code before the directory and does not rely on its caller
- The DNS zones are objects of the directory: read through `DirectoryService.readDns` and
  changed through `DirectoryService.changeDns`, on the same domain controller as everything
  else and with the same record of who did what. `dns/DnsOperations.ts` holds the
  operations; `dns/dnsRecord.ts` decodes and encodes one value of `dnsRecord` (pure, like
  `repsBlob.ts`, and tested to write back what it read byte for byte), and
  `dns/dnsProtection.ts` says which names and records are a domain controller's own. A zone
  and a name are addressed by GUID; a record has no id and is told apart by its type and
  data (`sameDnsRecord`)
- **Every change to a zone raises its serial number first** (`raiseSerial`), or no secondary
  name server ever transfers it. Neither the SOA record nor a changed record is written
  over: the value that was read is deleted and the new one added in one modify, which the
  directory refuses when somebody else -- BIND, for a dynamic update -- changed it in
  between. That refusal is LDAP result 16
- `directory.enabled` and `directory.readOnly` are read from config.yaml and **nothing in
  the API sets them**; that is what keeps a stolen login from switching writing back on
- `POST /api/v1/register` is the one route without a session: an agent registers with a
  token issued on its domain controller's page (`DcAgentService.registerInbound`), good
  once, for an hour and for that domain controller only
- `DashboardHub` is the one way anything is pushed to a dashboard

### Frontend (server/frontend/src)
- Feature-based structure under `features/` (dashboard, domain, domaincontrollers, directory, dns, activity, accounts, auth, webhooks, settings, app)
- What the server holds lives in one TanStack Query cache (`lib/queryClient.ts`), read through
  the modules in `queries/` and addressed by `lib/queryKeys.ts`. Zustand holds only
  `useUIStore`, what this browser alone knows.
- Every request goes through `lib/api.ts`, which parses the answer against a schema from
  `shared/src/responses.ts` and throws the server's reason on a refusal. `apiFetch` stays
  below it; no component calls `fetch`.
- A dashboard message changes a cache entry through a pure function in `lib/cacheUpdates.ts`.
  The messages are one union in `shared/src/dashboardMessages.ts`; the backend sends through
  it, and the socket handler's `switch` ends in `assertNever`.
- Where each finding stands with the activity -- pending or reported -- is a cache entry of
  its own (`queryKeys.dcHealth.issues`), pushed whole on connect and when it changed; the
  finding list (`IssueList`) says under each when it is or was reported.
- The name servers that are no domain controllers are a cache entry of their own
  (`queryKeys.dcHealth.nameServers`), pushed whole on connect and after every round;
  `useDomainHealth` hands them to `buildDomainHealth`. So are the central URLs
  (`queryKeys.dcHealth.serviceUrls`); `ServiceUrlsCard` lists them off the same findings. How a server stands with one zone is
  derived in `features/dns/lib/zoneServers.ts`, off the same findings the dashboard shows.
- A lost socket is said: `isLost` in `WebSocketContext` turns true `LOST_AFTER_MS` (5 s) after
  the socket is gone and drives the library's `ConnectionBanner` and `StatusDotProvider`.
  After a reconnect everything the server does not push on connect (`isPushedOnConnect` in
  `lib/queryKeys.ts`) is invalidated. A new cache area the server pushes on connect has to
  be added there.
- Every path lives once in `lib/paths.ts` (`ROUTES`, `paths`). No path literal
  anywhere else. The route tree in `features/app/routes.tsx` is the one description of what
  lives where: the sidebar (`handle.nav`), the document title (`lib/pageTitle.ts`), "back"
  (`useBackPath`, the route above -- never `location.state`) and the `errorElement` are all
  read off it. A new page is a route there, with its lazy import in `lazyPages.ts`.
  The breadcrumb in a page's header (`HeaderBreadcrumb`, `lib/breadcrumb.ts`) is read off
  the same handles as the title; a page below a list uses it as its heading.
- A route whose subject is gone for good throws `NotFoundError` (`lib/notFound.ts`).
- An editor keeps its draft in `useEntityForm`, checked against the request schema from
  `shared`; its rules are pure and live in the feature's `lib/<name>Form.ts`, with a test.
  Leaving a page with unsaved changes is asked about in one place, `useUnsavedChangesGuard`
  (the router's blocker); an editor navigates away with its `close` or `leave`, never with
  `navigate` of its own.
- The domain's health is derived, never stored: `buildDomainHealth` in `shared` lays every
  domain controller's last measurement next to the others and names what is wrong
  (`DomainIssue`). The dashboard calls it through `useDomainHealth`; no view judges a
  measurement by itself. The list of domain controllers is read off the same result, so the
  list and the dashboard cannot disagree.
- The directory is not pushed: `queries/directory.ts` reads it on request, it goes stale after
  30 s, and `useDirectoryChange` invalidates all of it after a change made here. Every page
  of it stands behind `DirectoryGate`, which says whether the directory is configured, a
  domain controller answers, and changes are possible. The DNS zones (`queries/dns.ts`,
  `features/dns`) are part of it: their keys live under `directory`, their pages stand
  behind the same gate, and a change to a record goes through `useDirectoryChange`. An object is addressed by its
  **GUID**, never its DN.
- A list describes its columns once, as `DataColumnDef[]` (`columns`), with `actionsColumn`
  and `listGroups` from the library; its `emptyMessage` is an `EmptyState`, a search without
  a hit a `noResultsMessage`. The search goes to the view as `searchFilter`, never applied
  to `data` beforehand, or the view cannot tell the two apart.
- Dates follow the browser's locale (`formatDate`, `formatTime` in `utils.ts`; no locale
  literal). "How long ago" is `<RelativeTime>` on `useNow`, the date in its tooltip.
- Two words that must not be mixed up. "User" in the code is a sadm login; the UI calls them
  "Accounts" (`features/accounts`, `/accounts`), because "Users" in the UI are the
  directory's. A domain controller is a domain controller everywhere — code, UI and API.
- A link into the published documentation comes from `lib/docs.ts` (`DOCS`), nowhere else.
- React Contexts: WebSocketContext, AuthContext. The theme is the library's `ThemeProvider`,
  mounted with `STORAGE_KEYS.theme`
- Every key in the browser's storage lives once in `lib/storageKeys.ts` (`STORAGE_KEYS`,
  written `sadm.<area>.<what>`). No key literal anywhere else; renaming one forgets the
  stored value and needs no migration.
- Vite proxies `/api` and `/ws` to backend in dev

### Client (client)
- `core/` is kasm's client core: `Config` (what the operator wrote, frozen), `Identity`
  (what the server issued, in the data directory), `RegistrationState`, `Connection` (both
  directions, one message table), `SetupPin`, the local web server in `web/`. Its two pages
  are **off by default**: the container shares its host's network.
- `index.ts` answers `--version` and imports nothing else before that; the agent itself is
  `agent.ts`. It first reads which domain controller it runs on and waits for that.
- `services/` is what it reads. `SambaHelper` runs `sambaHelperScript.ts` -- Python on
  Samba's own modules, one JSON line as the answer, checked with Zod -- for what Samba has
  no other structured source for. `xmlRpc.ts` (pure) and `supervisor.ts` ask supervisord;
  `gptIni.ts` (pure) reads a policy's version; `LocalService` puts a report together and
  sends it when it changed; `DbcheckService` runs the check on its schedule and when asked,
  and a fix; `ReplicationSyncService` replicates when asked. Both try a fix or a replication
  again as the request says, with `series.ts` (pure) deciding where the operation stands.
- A part that cannot be read is left out and named in `errors`, as in a measurement.
- Agent and server are updated separately -- the image of a domain controller is rebuilt on
  its own schedule. Both drop a message they do not know, a new field is optional, and
  **the schemas in `shared/src/agent.ts` are loose** for that reason.
- Registration has one implementation (`core/Registration.ts`) behind both ways in: the
  register page and the environment (`SADM_SERVER_URL`, `SADM_REGISTRATION_TOKEN`).

### Shared (shared)
- Single source of truth for types and validation across all workspaces
- Always build shared first when making type changes: `npm run build -w shared`
- One entry point, `@sadm/shared`, imported by the frontend as well as the backend: nothing
  in it may need Node, or it lands in the browser bundle. What only the server needs — the
  logger — lives in `server/backend`.
- The schemas of a measurement are strict (`z.object`, not `looseObject`): what writes one
  and what reads one are the same build. Those of the agent (`agent.ts`) are loose, for the
  opposite reason.
- Which of Samba's services are judged, and under which name each registers, is
  `sambaServices.ts`, with a test that holds it against what the development domain showed.

## Configuration

- Server config: `server/config.yaml` (from `config.example.yaml`). Its `directory` block
  says where the domain is and as whom to ask; the password comes from `SADM_LDAP_PASSWORD`
  or `SADM_LDAP_PASSWORD_FILE` only. `SADM_LDAP_URLS`, `SADM_LDAP_BIND_DN`,
  `SADM_LDAP_CA_FILE` and `SADM_LDAP_ALLOW_SELF_SIGNED` lay over the block
  (`directoryConfig` in `AppConfig.ts`) and are never written back to the file.
- `VITE_USE_LOCAL_UI` / `VITE_UI_COMPONENTS_PATH` (shell environment of the frontend
  build, not read from `.env`): set `VITE_USE_LOCAL_UI=true` to build against a sibling
  checkout of `@stefgo/react-ui-components` instead of the installed package
  (default path `../react-ui-components`). **Off by default**, so a build never depends
  on a checkout that CI and containers do not have. Vite, Tailwind and
  `tsconfig.local-ui.json` (`npm run typecheck:local-ui`) all switch on it; use them
  together, or the compiler and the bundler see two versions of the same module.
  Tailwind swaps the **preset** as well as its content glob: the preset carries the theme,
  so a local build on the installed preset would run new components on the old theme.

## Code Style

- **Indentation**: 4 spaces in all workspaces and config files, no tabs. No formatter is
  configured — match the surrounding file.
- **Linting**: two configs, one per kind of code, because a file must not be matched by
  both. `eslint.config.mjs` at the root covers `shared` and `server/backend`
  (js, mjs, ts; Node globals; typescript-eslint recommended, no type information) and
  ignores `server/frontend`; `server/frontend/eslint.config.js` covers the frontend's
  `src/**/*.{ts,tsx}` and adds react-hooks and react-refresh. A new Node workspace is
  covered by the root config without another file. Errors fail the run; no rule is
  downgraded to a warning. `prefer-const` runs with `ignoreReadBeforeAssign`, for the
  `let` a closure reads before anything assigns it.
  A context is split into a JSX-free `XContext.ts` (context object and hook) and an
  `XProvider.tsx`, so `react-refresh/only-export-components` stays an error.
  `react-hooks/set-state-in-effect` is an error too: a loader lives inside its effect and
  sets state only after an `await` (a reload bumps a counter the effect depends on), and
  state derived from props is reseeded while rendering, not in an effect.
- **Quotes**: double quotes for string literals in every workspace, double quotes for JSX
  attributes. Template literals where they earn it. There is no formatter, so this is a rule
  rather than a setting: what matters is that a file does not mix the two.
- **Language**: TypeScript throughout

## Commits

- **Conventional Commits**, checked locally by `.githooks/commit-msg` against
  `commitlint.config.mjs`. The root `prepare` script sets `core.hooksPath` on every
  `npm install`. `ci.yml` lints commits only on pull requests, and this repository is
  maintained without them, so the hook is the check that actually runs.
- **With `bump: auto` the commit type is the only input the version number comes from**: `feat` raises the
  minor, `fix`, `perf` and `revert` the patch, every other type releases nothing.
- **Commit messages are written in English** — subject and body. The existing history is
  German and stays as it is; the rule applies going forward.
- **No `!` in the header** (`feat!: …` is rejected by the `no-breaking-bang` rule): the
  Angular preset semantic-release reads commits with does not know it, so such a commit
  would release nothing. A breaking change is declared with a `BREAKING CHANGE:` footer,
  which raises the **minor** position, not the major one.
- **A body line that starts with one word and a colon** (`happened: …`) is parsed as the
  start of the footer. Rephrase it.
- `subject-case` is off, so an English subject in sentence case is fine
  (`fix: Validate the settings before saving them`).
- Release commits (`chore(release): x.y.z`) are exempt from commitlint; their body is the
  generated release notes.
- `.githooks/pre-push` allows pushing `main` and `dev` only; topic branches stay local.

## Versioning and Releases

`semantic-release` owns the version. It runs from `.github/workflows/release.yml`, which is
**`workflow_dispatch` only and releases from `main` (a release) or `dev` (a beta,
`x.y.z-beta.n`)**: a release is an action, not a side effect of pushing. **Never bump a
version or create a `v*` tag by hand.**

The workflow calls [stefgo/release-workflows](https://github.com/stefgo/release-workflows),
which carries semantic-release and its configuration for every stefgo project. There is no
`release` entry in `package.json` and no semantic-release package installed here.

- Inputs: `dry_run` (default on) shows the next version and the complete notes and changes
  nothing; `bump` (`auto` | `patch` | `minor` | `major`) takes the step from the commit types
  or is the step itself, whatever the commits say. `major` is the only way a major version is
  created. A run that was asked for and produces no release fails.
- **Every release needs hand-written notes in `.release/next.md`** — what is new, what an
  upgrade needs. They go above the generated list of commits; without them the workflow
  refuses. A beta keeps the text, the release from `main` empties the file. Write it as part
  of the change that deserves a sentence, not at release time.
- **`dev` is merged into `main` with its history — never squashed or rebased** — and `main`
  back into `dev` before the next beta. The workflow checks both and refuses otherwise.
- The root `package.json` is the single source of truth for the version. It starts at
  `0.0.0`; without a release tag semantic-release makes the first release `1.0.0`. The
  workspace manifests keep `1.0.0` and nothing reads them.
- semantic-release pushes the tag over `GITHUB_TOKEN`, which starts no workflow, so
  `release.yml` dispatches `build.yml` on the tag ref itself and waits for it. That build is
  what moves `latest`.
- A push to `main` or `dev` publishes the rolling `:main` / `:dev` image plus `sha-<short>`
  — no tag, no version, no changelog entry.
- The version string the UI shows is derived in one order: build argument, then the root
  `package.json` (with `+<hash>` when the commit carries no release tag), then git. The
  order lives in `server/frontend/vite.config.ts`.

### The release notes are part of the commit

Before every commit, read `.release/next.md` and bring it up to date with what the commit
changes — in the same commit, not at release time.

- A commit that changes what a user sees or has to do — a feature, a fix, a changed
  default, a renamed setting, anything an upgrade needs — is reflected in the text. A
  `feat`, `fix` or `perf` commit that leaves the file untouched needs a reason.
- A commit that changes nothing for a user (`ci`, `test`, `refactor`, `docs`, `chore`,
  most of `build`) leaves the file alone. No line is added for the sake of it.
- Revise the text as a whole instead of appending a line per commit: it describes the
  release, not its history. Merge what belongs together, and remove a sentence a later
  commit made untrue — a feature taken back before the release is not in its notes.
- Write for someone who uses the project, in their terms: what is new, why it matters,
  what an upgrade needs. No file names and no internals; the list of commits below the
  text already names every change.
- The text goes below the HTML comment at the top of the file, with `###` headings. If
  the file holds only the comment, the text starts with this commit.

## Testing

Vitest, configured in `vitest.config.mts` at the root with one project per workspace:
`shared`, `frontend`, `client` and `backend`. All run in plain Node, so what is tested is
logic — nothing renders a component or starts the backend.

- A test lives next to its module (`activityText.ts`, `activityText.test.ts`).
- Every project but `shared` sets the `development` condition, so its tests read
  `shared/src` and need no build first.
- `shared`, `client` and `server/backend` build with `tsconfig.build.json`, which keeps the
  tests out of `dist`; `npm run typecheck -w <workspace>` is what type-checks them.
- Logic inside a class with side effects is moved into a pure module first and tested there.
- A backend module that imports `core/Database.js` or `config/AppConfig.js` reads the real
  `server.db` and `config.yaml` the moment it is imported. Its test replaces both with
  `vi.mock`; `src/testing/memoryDatabase.ts` gives an in-memory database on the current
  schema. **No test may open the files of a running installation.**
- **No test talks to a directory.** What needs one — a measurement, a change — is checked
  against the development domain by hand (`docs/development.md`). What a test can hold is
  kept pure for that reason: the blob decoder, the Kerberos request, the findings.
- **No test runs Samba's Python or asks a supervisord** either. The agent's readers are
  checked in the development domain; what a test holds is the XML-RPC reader, the GPT.INI
  reader and the rules around them. A client module that imports `core/Config.js` reads
  config.yaml the moment it is imported; its test replaces it with `vi.mock`.

CI (`.github/workflows/ci.yml`) runs `npm run build`, `npm test`, `npm run typecheck` for
`shared`, `client`, `server/backend` and `server/frontend`, `npm run lint -w server/frontend`
and `npm run lint` on every branch and pull request; `build.yml` calls the same workflow and
only builds the two images (`sadm-server`, `sadm-client`) once it passes. Run the eight
locally before pushing.

The agent's image holds no program of its own to start, so its smoke test copies
`/opt/sadm-client` into a plain Debian and asks the agent for its version -- in the
Dockerfile's own `smoke` stage, and again in `build.yml` against the digest that was pushed.

## Docs

See `docs/` for detailed documentation:
- `docs/index.md` — Landing page of the published site: the pieces, and where the data comes from
- `docs/quickstart.md` — The server with Docker Compose, pointed at a domain
- `docs/configuration.md` — What is specific to SADM in `config.yaml`, env vars
- `docs/health.md` — What is measured and how a service is asked, the findings, when one is reported
- `docs/agent.md` — What the agent reports, how it gets into an image, registering it, the database check
- `docs/directory.md` — What can be managed, what is protected, the record of changes
- `docs/dns.md` — The DNS zones: what can be managed, what is protected, the serial number
- `docs/webhooks.md` — Event kinds, the template, `event.data` by kind
- `docs/security.md` — What the server can do, and what limits it
- `docs/development.md` — The development stack with its test domain, the checks

**A new finding goes into the table in `docs/health.md`, a new event kind into the one in
`docs/webhooks.md`.** A change an operator has to act on gets an entry in
`docs/upgrade-notes.md` once there is a release to upgrade from (the page does not exist yet).

`docs/agent.md` is also the contract with whoever builds a domain controller's image: what
is in `/opt/sadm-client`, what the target image has to bring, and the environment variables.
A change to any of them is a change to that page.

### The docs are rendered twice

`docs/` is both the GitHub-browsable directory and the `docs_dir` of
[`mkdocs.yml`](mkdocs.yml) (MkDocs Material), published to
<https://stefgo.github.io/samba-ad-manager/> by
[`docs.yml`](.github/workflows/docs.yml) on pushes to `main`. **Every page has to
render in both**, which constrains three things:

- **A link out of `docs/` must be absolute**
  (`https://github.com/stefgo/samba-ad-manager/blob/main/…`). A relative
  `../compose.yaml` resolves on GitHub and nowhere else — MkDocs cannot follow a path
  outside its `docs_dir`, and `--strict` fails the build on it. Links between pages
  inside `docs/` stay relative.
- **A hand-written TOC uses GitHub anchors** — the emoji is dropped and the leading space
  becomes a dash (`#-authentication`). `mkdocs.yml` sets `pymdownx.slugs.slugify(case=lower)`
  for exactly that reason. Changing the slugify function silently breaks those links.
- **A new page has to be added to `nav` in `mkdocs.yml`**; `--strict` fails on a page
  outside the navigation.

The workflow is deliberately **not** part of `ci.yml`/`build.yml`: that chain is the
gate on a release, and a documentation typo must not block one. The strict build runs on
every branch that touches the docs; only `main` deploys.
