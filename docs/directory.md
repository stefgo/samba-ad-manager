# Directory

SADM reads and changes the directory over LDAPS, as the account the server is configured
with. Any domain controller whose directory answers can serve a request; the PDC emulator is
asked first, because that is where password changes are authoritative.

## What can be managed

| | Read | Create | Edit | Other |
|---|---|---|---|---|
| **Users** | list, details, group memberships | yes | names, e-mail, description, UPN, "password never expires" | set password, enable / disable, unlock, add to and remove from groups |
| **Groups** | list, details, members | yes, with scope and type | description, e-mail | add and remove members |
| **Computers** | list, details, group memberships | — | description | enable / disable |
| **Organizational units** | tree with what lives in each | yes | description | — |

Every user, group, computer and organizational unit can also be renamed, moved to another
container and deleted. An organizational unit is deleted only when it is empty.

A user or a computer is deleted together with what lives below its account -- what a
machine or an application keeps there, such as BitLocker recovery keys, published printers
or service connection points. The question before the deletion says how many objects that
are. Should a user, group, computer, organizational unit or protected object live below an
account, the deletion is refused instead.

Computer accounts are not created here: a machine gets one by joining the domain.

The DNS zones are in the directory as well, and their records are managed the same way —
see [DNS](dns.md).

## How objects are addressed

By their `objectGUID`. A page of an object keeps working after the object was renamed or
moved — by SADM or by any other tool — and a request never ends up at another object that
took over the old name.

## What is protected

These can be looked at, and are not deleted, renamed, moved or disabled from SADM:

- objects the directory marks as critical (`isCriticalSystemObject`) — `Administrator`,
  `krbtgt`, `Domain Admins`, the built-in groups and so on
- the computer account of a domain controller
- the account the server itself binds as
- the containers the domain is provisioned with (`Users`, `Computers`, `Builtin`, …)

Every change first reads the object it is about to change, and these are refused there —
whatever the request says. The dashboard shows them as *Protected* and offers the actions
disabled.

## Passwords

A password is set with a modification of `unicodePwd` over LDAPS. Whether it is long and
complex enough is the domain's password policy to decide; its refusal is shown in the dialog
the password was typed in. The password goes to the directory and nowhere else — not into
the activity history, not into a log.

## The record of changes

Every change that was made is an event in the activity history: who made it, to which
object, on which domain controller. A change the directory refused leaves no event — it
did not happen. The events can be forwarded with a [webhook](webhooks.md).

## Read-only

`directory.readOnly: true` in the server's `config.yaml` lets the directory be looked at and
not changed; the dashboard says so and offers no change. `directory.enabled: false` keeps
the directory out of SADM altogether: the domain controllers are still measured.

Both are read from the file alone. No page of the dashboard sets them.
