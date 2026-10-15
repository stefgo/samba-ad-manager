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
| `dc1`, `dc2` | 6361, 6362 (LDAPS) | The Samba AD domain `SADM.TEST`. `dc1` provisions it on first start, `dc2` joins it. `Administrator` / `Passw0rd-dev`. Samba runs under supervisord, and both carry the [agent](agent.md). |
| `agent` | — | Never started: the image that carries the agent, which `dc1` and `dc2` copy it out of, the way the image of a real domain controller does. |

Log in at <http://localhost:3020> as `admin` / `admin`. The server is pointed at `dc1` and
`dc2` in `compose.dev.yaml`; both show on the dashboard within a minute, with nothing to
register.

To see a finding, stop a domain controller: `docker stop sadm-dc2`. The dashboard shows it
within a minute; the activity history once it has lasted five minutes -- set *Report After*
under *Settings* → *Findings* to 0 or 1 to see it sooner. To stop Samba and keep the
container, and with it the agent: `docker exec sadm-dc2 supervisorctl stop samba`.

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
zone's refresh to one minute, and `ns2` is told it may ask that often, so a change arrives
there while you watch. The finding *Secondary behind* still takes a quarter of an hour to
appear: it gives a secondary what BIND takes by default, whatever the zone says.

```bash
# What each of them serves for the zone, serial number included
for s in 172.28.0.21 172.28.0.22 172.28.0.30; do docker exec sadm-dc1 dig @$s sadm.test SOA +norec +short; done

# A DNS server that is gone, and back
docker exec sadm-dc1 pkill named
docker exec sadm-dc1 named -u bind -c /etc/bind/named.conf

# A secondary that may no longer transfer: take it off the list and have BIND read that.
# A restart of the container puts it back.
docker exec sadm-dc1 sh -c "sed -i '/dns zone transfer clients allow/d' /etc/samba/smb.conf && pkill named && sleep 1 && named -u bind -c /etc/bind/named.conf"
docker restart sadm-dc1
```

### The agents

Both domain controllers start with the agent, unregistered. They show the two ways to
register one:

```bash
# dc1 dials the server: "Add Agent" on DC1's page, "The agent connects to this server", then
SADM_DC1_TOKEN=<the token> docker compose -f compose.dev.yaml up -d dc1

# dc2 is dialled: "Add Agent" on DC2's page, "This server connects to the agent", address dc2.sadm.test, with the PIN from
docker logs sadm-dc2 2>&1 | grep "Setup PIN"
```

`dc2` then reports *Sysvol out of step*, and rightly: it joined the domain, and Samba copied
it no sysvol. Copy it to clear the finding, and edit a `GPT.INI` on one side to bring it back:

```bash
docker exec sadm-dc1 tar -C /var/lib/samba/sysvol -c . | docker exec -i sadm-dc2 tar -C /var/lib/samba/sysvol -x
```

```bash
# An agent that is gone, and back
docker exec sadm-dc1 supervisorctl stop sadm-client
docker exec sadm-dc1 supervisorctl start sadm-client

# What the agent reads, as Samba and supervisord say it
docker exec sadm-dc1 samba-tool processes
docker exec sadm-dc1 supervisorctl status

# Register an agent anew: it keeps its identity in the volume of the domain
docker exec sadm-dc1 rm -rf /var/lib/samba/sadm-client && docker restart sadm-dc1
```

Samba starts a service of its own again when it ends, so *Samba service not running* does
not come from killing one once. A change to the agent needs its image built again:
`docker compose -f compose.dev.yaml build dc1`.

The agent can also run on the host against nothing — `npm run dev:client` — which is enough
for its web pages and of no use for what it reads: that needs Samba's Python modules and
its database.

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
of the workspaces, where a new measurement or finding goes, commits, releases.
