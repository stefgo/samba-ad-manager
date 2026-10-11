# Security

SADM manages a directory. Whoever controls it controls the domain — which is why the
following is spelled out rather than left implicit.

## What the server can do

The server holds one account of the directory and talks to every domain controller itself:
it reads over LDAPS, asks DNS and Kerberos whether they answer, and makes the changes listed
under [Directory](directory.md). It runs nothing on a domain controller — there is no agent,
no shell and no remote command.

Whoever takes over the server holds that account's password and can do in the directory what
that account may do. That is the weight of this design, and what stands against it is below.

## What limits it

- **The account's own rights** — the one limit that is enforced by the domain itself, and so
  the one that holds whatever happens to the server. See below.
- **`directory.readOnly`** — the server changes nothing. Checked on every change, at the
  last step before the directory.
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

Measuring needs less than managing. Reading the FSMO roles, the list of domain controllers
and the replication state (`repsFrom`, `repsTo`) takes an account that may read the
directory's partitions — for a server that only watches, give it that and set
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

The connections carry the bind password and every password SADM sets. Prefer the CA file.

## What the server sends to a domain controller

| | |
|---|---|
| LDAPS, 636 | Reads and changes, as the account above. One more connection per measurement reads the rootDSE without a bind. |
| DNS, 53 | One query for the domain's SOA record. |
| Kerberos, 88 | One request for a ticket for `sadm-health-probe`, a principal that does not exist. No password is involved, and no account's failed-logon counter moves. The KDC's log shows it. |
| 135, 389, 445, 464, 3268 | A connection that is closed again at once. |

## The database check

The [database check](dbcheck.md) is the one thing that runs on a domain controller: a script
of some eighty lines, started by cron, that you install yourself. It reads the local
database, changes nothing, and sends a count to the server.

It reports with a token that is issued per domain controller. The server keeps only the
token's hash. The token allows one thing — reporting the check of that one domain controller
— and a report that names another is refused. Whoever holds it can make SADM show a wrong
count for that domain controller, and nothing else.

## The dashboard

Everything of the server's own — sessions, the reverse proxy settings, HSTS — is configured
as documented in
[`server/config.example.yaml`](https://github.com/stefgo/samba-ad-manager/blob/main/server/config.example.yaml).
Every account that can log in to SADM can do everything SADM can; there are no roles.

Vulnerabilities are reported as described in
[SECURITY.md](https://github.com/stefgo/samba-ad-manager/blob/main/SECURITY.md).
