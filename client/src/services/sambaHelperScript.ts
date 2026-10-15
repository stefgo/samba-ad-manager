/**
 * The script the agent runs for what Samba offers no other structured source for: which
 * domain controller this is, which of its services run (Samba's internal messaging) and the
 * database check. It imports the Python modules `samba-tool` itself is built on, so it reads
 * what `samba-tool processes` and `dbcheck` read -- and hands it on as one JSON object
 * instead of text. `dbcheck-fix` is the one action that writes: what `samba-tool dbcheck
 * --cross-ncs --fix --yes` writes, and only when the operator allowed it.
 *
 * It is passed to the interpreter as an argument (`python3 -c <source> <action>`) and
 * nothing is installed for it. A string in a TypeScript module rather than a `.py` file next
 * to it: `tsc` copies no other files into `dist`, and a helper that is missing from the
 * image would only show at the first report.
 *
 * The contract, which `SambaHelper.ts` checks with Zod: exactly one line of JSON on stdout,
 * `{"ok": true, "data": …}` or `{"ok": false, "error": "…"}`. Whatever the Samba modules
 * print on the way goes to stderr.
 */
export const SAMBA_HELPER_ACTIONS = ["info", "services", "dbcheck", "dbcheck-fix"] as const;
export type SambaHelperAction = (typeof SAMBA_HELPER_ACTIONS)[number];

export const SAMBA_HELPER_SOURCE = String.raw`
import json
import sys
import time

# The Samba modules print progress and findings. Only the result may reach stdout.
out = sys.stdout
sys.stdout = sys.stderr


def load_parm():
    from samba.param import LoadParm
    lp = LoadParm()
    lp.load_default()
    return lp


def open_samdb(lp):
    from samba.auth import system_session
    from samba.samdb import SamDB
    return SamDB(session_info=system_session(), url=None, lp=lp)


def info():
    lp = load_parm()
    samdb = open_samdb(lp)
    return {
        # The GUID of this domain controller's NTDS settings: what the server knows it by.
        "dcId": str(samdb.get_ntds_GUID()),
        "dnsDomain": samdb.domain_dns_name(),
        "privateDir": lp.get("private dir"),
        "sysvolPath": lp.get("path", "sysvol"),
    }


def services():
    from samba.messaging import Messaging

    lp = load_parm()
    servers = Messaging(lp_ctx=lp).irpc_all_servers()
    return {
        "configured": [str(name) for name in lp.get("server services")],
        "running": [{"name": s.name, "pids": sorted(set(int(i.pid) for i in s.ids))} for s in servers],
    }


# search_options:1:2 lets the search leave the domain partition for the others. It is all
# --cross-ncs adds in samba-tool; without it the DNS zones are not looked at.
DBCHECK_CONTROLS = ["show_deleted:1", "search_options:1:2"]


def dbcheck():
    import ldb
    from samba.dbchecker import dbcheck as Checker

    samdb = open_samdb(load_parm())
    started = time.time()
    # Read only: nothing is fixed, and no transaction is opened.
    checker = Checker(samdb, samdb_schema=samdb, verbose=False, fix=False, yes=False, quiet=True)
    errors = checker.check_database(DN=None, scope=ldb.SCOPE_SUBTREE, controls=DBCHECK_CONTROLS, attrs=["*"])
    return {"errors": int(errors), "durationMs": int((time.time() - started) * 1000)}


def dbcheck_fix():
    import ldb
    from samba.dbchecker import dbcheck as Checker

    samdb = open_samdb(load_parm())
    started = time.time()
    # What samba-tool dbcheck --fix --yes does: every fix in one transaction, so a fix that
    # fails halfway leaves the database as it was. Writes wait while it is open.
    samdb.transaction_start()
    try:
        checker = Checker(samdb, samdb_schema=samdb, verbose=False, fix=True, yes=True, quiet=True, in_transaction=True)
        errors = checker.check_database(DN=None, scope=ldb.SCOPE_SUBTREE, controls=DBCHECK_CONTROLS, attrs=["*"])
        samdb.transaction_commit()
    except BaseException:
        samdb.transaction_cancel()
        raise
    return {"errors": int(errors), "durationMs": int((time.time() - started) * 1000)}


ACTIONS = {"info": info, "services": services, "dbcheck": dbcheck, "dbcheck-fix": dbcheck_fix}

try:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action not in ACTIONS:
        raise ValueError("unknown action: %r" % action)
    answer = {"ok": True, "data": ACTIONS[action]()}
except Exception as error:  # noqa: BLE001 -- whatever went wrong is the answer
    answer = {"ok": False, "error": "%s: %s" % (type(error).__name__, error)}

out.write(json.dumps(answer) + "\n")
out.flush()
`;
