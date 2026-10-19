# Webhooks

A webhook sends an HTTP request for every event that passes its filters: a minimum level and,
optionally, a list of event kinds. Its body is a JSON template of your own.

## Events

| Kind | Level | When |
|---|---|---|
| `domain.issue_opened` | warning / error | The first [finding](health.md#findings) of an [incident](health.md#one-incident-per-domain-controller) has lasted its [report wait](health.md#when-a-finding-is-reported), 5 minutes unless set otherwise. |
| `domain.issue_extended` | warning / error | Another finding of an open incident has lasted its report wait. |
| `domain.issue_escalated` | error | A reported warning has been an error for its report wait. |
| `domain.issue_resolved` | info | Every finding of the incident has been gone for the wait before the all-clear, 5 minutes unless set otherwise. `data.durationSeconds` is how long the incident lasted. |
| `domain.issue_discarded` | info, **off by default** | The incident was over before any of its findings was reported; `data.durationSeconds` is how long it was seen. Recorded and sent only once it is given a level under *Settings* → *Activity History* → *Event Levels*. |
| `directory.user_created`, `directory.user_updated`, `directory.password_set`, `directory.user_unlocked` | info | A change to a user. |
| `directory.account_enabled`, `directory.account_disabled` | info | A user or a computer. |
| `directory.group_created`, `directory.group_updated`, `directory.members_added`, `directory.members_removed` | info | A change to a group. |
| `directory.computer_updated`, `directory.ou_created`, `directory.ou_updated` | info | |
| `directory.object_moved`, `directory.object_renamed`, `directory.object_deleted` | info | Any object. |
| `directory.dns_record_created`, `directory.dns_record_updated`, `directory.dns_record_deleted` | info | A [DNS record](dns.md). |
| `dc.discovered` | info | The directory lists a domain controller for the first time. |
| `dc.removed` | warning | The directory no longer lists one. |
| `agent.registered` | info | An [agent](agent.md) registered for a domain controller. `data` carries `connectionMode` and `hostname`, and `reregistered: true` when it took the place of the agent the domain controller had. |
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
| `{{event.correlationId}}` | Shared by the events of one incident. |
| `{{event.data.…}}` | The facts of the event, by kind — see below. |
| `{{event.subject.name}}`, `{{event.subject.dn}}` | What the event is about. |
| `{{dc.name}}`, `{{dc.dnsHostName}}`, `{{dc.site}}`, `{{dc.id}}` | The domain controller the event is about; empty for an event about the domain or the server. |
| `{{webhook.name}}` | |

The editor previews the template with a sample event of the kinds the webhook filters for,
and *Send Test* delivers that sample.

### `event.data` of an incident

Every event of an incident carries the same facts: the incident, every finding it has had,
and -- by kind -- the findings the event is about.

```json
{
    "domain": "example.net",
    "status": "critical",
    "dc": "DC2",
    "severity": "error",
    "since": "2026-10-16T10:00:00.000Z",
    "openedAt": "2026-10-16T10:05:00.000Z",
    "reported": [ { "…": "the findings reported with this event" } ],
    "findings": [
        {
            "type": "service-down",
            "severity": "error",
            "worstSeverity": "error",
            "text": "DC2: Kerberos (port 88) does not answer: timed out",
            "state": "reported",
            "since": "2026-10-16T10:00:00.000Z",
            "lastSeenAt": "2026-10-16T10:06:00.000Z",
            "reportedAt": "2026-10-16T10:05:00.000Z",
            "gaps": 1,
            "history": [
                { "change": "appeared", "at": "2026-10-16T10:00:00.000Z", "severity": "error", "text": "DC2: Kerberos (port 88) does not answer: timed out" },
                { "change": "gap", "first": "2026-10-16T10:02:00.000Z", "last": "2026-10-16T10:02:00.000Z", "count": 1, "longestSeconds": 60 }
            ],
            "historyOmitted": 0
        }
    ]
}
```

- `dc` is null for the incident of the domain: findings about the domain itself or about a
  name server that is no domain controller; their `text` names the server then.
- `severity` is the worst of the findings the event reports (opened, extended), `error` on
  the escalated event, and the worst the incident had on the resolved and the discarded one.
- `openedAt` is null on the discarded event. `durationSeconds` is on the resolved event --
  from when the incident began, not from when it was reported -- and on the discarded one,
  for as long as it was seen.
- `reported` is on the opened and the extended event, `escalated` on the escalated one: the
  findings the event is about, in the same form as `findings`.
- `status` is the domain's status when the event was written.

A finding's `state` is `pending` (not reported yet), `reported`, or `gone`. `history` holds what
happened to it while the server watched: `appeared` and `gone` with `at`; `severity` with
`first`, `last`, `count` and the latest `severity` and `text`; `gap` with `first` and `last`
(when the first and the last gap began), `count` and `longestSeconds`. Repeats of the same
change in a row are one entry with a count. When gaps and changes of severity take turns, the
first ten and the last ten entries are kept and `historyOmitted` says how many are left out.
After a restart of the server, the history begins again.

`type` is one of `dc-unreachable`, `service-down`, `not-synchronized`, `replication-failing`,
`replication-stale`, `fsmo-missing`, `fsmo-conflict`, `clock-offset`, `dbcheck-errors`,
`dbcheck-overdue`, `agent-offline`, `samba-service-down`, `process-not-running`,
`process-restarting`, `storage-low`, `sysvol-out-of-step`, `dns-zone-not-served`, `dns-server-down`, `dns-secondary-behind`,
`dns-secondary-ahead`, `dc-records-missing` and `dns-stale-dc-record`.

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

## Example: a chat message for incidents

```json
{
    "text": "[{{event.level | upper}}] {{event.data.domain}}: {{event.message}}"
}
```

With *Minimum Level* `info` and *Event Kinds* `domain.*`, that reports every incident, what
joins it, and its all-clear.

`$map` and `$join` turn the findings into lines, one per finding:

```json
{
    "text": "{{event.message}}",
    "details": {
        "$join": {
            "$map": "event.data.findings",
            "each(f)": "- {{f.text}} ({{f.state}}, gone and back {{f.gaps}} times)"
        },
        "with": "\n"
    }
}
```
