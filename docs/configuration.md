# Configuration

Both the server and the agent read a `config.yaml` and check it on every start: a value of
the wrong type or format stops the process with a log line that names the field. The
annotated examples are the reference —
[`server/config.example.yaml`](https://github.com/stefgo/samba-ad-manager/blob/main/server/config.example.yaml)
and
[`client/config.example.yaml`](https://github.com/stefgo/samba-ad-manager/blob/main/client/config.example.yaml).
This page lists what is specific to SADM.

## The agent

### `samba` — the Samba container

| Key | Environment | Default | |
|---|---|---|---|
| `container` | `SADM_SAMBA_CONTAINER` | — | Name or id of the Samba container. Without it the container's state, replication, the service processes and the database check are not read, and the Docker socket is never opened. |
| `dockerSocket` | `SADM_DOCKER_SOCKET` | `/var/run/docker.sock` | |
| `python` | — | `python3` | The interpreter inside the Samba container that can import Samba's modules. |

### `ldap` — the directory

| Key | Environment | Default | |
|---|---|---|---|
| `url` | `SADM_LDAP_URL` | — | `ldaps://<host>[:port]`. LDAPS only. |
| `bindDn` | `SADM_LDAP_BIND_DN` | — | A DN or `user@realm`. |
| — | `SADM_LDAP_PASSWORD`, `SADM_LDAP_PASSWORD_FILE` | — | The password of `bindDn`. Environment only, never in `config.yaml`. |
| `caFile` | `SADM_LDAP_CA_FILE` | — | PEM file with the CA, or the certificate itself, the domain controller presents. |
| `allowSelfSigned` | `SADM_LDAP_ALLOW_SELF_SIGNED` | `false` | Accept a certificate that cannot be verified. |
| `timeoutMs` | — | `15000` | |

Without `bindDn` and a password the agent reads only what the directory tells anyone: the
domain controller's name, its Samba version and whether it is synchronized.

A URL with a port other than 636 is taken for a mapping — a published container port, a
tunnel. The agent then does not probe the other service ports at that address.

### `directory` — what the server may do

| Key | Default | |
|---|---|---|
| `enabled` | `true` | `false`: the agent measures its domain controller and answers nothing about objects. |
| `readOnly` | `false` | `true`: objects can be looked at through this agent, and none is changed. |

These are decided on the domain controller's side on purpose: the server cannot switch them.

### `health` — how often

| Key | Default | |
|---|---|---|
| `interval` | `60` | Seconds between two measurements. |
| `replicationInterval` | `300` | Seconds between two readings of replication and of the object counts. |
| `dbcheckIntervalHours` | `24` | Hours between two database checks. `0`: only when asked from the dashboard. |

## The server

The settings page writes the `settings` block of the server's `config.yaml`. Specific to
SADM are the thresholds under *Domain Health*:

| Key | Default | |
|---|---|---|
| `health_max_clock_offset_seconds` | `300` | From when on a domain controller's clock counts as off. Kerberos refuses logons at 300. |
| `health_max_replication_age_minutes` | `60` | How old the last successful replication from a partner may be. |

The server listens on port 3020 (`port`, `SADM_SERVER_PORT`), the agent's own web server on
3021 (`listenPort`, `SADM_CLIENT_PORT`).
