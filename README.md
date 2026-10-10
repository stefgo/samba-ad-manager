# Samba AD Manager (SADM)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/)

<img src="docs/assets/favicon.svg" alt="" width="72" align="right">

The **Samba AD Manager** (SADM) is a web interface for an Active Directory that is run by
[Samba](https://www.samba.org) AD domain controllers: an overview of the domain controllers
and their health, and the management of user accounts, groups, computer accounts and
organizational units. It consists of a lightweight Node.js agent next to each domain
controller and a central Fastify/React server with a dashboard and API.

> **Under construction.** What exists so far is the foundation listed under *Status*. The
> health overview and the directory management are being built on top of it.

## Status

| Area | State |
|---|---|
| Server: login (local and OIDC), accounts, settings, scheduled cleanup | in place |
| Agent: registration (inbound and outbound), activity queue, status page | in place |
| Activity history and webhooks | in place |
| Domain controller health (replication, FSMO roles, services, clock) | planned |
| Directory: users, groups, computers, organizational units | planned |

## Architecture

The project is a monorepo with four components:

1. **Server Backend (`server/backend`):** A Fastify API server acting as the control plane.
   Manages agent registrations, accounts, the activity log and the webhooks (SQLite).
2. **Server Frontend (`server/frontend`):** A React SPA built with Vite and Tailwind CSS.
3. **Client Agent (`client`):** A lightweight Node.js daemon, one per domain controller,
   connected to the server over a persistent WebSocket.
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

Or as containers:

```bash
NPM_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up --build
```

## License

[MIT](LICENSE)
