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

SADM gives an Active Directory that is run by Samba AD domain controllers one dashboard. A
small agent runs next to each domain controller; the server collects what the agents measure
and shows the domain as a whole.

### Domain controller health

Every domain controller is measured once a minute: whether its Samba container runs, who it
is and how it sees its domain, which services answer, how its replication links are doing,
how far its clock is off, and what the daily database check found. The dashboard lays the
measurements next to each other and names what is wrong -- including what no single domain
controller can see, such as two of them disagreeing about who holds a FSMO role.

The agent needs the Docker socket of its host and an account in the directory; see
`client/config.example.yaml`.
