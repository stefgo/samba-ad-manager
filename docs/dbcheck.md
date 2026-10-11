# Database Check

Samba's database check — `samba-tool dbcheck` — reads the local database of a domain
controller. It cannot be run over the network, so it is the one measurement SADM does not
take itself: a small script on the domain controller runs the check and reports the result
to the server.

This is optional. A domain controller that reports no check is measured like every other;
the dashboard then simply shows none.

## What the script does

[`sadm-dbcheck.py`](scripts/sadm-dbcheck.py) runs the check Samba's own tool runs,
**read-only**: nothing is fixed and no transaction is opened. It then sends five values to
the server:

| | |
|---|---|
| `dcId` | Which domain controller this is: the GUID of its NTDS settings, read from its database. |
| `checkedAt` | When the check finished. |
| `errors` | How many errors the check counted; `null` when the check itself failed. |
| `durationMs` | How long it took. |
| `error` | Why there is no count, where there is none. |

It needs Python 3 and Samba's own Python modules, which every Samba AD DC has, and nothing
else. It is one file; read it before you install it.

## 1. Issue a token

Open the domain controller's page in SADM and choose *Issue report token* on the *Database
Check* card. The token is shown once. It lets its holder report the database check of this
one domain controller and nothing else: a report that names another domain controller is
refused.

From that moment a report is expected. One that stays away longer than the threshold
(*Settings* → *Domain Health*, 36 hours by default) is the finding *Database check overdue* —
so a cron job that died is noticed rather than read as "no errors".

## 2. Install the script

Copy `sadm-dbcheck.py` to the domain controller and keep the token in a file only root reads:

```bash
install -m 755 sadm-dbcheck.py /usr/local/sbin/sadm-dbcheck.py
install -m 600 /dev/null /etc/sadm-dbcheck.token
echo '<the token>' > /etc/sadm-dbcheck.token
```

The script takes its settings from the environment:

| Variable | |
|---|---|
| `SADM_URL` | Where the SADM server is: `https://sadm.example.net`. |
| `SADM_TOKEN` or `SADM_TOKEN_FILE` | The token, or a file that holds it. |
| `SADM_CA_FILE` | Optional: a PEM file with the CA of the server's certificate, where the system does not know it. |

Run it once by hand. It prints what it reported, and the result shows on the domain
controller's page:

```bash
SADM_URL=https://sadm.example.net SADM_TOKEN_FILE=/etc/sadm-dbcheck.token /usr/local/sbin/sadm-dbcheck.py
```

## 3. Let cron run it

### Samba installed on the host

`/etc/cron.d/sadm-dbcheck`:

```
SADM_URL=https://sadm.example.net
SADM_TOKEN_FILE=/etc/sadm-dbcheck.token
17 3 * * * root /usr/local/sbin/sadm-dbcheck.py
```

### Samba in a container

The script has to run where Samba's database and Python modules are: inside the container.
Keep script and token on the host and hand both in — the script on standard input, the token
in the environment:

`/etc/cron.d/sadm-dbcheck`:

```
17 3 * * * root docker exec -i -e SADM_URL=https://sadm.example.net -e SADM_TOKEN="$(cat /etc/sadm-dbcheck.token)" samba python3 - < /usr/local/sbin/sadm-dbcheck.py
```

`samba` is the name of the container, as `docker ps` shows it.

Once a day is plenty: the check walks every object of the directory and takes minutes on a
large one. Give each domain controller another minute of the hour.

## When something is wrong

The script exits with 0 once the result is reported, whatever the check found, and with 1
when it could not report — which cron mails to root.

| It says | |
|---|---|
| `the server refused the report (HTTP 401)` | The token is not one the server issued, or it has been replaced or removed since. |
| `the server refused the report (HTTP 403)` | The token belongs to another domain controller. |
| `the server could not be reached` | `SADM_URL`, the network, or the certificate — set `SADM_CA_FILE`. |
| `the database could not be opened` | The script does not run where Samba's database is, or not as root. |

## Replacing and removing the token

*New token* on the *Database Check* card issues another one; the old one stops working at
once, so the file on the domain controller has to follow. *Stop expecting reports* removes
the token, forgets the last reported check and ends the finding about a late report. The
cron job on the domain controller keeps running until it is removed there; its reports are
refused.
