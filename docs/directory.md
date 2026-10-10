# Directory

SADM reads and changes the directory through the agents, over LDAPS, as the account each
agent is configured with. Any connected agent with such an account can serve a request; the
one next to the PDC emulator is asked first.

## What can be managed

| | Read | Create | Edit | Other |
|---|---|---|---|---|
| **Users** | list, details, group memberships | yes | names, e-mail, description, UPN, "password never expires" | set password, enable / disable, unlock, add to and remove from groups |
| **Groups** | list, details, members | yes, with scope and type | description, e-mail | add and remove members |
| **Computers** | list, details, group memberships | — | description | enable / disable |
| **Organizational units** | tree with what lives in each | yes | description | — |

Every user, group, computer and organizational unit can also be renamed, moved to another
container and deleted. An organizational unit is deleted only when it is empty.

Computer accounts are not created here: a machine gets one by joining the domain.

## How objects are addressed

By their `objectGUID`. A page of an object keeps working after the object was renamed or
moved — by SADM or by any other tool — and a request never ends up at another object that
took over the old name.

## What is protected

These can be looked at, and are not deleted, renamed, moved or disabled from SADM:

- objects the directory marks as critical (`isCriticalSystemObject`) — `Administrator`,
  `krbtgt`, `Domain Admins`, the built-in groups and so on
- the computer account of a domain controller
- the account the agent itself binds as
- the containers the domain is provisioned with (`Users`, `Computers`, `Builtin`, …)

The agent refuses these whatever the server asks. The dashboard shows them as *Protected*
and offers the actions disabled.

## Passwords

A password is set with a modification of `unicodePwd` over LDAPS. Whether it is long and
complex enough is the domain's password policy to decide; its refusal is shown in the dialog
the password was typed in. The password is in the request to the agent and nowhere else —
not in the activity history, not in a log.

## The record of changes

Every change that was made is an event in the activity history: who made it, to which
object, through which domain controller. A change the directory refused leaves no event — it
did not happen. The events can be forwarded with a [webhook](webhooks.md).

## Read-only

`directory.readOnly: true` in an agent's `config.yaml` lets the directory be looked at
through that agent and not changed. When every connected agent is read-only, the dashboard
says so and offers no change. `directory.enabled: false` takes the agent out of the
directory altogether; it then only measures its domain controller.
