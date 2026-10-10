# Samba AD Manager (SADM)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/)

<img src="docs/assets/favicon.svg" alt="" width="72" align="right">

The **Samba AD Manager** (SADM) is a web interface for an Active Directory that is run by
[Samba](https://www.samba.org) AD domain controllers: an overview of the domain controllers
and their health, and the management of user accounts, groups, computer accounts and
organizational units. It consists of a lightweight Node.js agent next to each domain
controller and a central Fastify/React server with a dashboard and API.

## Features

- **The domain at a glance:** every domain controller with its Samba version, site, FSMO
  roles and global catalog, the domain's functional levels and the number of users, groups
  and computers.
- **Health, with what is wrong named:** a stopped Samba container, a directory that does not
  answer, a missing Samba service, a closed service port, failing or stale replication, a
  FSMO role nobody or more than one holds, a clock beyond what Kerberos tolerates, findings
  of the database check. What no single domain controller can see shows up when their
  measurements are laid next to each other.
- **Directory management:** users, groups, computers and organizational units — create, edit,
  rename, move, delete; set passwords, enable, disable and unlock accounts; manage group
  members. Objects the directory cannot do without are protected.
- **Structured sources only:** LDAPS for the directory, the Docker API for the Samba
  container, and Samba's own Python modules for replication, service processes and the
  database check. Nothing is parsed out of the text a command prints.
- **A record of every change:** who changed what, through which domain controller.
- **Webhooks:** findings, their all-clear and changes to the directory go to a chat channel
  or an endpoint of your own, each webhook with a JSON template and filters.
- **Limits on the domain controller's side:** an agent can be set read-only, or kept out of
  the directory altogether — in its own configuration, where the server cannot change it.
- **Authentication:** local accounts and OIDC.

Documentation: [`docs/`](docs/index.md) — start with the [Quick Start](docs/quickstart.md).

## Architecture

The project is a monorepo with four components:

1. **Server Backend (`server/backend`):** A Fastify API server acting as the control plane.
   Manages agent registrations, accounts, the last measurement of every domain controller,
   the activity log and the webhooks (SQLite). It never talks to a domain controller itself.
2. **Server Frontend (`server/frontend`):** A React SPA built with Vite and Tailwind CSS.
3. **Client Agent (`client`):** A lightweight Node.js daemon, one per domain controller,
   connected to the server over a persistent WebSocket. It measures its domain controller
   and carries out a fixed list of actions on its directory.
4. **Shared Library (`shared`):** Single source of truth for TypeScript types, Zod validation
   schemas and constants.

## Development

Requires Node.js 22+ and a token that can read GitHub Packages (for
`@stefgo/react-ui-components` and `@stefgo/js-template-engine`) in `NPM_TOKEN`:

```bash
NPM_TOKEN=$(gh auth token) npm install
npm run build
npm test

npm run dev:server      # backend in watch mode, http://localhost:3020 (admin/admin)
npm run dev:frontend    # Vite dev server, proxies /api and /ws to the backend
npm run dev:client      # agent in watch mode, http://localhost:3021
```

Or as containers, with a Samba AD test domain of two domain controllers:

```bash
NPM_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up --build
```

See [docs/development.md](docs/development.md).

## License

[MIT](LICENSE)
