#!/bin/bash
# A secondary name server for the development domain: a plain BIND that transfers one zone
# from a domain controller and answers for it. It is no domain controller and knows nothing
# of the directory -- which is what makes it the thing to test a secondary with.
#
#   NS_ZONE=sadm.test        the zone it carries
#   NS_PRIMARY=172.28.0.21   where it transfers the zone from
set -euo pipefail

ZONE="${NS_ZONE:?NS_ZONE is required}"
PRIMARY="${NS_PRIMARY:?NS_PRIMARY is required}"

cat > /etc/bind/named.conf <<NAMED
options {
    directory "/var/cache/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    allow-query { any; };
    recursion no;
    dnssec-validation no;
};

zone "${ZONE}" {
    type secondary;
    primaries { ${PRIMARY}; };
    file "/var/cache/bind/${ZONE}.db";
    // BIND asks no more often than every five minutes unless it is told it may. The
    // development zone says one minute, so that a change arrives while somebody watches.
    min-refresh-time 20;
    min-retry-time 10;
};
NAMED

# In the foreground, logging to stdout: the container lives exactly as long as BIND does.
exec named -g -u bind -c /etc/bind/named.conf
