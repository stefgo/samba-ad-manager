# Development

## Prerequisites

- Node.js 22+
- Docker with the Compose plugin
- A token that can read GitHub Packages, for `@stefgo/react-ui-components` and
  `@stefgo/js-template-engine`, in `NPM_TOKEN`. The commands below take it from the GitHub
  CLI.

## The development stack

```bash
NPM_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up --build
```

This starts:

| Service | Port | |
|---|---|---|
| `server-dev` | 3020 | The backend in watch mode. It serves the frontend from `server/dist/public` once that has been built (`npm run build -w server/frontend`); for hot reload run `npm run dev:frontend` on the host. |
| `dc1`, `dc2` | 6361, 6362 (LDAPS) | The Samba AD domain `SADM.TEST`. `dc1` provisions it on first start, `dc2` joins it. `Administrator` / `Passw0rd-dev`. |
| `client-dc1`, `client-dc2` | 3021, 3022 | One agent in watch mode next to each domain controller. |

Log in at <http://localhost:3020> as `admin` / `admin`, issue a registration token under
*Domain Controllers*, and register each agent on its own page with that token, the setup PIN
from `docker logs sadm-client-dc1`, and the server URL `http://172.28.0.10:3020`.

To see a finding, stop a domain controller: `docker stop sadm-dc2`. The dashboard shows it
within a minute; the activity history after another 45 seconds.

`docker compose -f compose.dev.yaml down -v` throws the domain away.

## Without containers

```bash
NPM_TOKEN=$(gh auth token) npm install
npm run dev:server
npm run dev:frontend
```

An agent on the host reaches a development domain controller through its published LDAPS
port and the host's Docker socket — set `SADM_SAMBA_CONTAINER=sadm-dc1`,
`SADM_LDAP_URL=ldaps://127.0.0.1:6361`, `SADM_LDAP_BIND_DN=Administrator@sadm.test`,
`SADM_LDAP_PASSWORD=Passw0rd-dev`, `SADM_LDAP_ALLOW_SELF_SIGNED=true` and, on Docker Desktop,
`SADM_DOCKER_SOCKET=$HOME/.docker/run/docker.sock`, then `npm run dev:client`.

## Checks

The eight that CI runs, and that have to pass before a push:

```bash
npm run build
npm test
npm run typecheck -w shared
npm run typecheck -w client
npm run typecheck -w server/backend
npm run typecheck -w server/frontend
npm run lint
npm run lint:frontend
```

The tests are logic only: nothing renders a component, starts the backend or talks to a
directory. What needs a directory is checked against the development domain by hand.

## Conventions

See
[CLAUDE.md](https://github.com/stefgo/samba-ad-manager/blob/main/CLAUDE.md): the structure
of the workspaces, where a new action of the agent goes, commits, releases.
