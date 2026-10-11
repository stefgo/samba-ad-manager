/**
 * The names of the Windows error codes a replication link ends with, as Samba prints them
 * (`samba.werror`). The directory stores the number alone; this is the handful that a link
 * between two domain controllers actually fails with. A code that is not listed stays a
 * number -- which still tells an operator what to look up.
 */
const WERROR_NAMES: Readonly<Record<number, string>> = {
    2: "WERR_FILE_NOT_FOUND",
    5: "WERR_ACCESS_DENIED",
    14: "WERR_OUTOFMEMORY",
    58: "WERR_BAD_NET_RESP",
    1256: "WERR_HOST_DOWN",
    1311: "WERR_NO_LOGON_SERVERS",
    1326: "WERR_LOGON_FAILURE",
    1396: "WERR_WRONG_TARGET_NAME",
    1722: "WERR_RPC_S_SERVER_UNAVAILABLE",
    1723: "WERR_RPC_S_SERVER_TOO_BUSY",
    1726: "WERR_RPC_S_CALL_FAILED",
    1727: "WERR_RPC_S_CALL_FAILED_DNE",
    1753: "WERR_EPT_S_NOT_REGISTERED",
    1908: "WERR_DOMAIN_CONTROLLER_NOT_FOUND",
    8418: "WERR_DS_DRA_SCHEMA_MISMATCH",
    8438: "WERR_DS_DRA_BUSY",
    8439: "WERR_DS_DRA_BAD_DN",
    8440: "WERR_DS_DRA_BAD_NC",
    8441: "WERR_DS_DRA_DN_EXISTS",
    8442: "WERR_DS_DRA_INTERNAL_ERROR",
    8443: "WERR_DS_DRA_INCONSISTENT_DIT",
    8444: "WERR_DS_DRA_CONNECTION_FAILED",
    8445: "WERR_DS_DRA_BAD_INSTANCE_TYPE",
    8446: "WERR_DS_DRA_OUT_OF_MEM",
    8447: "WERR_DS_DRA_MAIL_PROBLEM",
    8448: "WERR_DS_DRA_REF_ALREADY_EXISTS",
    8449: "WERR_DS_DRA_REF_NOT_FOUND",
    8450: "WERR_DS_DRA_OBJ_IS_REP_SOURCE",
    8451: "WERR_DS_DRA_DB_ERROR",
    8452: "WERR_DS_DRA_NO_REPLICA",
    8453: "WERR_DS_DRA_ACCESS_DENIED",
    8454: "WERR_DS_DRA_NOT_SUPPORTED",
    8455: "WERR_DS_DRA_RPC_CANCELLED",
    8456: "WERR_DS_DRA_SOURCE_DISABLED",
    8457: "WERR_DS_DRA_SINK_DISABLED",
    8458: "WERR_DS_DRA_NAME_COLLISION",
    8459: "WERR_DS_DRA_SOURCE_REINSTALLED",
    8460: "WERR_DS_DRA_MISSING_PARENT",
    8461: "WERR_DS_DRA_PREEMPTED",
    8462: "WERR_DS_DRA_ABANDON_SYNC",
    8463: "WERR_DS_DRA_SHUTDOWN",
    8464: "WERR_DS_DRA_INCOMPATIBLE_PARTIAL_SET",
    8465: "WERR_DS_DRA_SOURCE_IS_PARTIAL_REPLICA",
    8466: "WERR_DS_DRA_EXTN_CONNECTION_FAILED",
    8524: "WERR_DS_DNS_LOOKUP_FAILURE",
    8589: "WERR_DS_CANT_DERIVE_SPN_WITHOUT_SERVER_REF",
    8606: "WERR_DS_INSUFFICIENT_ATTR_TO_CREATE_OBJECT",
    8614: "WERR_DS_REPL_LIFETIME_EXCEEDED",
};

/** What a failed link is shown with: the code's name, or the code. Null for success. */
export function werrorText(code: number): string | null {
    if (code === 0) return null;
    return WERROR_NAMES[code] ?? `Windows error ${code}`;
}
