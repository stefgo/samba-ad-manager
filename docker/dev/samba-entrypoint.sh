#!/bin/bash
# Brings up one domain controller of the development domain.
#
#   SAMBA_ROLE=provision   the first DC: creates the domain on first start
#   SAMBA_ROLE=join        every other DC: joins the domain of SAMBA_JOIN_SERVER on first start
#
#   SAMBA_DNS_BACKEND=SAMBA_INTERNAL   Samba answers DNS itself (the default)
#   SAMBA_DNS_BACKEND=BIND9_DLZ        BIND answers it, reading the zones out of the directory
#   SAMBA_DNS_SECONDARY=<address>      with BIND: who may transfer the zones, and on the first
#                                      DC the name server `ns2` the domain's zone then lists
#
#   SADM_AGENT=yes                     runs the SADM agent next to Samba. With SADM_SERVER_URL
#                                      it dials the server and registers with
#                                      SADM_REGISTRATION_TOKEN; without, it waits on port
#                                      3021 for the server to dial it, and logs a setup PIN
#
# A container that already has a database just starts Samba -- so `docker compose stop` and
# `start` behave like a reboot of the DC, and only `down -v` makes a new domain. The DNS
# backend is the exception: a domain that has the other one is switched over on start.
set -euo pipefail

REALM="${SAMBA_REALM:?SAMBA_REALM is required}"
DOMAIN="${SAMBA_DOMAIN:?SAMBA_DOMAIN is required}"
ADMIN_PASS="${SAMBA_ADMIN_PASSWORD:?SAMBA_ADMIN_PASSWORD is required}"
ROLE="${SAMBA_ROLE:-provision}"
DNS_BACKEND="${SAMBA_DNS_BACKEND:-SAMBA_INTERNAL}"
DNS_SECONDARY="${SAMBA_DNS_SECONDARY:-}"
REALM_LOWER="$(echo "$REALM" | tr '[:upper:]' '[:lower:]')"

case "$DNS_BACKEND" in
    SAMBA_INTERNAL | BIND9_DLZ) ;;
    *) echo "SAMBA_DNS_BACKEND must be SAMBA_INTERNAL or BIND9_DLZ" >&2; exit 1 ;;
esac

# Kerberos finds its KDCs through the domain's DNS, which is this domain's own.
cat > /etc/krb5.conf <<KRB
[libdefaults]
    default_realm = ${REALM}
    dns_lookup_realm = false
    dns_lookup_kdc = true
KRB

if [ ! -f /var/lib/samba/private/sam.ldb ]; then
    rm -f /etc/samba/smb.conf
    if [ "$ROLE" = "provision" ]; then
        echo "Provisioning ${REALM} ..."
        samba-tool domain provision \
            --realm="$REALM" \
            --domain="$DOMAIN" \
            --server-role=dc \
            --dns-backend="$DNS_BACKEND" \
            --adminpass="$ADMIN_PASS" \
            --use-rfc2307
    else
        SERVER="${SAMBA_JOIN_SERVER:?SAMBA_JOIN_SERVER is required to join}"
        echo "Waiting for ${SERVER} ..."
        until samba-tool domain info "$SERVER" >/dev/null 2>&1; do sleep 3; done
        echo "Joining ${REALM} through ${SERVER} ..."
        samba-tool domain join "$REALM_LOWER" DC \
            --server="$SERVER" \
            --dns-backend="$DNS_BACKEND" \
            -U"Administrator%${ADMIN_PASS}"
    fi
fi

# Sets one parameter of [global], replacing the line where there is one already.
set_global() {
    local name="$1" value="$2"
    sed -i "/^\s*${name}\s*=/d" /etc/samba/smb.conf
    sed -i "s|^\[global\]|[global]\n\t${name} = ${value}|" /etc/samba/smb.conf
}

# Which backend the domain has is what smb.conf says of Samba's own DNS server: with BIND
# it is not among the `server services`, and without such a line it is.
SERVICES="$(grep -E '^\s*server services\s*=' /etc/samba/smb.conf || true)"
if [ -n "$SERVICES" ] && ! echo "$SERVICES" | grep -Eq '[=, ]\s*dns\s*(,|$)'; then
    CURRENT_BACKEND=BIND9_DLZ
else
    CURRENT_BACKEND=SAMBA_INTERNAL
fi
if [ "$CURRENT_BACKEND" != "$DNS_BACKEND" ]; then
    echo "Switching the DNS backend from ${CURRENT_BACKEND} to ${DNS_BACKEND} ..."
    samba_upgradedns --dns-backend="$DNS_BACKEND"
fi
# samba_upgradedns leaves the line to whoever runs it, and provision and join write the
# services out one by one. Either way it ends up as the one line that says it.
if [ "$DNS_BACKEND" = "BIND9_DLZ" ]; then
    set_global "server services" "-dns"
else
    sed -i '/^\s*server services\s*=/d' /etc/samba/smb.conf
fi

if [ "$DNS_BACKEND" = "BIND9_DLZ" ]; then
    [ -n "$DNS_SECONDARY" ] && set_global "dns zone transfer clients allow" "$DNS_SECONDARY"

    # Samba's own named.conf names the module by the BIND version it knew when it was
    # released; this one names the newest module there is, which later BIND versions load.
    MODULE="$(ls /usr/lib/*/samba/bind9/dlz_bind9_*.so | sort -V | tail -1)"
    cat > /etc/bind/named.conf <<NAMED
options {
    directory "/var/cache/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    allow-query { any; };
    recursion no;
    dnssec-validation no;
    notify yes;
    // What a dynamic update signs itself with: the DCs register their own records that way.
    tkey-gssapi-keytab "/var/lib/samba/bind-dns/dns.keytab";
    minimal-responses yes;
};

dlz "AD DNS Zone" {
    database "dlopen ${MODULE}";
};
NAMED
    # In the background and not watched: `pkill named` is how a DNS server that is gone is
    # looked at, and `named -u bind` brings it back.
    named -u bind -c /etc/bind/named.conf
fi

# What the first DC adds to its domain once it is up: the secondary as a name server of the
# zone, and a SOA that has a secondary ask every minute rather than every quarter of an hour
# -- nobody waits that long to see a change arrive.
after_start() {
    local creds="-UAdministrator%${ADMIN_PASS}"
    until samba-tool dns query 127.0.0.1 "$REALM_LOWER" @ SOA "$creds" >/dev/null 2>&1; do sleep 3; done

    if ! samba-tool dns query 127.0.0.1 "$REALM_LOWER" ns2 A "$creds" >/dev/null 2>&1; then
        samba-tool dns add 127.0.0.1 "$REALM_LOWER" ns2 A "$DNS_SECONDARY" "$creds"
        samba-tool dns add 127.0.0.1 "$REALM_LOWER" @ NS "ns2.${REALM_LOWER}." "$creds"
    fi

    local soa
    soa="$(samba-tool dns query 127.0.0.1 "$REALM_LOWER" @ SOA "$creds" | grep 'SOA:')"
    if ! echo "$soa" | grep -q 'refresh=60,'; then
        local field
        field() { echo "$soa" | sed -E "s/.*[ ,]$1=([^, ]+).*/\1/"; }
        local serial ns email
        serial="$(field serial)"; ns="$(field ns)"; email="$(field email)"
        samba-tool dns update 127.0.0.1 "$REALM_LOWER" @ SOA \
            "${ns} ${email} ${serial} $(field refresh) $(field retry) $(field expire) $(field minttl)" \
            "${ns} ${email} $((serial + 1)) 60 30 86400 3600" "$creds"
    fi
}

if [ "$DNS_BACKEND" = "BIND9_DLZ" ] && [ "$ROLE" = "provision" ] && [ -n "$DNS_SECONDARY" ]; then
    after_start &
fi

# Samba under supervisord, as in the image of a real domain controller: the container lives
# as long as supervisord does, and a Samba that ends is started again. `supervisorctl stop
# samba` is how a domain controller that is down is looked at.
mkdir -p /etc/supervisor/conf.d
cat > /etc/supervisor/supervisord.conf <<SUPERVISOR
[unix_http_server]
file=/var/run/supervisor.sock

[supervisord]
nodaemon=true
user=root
logfile=/dev/null
logfile_maxbytes=0
pidfile=/var/run/supervisord.pid

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[program:samba]
command=samba --foreground --no-process-group --debug-stdout
priority=1
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[include]
files = /etc/supervisor/conf.d/*.conf
SUPERVISOR

# The agent is a program of the same supervisord, switched on by linking its file in --
# which is all an image has to do to take it in.
rm -f /etc/supervisor/conf.d/sadm-client.conf
if [ "${SADM_AGENT:-no}" = "yes" ]; then
    ln -s /opt/sadm-client/supervisor.conf /etc/supervisor/conf.d/sadm-client.conf
fi

exec supervisord -c /etc/supervisor/supervisord.conf
