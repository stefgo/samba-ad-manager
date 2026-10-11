# Samba AD Manager (SADM)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/)

<img src="docs/assets/favicon.svg" alt="" width="72" align="right">

The **Samba AD Manager** (SADM) is a web interface for an Active Directory that is run by
[Samba](https://www.samba.org) AD domain controllers: an overview of the domain controllers
and their health, and the management of user accounts, groups, computer accounts and
organizational units. It is one Fastify/React server with a dashboard and API that talks to
the domain controllers over the network. Nothing is installed on a domain controller.

## Features

- **The domain at a glance:** every domain controller with its Samba version, site, FSMO
  roles and global catalog, the domain's functional levels and the number of users, groups
  and computers.
- **Health, with what is wrong named:** a domain controller that does not answer, a service
  that does not — asked in its own protocol, so a process that hangs behind an open port is
  noticed — failing or stale replication, a FSMO role nobody or more than one holds, a clock
  beyond what Kerberos tolerates, findings of the database check. What no single domain
  controller can see shows up when their measurements are laid next to each other.
- **Nothing to register:** the server is told where one domain controller is. The others it
  finds in the directory, and one that joins the domain later is measured from then on.
- **Directory management:** users, groups, computers and organizational units — create, edit,
  rename, move, delete; set passwords, enable, disable and unlock accounts; manage group
  members. Objects the directory cannot do without are protected.
- **Structured sources only:** LDAPS for the directory and for replication, DNS and Kerberos
  asked directly, and Samba's own checker for the database check — run on the domain
  controller by cron and reported to the server. Nothing is parsed out of the text a
  command prints.
- **A record of every change:** who changed what, on which domain controller.
- **Webhooks:** findings, their all-clear and changes to the directory go to a chat channel
  or an endpoint of your own, each webhook with a JSON template and filters.
- **Limits that a login cannot lift:** the server can be set read-only, or kept out of the
  directory altogether — in its configuration file, which no page of the dashboard writes.
  What it can change at all is what its account in the directory may change.
- **Authentication:** local accounts and OIDC.

Documentation: [`docs/`](docs/index.md) — start with the [Quick Start](docs/quickstart.md).

## Architecture

The project is a monorepo with three components:

1. **Server Backend (`server/backend`):** A Fastify API server. It measures the domain
   controllers, reads and changes the directory, and keeps accounts, the last measurement of
   every domain controller, the activity log and the webhooks (SQLite).
2. **Server Frontend (`server/frontend`):** A React SPA built with Vite and Tailwind CSS.
3. **Shared Library (`shared`):** Single source of truth for TypeScript types, Zod validation
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
```

Or as containers, with a Samba AD test domain of two domain controllers:

```bash
NPM_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up --build
```

See [docs/development.md](docs/development.md).

## License

[MIT](LICENSE)
