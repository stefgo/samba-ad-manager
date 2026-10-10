# Security

SADM manages a directory. Whoever controls it controls the domain — which is why the
following is spelled out rather than left implicit.

## What the server can do

The server holds no credentials of the directory and never talks to a domain controller. It
asks an agent to carry out one of a fixed list of actions: measure, run the database check,
read objects, and make the changes listed under [Directory](directory.md). There is no
action that runs a command or passes LDAP through.

Whoever takes over the server can do exactly that, with the rights of the accounts the
agents are configured with. What stands in the way is on the agents' side.

## What limits it, on the domain controller's side

- **`directory.readOnly`** — the agent changes nothing, whatever it is asked.
- **`directory.enabled: false`** — the agent answers nothing about the directory.
- **Protected objects** — the agent reads an object before it changes it and refuses the
  ones the directory cannot do without.
- **The account's own rights** — see below.

None of these can be changed from the server.

## The account the agent uses

The agent binds to the directory as the account in `ldap.bindDn`. What SADM can change is
what that account may change. `Administrator` works and is the widest choice. Narrower is an
account of its own with rights delegated on the organizational units SADM is meant to
manage; outside them the directory then refuses, and SADM shows the refusal.

The password is given as `SADM_LDAP_PASSWORD` or, better, as a file named by
`SADM_LDAP_PASSWORD_FILE` (a Docker secret). It is not read from `config.yaml`.

## The certificate

Samba generates a self-signed certificate. The agent refuses it unless told otherwise:

- `ldap.caFile` with Samba's CA (`/var/lib/samba/private/tls/ca.pem`), or
- `ldap.allowSelfSigned: true`, which accepts any certificate.

The connection carries the bind password and every password SADM sets. Prefer the CA file.

## The Docker socket

The agent uses the Docker socket of its host to inspect the Samba container and to run a
Python script inside it that reads replication, the service processes and the database
check. The script is the agent's own and takes one of three fixed words as its argument;
nothing the server sends reaches it.

The socket is root on the host. Treat the agent as root on the domain controller's host.
Without `samba.container` the socket is never opened — the agent then reports what LDAP
alone can tell.

## The dashboard

Everything of the server's own — sessions, the reverse proxy settings, HSTS, who may connect
as an agent — is configured as documented in
[`server/config.example.yaml`](https://github.com/stefgo/samba-ad-manager/blob/main/server/config.example.yaml).
Every account that can log in to SADM can do everything SADM can; there are no roles.

Vulnerabilities are reported as described in
[SECURITY.md](https://github.com/stefgo/samba-ad-manager/blob/main/SECURITY.md).
