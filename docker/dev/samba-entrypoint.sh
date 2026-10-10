#!/bin/bash
# Brings up one domain controller of the development domain.
#
#   SAMBA_ROLE=provision   the first DC: creates the domain on first start
#   SAMBA_ROLE=join        every other DC: joins the domain of SAMBA_JOIN_SERVER on first start
#
# A container that already has a database just starts Samba -- so `docker compose stop` and
# `start` behave like a reboot of the DC, and only `down -v` makes a new domain.
set -euo pipefail

REALM="${SAMBA_REALM:?SAMBA_REALM is required}"
DOMAIN="${SAMBA_DOMAIN:?SAMBA_DOMAIN is required}"
ADMIN_PASS="${SAMBA_ADMIN_PASSWORD:?SAMBA_ADMIN_PASSWORD is required}"
ROLE="${SAMBA_ROLE:-provision}"
REALM_LOWER="$(echo "$REALM" | tr '[:upper:]' '[:lower:]')"

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
            --dns-backend=SAMBA_INTERNAL \
            --adminpass="$ADMIN_PASS" \
            --use-rfc2307
    else
        SERVER="${SAMBA_JOIN_SERVER:?SAMBA_JOIN_SERVER is required to join}"
        echo "Waiting for ${SERVER} ..."
        until samba-tool domain info "$SERVER" >/dev/null 2>&1; do sleep 3; done
        echo "Joining ${REALM} through ${SERVER} ..."
        samba-tool domain join "$REALM_LOWER" DC \
            --server="$SERVER" \
            --dns-backend=SAMBA_INTERNAL \
            -U"Administrator%${ADMIN_PASS}"
    fi
fi

# In the foreground, logging to stdout: the container lives exactly as long as Samba does.
exec samba --foreground --no-process-group --debug-stdout
