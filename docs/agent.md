# Agent

SADM measures a domain controller over the network: it asks its directory, its DNS server
and its KDC. Some things cannot be asked that way, because nothing on the network answers
for them. The agent is a small process that runs **in the domain controller's container**
and reports them.

This is optional, per domain controller. One without an agent is measured like every other;
its page then shows no local readings and no database check.

## What it reports

| | Source | Finding |
|---|---|---|
| Which services of the `samba` process run | Samba's internal messaging — what `samba-tool processes` lists — against `server services` in `smb.conf` | *Samba service not running* |
| The programs supervisord runs (Samba, BIND), their state and when they last started | supervisord's XML-RPC interface | *Process not running*, *Process restarting* |
| Free space where Samba's databases live, and the size of the directory database | the file system | *Storage low* |
| The version of every group policy in the sysvol | the `GPT.INI` of each policy folder | *Sysvol out of step* |
| [The database check](#the-database-check) | Samba's own checker | *Database check*, *Database check overdue* |

The first one sees what no port shows: the replication service (`drepl`) and the topology
checker (`kcc`) listen nowhere. The last but one is specific to Samba, which **does not
replicate the sysvol**: a group policy that was edited on one domain controller is in the
directory of all of them within moments, and in the sysvol of the others only once
something copies it there. SADM holds each domain controller's sysvol against its own
directory.

What it reads goes to the server when it changes, and once a minute otherwise.

## What the server can ask of it

Three things, none with a parameter: to report now, to run the database check now, and to
[fix what the check finds](#fixing-what-the-check-finds). There is no command, no path and
no option in any of them. The agent runs as root next to the directory's database, so
nothing that a login of the dashboard could turn into a command is sent to it.

It reads, and the database check runs read-only. The fix is the one thing it writes, and
only where whoever runs the domain controller allowed it (`SADM_DBCHECK_ALLOW_FIX`); it is
off by default.

The agent does not read or change the directory's objects. That stays with the server, over
LDAPS.

## Getting it into an image

The agent is published as an image that runs nothing and holds one directory,
`ghcr.io/stefgo/sadm-client`. A domain controller's image copies it:

```dockerfile
COPY --from=ghcr.io/stefgo/sadm-client:latest /opt/sadm-client /opt/sadm-client
```

| In `/opt/sadm-client` | |
|---|---|
| `bin/sadm-client` | Starts the agent. `--version` says which one it is, without reading anything. |
| `bin/node` | The Node runtime it was built for. Nothing has to be installed for it. |
| `supervisor.conf` | The agent as a program of supervisord. |
| `client/`, `shared/`, `node_modules/` | The agent itself. |

The target image has to bring glibc and libstdc++, which every Debian has, and Samba's
Python modules (`python3-samba`), which the agent reads the local database with. The image
is built for `linux/amd64` and `linux/arm64`, and tagged like the server's: `latest`, the
version, and `main` / `dev`.

To run it under the supervisord that runs Samba, have `supervisord.conf` include a
directory and link the agent's file into it:

```ini
[include]
files = /etc/supervisor/conf.d/*.conf
```

```bash
ln -s /opt/sadm-client/supervisor.conf /etc/supervisor/conf.d/sadm-client.conf
```

The agent is started after Samba and started again whenever it ends. It is no part of the
container's health check and never stops anything: a domain controller whose agent is down
keeps running, and SADM reports *Agent offline*.

It keeps its state — the identity the server issues, and a `config.yaml` if you write one —
in `/var/lib/samba/sadm-client`, below Samba's own. That is deliberate: a domain controller
that is provisioned or joined anew is another domain controller, and the identity of the
old one goes with the volume.

## Registering it

An agent belongs to one domain controller, and says which one it runs on: the GUID of its
NTDS settings, read from the local database. The server takes it for that domain controller
and for no other. There are two ways to register one, and *Add Agent* at the top of the
domain controller's page asks first which of them it is to be. Once it has an agent, the
page's details say how that is connected.

### The agent dials the server

Choose *The agent connects to this server* and then *Generate Token*. Start the container
with two variables:

| | |
|---|---|
| `SADM_SERVER_URL` | Where the SADM server is: `https://sadm.example.net`. |
| `SADM_REGISTRATION_TOKEN` or `SADM_REGISTRATION_TOKEN_FILE` | The token, or a file that holds it. |

The agent registers when it starts, keeps the identity it is given and connects from then
on. The token is good for that one domain controller, for one registration and for an hour;
remove it from the environment afterwards. Nothing listens on the domain controller.

### The server dials the agent

For a domain controller that cannot reach the server. Start the container **without**
`SADM_SERVER_URL`: the agent then listens on port 3021 and prints a setup PIN into its log.
Choose *This server connects to the agent* and enter the agent's address and that PIN. The
server registers the agent and keeps the connection up; when it is lost, the server dials
again.

Where the agent is dialled can be changed later -- *Edit Agent* in the menu at the top of
the domain controller's page --, for one whose port was moved or that is reached at another address. The agent
stays registered.

The PIN is replaced after five wrong attempts. `allowedNetworks` in the agent's
`config.yaml` limits who may dial it at all, and a `tls` block has it serve TLS — the
address is then written `wss://host:port`. The server checks that certificate unless
`security.allow_self_signed_agent_certificates` is set in its own `config.yaml`. The token
of such an agent is not stored on the server: it is derived from the server's `jwtSecret`,
so an agent the server dials has to be connected again when that secret changes.

### Registering it again, and removing it

*Remove Agent* in the same menu forgets the agent and what it reported. The
agent itself keeps running and is refused from then on. To register it again, delete
`identity.json` in `/var/lib/samba/sadm-client` and restart it.

An agent that registers for a domain controller that has one takes its place.

## Configuration

Nothing has to be configured beyond the two variables above. What can be:

| Variable | |
|---|---|
| `SADM_SERVER_URL` | The server, for an agent that dials it. Unset: the agent waits to be dialled. |
| `SADM_REGISTRATION_TOKEN`, `SADM_REGISTRATION_TOKEN_FILE` | The registration token. Read while the agent has no identity. |
| `SADM_ALLOW_SELF_SIGNED` | `true` accepts a server certificate that does not validate. Better: name the CA in `NODE_EXTRA_CA_CERTS`, which Node reads itself. |
| `SADM_CLIENT_PORT` | The port the agent listens on where it does (default 3021). |
| `SADM_SUPERVISOR_SOCKET` | Where supervisord's socket is (default `/var/run/supervisor.sock`). Empty: there is none, and the programs are not read. |
| `SADM_DBCHECK_ALLOW_FIX` | `true` lets the server have the agent [fix what the database check finds](#fixing-what-the-check-finds). Off by default; wins over `report.dbcheckAllowFix`. |
| `SADM_CLIENT_DATA_DIR`, `SADM_CLIENT_CONFIG` | Where the identity and `config.yaml` are (default `/var/lib/samba/sadm-client`). |
| `SADM_REGISTRATION_SECRET`, `SADM_REGISTRATION_SECRET_FILE` | A secret the server may present in place of the setup PIN, for a rollout where nobody reads a log. |
| `LOG_LEVEL` | `trace` … `fatal`, `silent`. |

Everything else is `config.yaml`, described in
[`client/config.example.yaml`](https://github.com/stefgo/samba-ad-manager/blob/main/client/config.example.yaml):
how often the agent reads, how often it runs the database check, whether it may fix what the
check finds, and the two pages of its own web server. Those — a register page and a status page — are **off by default**: a
domain controller's container usually shares the host's network, where an open page is open
to everyone who reaches the host.

## The database check

Samba's database check — `samba-tool dbcheck` — reads the local database of a domain
controller and cannot be run over the network. The agent runs the check Samba's own tool
runs, **read-only**: nothing is fixed and no transaction is opened. It checks every
partition the domain controller holds — the domain, the configuration, the schema and the
two DNS partitions — which is `samba-tool dbcheck --cross-ncs`.

It runs once a day (`report.dbcheckIntervalHours`) and when *Check now* is chosen on the
domain controller's page. The check walks every object of the directory and takes minutes
on a large one; the result shows on the page when it is done. A result that could not be
sent because the server was away is sent with the next connection.

What it counts is the finding *Database check*. A check that stays away longer than the
threshold (*Settings* → *Domain Health*, 36 hours by default) is *Database check overdue* —
so a check that no longer runs is noticed rather than read as "no errors". Nothing is
expected of a domain controller without an agent.

### Fixing what the check finds

Where the last check counted errors, *Fix errors* on the domain controller's page has the
agent fix them as `samba-tool dbcheck --cross-ncs --fix --yes` does: everything the check
finds, nothing chosen. Then it runs the check again, and that check's result is what the
page shows — with how many errors the fix went at, under *Preceding Fix*.

It needs two things:

- **The agent has to be allowed to.** `SADM_DBCHECK_ALLOW_FIX=true` in the domain
  controller's environment, or `report.dbcheckAllowFix: true` in the agent's `config.yaml`.
  Without it the agent does not offer the fix, and does not obey a request for one. Whether
  the database of a domain controller may be changed from the dashboard is decided where the
  domain controller is run, not by whoever logs in to the dashboard.
- **The server has to be allowed to change things.** With `directory.readOnly: true` in the
  server's `config.yaml` the fix is refused, like every other change.

The fix runs in **one transaction**, as Samba's own tool does: a fix that fails or is cut
off changes nothing. While it runs, every other write to this domain controller's database
waits — logons that update an account, replication from the others, dynamic DNS updates.
It takes about as long as a check. Have a backup of the domain controller before, and fix
one domain controller at a time; what is fixed replicates to the others like any change.

Who asked for a fix and how it went are both in the activity (`agent.dbcheck_fix_requested`,
`agent.dbcheck_fixed`) and can be sent on by a [webhook](webhooks.md).

`--reset-well-known-acls` and `--reindex` are not offered. They remain `samba-tool`'s, on the
domain controller.

## When something is wrong

The agent logs to the container's output, next to Samba.

| It says | |
|---|---|
| `Could not read the local Samba database` | The agent does not run where Samba's database is, not as root, or `python3-samba` is missing. It tries again. |
| `Registration refused: The registration token is not valid, or no longer` | The token was used, replaced or is older than an hour. Issue a new one. |
| `Registration refused: This token was issued for …` | The token belongs to another domain controller. |
| `Server not reachable at …` | `SADM_SERVER_URL` or the network. It tries again. |
| `The server's certificate could not be verified` | Name the CA in `NODE_EXTRA_CA_CERTS`, or set `SADM_ALLOW_SELF_SIGNED=true`. |
| `The server refused this agent: This agent's identity belongs to another domain controller` | The volume was moved, or the domain controller was joined anew with the old agent directory in place. Delete `identity.json` and register again. |

On the server's side, a part the agent could not read is listed on the domain controller's
page under *Not Read Locally*, with the reason.
