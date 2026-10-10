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
`client/config.example.yaml`. An agent that was given neither still connects, so it says so:
in its log when it starts, and on the dashboard as a finding of its own. A source that
cannot be read is named in the agent's log when it fails and when it is back.

### Directory management

Users, groups, computers and organizational units can be browsed and changed: create, edit,
rename, move and delete; set a password, enable, disable and unlock an account; add and
remove group members. The organizational units are shown as a tree with what lives in each.

Objects the directory cannot do without -- its built-in accounts and groups, a domain
controller's own account -- can be looked at and are not offered for deletion. Every change
is recorded in the activity with who made it.

`directory.readOnly: true` in an agent's `config.yaml` lets that domain controller be looked
at and not changed; `directory.enabled: false` keeps the directory out of SADM altogether.

### Findings as events, and webhooks

A finding about the domain is recorded in the activity once it has lasted 45 seconds, and
again when it is over -- with how long it lasted. Both can be sent on by a webhook, with a
JSON body of your own; so can every change to the directory. The thresholds for a clock that
is off and for replication that is stale are settings, under *Domain Health*.
