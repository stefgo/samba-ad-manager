# DNS

A Samba domain keeps its DNS zones in the directory. SADM reads them there, over LDAPS like
every other object — whichever server answers DNS for the domain, Samba's own or BIND with
`BIND9_DLZ`, serves what stands in the directory.

## What is shown

*DNS* lists every zone the directory holds: its name, how many names it has, its serial
number and refresh interval, the name servers it lists, and where it is kept.

| Kept in | |
|---|---|
| Domain | The partition `DomainDnsZones`, replicated to every DNS server of the domain. |
| Forest | The partition `ForestDnsZones`, replicated to every DNS server of the forest. This is where `_msdcs.<forest>` lives. |
| Domain partition | Below `CN=System` of the domain itself, where a domain that was upgraded from an old one may still have its zones. |

A zone's page shows every record of every name in it, one row per record, with its type,
what it says, its TTL and whether it was entered or registered.

| | |
|---|---|
| **Types** | A, AAAA, CNAME, PTR, NS, TXT, MX, SRV and SOA are read. A record of any other type is shown as `TYPE<number>` with its data in hexadecimal. |
| **Registered** | *Static* for a record somebody entered. For a record a client registered itself — a dynamic update — when it last did. |
| **The lock** | A record a domain controller registered for itself: the zone's own records, every name a service is found under (`_ldap._tcp`, `_kerberos._udp`, …), everything in `_msdcs.<forest>`, `DomainDnsZones` and `ForestDnsZones`, and the addresses under a domain controller's name. |

Two zones that are in the directory are not shown, because they are no zones of the domain:
the root hints (`RootDNSServers`) and the trust anchors a Windows DNS server keeps.

A name that was deleted stays in the directory for a while, marked as gone. It is not shown.

## Who serves a zone

A zone's page lists who answers for it — the domain controllers, and the secondaries that
transfer it — each with the serial number it serves. *In step* is the serial number the
domain controllers have; *Catching up* is another one, for no longer than the zone allows;
*Behind*, *Ahead* and *Not answering* are [findings](health.md#name-servers-that-are-no-domain-controllers).
The list of zones says the same for each zone in one badge.

This is measured, not read on request: it is as old as the last measurement, which
*Measure now* on a domain controller's page renews.

## Where it is read

On the domain controller every other question about the directory goes to — the PDC emulator
where it answers, otherwise any other. What another domain controller serves is the same
once replication has carried it there; see [Domain Health](health.md) for how replication is
doing.

The account the server binds as needs to read the DNS partitions. Every authenticated
account of the domain may, unless that was taken away.
