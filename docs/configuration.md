# Configuration

The server reads one `config.yaml` and checks it on every start: a value of the wrong type
or format stops the process with a log line that names the field. The annotated example is
the reference —
[`server/config.example.yaml`](https://github.com/stefgo/samba-ad-manager/blob/main/server/config.example.yaml).
This page lists what is specific to SADM.

## `directory` — the domain

| Key | Environment | Default | |
|---|---|---|---|
| `urls` | `SADM_LDAP_URLS` (comma separated) | — | Where the domain is first asked who its domain controllers are: `ldaps://<host>[:port]`. LDAPS only. One is enough; the others are found in the directory. |
| `bindDn` | `SADM_LDAP_BIND_DN` | — | The account the server binds as: a DN or `user@realm`. |
| — | `SADM_LDAP_PASSWORD`, `SADM_LDAP_PASSWORD_FILE` | — | The password of `bindDn`. Environment only, never in `config.yaml`. |
| `caFile` | `SADM_LDAP_CA_FILE` | — | One PEM file with the CA, or the certificates themselves, of every domain controller. |
| `allowSelfSigned` | `SADM_LDAP_ALLOW_SELF_SIGNED` | `false` | Accept a certificate that cannot be verified. |
| `timeoutMs` | — | `15000` | |
| `enabled` | — | `true` | `false`: the domain controllers are measured, and no object of the directory is shown. |
| `readOnly` | — | `false` | `true`: objects can be looked at, and none is changed. |

Without `urls`, `bindDn` and the password the server starts, serves the dashboard and
measures nothing. It says so in its log, and the dashboard says that the directory is not
configured.

`enabled` and `readOnly` are read from the file alone, and no page of the dashboard sets
them. That is on purpose: whoever gets hold of a login of SADM cannot switch writing back on.

There is one account and one CA file for the whole domain, not one per domain controller.

### Where a domain controller is reached

By the DNS name the directory gives it, on the standard ports. Where that name does not
resolve from the server, set an address on the domain controller's page (*Set address*): a
host name or an IP address. Its certificate is still checked against its name in the
directory.

## `health` — how often

| Key | Default | |
|---|---|---|
| `interval` | `60` | Seconds between two measurements of every domain controller. |
| `replicationInterval` | `300` | Seconds between two readings of replication, of the object counts and of the DNS zones, and between two rounds of asking the name servers that are no domain controllers. |
| `dnsServers` | `[]` | Name servers of the domain that no zone lists in its NS records: a hidden secondary. A host name or an IP address each. The ones a zone lists are found without being named here — see [Domain Health](health.md#name-servers-that-are-no-domain-controllers). |

## `settings` — what the settings page writes

Specific to SADM are the thresholds under *Domain Health*:

| Key | Default | |
|---|---|---|
| `health_max_clock_offset_seconds` | `300` | From when on a domain controller's clock counts as off. Kerberos refuses logons at 300. |
| `health_max_replication_age_minutes` | `60` | How old the last successful replication from a partner may be. |
| `health_max_dbcheck_age_hours` | `36` | How old the last [database check](agent.md#the-database-check) of a domain controller may be whose agent runs one. |
| `health_storage_warning_percent` | `15` | Below how many percent of free space the storage of a domain controller is a warning. Read by its [agent](agent.md). |
| `health_storage_error_percent` | `5` | Below how many it is an error. |

## `security` — agents

| Key | Default | |
|---|---|---|
| `allow_self_signed_agent_certificates` | `false` | Accept a certificate that does not validate from an [agent](agent.md) the server dials as `wss://`. For the installation as a whole, not per agent. |

## The port

The server listens on port 3020 (`port`, `SADM_SERVER_PORT`).
