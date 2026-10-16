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
| `serviceUrls` | `SADM_LDAP_SERVICE_URLS` (comma separated) | `[]` | The names applications reach the directory under rather than one domain controller, e.g. those of a virtual address: `ldap://<host>[:port]` and `ldaps://<host>[:port]`, one name for both or one each, in any domain. Measured, see [Central URLs](health.md#central-urls); see also [Central names](#central-names). |
| `bindDn` | `SADM_LDAP_BIND_DN` | — | The account the server binds as: a DN or `user@realm`. |
| — | `SADM_LDAP_PASSWORD`, `SADM_LDAP_PASSWORD_FILE` | — | The password of `bindDn`. Environment only, never in `config.yaml`. |
| `caFile` | `SADM_LDAP_CA_FILE` | — | One PEM file with the CA, or the certificates themselves, of every domain controller whose certificate no public CA issued. It adds to the public CAs the server trusts anyway, so a domain controller with a certificate from Let's Encrypt is accepted next to it. |
| `allowSelfSigned` | `SADM_LDAP_ALLOW_SELF_SIGNED` | `false` | Accept a certificate that cannot be verified. |
| `timeoutMs` | — | `15000` | |
| `enabled` | — | `true` | `false`: the domain controllers are measured, and no object of the directory is shown. |
| `readOnly` | — | `false` | `true`: objects can be looked at, and none is changed. An agent is not asked to [fix its database](agent.md#fixing-what-the-check-finds) either. |

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
directory, or against one of the [central names](#central-names).

### Central names

Applications often reach the directory under a name of its own rather than through one
domain controller: that of a virtual address that moves between them, for instance
`ldap.example.net`. Its domain need not be the realm's. List those names in `serviceUrls`:
SADM [measures them](health.md#central-urls) — whether they answer, which domain controller
does, and the certificate — and does not work through them.

Samba has one certificate and presents it under every name it is reached by. A certificate
for the central names — from Let's Encrypt, which cannot issue one for a private realm such
as `home.lan` — therefore does not name the domain controller, and the server would refuse
it. A domain controller's certificate may carry one of the host names of `serviceUrls`
instead of its own. The chain is checked in full as before; only the name is widened.

## `health` — name servers to ask

How often the domain controllers are measured is a [setting](#settings--what-the-settings-page-writes).

| Key | Default | |
|---|---|---|
| `dnsServers` | `[]` | Name servers of the domain that no zone lists in its NS records: a hidden secondary. A host name or an IP address each. The ones a zone lists are found without being named here — see [Domain Health](health.md#name-servers-that-are-no-domain-controllers). |

## `settings` — what the settings page writes

Specific to SADM are the thresholds and intervals under *Domain Health*, and when a finding
is reported, under *Findings*:

| Key | Default | |
|---|---|---|
| `health_max_clock_offset_seconds` | `300` | From when on a domain controller's clock counts as off. Kerberos refuses logons at 300. |
| `health_max_replication_age_minutes` | `60` | How old the last successful replication from a partner may be. |
| `health_max_dbcheck_age_hours` | `36` | How old the last [database check](agent.md#the-database-check) of a domain controller may be whose agent runs one. |
| `health_storage_warning_percent` | `15` | Below how many percent of free space the storage of a domain controller is a warning. Read by its [agent](agent.md). |
| `health_storage_error_percent` | `5` | Below how many it is an error. |
| `health_certificate_warning_days` | `14` | Fewer days than this before a certificate expires — a domain controller's or a [central URL's](health.md#central-urls) — are a warning. |
| `health_certificate_error_days` | `3` | Fewer than this are an error, as is a certificate that has expired. |
| `health_interval_seconds` | `60` | Seconds between two measurements of every domain controller, from 10 to 3600. |
| `health_replication_interval_seconds` | `300` | Seconds between two readings of replication, of the object counts and of the DNS zones, and between two rounds of asking the name servers that are no domain controllers, from 30 to 86400. |
| `issue_report_after_minutes` | `5` | How long a finding has to last before the activity and the webhooks hear of it, from 0 to 1440 — see [When a finding is reported](health.md#when-a-finding-is-reported). |
| `issue_resolve_after_minutes` | `5` | How long a reported finding has to be gone before it is called off. |
| `dbcheck_fix_retries` | `2` | How often a [fix of the database](agent.md#fixing-what-the-check-finds) is tried again while it fails or leaves errors, from 0 to 10. Under *Agent Requests*, with the two below. |
| `dbcheck_fix_retry_delay_minutes` | `10` | How many minutes apart, from 1 to 1440. |
| `dbcheck_fix_timeout_minutes` | `360` | How long the server waits for the outcome, every attempt included, before the activity says it is late; from 10 to 2880. |
| `replication_sync_retries` | `2` | How often a [replication](agent.md#replicating-now) is tried again while a link fails, from 0 to 10. |
| `replication_sync_retry_delay_minutes` | `2` | How many minutes apart, from 1 to 1440. |
| `replication_sync_timeout_minutes` | `30` | How long the server waits for the outcome, from 5 to 1440. |
| `issue_report_after_overrides` | `""` | A wait of its own per kind of finding: `kind=minutes` entries separated by commas, e.g. `dc-unreachable=2, replication-failing=15`. The kinds are those of the [table of findings](health.md#findings), as the settings page lists them. |

## `security` — agents

| Key | Default | |
|---|---|---|
| `allow_self_signed_agent_certificates` | `false` | Accept a certificate that does not validate from an [agent](agent.md) the server dials as `wss://`. For the installation as a whole, not per agent. |

## The port

The server listens on port 3020 (`port`, `SADM_SERVER_PORT`).
