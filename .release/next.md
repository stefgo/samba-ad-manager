<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### Read the domain's status from elsewhere

`GET /api/v1/status` answers with what the dashboard shows -- the verdict (`healthy`,
`degraded`, `critical`, `unknown`) and every finding with the dashboard's text -- for Home
Assistant, a monitoring system or a script. Besides a session it takes a status token that
opens this route and nothing else: set `statusToken` in `config.yaml` or
`SADM_STATUS_TOKEN` (`_FILE`), at least 32 characters. Without one nothing changes. See
[Reading the status from elsewhere](https://stefgo.github.io/samba-ad-manager/health/#reading-the-status-from-elsewhere).

