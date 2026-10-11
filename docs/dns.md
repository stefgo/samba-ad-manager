# DNS

A Samba domain keeps its DNS zones in the directory. SADM reads and changes them there, over
LDAPS like every other object — whichever server answers DNS for the domain, Samba's own or
BIND with `BIND9_DLZ`, serves what stands in the directory.

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
| **The lock** | A [protected](#what-is-protected) record. |

Two zones that are in the directory are not shown, because they are no zones of the domain:
the root hints (`RootDNSServers`) and the trust anchors a Windows DNS server keeps.

A name that was deleted stays in the directory for a while, marked as gone. It is not shown.

## What can be managed

Records of the types A, AAAA, CNAME, PTR, TXT, MX and SRV can be created, changed and
deleted. A zone itself is not created, changed or deleted from here, and neither are its NS
and SOA records.

| | |
|---|---|
| **New Record** | A name within the zone — `www` for `www.<zone>`, `a.b` for a name with a dot, `*` for everything that has no name of its own — a type, what the record says, and a TTL. A name that does not exist yet is created with its first record. |
| **Edit** | What the record says, and its TTL. The name and the type stay: under another name, or of another type, it is another record. |
| **Delete** | One record. A name whose last record is deleted is removed with it. |

A host name in a record — the target of an alias, a mail server — is written in full:
`www.example.net`, not `www`.

Two rules are checked before anything is written: a name has no record twice, and an alias
(CNAME) stands alone — a name that is one has no other record.

A record a client registered itself can be changed and deleted like any other. A changed one
becomes static: it no longer ages, and the client that registered it will register again
what it thinks is right.

Every change is an event in the activity history — who, which name, what the record says and
said before — and can be forwarded with a [webhook](webhooks.md).

## What is protected

These are shown, with a lock, and are not created, changed or deleted from SADM:

- the zone's own name, `@`: its SOA and NS records and the addresses of the domain
- every name with a label that starts with `_` — `_ldap._tcp`, `_kerberos._udp`, `_msdcs`,
  `_sites` and everything below them — which is where a domain controller is found
- everything in the zone `_msdcs.<forest>`
- `DomainDnsZones` and `ForestDnsZones`
- the A and AAAA records under a domain controller's own name; any other record there, a
  TXT record say, is yours

They are the records the domain controllers register for themselves. A wrong one takes the
domain down, and the domain controller that owns it would put it back anyway.

There is one exception, and it only deletes: a service record, an alias or an address at
such a name that **names no domain controller of the domain**. That is what a domain
controller leaves behind that was removed without being demoted properly — nothing puts it
back, nothing else removes it, and clients that are sent there wait for an answer that does
not come. [Domain Health](health.md#the-records-of-the-domain-controllers) reports such a
record as *Stale DC record*; here it can be deleted.

The protection is part of the server and cannot be switched off. `directory.readOnly: true`
in the server's `config.yaml` switches every change off, these included.

## The serial number

A secondary name server looks at nothing but a zone's serial number: it transfers the zone
when the number has risen. So SADM raises it with every change — a new record, a changed
one, a deleted one, and a TTL that changed, which `samba-tool` does not raise it for.

The number is raised first and the record written second. A change that then fails leaves a
number that was raised for nothing; the other order would leave a change no secondary sees.

A domain controller's own DNS server raises the same number for every dynamic update. SADM
therefore does not write the SOA record over: it takes out the value it read and puts in the
new one, in one request, which the directory refuses when the value changed in between —
then it reads again. A record that somebody else changed while its dialog was open is
refused the same way, and nothing is written.

**A change reaches a secondary at its next refresh, not at once.** The domain controllers
answer with it immediately. But BIND sends a secondary a NOTIFY only for the changes it makes
itself, and a change made in the directory — by SADM as by `samba-tool` — is none of those.
The note after a change says how often the zone's secondaries ask.

## Who serves a zone

A zone's page lists who answers for it — the domain controllers, and the secondaries that
transfer it — each with the serial number it serves. *In-step* is the serial number the
domain controllers have; *Catching-up* is another one, for no longer than the zone allows;
*Behind*, *Ahead* and *Not-answering* are [findings](health.md#name-servers-that-are-no-domain-controllers).
The list of zones says the same for each zone in one badge.

This is measured, not read on request: it is as old as the last measurement, which
*Measure now* on a domain controller's page renews.

## Where it is read

On the domain controller every other question about the directory goes to — the PDC emulator
where it answers, otherwise any other. What another domain controller serves is the same
once replication has carried it there; see [Domain Health](health.md) for how replication is
doing.

The account the server binds as needs to read the DNS partitions. Every authenticated
account of the domain may, unless that was taken away. To change records it needs to write
there — see [Security](security.md#the-account-the-server-uses).
