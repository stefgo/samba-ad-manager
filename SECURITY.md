# Security Policy

## Supported versions

Only the most recent release receives fixes. There are no maintenance branches for
older versions — if you run an older one, upgrading is the fix.

| Version | Supported |
| :------ | :-------- |
| Latest release | ✅ |
| Anything older | ❌ |

The rolling `:main` image is a development artefact, not a release. Report problems you
find there just the same, but expect the fix to arrive in the next release rather than as
a separate patch.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting instead: go to the
[Security tab](https://github.com/stefgo/samba-ad-manager/security) and choose
**Report a vulnerability**. The report is visible only to the maintainer, and the
discussion stays private until a fix is released.

Helpful things to include:

- Which component is affected — server, client agent, or the web frontend
- The version or image tag you are running
- What an attacker can achieve, and what access they need to start
- A reproduction, however rough

This is a single-maintainer project. Expect an initial reply within a few days rather than
within hours, and expect the fix to arrive with the next release.

## Where the sensitive parts are

If you are looking for somewhere to start, these are the areas where a defect would matter
most:

- **What the agent may do** — the client agent acts on a domain controller on the server's
  behalf. Anything that makes it do something outside the fixed set of actions it implements,
  or lets someone other than its server drive it, matters.
- **What leaves the domain controller** — the agent reports named fields only. A path by which
  password hashes, keys or other directory secrets reach the server or the dashboard is a defect.
- **Agent registration** — `POST /api/register` on the agent requires the setup PIN printed
  to its log, the server issues the client ID and a registration token, and a server-initiated
  registration on `/ws/register` requires the same PIN or the agent's `SADM_REGISTRATION_SECRET`. `allowedNetworks` on the agent and
  `security.allowed_networks` on the server restrict who may connect.
- **Agent authentication** — an agent authenticates on `/ws/agent` with the `authToken` it
  received at registration.
- **`jwtSecret`** in the server's `config.yaml` — it signs every dashboard session. The file
  is generated on first start and must not be world-readable. The session travels in an
  httpOnly cookie.
- **The initial `admin` account** — created on first start with a default password that has
  to be changed.
- **OIDC configuration**, when enabled — an alternative path into the same session handling
  as `POST /api/login`.

## Scope

In scope: this repository — the server, the client agent, the shared library, the container
images published under `ghcr.io/stefgo/sadm-*`, and the workflows that build them.

Out of scope: Samba itself, the Docker Engine the images run on, and
anything that requires an attacker to already hold administrative access to the host.
