# Quick Start

This sets up the SADM server and points it at a Samba AD domain. Nothing is installed on the
domain controllers.

## What you need

- Docker with the Compose plugin, on the host of the server
- An account in the directory for the server, and its password — see
  [the account the server uses](security.md#the-account-the-server-uses)
- The network open from the server to every domain controller: 636 for the directory, 53 and
  88 to ask DNS and Kerberos, and 135, 389, 445, 464 and 3268 to see whether those ports open
- The names the directory gives its domain controllers (`dc1.example.net`) resolving on the
  server — or an address for each, set in the dashboard afterwards

## 1. Point the server at the domain

Take `compose.yaml` from the
[repository](https://github.com/stefgo/samba-ad-manager/blob/main/compose.yaml) and set the
domain in its environment:

```yaml
environment:
    - SADM_LDAP_URLS=ldaps://dc1.example.net
    - SADM_LDAP_BIND_DN=sadm@example.net
    - SADM_LDAP_PASSWORD_FILE=/run/secrets/sadm_ldap_password
```

One domain controller is enough: the others are found in the directory. A second URL covers
the day the first one is down.

Put the account's password into `sadm-ldap-password.secret`, alone on one line.

Samba's own certificates are self-signed, and the server refuses them unless told otherwise.
Either collect the CA of every domain controller (`/var/lib/samba/private/tls/ca.pem` on
each) in one PEM file and name it in `SADM_LDAP_CA_FILE`, or set
`SADM_LDAP_ALLOW_SELF_SIGNED=true` — see [Security](security.md#the-certificates).

## 2. Start it

```bash
touch server-config.yaml
docker compose up -d
```

The dashboard answers on port 3020. Log in as `admin` / `admin` and change that password
under *Accounts* first.

## 3. Look at the dashboard

Within a minute every domain controller of the domain shows on the dashboard with its roles,
its replication links and whatever is wrong with it. The directory's pages work as soon as
one domain controller's directory answers.

If a domain controller shows as *unreachable* because its name does not resolve from the
server, open its page and set its address under *Set address*.

If a part of a measurement is missing, the domain controller's page says which and why under
*Not Measured*. If no domain controller appears at all, `docker logs sadm-server` says why
the directory could not be asked.

## 4. Optional: the database check

Samba's database check reads the local database, so it runs on the domain controller itself.
[Database Check](dbcheck.md) describes the script that runs it by cron and reports the result
to the server.
