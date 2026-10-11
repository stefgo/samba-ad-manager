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
Nothing is installed on a domain controller, and nothing has to be registered: a domain
controller that joins the domain is measured from the next minute on.

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
Quick Start. Where the name the directory gives a domain controller does not resolve from
the server, an address can be set for it on its page.

### The database check

Samba's database check reads the local database of a domain controller, so it is the one
measurement that is reported instead of taken: a script from the documentation runs the
check by cron and sends the result to SADM, with a token issued on the domain controller's
page. A report that stays away is a finding of its own. The check covers every partition
the domain controller holds, the DNS zones included.

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

A finding about the domain is recorded in the activity once it has lasted 45 seconds, and
again when it is over -- with how long it lasted. Both can be sent on by a webhook, with a
JSON body of your own; so can every change to the directory and a domain controller that
joins or leaves the domain. The thresholds for a clock that is off, replication that is
stale and a database check that is late are settings, under *Domain Health*.
