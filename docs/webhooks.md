# Webhooks

A webhook sends an HTTP request for every event that passes its filters: a minimum level and,
optionally, a list of event kinds. Its body is a JSON template of your own.

## Events

| Kind | Level | When |
|---|---|---|
| `domain.issue_opened` | warning / error | A [finding](health.md#findings) has lasted its [report wait](health.md#when-a-finding-is-reported), 5 minutes unless set otherwise. |
| `domain.issue_escalated` | error | A reported warning has been an error for its report wait. |
| `domain.issue_resolved` | info | It has been gone for the wait before the all-clear, 5 minutes unless set otherwise. `data.durationSeconds` is how long it lasted. |
| `directory.user_created`, `directory.user_updated`, `directory.password_set`, `directory.user_unlocked` | info | A change to a user. |
| `directory.account_enabled`, `directory.account_disabled` | info | A user or a computer. |
| `directory.group_created`, `directory.group_updated`, `directory.members_added`, `directory.members_removed` | info | A change to a group. |
| `directory.computer_updated`, `directory.ou_created`, `directory.ou_updated` | info | |
| `directory.object_moved`, `directory.object_renamed`, `directory.object_deleted` | info | Any object. |
| `directory.dns_record_created`, `directory.dns_record_updated`, `directory.dns_record_deleted` | info | A [DNS record](dns.md). |
| `dc.discovered` | info | The directory lists a domain controller for the first time. |
| `dc.removed` | warning | The directory no longer lists one. |
| `agent.registered` | info | An [agent](agent.md) registered for a domain controller. `data` carries `connectionMode` and `hostname`. |
| `agent.updated` | info | The address the server dials an agent at was changed. `data` carries `targetAddress`, `was` and `actor`. |
| `agent.removed` | info | An agent was removed, with `actor`. |
| `agent.dbcheck_fix_requested` | info | Somebody had an agent [fix what its database check finds](agent.md#fixing-what-the-check-finds), with `actor`. |
| `agent.dbcheck_fix_attempted` | trace | An attempt of the fix that is [tried again](agent.md#fixing-what-the-check-finds). `data` carries `errorsFound`, `errorsRemaining`, `error`, `attempt`, `of` and `nextAttemptAt`. |
| `agent.dbcheck_fixed` | info / warning / error | The fix is done and the check after it too, for good. `data` carries `errorsFound` (null when the fix failed), `errorsRemaining` (what the check after it counted) and `error`, all of the last attempt, `attempts` and `history` (those three of every attempt). Info when none is left, warning when some are or the check after it could not be run, error when the fix failed and changed nothing. |
| `agent.dbcheck_fix_unconfirmed` | warning | The agent has not reported the outcome of a fix in time (*Agent Requests*, six hours by default). `data.waitedMinutes`. An outcome that arrives later is recorded all the same, in the same row. |
| `agent.replication_sync_requested` | info | Somebody had a domain controller [replicate now](agent.md#replicating-now) from its partners, with `actor`. |
| `agent.replication_sync_attempted` | trace | An attempt that is [tried again](agent.md#replicating-now). `data` as below, with `attempt`, `of` and `nextAttemptAt`. |
| `agent.replication_synced` | info / warning / error | The agent reported how it went, for good. `data` carries `links` (how many were asked), `failed`, `failures` (`partner`, `namingContext`, `error` of each) and `error`, all of the last attempt, `attempts` and `history` (`links`, `failed`, `error` of every attempt). Info when every link replicated, warning when some failed or there was no link although there are partners, error when all failed or none could be asked. |
| `agent.replication_sync_unconfirmed` | warning | The agent has not reported the outcome of a replication in time (30 minutes by default). `data.waitedMinutes`. |
| `scheduler.failed` | error | A scheduled job of the server. |

Kinds are filtered with `*` as a wildcard: `domain.*`, `directory.object_*`. The level of a
kind can be changed, or the kind switched off, under *Settings* → *Activity History*.

## The template

A template is JSON whose strings may contain placeholders. Three roots exist:

| Placeholder | |
|---|---|
| `{{event.message}}` | The sentence the activity list shows. |
| `{{event.kind}}`, `{{event.level}}`, `{{event.occurredAt}}` | |
| `{{event.correlationId}}` | Shared by the two events of one finding. |
| `{{event.data.…}}` | The facts of the event, by kind — see below. |
| `{{event.subject.name}}`, `{{event.subject.dn}}` | What the event is about. |
| `{{dc.name}}`, `{{dc.dnsHostName}}`, `{{dc.site}}`, `{{dc.id}}` | The domain controller the event is about; empty for an event about the domain or the server. |
| `{{webhook.name}}` | |

The editor previews the template with a sample event of the kinds the webhook filters for,
and *Send Test* delivers that sample.

### `event.data` of a finding

```json
{
    "type": "service-down",
    "severity": "error",
    "dc": "DC2",
    "text": "DC2: Kerberos (port 88) does not answer: timed out",
    "domain": "example.net",
    "status": "critical",
    "durationSeconds": 184
}
```

`type` is one of `dc-unreachable`, `service-down`, `not-synchronized`, `replication-failing`,
`replication-stale`, `fsmo-missing`, `fsmo-conflict`, `clock-offset`, `dbcheck-errors`,
`dbcheck-overdue`, `agent-offline`, `samba-service-down`, `process-not-running`,
`process-restarting`, `storage-low`, `sysvol-out-of-step`, `dns-zone-not-served`, `dns-server-down`, `dns-secondary-behind`,
`dns-secondary-ahead`, `dc-records-missing` and `dns-stale-dc-record`. `dc` is null for a finding about the domain itself or about a name
server that is no domain controller; `text` names the server then. `severity` is `error` on
the escalated event. `status` is the domain's status with the finding (opened, escalated) or
without it (resolved); `durationSeconds` is on the resolved event only, and counts from when
the finding began, not from when it was reported.

### `event.data` of a change to the directory

```json
{
    "actor": "admin",
    "name": "jdoe",
    "type": "user",
    "dcName": "DC1"
}
```

`dcName` is the domain controller the change was made on. Plus, by kind: `attributes` (the
names of what was changed), `members` (how many), `target` (the DN moved to), `newName`.

For a DNS record `type` is `dns-record` and `name` the name the record is under, in full.
`zone` is the zone, `record` what the record says (`A 192.0.2.10`) — after the change, or
before it was deleted — and `was` what a changed one said before.

### `event.data` of a domain controller that joined or left

```json
{
    "dcName": "DC3",
    "dnsHostName": "dc3.example.net",
    "site": "Default-First-Site-Name"
}
```

## Example: a chat message for findings

```json
{
    "text": "[{{event.level | upper}}] {{event.data.domain}}: {{event.message}}"
}
```

With *Minimum Level* `info` and *Event Kinds* `domain.*`, that reports every finding and its
all-clear.
