# Webhooks

A webhook sends an HTTP request for every event that passes its filters: a minimum level and,
optionally, a list of event kinds. Its body is a JSON template of your own.

## Events

| Kind | Level | When |
|---|---|---|
| `domain.issue_opened` | warning / error | A [finding](health.md#findings) has lasted 45 seconds. |
| `domain.issue_resolved` | info | It has been gone for 45 seconds. |
| `directory.user_created`, `directory.user_updated`, `directory.password_set`, `directory.user_unlocked` | info | A change to a user. |
| `directory.account_enabled`, `directory.account_disabled` | info | A user or a computer. |
| `directory.group_created`, `directory.group_updated`, `directory.members_added`, `directory.members_removed` | info | A change to a group. |
| `directory.computer_updated`, `directory.ou_created`, `directory.ou_updated` | info | |
| `directory.object_moved`, `directory.object_renamed`, `directory.object_deleted` | info | Any object. |
| `client.connected`, `client.disconnected` | trace | An agent's connection. |
| `client.registered` | info | |
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
| `{{client.name}}` | The agent the event came through; empty for an event of the server itself. |
| `{{webhook.name}}` | |

The editor previews the template with a sample event of the kinds the webhook filters for,
and *Send Test* delivers that sample.

### `event.data` of a finding

```json
{
    "type": "container-stopped",
    "severity": "error",
    "dc": "DC2",
    "text": "DC2: the Samba container is exited",
    "domain": "example.net",
    "status": "critical",
    "durationSeconds": 184
}
```

`status` is the domain's status with the finding (opened) or without it (resolved);
`durationSeconds` is on the resolved event only.

### `event.data` of a change to the directory

```json
{
    "actor": "admin",
    "name": "jdoe",
    "type": "user",
    "clientName": "dc1"
}
```

Plus, by kind: `attributes` (the names of what was changed), `members` (how many),
`target` (the DN moved to), `newName`.

## Example: a chat message for findings

```json
{
    "text": "[{{event.level | upper}}] {{event.data.domain}}: {{event.message}}"
}
```

With *Minimum Level* `info` and *Event Kinds* `domain.*`, that reports every finding and its
all-clear.
