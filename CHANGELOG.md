## 1.0.0 (2026-10-26)

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
serious a finding is says the badge beside it. In the list of domain controllers, whose
status column says how each is doing, the dot says only whether it answers: green or red,
grey until it has been measured.

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

### Features

* **activity:** Show repeated activity rows as one row with a count ([97a4d7f](https://github.com/stefgo/samba-ad-manager/commit/97a4d7f629b166d2b95eedeb3af37a8270e8b87d))
* **activity:** Show the findings of an incident in its row ([d957840](https://github.com/stefgo/samba-ad-manager/commit/d9578404b1ad0c55f6f3da21d8c404585ba1ccd4))
* Add an optional agent in the domain controller's container ([580b3de](https://github.com/stefgo/samba-ad-manager/commit/580b3decee37542a0731b7e5d863b1bbbc68c194))
* **agent:** Add an agent through one flow and manage it from the page header ([d90d5fb](https://github.com/stefgo/samba-ad-manager/commit/d90d5fb25f68f10f5eae1544381ccb1368f37536))
* **agent:** Fix what the database check finds, where the domain controller allows it ([001c3e8](https://github.com/stefgo/samba-ad-manager/commit/001c3e8fb1e0746d7e130236fab11c50244d7b8f))
* **agent:** Have a domain controller replicate from its partners on request ([296fb9a](https://github.com/stefgo/samba-ad-manager/commit/296fb9a071d42b1de2fd3970faa8a4c843829deb))
* **agent:** Have the agent try a fix or a replication again until it succeeds ([4921dfe](https://github.com/stefgo/samba-ad-manager/commit/4921dfeaf6bb1d18b65802b85d0ffad216ca6109))
* **dashboard:** Copy the domain's name and DN, and drop the monospace type ([8b854d3](https://github.com/stefgo/samba-ad-manager/commit/8b854d30f7aeee18235b1805b51f43948fdd87d8))
* **dbcheck:** Check every partition, not the domain's alone ([67a2c7d](https://github.com/stefgo/samba-ad-manager/commit/67a2c7d797ec7c54b3e46886c7d91b613273fe72))
* **directory:** Accept a central name in a domain controller's certificate ([34b3791](https://github.com/stefgo/samba-ad-manager/commit/34b3791b2c89dd4bfd5bd8b3b807d524965635ca))
* **directory:** Page through what lives in a container ([4daf2b2](https://github.com/stefgo/samba-ad-manager/commit/4daf2b23b3e32f32f19449e35d9cf40e212bb6f5))
* **dns:** Create, change and delete DNS records ([7ced2b9](https://github.com/stefgo/samba-ad-manager/commit/7ced2b96b5d376a2e4cc4ceacbc131aef89e9bb9))
* **dns:** Show a zone's state in the list as one short badge ([4de52dc](https://github.com/stefgo/samba-ad-manager/commit/4de52dc62027ccfcb11785613b87a3bb75bccac1))
* **dns:** Show the DNS zones the directory holds ([17c8ab0](https://github.com/stefgo/samba-ad-manager/commit/17c8ab04979b907a7cca2af4a200084ad743b2a8))
* **domain-controllers:** Show only reachability in the list's status dot ([b0d95a9](https://github.com/stefgo/samba-ad-manager/commit/b0d95a9e32d5b400264450649a6da27c55a83c38))
* **domaincontrollers:** Copy a domain controller's names, and drop the monospace type ([2f7fb8a](https://github.com/stefgo/samba-ad-manager/commit/2f7fb8aa82d11c0ed0153f94b31958ee1e7c6d8f))
* **domaincontrollers:** Show the FSMO badge without the number of roles ([f751ebb](https://github.com/stefgo/samba-ad-manager/commit/f751ebbe9ed54bdec17a6a41b242891a4fb52936))
* Draw the app icon as a forest of three domains ([f4dfbbd](https://github.com/stefgo/samba-ad-manager/commit/f4dfbbd9c4dfec57c6d5d25f7dab8d2bf936d722))
* **health:** Ask every name server of the domain for every zone ([4ea608e](https://github.com/stefgo/samba-ad-manager/commit/4ea608e3750283aa90645fedee29b25e039521e9))
* **health:** Check the DNS records the domain controllers register ([1a20045](https://github.com/stefgo/samba-ad-manager/commit/1a2004568191608c9fdec2d89e4ece9603eea49d))
* **health:** Measure every domain controller at once from the list ([7bcbb23](https://github.com/stefgo/samba-ad-manager/commit/7bcbb23ea2e0d9a93e7caa971f2745c9609039b9))
* **health:** Measure the central URLs and the certificates ([5227220](https://github.com/stefgo/samba-ad-manager/commit/522722067809587b3928ce38503bcaaf5e11adf5))
* **health:** Report a finding only once it has lasted, with waits set per kind ([a4d6c8f](https://github.com/stefgo/samba-ad-manager/commit/a4d6c8fb6919d474ef318a2f49b4692afb88a176))
* **health:** Report findings as one incident per domain controller ([abb4018](https://github.com/stefgo/samba-ad-manager/commit/abb40188a3e3e3512388a91417b4bea7bfbb8866))
* **health:** Show in a domain controller's dot whether it is there ([e0e7f98](https://github.com/stefgo/samba-ad-manager/commit/e0e7f9886d3f104d002f1d75ff77b17ea876b196))
* List the domain controllers first under Directory in the sidebar ([3b61e4a](https://github.com/stefgo/samba-ad-manager/commit/3b61e4aa9c338f3251309771822ddc7f11a51df5))
* Manage users, groups, computers and organizational units ([24983c0](https://github.com/stefgo/samba-ad-manager/commit/24983c0175f33ccc1b1ea2e17fc7765d37530fab))
* Measure and manage the domain from the server, without an agent ([5818465](https://github.com/stefgo/samba-ad-manager/commit/5818465a4c981e175195bfe8ffda592839d55389))
* Measure the health of every domain controller ([023d0b9](https://github.com/stefgo/samba-ad-manager/commit/023d0b9cc4e1817f228ebb7153d1173ad5fedb29))
* Read and change the directory through the agents ([f3963b0](https://github.com/stefgo/samba-ad-manager/commit/f3963b0df2787073f77b0c83ebd5722f43fda6e9))
* Report findings as events, with thresholds and documentation ([a6b697c](https://github.com/stefgo/samba-ad-manager/commit/a6b697ce250dbe8d729dd70641af5ccf1728c94f))
* Say when an agent has nothing to measure from ([c2951bf](https://github.com/stefgo/samba-ad-manager/commit/c2951bfc689257ba0e99d1011f43c0e777a7b131))
* **server:** Store the registration token on its domain controller ([e7b38c5](https://github.com/stefgo/samba-ad-manager/commit/e7b38c51c238ad8b938ce3c5277fbb1dfd203204))

### Bug Fixes

* **activity:** Wrap long messages instead of widening the table ([0f8a971](https://github.com/stefgo/samba-ad-manager/commit/0f8a971bb9e308943310e17e7782bcd91278ea6f))
* **agent:** Say a policy's sysvol state without a version it does not have ([6205998](https://github.com/stefgo/samba-ad-manager/commit/62059983affcb82fc65d94f8fc14fc9a39f369aa))
* **directory:** Delete a user or computer with what lives below its account ([f84a123](https://github.com/stefgo/samba-ad-manager/commit/f84a123775638038717f9d79cf9e1984401025d8))
* **directory:** Open an object from anywhere in its row ([3936b22](https://github.com/stefgo/samba-ad-manager/commit/3936b22910e5996a324b88d550c4bf51cea3d4fc))
* **directory:** Trust the public CAs next to the CA file, not instead of them ([c8cc1cd](https://github.com/stefgo/samba-ad-manager/commit/c8cc1cd9e92bbb49c1eaa1481ead747598ddcaca))
* **domain-controllers:** Set the DNS name in the list in the size of the other columns ([08c3104](https://github.com/stefgo/samba-ad-manager/commit/08c31045cff557143316e1ab3505962b9bca1aa3))
* **health:** Do not hold an unreachable partner against a domain controller ([9c638c6](https://github.com/stefgo/samba-ad-manager/commit/9c638c602bb250cef8d495004eeedc9878840d89))
* Update the UI library so wrapped table text sits 20px apart ([3309cc5](https://github.com/stefgo/samba-ad-manager/commit/3309cc5eba387d426e33631deaea0969b09ef59c))
* Update the UI library to 4.10.0 ([b638594](https://github.com/stefgo/samba-ad-manager/commit/b638594872fed6d77fb0b2326b87926a6efdf57c))
* Update the UI library to 4.12.0 ([fd3e9a3](https://github.com/stefgo/samba-ad-manager/commit/fd3e9a339c262de53af2d3f4295ec7d599ac5079))
