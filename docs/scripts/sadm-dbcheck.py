#!/usr/bin/env python3
"""Runs Samba's database check on this domain controller and reports the result to SADM.

The check is the one `samba-tool dbcheck --cross-ncs` runs, read-only: nothing is fixed and
no transaction is opened. It covers every partition this domain controller holds -- the
domain, the configuration, the schema and the two DNS partitions. It has to run on the
domain controller itself -- it reads the local
database -- which is why SADM cannot take this measurement over the network and this script
exists. Start it from cron, once a day.

Settings, from the environment:

    SADM_URL         where the SADM server is, e.g. https://sadm.example.net
    SADM_TOKEN       this domain controller's report token, issued on its page in SADM
    SADM_TOKEN_FILE  ... or a file that holds it (instead of SADM_TOKEN)
    SADM_CA_FILE     optional: a PEM file with the CA of the server's certificate

Needs Python 3 and Samba's own Python modules, which every Samba AD DC has, and nothing
else. Exits with 0 once the result is reported, whatever the check found, and with 1 when
the check could not be reported -- which cron then mails.

See https://stefgo.github.io/samba-ad-manager/dbcheck/
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


def fail(message):
    print("sadm-dbcheck: %s" % message, file=sys.stderr)
    sys.exit(1)


def setting(name, required=True):
    """A setting from the environment, or from the file `<name>_FILE` names."""
    value = os.environ.get(name, "").strip()
    path = os.environ.get(name + "_FILE", "").strip()
    if value and path:
        fail("set %s or %s_FILE, not both" % (name, name))
    if path:
        try:
            with open(path, encoding="utf-8") as handle:
                value = handle.read().strip()
        except OSError as error:
            fail("%s_FILE cannot be read: %s" % (name, error))
    if required and not value:
        fail("%s is not set" % name)
    return value


def check():
    """Opens the local database, says which domain controller this is, and checks it."""
    import ldb
    from samba.auth import system_session
    from samba.dbchecker import dbcheck
    from samba.param import LoadParm
    from samba.samdb import SamDB

    lp = LoadParm()
    lp.load_default()
    samdb = SamDB(session_info=system_session(), url=None, lp=lp)
    # "all": every partition was checked, not only the domain's. An older version of this
    # script checked the domain alone and said nothing here.
    report = {"dcId": str(samdb.get_ntds_GUID()), "scope": "all"}

    started = time.time()
    try:
        checker = dbcheck(samdb, samdb_schema=samdb, verbose=False, fix=False, yes=False, quiet=True)
        # search_options:1:2 lets the search leave the domain partition for the others. It
        # is all `--cross-ncs` adds in samba-tool; without it the DNS zones are not looked at.
        controls = ["show_deleted:1", "search_options:1:2"]
        errors = checker.check_database(DN=None, scope=ldb.SCOPE_SUBTREE, controls=controls, attrs=["*"])
        report["errors"] = int(errors)
    except Exception as error:  # noqa: BLE001 -- that the check failed is what is reported
        report["errors"] = None
        report["error"] = ("%s: %s" % (type(error).__name__, error))[:2000]
    report["durationMs"] = int((time.time() - started) * 1000)
    report["checkedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return report


def send(url, token, ca_file, report):
    request = urllib.request.Request(
        url.rstrip("/") + "/api/v1/dbcheck/report",
        data=json.dumps(report).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        method="POST",
    )
    context = ssl.create_default_context(cafile=ca_file or None)
    try:
        with urllib.request.urlopen(request, timeout=30, context=context) as response:
            response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace").strip()
        fail("the server refused the report (HTTP %s): %s" % (error.code, body))
    except (urllib.error.URLError, OSError) as error:
        fail("the server could not be reached at %s: %s" % (url, getattr(error, "reason", error)))


def main():
    url = setting("SADM_URL")
    token = setting("SADM_TOKEN")
    ca_file = setting("SADM_CA_FILE", required=False)

    # Samba's modules print what they find. Only this script's own words go to stdout.
    stdout, sys.stdout = sys.stdout, sys.stderr
    try:
        report = check()
    except Exception as error:  # noqa: BLE001 -- without the database there is nothing to report
        fail("the database could not be opened, so nothing is reported -- %s: %s" % (type(error).__name__, error))
    finally:
        sys.stdout = stdout

    send(url, token, ca_file, report)
    if report["errors"] is None:
        print("sadm-dbcheck: the check could not be run, and that was reported: %s" % report.get("error"))
    else:
        print("sadm-dbcheck: reported %d error(s), checked in %d ms" % (report["errors"], report["durationMs"]))


if __name__ == "__main__":
    main()
