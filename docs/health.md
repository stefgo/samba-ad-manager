# Domain Health

The server measures every domain controller of the domain over the network and keeps the
last measurement of each. Laid next to each other they show what no single domain controller
can see. A domain controller that carries the [agent](agent.md) adds what the network does
not show.

## What is measured

| | Source | How often |
|---|---|---|
| Name, DNS name, site, Samba version, global catalog, synchronized, highest USN | LDAP rootDSE | every measurement |
| The clock | `currentTime` in the rootDSE against the server's clock | every measurement |
| Functional levels, the holders of the seven FSMO roles, the domain controllers of the forest | LDAP | every measurement |
| Whether each service answers | see below | every measurement |
| Replication, inbound and outbound, per naming context | `repsFrom` and `repsTo`, over LDAPS | the replication interval |
| Whether its DNS server answers for every zone the directory holds, and with which serial number | the zones from LDAP, each asked for over DNS | the replication interval |
| The name servers that are no domain controllers — see [below](#name-servers-that-are-no-domain-controllers) | DNS | the replication interval |
| The DNS records every domain controller registers for itself — see [below](#the-records-of-the-domain-controllers) | the zones, over LDAPS | the replication interval |
| How many users, groups and computers there are | LDAP | the replication interval |
| The group policies and the version each should have in the sysvol | LDAP | the replication interval |
| The certificate its LDAPS presents: for whom, by whom, until when | a TLS handshake on 636 | the replication interval |
| The names applications reach the directory under — see [below](#central-urls) | LDAP and TLS | the replication interval |
| Which of Samba's services run, the programs of its supervisor, the storage, the group policies in the sysvol | [the agent](agent.md), where a domain controller has one | every 30 seconds; sent when it changed, and once a minute |
| The database check (`dbcheck`, read-only) | [the agent](agent.md#the-database-check) | once a day, and when *Check now* is chosen |

A measurement is taken every 60 seconds and when *Measure now* is chosen -- on a domain
controller's page for that one, above the list of domain controllers for all of them. What is
read at the replication interval, every 300 seconds, is carried over in between. Both are
settings, under *Settings* → *Domain Health* → *Measuring*, and a change applies from the next
round on.

A part that cannot be read is left out, the rest is still reported. The domain controller's
page lists what is missing and why under *Not Measured*.

### How a service is asked

| Service | Port | How |
|---|---|---|
| LDAPS | 636 | The rootDSE is read, on a connection of its own and without a bind. |
| DNS | 53 | The SOA record of the domain is asked for, without recursion. It counts when the server answers with authority — as one that holds the zone. |
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

Where a domain controller has an agent, *Replicate now* has it pull every inbound link at
once instead of at Samba's next round — see [the agent](agent.md#replicating-now).

### DNS zones

The service check above asks for one zone, the domain's. A domain controller's DNS server
answers for every zone its directory holds, so each of them is asked for as well: the list
comes from the directory, the question goes to DNS. The answer has to carry authority and
the zone's SOA record, whose serial number is kept.

The two DNS partitions are replicated like any other part of the directory. A domain
controller that serves an older serial number than the others has not replicated a change
yet; one that stays there has a replication link that fails or is stale, and that is the
finding.

### Name servers that are no domain controllers

A zone may list name servers that are not domain controllers: secondaries, which transfer
the zone from a domain controller and answer for it. SADM finds them in the NS records of
the zones and asks each of them for every zone that lists it. A secondary no zone lists — a
hidden one — is named in [`health.dnsServers`](configuration.md#health--name-servers-to-ask); it is
asked for every zone and kept for the ones it answers for.

A secondary only looks at a zone's serial number. It asks for it once per refresh interval
and transfers the zone when the number has risen — so it is behind after every change, until
it next asks. That is how it is meant to work and no finding. What is one:

- A secondary that has another serial number than the domain controllers **and whose own has
  not moved** for longer than one refresh and one retry of the zone. A busy zone that a
  secondary keeps following is never reported, however far ahead the domain controllers are
  at any moment. The two intervals are taken from the zone's SOA record, and not below 300
  and 500 seconds: BIND does not ask more often than that unless it is told it may.
- A secondary with a **higher** serial number than every domain controller, for as long. It
  transfers nothing until the domain controllers pass it. This happens where the serial
  number has gone back: every domain controller counts for itself, and replication lets one
  count win.

The serial number a secondary is compared with is the highest any domain controller serves.

A change made over LDAP — by SADM, or by `samba-tool` — raises the serial number, but no
server sends the secondaries a NOTIFY for it. They pick it up at their next refresh.

### Central URLs

Applications often reach the directory under a name of its own rather than through one
domain controller: that of a virtual address that moves between them, `ldap.example.net`
say, in any domain. The URLs in
[`directory.serviceUrls`](configuration.md#central-names) are asked, at the replication
interval:

| URL | How |
|---|---|
| `ldaps://` | A TLS handshake, and the certificate is checked against the URL's host. Then the rootDSE is read without a bind. |
| `ldap://` | The rootDSE is read without a bind, unencrypted. Then a second connection asks for StartTLS and checks the certificate as above — what an application that uses StartTLS needs. |

The rootDSE says which domain controller answered: the one that holds the address at the
moment. The dashboard shows it next to the URL, and when the certificate expires. SADM does
not work through these URLs; it talks to every domain controller under its own name.

### The records of the domain controllers

A domain controller is found through DNS and through nothing else: a client asks for
`_ldap._tcp.dc._msdcs.<domain>`, a replication partner for `<GUID>._msdcs.<forest>`. Every
domain controller puts its own records there and keeps them there — Samba's
`samba_dnsupdate` works off a list every ten minutes. When that stops working, nothing says
so. The records of a domain controller that joined last week are simply missing, and
replication to it fails with an error about a name.

SADM expects of each domain controller what that list
([`dns_update_list`](https://github.com/samba-team/samba/blob/master/source4/setup/dns_update_list))
has Samba register for it:

| | Which domain controller |
|---|---|
| An address under its own name | every |
| The alias `<GUID of its NTDS settings>._msdcs.<forest>` | every |
| `_ldap._tcp` and `_kerberos._tcp` under `<site>._sites.<domain>` and `<site>._sites.dc._msdcs.<domain>` | every |
| Its address under `<domain>`; `_ldap._tcp`, `_kerberos._tcp`, `_kerberos._udp`, `_kpasswd._tcp` and `_kpasswd._udp` under `<domain>`; `_ldap._tcp` and `_kerberos._tcp` under `dc._msdcs.<domain>`; `_ldap._tcp.<GUID of the domain>.domains._msdcs.<forest>` | every writable one |
| `_ldap._tcp.pdc._msdcs.<domain>` | the PDC emulator |
| Its address under `gc._msdcs.<forest>`; `_gc._tcp.<forest>`, `_ldap._tcp.gc._msdcs.<forest>` and the two under `<site>._sites` | a global catalog |
| An NS record of the zone; its address under `DomainDnsZones.<domain>`; `_ldap._tcp.DomainDnsZones.<domain>` and the one under `<site>._sites` — and the same for `ForestDnsZones.<forest>` and `_msdcs.<forest>` | one that holds the DNS partition |

A read-only domain controller registers the records of its site and its alias, and nothing
it would have to be writable for.

The records are looked up in the directory of every domain controller that answers, each in
its own copy. Where one copy lacks a record the others have, the finding says which.

A domain controller that has just joined is not held to its records for half an hour.

The same names are looked at the other way round: a service record or an alias there that
names a host the directory does not list as a domain controller, or an address under one of
the shared names that is no domain controller's. That is what a demotion that was not
finished leaves behind — and where clients are sent that then wait for an answer.

## Findings

| Finding | Severity | |
|---|---|---|
| Domain controller unreachable | error | None of its services answers. Nothing else is reported for that domain controller: it would only repeat this. |
| Service does not answer | error / warning | Error for a service a domain controller needs, warning for Kerberos password change and the global catalog. |
| Not synchronized | warning | The domain controller has not finished its initial replication. |
| Replication failing | error | Per partner, with the number of consecutive failures and the error of the worst link. Not reported while the partner is unreachable: that is the partner's finding. |
| Replication stale | warning | The last success from a partner is older than the threshold, or there never was one. Not reported while the partner is unreachable. |
| FSMO role missing | error | No domain controller names a holder. |
| FSMO role conflict | error | The domain controllers disagree about the holder. |
| Clock offset | error | Beyond the threshold. |
| Database check | warning | The check counted errors, or could not be run. |
| Database check overdue | warning | A domain controller whose agent runs the check has reported none for longer than the threshold. |
| Agent offline | warning | A domain controller has an agent, and it is not connected. What the agent last read is not judged meanwhile: it describes the moment it left. |
| Samba service not running | error | A service `smb.conf` has the `samba` process start is not registered with it: Kerberos, LDAP, replication (`drepl`), the topology checker (`kcc`), DNS registration and the like. Sees what no port shows. |
| Process not running | error | A program of the container's supervisord — Samba, BIND — is not running. |
| Process restarting | warning | A program has started three times or more within an hour. |
| Storage low | warning / error | Less than 15 % of the storage Samba's databases live on is free, or less than 5 %. A full volume damages the directory's database. |
| Sysvol out of step | warning | A group policy is in the sysvol of this domain controller in another version than its directory says, or not at all. One finding per domain controller. Samba does not replicate the sysvol; a policy that changed within the last half hour is not held against it. |
| DNS zone not served | error | A domain controller's DNS server does not answer with authority for a zone its directory holds. Not reported while its DNS service does not answer at all. |
| Name server does not answer | error / warning | A name server that is no domain controller does not answer, or not with authority for a zone that lists it — also the NS record a removed domain controller left behind, and a secondary whose copy of the zone has expired. Error for a server a zone lists, warning for one only `health.dnsServers` names. |
| Secondary behind | warning | See [above](#name-servers-that-are-no-domain-controllers). The text names both serial numbers. |
| Secondary ahead | warning | The secondary's serial number is higher than every domain controller's, and it transfers nothing. |
| DC records missing | error / warning | A domain controller lacks [records it registers for itself](#the-records-of-the-domain-controllers). One finding per domain controller, with how many and the first of them. Error when its address, its alias or a record under `dc._msdcs` is among them — what it is not found without — otherwise warning. Run `samba_dnsupdate --verbose` on that domain controller to see why it does not register. |
| Stale DC record | warning | DNS names a host or an address as a domain controller that the directory does not list as one. One finding per host. |
| Certificate expiring | warning / error | A certificate expires in less than 14 days, or less than 3 days, or has expired: that of a domain controller's LDAPS, or one a [central URL](#central-urls) presents. A certificate from Let's Encrypt that is renewed on time never comes near; this is the finding for a renewal that stopped. |
| Central URL does not answer | error | The rootDSE cannot be read through a [central URL](#central-urls). |
| Central URL certificate | error | The certificate a central URL presents is not trusted or not issued for its host, or StartTLS is refused. Said once: not again as a certificate that expires. |

The domain is **critical** with any error, **degraded** with any warning, **healthy**
without a finding, and **unknown** while nothing has been measured.

The dot next to a domain controller is coarser than that, because it also says whether the
domain controller is there at all. It is **green** for one that answers and has no finding,
**red** for one that answers on none of its services, **yellow** for one that answers and
has a finding, however serious, and **grey** for one that has not been measured yet.

The thresholds — for the clock, the age of replication and of the database check, the two
for storage and the two for certificates — are settings; see
[Configuration](configuration.md#settings--what-the-settings-page-writes).

The six findings from *Agent offline* down come from the [agent](agent.md) and exist only
for a domain controller that has one.

## When a finding is reported

The dashboard shows a finding as soon as it is measured. The activity history and the
webhooks hear of it once it has lasted **5 minutes**. A service that misses an answer, or a
replication that fails once and succeeds on the next round, is therefore not reported. The
wait is a setting, under *Settings* → *Findings*, and each kind of finding can have one of
its own -- two minutes for *Domain controller unreachable*, a quarter of an hour for
*Replication failing*. A wait of 0 reports at once.

Until a finding is reported, the dashboard says under it when it will be if it lasts; once it
is, since when.

### One incident per domain controller

The findings are reported by **incident**: everything wrong with one domain controller is one
incident, and the findings about no domain controller -- about the domain as a whole, or about
a [name server that is no domain controller](#name-servers-that-are-no-domain-controllers) --
are the incident of the domain. An incident is one row of the activity list, and its events
share a correlation id, so a webhook can tie the all-clear to the alert.

| Event | When |
|---|---|
| `domain.issue_opened` | The first finding of the incident has lasted its wait. |
| `domain.issue_extended` | Another finding of it has lasted its wait while it is open. |
| `domain.issue_escalated` | A reported warning has been an error for as long as its kind's wait: storage that drops below the error threshold for a moment does not count. One that goes back to a warning does so quietly, and becoming an error again is reported again. A finding that became an error before it was reported is reported as one. |
| `domain.issue_resolved` | Every finding of the incident has been gone for **5 minutes** (a setting as well), with how long the incident lasted. |
| `domain.issue_discarded` | The incident was over before any of its findings was reported. **Off** unless it is given a level under *Settings* → *Activity History* → *Event Levels*. |

A reported finding that goes while others stay is not an event of its own; the all-clear
lists it. A finding that comes back after it was gone is a new one and waits again.

**A finding that comes and goes is one finding.** It counts as there as long as it is never
gone for longer than the wait before the all-clear. A replication that fails every other
round is reported, although it is never there for five minutes in a row; and once reported
its incident is not called off and reported again each time it is briefly gone.

### What an event carries

Every event of an incident lists **all its findings**, with what each went through while the
server watched it: since when it is there, the worst it was, how often it was gone and came
back, and a history of when it appeared, changed its severity, had gaps and went. Repeats are
folded into one line with a count, the way the activity list folds repeated rows, so a
finding that flaps every minute is one line and not hundreds. See
[`event.data` of an incident](webhooks.md#eventdata-of-an-incident).

### After a restart

The incidents that were reported are kept, so a restart neither reports them twice nor
forgets their all-clear. Everything else is the server's memory: a finding that was waiting
starts its wait again, and what a finding went through before the restart is not in the
history of its next event. For 90 seconds after its start the server reports nothing, until
its first measurements are in.

## Domain controllers that join and leave

Which domain controllers there are is read from the directory with every measurement. One
that the directory lists for the first time is recorded in the activity and measured from
then on; one it no longer lists is recorded and forgotten, with what was known of it.
