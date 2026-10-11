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

Log in at <http://localhost:3020> as `admin` / `admin`. The server is pointed at `dc1` and
`dc2` in `compose.dev.yaml`; both show on the dashboard within a minute, with nothing to
register.

To see a finding, stop a domain controller: `docker stop sadm-dc2`. The dashboard shows it
within a minute; the activity history after another 45 seconds.

A service that hangs is what the protocol probes are for. Freeze the KDC of `dc1` and watch
*Kerberos does not answer* appear while its port stays open:

```bash
docker exec sadm-dc1 sh -c 'kill -STOP $(pgrep -f "task\[kdc\]")'
docker exec sadm-dc1 sh -c 'kill -CONT $(pgrep -f "task\[kdc\]")'
```

### BIND and a secondary name server

The domain above answers DNS with Samba's own server. A second compose file switches it to
BIND (`BIND9_DLZ`, which reads the zones out of the directory) and adds `ns2`, a plain BIND
that transfers the zone `sadm.test` from `dc1` — the setup in which a change has to raise
the zone's serial number to arrive anywhere else:

```bash
NPM_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml -f compose.dev.bind.yaml up --build
```

| Service | Address | |
|---|---|---|
| `ns2` | 172.28.0.30 | The secondary. It is listed as a name server of `sadm.test` and carries no other zone. |

A domain that was made without the second file is switched over on start, and switched back
by a start without it; nothing has to be thrown away. The first start with it also sets the
zone's refresh to one minute, so a secondary catches up while you watch.

```bash
# What each of them serves for the zone, serial number included
for s in 172.28.0.21 172.28.0.22 172.28.0.30; do docker exec sadm-dc1 dig @$s sadm.test SOA +norec +short; done

# A DNS server that is gone, and back
docker exec sadm-dc1 pkill named
docker exec sadm-dc1 named -u bind -c /etc/bind/named.conf

# A secondary that may no longer transfer: take it off the list, and put it back
docker exec sadm-dc1 sed -i '/dns zone transfer clients allow/d' /etc/samba/smb.conf
docker restart sadm-dc1
```

### The database check

No cron runs in the development domain. Issue a report token on a domain controller's page
and run the [script](dbcheck.md) by hand:

```bash
docker exec -i -e SADM_URL=http://172.28.0.10:3020 -e SADM_TOKEN=<the token> sadm-dc1 \
    python3 - < docs/scripts/sadm-dbcheck.py
```

`docker compose -f compose.dev.yaml down -v` throws the domain away.

## Without containers

```bash
NPM_TOKEN=$(gh auth token) npm install
npm run dev:server
npm run dev:frontend
```

The backend on the host reaches the development domain controllers' directory through their
published LDAPS ports, but not the other services it asks and not by the names the directory
gives them. It finds both domain controllers and reports them unreachable. To measure them,
run the backend in the development stack.

## Checks

The seven that CI runs, and that have to pass before a push:

```bash
npm run build
npm test
npm run typecheck -w shared
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
of the workspaces, where a new measurement or finding goes, commits, releases.
