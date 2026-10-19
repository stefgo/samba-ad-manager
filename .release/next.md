<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### The first release

SADM gives an Active Directory that is run by Samba AD domain controllers one dashboard. One
server is told where the domain is and as whom to ask. It finds every domain controller in
the directory, measures each of them over the network and shows the domain as a whole.
Nothing has to be installed on a domain controller, and nothing has to be registered: a
domain controller that joins the domain is measured from the next minute on.

### Domain controller health

Every domain controller is measured once a minute: who it is and how it sees its domain,
which of its services answer, how its replication links are doing and how far its clock is
off. The dashboard lays the measurements next to each other and names what is wrong --
including what no single domain controller can see, such as two of them disagreeing about
who holds a FSMO role. *Measure now* takes a measurement at once, of one domain controller
on its page or of all of them above their list.

The dot next to a domain controller says whether it is there and whether all is well: green
for one that answers and has no finding, red for one that answers on none of its services,
yellow for one that answers and has a finding, grey while it has not been measured yet. How
serious a finding is says the badge beside it.

A domain controller that is away is one finding, its own. The others cannot replicate from
it while it is gone, and that is not held against them: they keep their status.

The directory, DNS and Kerberos are asked a real question in their own protocol, not only
whether their port is open. A service that hangs keeps its port open, and that is noticed.

Each domain controller's DNS server is asked for every zone the directory holds. Where a zone
lists name servers that are no domain controllers -- secondaries that transfer the zone --
those are asked as well, and one that does not answer, or that has not picked up a change
for longer than the zone allows, is a finding. They are found in the zones' NS records; a
secondary no zone lists is named in `health.dnsServers`. The server needs port 53 open to
them.

A domain controller is found through the DNS records it registers for itself. Those are
checked against the list Samba registers them from: a domain controller that lacks some is
a finding, and so is a record that still names a domain controller the directory no longer
lists.

The server needs the network open to every domain controller (636, 53, 88, and 135, 389,
445, 464 and 3268) and an account in the directory; see `server/config.example.yaml` and the
Quick Start. Samba's self-signed certificates are trusted through one CA file, which adds to
the public CAs the server trusts anyway: a domain controller with a certificate from Let's Encrypt or another
public CA is accepted without it, next to those that need it. Where the name the directory gives a domain controller does not resolve from
the server, an address can be set for it on its page.

### Central URLs and certificates

Where applications reach the directory under a name of its own -- that of a virtual address,
in any domain --, that name goes into `directory.serviceUrls` (or `SADM_LDAP_SERVICE_URLS`),
as an `ldap://` and an `ldaps://` URL, one name for both or one each. The dashboard lists
them: whether each answers, which domain controller is behind it at the moment, and until
when its certificate holds -- over LDAPS, or after StartTLS for `ldap://`. One that does
not answer, or presents a certificate that is not good for its name, is a finding.

A domain controller's certificate may carry such a name instead of its own. That is what a
certificate from Let's Encrypt for a domain controller of a private realm looks like, and it
is accepted with its chain checked in full.

The certificate of every domain controller's LDAPS is read as well, and shown on its page. A
certificate that expires within 14 days is a warning, within 3 days an error; both are
settings under *Domain Health*. One from Let's Encrypt that is renewed on time never comes
that close.

### The agent

Some things nothing on the network answers for. An optional agent in a domain controller's
container reports them: which of Samba's services run -- replication and the topology
checker included, which listen on no port --, how the programs of its supervisor are doing,
how full the storage of the directory's database is, and which version of every group
policy its sysvol holds. Samba does not replicate the sysvol, so a domain controller whose
copy differs from what its directory describes is a finding.

The agent also runs Samba's database check, read-only and over every partition the domain
controller holds: once a day, and when *Check now* is chosen on the domain controller's
page. A check that stays away is a finding of its own.

Where the check counted errors, *Fix errors* has the agent fix them as `samba-tool dbcheck
--cross-ncs --fix --yes` does, in one transaction, and check again; the page then shows what
is left. This is off unless the domain controller allows it with `SADM_DBCHECK_ALLOW_FIX=true`
in its environment, and the server does not ask for it while `directory.readOnly` is set.
A fix that fails or leaves errors is tried again, twice and ten minutes apart unless set
otherwise under *Agent Requests*; the page says which attempt comes next and when.

After a replication problem was dealt with, *Replicate now* above a domain controller's
inbound links has its agent pull from every partner at once, instead of at Samba's next
round, and the links are measured again right after. A replication in which a link fails is
tried again in the same way, two minutes apart.

Who asked and how it went are recorded in the activity as one row: each attempt that is tried
again is a step of it, and only the outcome counts as a warning or an error -- or that none
arrived in time. Retries need the agent of this release in the domain controller's image; an
older one tries once.

The agent is published as the image `ghcr.io/stefgo/sadm-client`, which holds one directory
for a domain controller's image to copy. *Add Agent* on the domain controller's page asks
which side opens the connection: the agent registers with a token issued there, or it is
dialled by the server with a setup PIN from its log. The token is good once and for 30
minutes; until the agent has registered, the domain controller shows *Awaiting registration*
with *Generate New Token* for a token that was lost or has expired. *Re-register Agent*
replaces an agent that dials in -- one whose volume was lost, say -- and keeps what it
reported. Where the server dials an agent can be changed afterwards. It reads, and the server can ask it for four things only: to report, to
run the check, to replicate now and -- where the domain controller allowed it -- to fix what
the check found.
A domain controller without an agent is measured over the network as before.

### Directory management

Users, groups, computers and organizational units can be browsed and changed: create, edit,
rename, move and delete; set a password, enable, disable and unlock an account; add and
remove group members. The organizational units are shown as a tree with what lives in each.

A user or a computer is deleted together with what lives below its account -- the BitLocker
recovery keys or published printers of a machine, for instance -- and the question before
the deletion says how many objects that are. An organizational unit is deleted only when it
is empty.

Objects the directory cannot do without -- its built-in accounts and groups, a domain
controller's own account -- can be looked at and are not offered for deletion. Every change
is recorded in the activity with who made it.

What SADM may change is what its account in the directory may change. `directory.readOnly:
true` in the server's `config.yaml` lets the directory be looked at and not changed;
`directory.enabled: false` keeps it out of SADM altogether. Neither can be set from the
dashboard.

### DNS records

The DNS zones the directory holds are listed with their serial number and name servers, and
each zone with every record of every name in it. They are read and changed in the directory,
so it makes no difference whether Samba's own DNS server or BIND answers for the domain. A
zone's page also shows who answers for it and with which serial number.

Records of the types A, AAAA, CNAME, PTR, TXT, MX and SRV can be created, changed and
deleted. Every change raises the zone's serial number, so that a secondary name server
transfers the zone at its next refresh, and is recorded in the activity. The records a
domain controller registers for itself are marked and are not changed -- except that one
which still names a domain controller that is gone can be deleted. Zones themselves are not
created or deleted here.

To change records the server's account needs to write in the DNS partitions; members of
`DnsAdmins` may.

### Findings as events, and webhooks

What is wrong is reported by incident: everything wrong with one domain controller is one
incident, and what concerns the domain as a whole another. An incident is recorded in the
activity once a finding of it has lasted five minutes, again when another finding joins it or
a warning lasts as an error, and once more when all of it has been gone as long -- with how
long it lasted. A service that misses an answer, or a replication that fails once, shows on
the dashboard and goes no further. Until a finding is reported, the dashboard says under it
when it will be if it lasts. A problem that comes and goes is reported all the same, as one
finding. Both waits are settings, under *Findings*, and each kind of finding can have a wait
of its own.

Each of these events lists every finding of its incident with what it went through: since
when, the worst it was, how often it was gone and came back, and a short history in which
repeats are counted rather than listed. An incident that was over before it was reported can
be recorded too; it is off unless switched on under *Event Levels*.

The events can be sent on by a webhook, with a JSON body of your own that can list the
findings line by line; so can every change to the directory and a domain controller that
joins or leaves the domain. The thresholds for a
clock that is off, replication that is stale, a database check that is late and storage that
runs low are settings, under *Domain Health*, and so is how often the domain controllers are
measured.

In the activity list, the events of one finding or one operation are one row. Expanded, an
incident's row lists every finding of it -- how bad each got, when it was there, and whether
it was reported --, and the all-clear says how many were only seen and never reported. The
same event repeated one after the other -- a scheduled job that keeps failing -- is one row as
well, with how many times it happened, and expanded, when and how often.
