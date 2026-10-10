# Domain Health

Every agent measures the domain controller it stands next to and reports the measurement.
The server keeps the last one per agent and lays them next to each other: that is where
what no single domain controller can see shows up.

## What is measured

| | Source | How often |
|---|---|---|
| The Samba container: state, start time, image, its own health check | Docker API | every measurement |
| Name, DNS name, site, Samba version, global catalog, synchronized, highest USN | LDAP rootDSE | every measurement |
| Functional levels, the holders of the seven FSMO roles, the domain controllers of the forest | LDAP | every measurement |
| Which service ports answer (DNS, Kerberos, RPC, LDAP, SMB, kpasswd, LDAPS, global catalog) | TCP connect | every measurement |
| The Samba service processes | Samba's messaging, inside the container | every measurement |
| Replication, inbound and outbound, per naming context | DRSUAPI, inside the container | `health.replicationInterval` |
| How many users, groups and computers there are | LDAP | `health.replicationInterval` |
| The database check (`dbcheck`, read-only) | Samba's own checker, inside the container | `health.dbcheckIntervalHours`, or on request |
| The clock | The agent's clock against the server's when a measurement arrives | every measurement |

A measurement is taken every `health.interval` seconds, on every new connection to the
server, and when *Measure now* is chosen on a domain controller's page.

A part that cannot be read is left out, the rest is still reported. The domain controller's
page lists what is missing and why under *Not Measured*.

## Findings

| Finding | Severity | |
|---|---|---|
| Agent offline | warning | Nothing is known about that domain controller. Its last measurement is not judged. |
| No agent | warning | The directory lists a domain controller that no agent is registered for. |
| Container stopped | error | Nothing else is reported for that domain controller: it would only repeat this. |
| Container unhealthy | warning | The container's own health check fails. |
| Directory does not answer | error | |
| Samba service not running | error | One of `ldap_server`, `kdc_server`, `rpc_server`, `dreplsrv` has no process. |
| Port closed | error / warning | Error for a port a domain controller needs, warning for kpasswd and the global catalog. |
| Not synchronized | warning | The domain controller has not finished its initial replication. |
| Replication failing | error | Per partner, with the number of consecutive failures and the error of the worst link. |
| Replication stale | warning | The last success from a partner is older than the threshold, or there never was one. |
| FSMO role missing | error | No domain controller names a holder. |
| FSMO role conflict | error | The domain controllers disagree about the holder. |
| Clock offset | error | Beyond the threshold. |
| Database check | warning | The check counted errors. |

The domain is **critical** with any error, **degraded** with any warning, **healthy**
without a finding, and **unknown** while no connected agent has measured.

The two thresholds are settings — see [Configuration](configuration.md#the-server).

## When a finding is reported

The dashboard shows a finding as soon as it is measured. The activity history and the
webhooks are told once it has lasted 45 seconds, and told that it is over once it has been
gone as long. An agent that reconnects within seconds, or a replication attempt that fails
once and succeeds on the next, is therefore not reported.

The two events of one finding share a correlation id, so the activity list shows them as one
row and a webhook can tie the all-clear to the alert.

After a restart the server reports nothing for 90 seconds, while its agents reconnect.
