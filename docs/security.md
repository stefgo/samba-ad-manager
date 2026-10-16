# Security

SADM manages a directory. Whoever controls it controls the domain — which is why the
following is spelled out rather than left implicit.

## What the server can do

The server holds one account of the directory and talks to every domain controller itself:
it reads over LDAPS, asks DNS and Kerberos whether they answer, and makes the changes listed
under [Directory](directory.md). It runs nothing on a domain controller: there is no shell
and no remote command. Where a domain controller carries the [agent](agent.md), the server
can ask it for three things and nothing else — see [below](#the-agent).

Whoever takes over the server holds that account's password and can do in the directory what
that account may do. That is the weight of this design, and what stands against it is below.

## What limits it

- **The account's own rights** — the one limit that is enforced by the domain itself, and so
  the one that holds whatever happens to the server. See below.
- **`directory.readOnly`** — the server changes nothing. Checked on every change, at the
  last step before the directory, and before an agent is asked to fix its database.
- **`directory.enabled: false`** — the server shows no object of the directory at all.
- **Protected objects** — every change first reads the object it is about to change and
  refuses the ones the directory cannot do without.

`readOnly` and `enabled` are read from `config.yaml` at start and nowhere else. No page of
the dashboard and no route of the API sets them: an attacker who gets hold of a login of SADM
cannot switch writing back on. An attacker who can rewrite the server's files can — against
that one, only the account's rights help.

## The account the server uses

The server binds to the directory as the account in `directory.bindDn`. What SADM can change
is what that account may change. `Administrator` works and is the widest choice. Narrower is
an account of its own with rights delegated on the organizational units SADM is meant to
manage; outside them the directory then refuses, and SADM shows the refusal.

Changing DNS records takes the right to write in the DNS partitions. Members of `DnsAdmins`
have it, as has `Administrator`; an account without it gets the directory's refusal, and
SADM shows it.

Measuring needs less than managing. Reading the FSMO roles, the list of domain controllers,
the replication state (`repsFrom`, `repsTo`) and the [DNS zones](dns.md) takes an account
that may read the directory's partitions — for a server that only watches, give it that and set
`directory.readOnly: true`.

The password is given as `SADM_LDAP_PASSWORD` or, better, as a file named by
`SADM_LDAP_PASSWORD_FILE` (a Docker secret). It is not read from `config.yaml` and not stored
in the database.

## The certificates

Samba generates a self-signed certificate for each domain controller. The server refuses
them unless told otherwise:

- `directory.caFile` — one PEM file with the CA of every domain controller
  (`/var/lib/samba/private/tls/ca.pem` on each), or
- `directory.allowSelfSigned: true`, which accepts any certificate.

A certificate from a public CA, such as Let's Encrypt, needs neither: the server trusts the
public CAs that Node.js ships with, and `caFile` adds to them rather than replacing them. Domain controllers
with either kind of certificate can be in one domain.

A certificate is checked against the domain controller's name. A domain controller of a
private realm cannot get a certificate from Let's Encrypt for that name; one for the name
applications reach the directory under is accepted instead, when that name is listed in
`directory.serviceUrls` — see [Central names](configuration.md#central-names). That widens
which names count, not which certificates: one for such a name from a trusted CA is what a
domain controller has to present, and anybody else who can get one could present it as well.
Only list names that are yours.

The connections carry the bind password and every password SADM sets. Prefer the CA file.

## What the server sends to a domain controller

| | |
|---|---|
| LDAPS, 636 | Reads and changes, as the account above. One more connection per measurement reads the rootDSE without a bind. |
| DNS, 53 | One query for the SOA record of every zone the directory holds. |
| Kerberos, 88 | One request for a ticket for `sadm-health-probe`, a principal that does not exist. No password is involved, and no account's failed-logon counter moves. The KDC's log shows it. |
| 135, 389, 445, 464, 3268 | A connection that is closed again at once. |
| TLS, 636 | A handshake, at the replication interval, to read the certificate. Nothing is sent over it. |

To the [central URLs](health.md#central-urls), at the same interval: a read of the rootDSE
without a bind, and a TLS handshake — over LDAPS, or after StartTLS for an `ldap://` URL.
No password goes to them. The rootDSE of an `ldap://` URL is read unencrypted; it is what
the directory tells anyone.

The same query goes to every name server a zone lists that is no domain controller, and to
the ones named in `health.dnsServers`: its SOA record for each zone it is responsible for.
Nothing else is sent to a server that is not a domain controller.

## The agent

The [agent](agent.md) is optional, and the one thing of SADM that runs on a domain
controller: a process in its container, as root, next to the directory's database. It reads
— Samba's services, supervisord's programs, the storage, the sysvol — and runs Samba's
database check read-only. It holds no account of the directory.

What the server can ask of it is to report now, to run the database check now, to fix what
the check finds, and to replicate now from its partners. No request carries anything a login
of the dashboard chooses freely, so none can be turned into a command: the fix and the
replication carry how often to try again and how far apart -- numbers within fixed bounds,
which the agent checks and refuses the request over -- and an id the server made.

The fix is the one thing the agent writes: what `samba-tool dbcheck --cross-ncs --fix --yes`
writes, to that domain controller's database, in one transaction. Two switches hold it back,
and neither can be set from the dashboard. The agent offers it, and obeys a request for it,
only where `SADM_DBCHECK_ALLOW_FIX` (or `report.dbcheckAllowFix`) is set on the domain
controller — off by default, and the decision of whoever runs the domain controller. The
server does not ask for it while `directory.readOnly` is set; a fix under way is tried again by
the agent without being asked anew, and `directory.readOnly` changes only with a restart of
the server. Every request is recorded with who made it.

Whoever takes over the server can make an agent run its database check more often than it
should, and — where the domain controller allowed it — have it apply Samba's own fixes; and
nothing else.

An agent is registered for one domain controller and says which one it runs on; the server
refuses one that names another. It registers with a token that is issued on the domain
controller's page — good for that one, for one registration and for an hour — or is dialled
by the server and presents a setup PIN that is printed in its log. The server keeps every
token as its hash. Whoever holds an agent's identity can make SADM show wrong local
readings for that one domain controller, and nothing else.

An agent that dials the server listens nowhere. One the server dials listens on a port of
the domain controller; `allowedNetworks` in its configuration limits who may connect, and
its register and status pages are off unless switched on.

## The dashboard

Everything of the server's own — sessions, the reverse proxy settings, HSTS — is configured
as documented in
[`server/config.example.yaml`](https://github.com/stefgo/samba-ad-manager/blob/main/server/config.example.yaml).
Every account that can log in to SADM can do everything SADM can; there are no roles.

Vulnerabilities are reported as described in
[SECURITY.md](https://github.com/stefgo/samba-ad-manager/blob/main/SECURITY.md).
