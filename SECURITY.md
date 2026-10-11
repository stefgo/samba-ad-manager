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

- Which component is affected — the server or the web frontend
- The version or image tag you are running
- What an attacker can achieve, and what access they need to start
- A reproduction, however rough

This is a single-maintainer project. Expect an initial reply within a few days rather than
within hours, and expect the fix to arrive with the next release.

## Where the sensitive parts are

If you are looking for somewhere to start, these are the areas where a defect would matter
most:

- **The account in the directory** — the server binds to the directory as one account and
  holds its password in memory. Anything that lets someone who is not logged in use that
  connection, or reveals the password, matters most of all.
- **What limits the server** — `directory.readOnly`, `directory.enabled` and the protected
  objects. A path by which a change reaches the directory past one of them is a defect, and
  so is one by which a login of the dashboard can alter either setting.
- **What leaves the directory** — the server reads named attributes only. A path by which
  password hashes, keys or other directory secrets reach the dashboard, a log or a webhook
  is a defect.
- **The report token** — `POST /api/v1/dbcheck/report` is the one route that takes no
  session. Its token allows reporting the database check of one domain controller; anything
  more it can be made to do is a defect.
- **`jwtSecret`** in the server's `config.yaml` — it signs every dashboard session. The file
  is generated on first start and must not be world-readable. The session travels in an
  httpOnly cookie.
- **The initial `admin` account** — created on first start with a default password that has
  to be changed.
- **OIDC configuration**, when enabled — an alternative path into the same session handling
  as `POST /api/login`.

## Scope

In scope: this repository — the server, the shared library, the database check script in
`docs/scripts`, the container image published as `ghcr.io/stefgo/sadm-server`, and the
workflows that build it.

Out of scope: Samba itself, the Docker Engine the images run on, and
anything that requires an attacker to already hold administrative access to the host.
