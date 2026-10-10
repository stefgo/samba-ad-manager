# Quick Start

This sets up the SADM server and one agent next to a Samba AD domain controller that runs in
a Docker container. Further domain controllers get an agent each, the same way.

## What you need

- Docker with the Compose plugin, on the host of the server and on the host of every domain
  controller
- The name of the Samba container on that host (`docker ps`)
- An account in the directory for the agent, and its password — see
  [the account the agent uses](security.md#the-account-the-agent-uses)
- LDAPS (port 636) reachable from the agent's container

## 1. The server

Take `compose.yaml` from the
[repository](https://github.com/stefgo/samba-ad-manager/blob/main/compose.yaml) and start the
server service alone:

```bash
touch server-config.yaml
docker compose up -d sadm-server
```

The dashboard answers on port 3020. Log in as `admin` / `admin` and change that password
under *Accounts* first.

## 2. A registration token

Open *Domain Controllers* → *Add Domain Controller* and follow the wizard. It issues a
registration token and shows it once.

## 3. The agent

On the domain controller's host, in the same `compose.yaml`, set the agent's environment:

```yaml
environment:
    - SADM_SAMBA_CONTAINER=samba                 # as `docker ps` names it
    - SADM_LDAP_URL=ldaps://dc1.example.net
    - SADM_LDAP_BIND_DN=sadm@example.net
    - SADM_LDAP_PASSWORD_FILE=/run/secrets/sadm_ldap_password
```

Put the account's password into `sadm-ldap-password.secret`, alone on one line, and start
the agent:

```bash
touch client-config.yaml
docker compose up -d sadm-client
docker logs sadm-client        # shows the setup PIN
```

Open the agent's own page on port 3021, and register it with the server's URL, the token and
the setup PIN from its log.

## 4. Look at the dashboard

Within a minute the domain controller shows on the dashboard with its roles, its replication
links and whatever is wrong with it. The directory's pages work as soon as one agent with an
account in the directory is connected.

If a part of the measurement is missing, the domain controller's page says which and why
under *Not Measured*.
