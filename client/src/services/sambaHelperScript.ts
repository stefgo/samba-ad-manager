/**
 * The script the agent runs inside the Samba container for what has no other structured
 * source: the replication neighbours (DRSUAPI), the service processes (Samba's internal
 * messaging) and the database check. It imports the Python modules `samba-tool` itself is
 * built on, so it reads what `samba-tool drs showrepl`, `processes` and `dbcheck` read --
 * and hands it on as one JSON object instead of text.
 *
 * It is passed to the interpreter as an argument (`python3 -c <source> <action>`) and
 * nothing is installed in the container. A string in a TypeScript module rather than a
 * `.py` file next to it: `tsc` copies no other files into `dist`, and a helper that is
 * missing from the image would only show at the first measurement.
 *
 * The contract, which `SambaHelper.ts` checks with Zod: exactly one line of JSON on stdout,
 * `{"ok": true, "data": …}` or `{"ok": false, "error": "…"}`. Whatever the Samba modules
 * print on the way goes to stderr.
 */
export const SAMBA_HELPER_ACTIONS = ["replication", "processes", "dbcheck"] as const;
export type SambaHelperAction = (typeof SAMBA_HELPER_ACTIONS)[number];

export const SAMBA_HELPER_SOURCE = String.raw`
import json
import sys
import time

# The Samba modules print progress and findings. Only the result may reach stdout.
out = sys.stdout
sys.stdout = sys.stderr


def iso(nttime):
    """A Windows file time (100 ns since 1601) as ISO 8601 in UTC; None for 'never'."""
    value = int(nttime)
    if value <= 0:
        return None
    unix = value / 10000000.0 - 11644473600
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(unix)) + ".%03dZ" % int((unix % 1) * 1000)


def load_parm():
    from samba.param import LoadParm
    lp = LoadParm()
    lp.load_default()
    return lp


def replication():
    from samba import drs_utils
    from samba.credentials import Credentials
    from samba.dcerpc import drsuapi
    from samba.netcmd.common import netcmd_dnsname

    lp = load_parm()
    creds = Credentials()
    creds.guess(lp)
    # The domain controller's own account: no password is asked for and none is passed in.
    creds.set_machine_account(lp)
    conn, handle, _ = drs_utils.drsuapi_connect(netcmd_dnsname(lp), lp, creds)

    def neighbours(info_type):
        req = drsuapi.DsReplicaGetInfoRequest1()
        req.info_type = info_type
        _, info = conn.DsReplicaGetInfo(handle, 1, req)
        result = []
        for n in info.array:
            code, name = n.result_last_attempt
            result.append({
                "namingContext": n.naming_context_dn,
                "partnerDn": n.source_dsa_obj_dn,
                "lastAttempt": iso(n.last_attempt),
                "lastSuccess": iso(n.last_success),
                "consecutiveFailures": int(n.consecutive_sync_failures),
                "resultCode": int(code),
                "resultText": None if int(code) == 0 else str(name),
            })
        return result

    return {
        "inbound": neighbours(drsuapi.DRSUAPI_DS_REPLICA_INFO_NEIGHBORS),
        "outbound": neighbours(drsuapi.DRSUAPI_DS_REPLICA_INFO_REPSTO),
    }


def processes():
    from samba.messaging import Messaging

    services = Messaging(lp_ctx=load_parm()).irpc_all_servers()
    return [{"name": s.name, "pids": sorted(set(int(i.pid) for i in s.ids))} for s in services]


def dbcheck():
    import ldb
    from samba.auth import system_session
    from samba.dbchecker import dbcheck as Checker
    from samba.samdb import SamDB

    lp = load_parm()
    samdb = SamDB(session_info=system_session(), url=None, lp=lp)
    started = time.time()
    # Read only: nothing is fixed, and no transaction is opened.
    checker = Checker(samdb, samdb_schema=samdb, verbose=False, fix=False, yes=False, quiet=True)
    errors = checker.check_database(DN=None, scope=ldb.SCOPE_SUBTREE, controls=["show_deleted:1"], attrs=["*"])
    return {"errors": int(errors), "durationMs": int((time.time() - started) * 1000)}


ACTIONS = {"replication": replication, "processes": processes, "dbcheck": dbcheck}

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
