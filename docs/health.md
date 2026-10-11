# Domain Health

The server measures every domain controller of the domain over the network and keeps the
last measurement of each. Laid next to each other they show what no single domain controller
can see.

## What is measured

| | Source | How often |
|---|---|---|
| Name, DNS name, site, Samba version, global catalog, synchronized, highest USN | LDAP rootDSE | every measurement |
| The clock | `currentTime` in the rootDSE against the server's clock | every measurement |
| Functional levels, the holders of the seven FSMO roles, the domain controllers of the forest | LDAP | every measurement |
| Whether each service answers | see below | every measurement |
| Replication, inbound and outbound, per naming context | `repsFrom` and `repsTo`, over LDAPS | `health.replicationInterval` |
| How many users, groups and computers there are | LDAP | `health.replicationInterval` |
| The database check (`dbcheck`, read-only) | [reported by the domain controller](dbcheck.md) | when its cron job runs |

A measurement is taken every `health.interval` seconds and when *Measure now* is chosen on a
domain controller's page.

A part that cannot be read is left out, the rest is still reported. The domain controller's
page lists what is missing and why under *Not Measured*.

### How a service is asked

| Service | Port | How |
|---|---|---|
| LDAPS | 636 | The rootDSE is read, on a connection of its own and without a bind. |
| DNS | 53 | The SOA record of the domain is asked for. |
| Kerberos | 88 | A ticket is requested for a principal that does not exist; the KDC's refusal is the answer. |
| RPC endpoint mapper, LDAP, SMB, Kerberos password change, global catalog | 135, 389, 445, 464, 3268 | The port is connected to. |

The difference matters. A process that hangs keeps its port open: only a question in the
service's own protocol notices that nobody answers any more. For the last row SADM speaks no
protocol, so there it notices a service that is gone, not one that hangs.

The Kerberos probe asks as `sadm-health-probe`, which is what a KDC's log shows it as. No
password is involved and no account's failed-logon counter moves.

### Replication

Samba keeps the times of a link on its inbound side only. An outbound link names the partner
that is told about changes; whether that partner is up to date is what its own inbound link
says. Outbound links are therefore shown and not judged.

The replication service has no port. That it has stopped shows as inbound links whose last
attempt no longer moves — the finding *Replication stale*.

## Findings

| Finding | Severity | |
|---|---|---|
| Domain controller unreachable | error | None of its services answers. Nothing else is reported for that domain controller: it would only repeat this. |
| Service does not answer | error / warning | Error for a service a domain controller needs, warning for Kerberos password change and the global catalog. |
| Not synchronized | warning | The domain controller has not finished its initial replication. |
| Replication failing | error | Per partner, with the number of consecutive failures and the error of the worst link. |
| Replication stale | warning | The last success from a partner is older than the threshold, or there never was one. |
| FSMO role missing | error | No domain controller names a holder. |
| FSMO role conflict | error | The domain controllers disagree about the holder. |
| Clock offset | error | Beyond the threshold. |
| Database check | warning | The check counted errors, or could not be run. |
| Database check overdue | warning | A domain controller that is set up to report its check has not done so for longer than the threshold. |

The domain is **critical** with any error, **degraded** with any warning, **healthy**
without a finding, and **unknown** while nothing has been measured.

The three thresholds are settings — see [Configuration](configuration.md#settings--what-the-settings-page-writes).

## When a finding is reported

The dashboard shows a finding as soon as it is measured. The activity history and the
webhooks are told once it has lasted 45 seconds, and told that it is over once it has been
gone as long. A service that misses one answer, or a replication attempt that fails once and
succeeds on the next, is therefore not reported.

The two events of one finding share a correlation id, so the activity list shows them as one
row and a webhook can tie the all-clear to the alert.

After a restart the server reports nothing for 90 seconds, until its first measurements are in.

## Domain controllers that join and leave

Which domain controllers there are is read from the directory with every measurement. One
that the directory lists for the first time is recorded in the activity and measured from
then on; one it no longer lists is recorded and forgotten, with what was known of it.
