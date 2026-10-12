import { DC_SERVICES, FSMO_ROLES, FSMO_ROLE_LABELS, type DcHealth, type DnsServerHealth, type FsmoRole } from "./dcHealth.js";
import { compareSerial } from "./dnsSerial.js";

/**
 * The domain as a whole, derived from the last measurement of every domain controller.
 * Never stored: the backend's events and the dashboard both call `buildDomainHealth` on the
 * same input, so they cannot disagree about what is wrong.
 *
 * A single domain controller can only speak for itself. Whether two of them disagree about
 * who holds a role, whether one has fallen behind, whether a clock has drifted -- that only
 * shows when their measurements are laid next to each other, which is what happens here.
 */

export type DomainStatus = "healthy" | "degraded" | "critical" | "unknown";
export type IssueSeverity = "warning" | "error";

export type DomainIssueType =
    | "dc-unreachable"
    | "service-down"
    | "not-synchronized"
    | "replication-failing"
    | "replication-stale"
    | "fsmo-missing"
    | "fsmo-conflict"
    | "clock-offset"
    | "dbcheck-errors"
    | "dbcheck-overdue"
    | "dns-zone-not-served"
    | "dns-server-down"
    | "dns-secondary-behind"
    | "dns-secondary-ahead"
    | "dc-records-missing"
    | "dns-stale-dc-record";

/** One thing that is wrong. `text` is the finding as a reader sees it. */
export interface DomainIssue {
    /**
     * What makes this finding this finding, from one evaluation to the next: its type, the
     * domain controller, and what about it -- a port, a partner, a role. Not its text, which
     * counts failures and minutes and so changes while the finding stays the same.
     */
    id: string;
    type: DomainIssueType;
    severity: IssueSeverity;
    /** The domain controller the finding is about; absent for one about the domain itself. */
    dc?: string;
    /** That domain controller's id, for a link to its page. */
    dcId?: string;
    text: string;
}

/** What `buildDomainHealth` needs to know of a domain controller the directory lists. */
export interface DomainHealthController {
    id: string;
    /** The server's name in the directory, upper case as Samba writes it. */
    name: string;
    dnsHostName?: string | null;
    site?: string | null;
    /**
     * Since when this domain controller is expected to report its database check: the moment
     * its report token was issued. Null while none is.
     */
    dbcheckSince?: string | null;
    /**
     * When this server first heard of the domain controller. One that has just joined has
     * not registered its DNS records yet, and is not asked for them for half an hour.
     */
    firstSeen?: string | null;
}

/**
 * The DNS records a domain controller should have registered, as the domain controllers
 * that answered have them between them.
 */
export interface ControllerDnsRecords {
    /** How many records it should have. */
    expected: number;
    /** The ones at least one domain controller's directory lacks, what it is not found without first. */
    missing: { record: string; essential: boolean }[];
    /** The domain controllers whose directory lacks some; all of them where they agree. */
    missingOn: string[];
    /** How many domain controllers were asked. */
    askedOn: number;
}

/** One domain controller: what the directory lists, joined with its last measurement. */
export interface ControllerHealth {
    id: string;
    name: string;
    dnsHostName: string | null;
    site: string | null;
    /** The last measurement; null before the first one. */
    health: DcHealth | null;
    /** The roles the domain controllers agree it holds. */
    roles: FsmoRole[];
    isGlobalCatalog: boolean | null;
    /** Null until a domain controller's directory was asked for them. */
    dnsRecords: ControllerDnsRecords | null;
    status: DomainStatus;
    issues: DomainIssue[];
}

export interface DomainHealth {
    status: DomainStatus;
    /** `sadm.test`, as the domain controllers name it; null before the first measurement. */
    dnsName: string | null;
    dn: string | null;
    domainLevel: number | null;
    forestLevel: number | null;
    controllers: ControllerHealth[];
    /** Who holds each role. `holders` has more than one entry where the DCs disagree. */
    fsmo: Record<FsmoRole, { holder: string | null; holders: string[] }>;
    counts: { users: number; groups: number; computers: number } | null;
    /** The name servers of the domain that are no domain controllers, as last asked. */
    nameServers: DnsServerHealth[];
    /** Every finding, the domain's own first, then by domain controller. */
    issues: DomainIssue[];
}

export interface DomainHealthOptions {
    /** From when on a clock is too far off. Kerberos refuses at five minutes. */
    maxClockOffsetSeconds: number;
    /** How old the last successful replication of a link may be. */
    maxReplicationAgeMinutes: number;
    /** How old the last reported database check may be, where one is expected. */
    maxDbcheckAgeHours: number;
    /** The moment the ages are measured against. */
    now: number;
}

export const DEFAULT_DOMAIN_HEALTH_OPTIONS = {
    maxClockOffsetSeconds: 300,
    maxReplicationAgeMinutes: 60,
    maxDbcheckAgeHours: 36,
} as const;

const key = (name: string) => name.toUpperCase();

/** How long after it was first seen a domain controller is not held to its DNS records: Samba registers them every ten minutes. */
const NEW_DC_GRACE_MS = 30 * 60_000;

/** How many of the missing records a finding names before it says "and more". */
const NAMED_RECORDS = 2;

const issueId = (type: DomainIssueType, dc = "", about = ""): string => `${type}|${key(dc)}|${about}`;

/**
 * The thresholds as the settings block holds them, with the defaults for what is missing or
 * no number. The server's events and the dashboard both read them through here.
 */
export function domainHealthOptionsFromSettings(
    settings: Readonly<Record<string, unknown>>,
): Omit<DomainHealthOptions, "now"> {
    const positive = (value: unknown, fallback: number): number => {
        const parsed = Number.parseInt(String(value ?? ""), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    return {
        maxClockOffsetSeconds: positive(settings.health_max_clock_offset_seconds, DEFAULT_DOMAIN_HEALTH_OPTIONS.maxClockOffsetSeconds),
        maxReplicationAgeMinutes: positive(
            settings.health_max_replication_age_minutes,
            DEFAULT_DOMAIN_HEALTH_OPTIONS.maxReplicationAgeMinutes,
        ),
        maxDbcheckAgeHours: positive(settings.health_max_dbcheck_age_hours, DEFAULT_DOMAIN_HEALTH_OPTIONS.maxDbcheckAgeHours),
    };
}

/** 42 s, 3 min, 2 h 5 min, 1 d 3 h. */
export function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s} s`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return minutes % 60 > 0 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
    const days = Math.floor(hours / 24);
    return hours % 24 > 0 ? `${days} d ${hours % 24} h` : `${days} d`;
}

const worst = (issues: readonly DomainIssue[]): DomainStatus =>
    issues.some((issue) => issue.severity === "error")
        ? "critical"
        : issues.length > 0
          ? "degraded"
          : "healthy";

/** Whether a measurement found none of a domain controller's services answering. */
const answersNothing = (health: DcHealth): boolean => health.services.length > 0 && health.services.every((service) => !service.ok);

/**
 * What the last measurement and the last database check say is wrong with one domain
 * controller. `away` names the domain controllers that answer nothing, upper case.
 */
function controllerIssues(
    dc: DomainHealthController,
    health: DcHealth,
    options: DomainHealthOptions,
    away: ReadonlySet<string> = new Set(),
): DomainIssue[] {
    const { name } = dc;
    const issues: DomainIssue[] = [];
    const add = (type: DomainIssueType, severity: IssueSeverity, text: string, about = "") =>
        issues.push({ id: issueId(type, name, about), type, severity, dc: name, dcId: dc.id, text: `${name}: ${text}` });

    if (answersNothing(health)) {
        add("dc-unreachable", "error", "does not answer on any of its services");
        // Everything else would only repeat that it is not there.
        return issues;
    }

    for (const service of health.services) {
        if (service.ok) continue;
        const required = DC_SERVICES.find((known) => known.port === service.port)?.required ?? false;
        add(
            "service-down",
            required ? "error" : "warning",
            `${service.name} (port ${service.port}) does not answer${service.detail ? `: ${service.detail}` : ""}`,
            String(service.port),
        );
    }

    // A DNS server that does not answer at all is the finding above; every zone would repeat it.
    const dnsAnswers = health.services.find((service) => service.port === 53)?.ok !== false;
    for (const zone of dnsAnswers ? (health.dns?.zones ?? []) : []) {
        if (zone.ok) continue;
        add(
            "dns-zone-not-served",
            "error",
            `its DNS server does not answer for the zone ${zone.zone}${zone.detail ? `: ${zone.detail}` : ""}`,
            zone.zone.toLowerCase(),
        );
    }

    if (health.identity?.isSynchronized === false) {
        add("not-synchronized", "warning", "has not finished its initial synchronization");
    }

    // Per partner, not per naming context: one partner that is away fails five links at once.
    const byPartner = new Map<string, { failures: number; text: string | null; oldest: number | null; never: boolean }>();
    for (const link of health.replication?.inbound ?? []) {
        const entry = byPartner.get(link.partner) ?? { failures: 0, text: null, oldest: null, never: false };
        if (link.consecutiveFailures > entry.failures) {
            entry.failures = link.consecutiveFailures;
            entry.text = link.resultText ?? null;
        }
        if (link.lastSuccess) {
            const at = Date.parse(link.lastSuccess);
            if (!Number.isNaN(at)) entry.oldest = entry.oldest === null ? at : Math.min(entry.oldest, at);
        } else if (link.lastAttempt) {
            // Tried, and never succeeded. A link nobody has tried yet is simply new.
            entry.never = true;
        }
        byPartner.set(link.partner, entry);
    }
    for (const [partner, entry] of byPartner) {
        // A partner that answers nothing is its own finding; that nothing replicates from it is no fault of this one.
        if (away.has(key(partner))) continue;
        if (entry.failures > 0) {
            add(
                "replication-failing",
                "error",
                `replication from ${partner} failed ${entry.failures} ${entry.failures === 1 ? "time" : "times"} in a row${entry.text ? ` (${entry.text})` : ""}`,
                partner,
            );
        } else if (entry.never) {
            add("replication-stale", "warning", `replication from ${partner} has never succeeded`, partner);
        } else if (entry.oldest !== null) {
            const ageSeconds = (options.now - entry.oldest) / 1000;
            if (ageSeconds > options.maxReplicationAgeMinutes * 60) {
                add("replication-stale", "warning", `last replicated from ${partner} ${formatDuration(ageSeconds)} ago`, partner);
            }
        }
    }

    if (typeof health.clockOffsetMs === "number") {
        const offsetSeconds = Math.abs(health.clockOffsetMs) / 1000;
        if (offsetSeconds > options.maxClockOffsetSeconds) {
            add(
                "clock-offset",
                "error",
                `its clock is ${formatDuration(offsetSeconds)} ${health.clockOffsetMs > 0 ? "ahead of" : "behind"} this server's`,
            );
        }
    }

    issues.push(...dbcheckIssues(dc, health, options));
    return issues;
}

/**
 * The database check is reported by the domain controller itself, on its own schedule, so
 * its findings do not depend on whether the last measurement reached it -- and a report
 * that stops coming is a finding of its own, or a dead cron job would read as "no errors".
 */
function dbcheckIssues(dc: DomainHealthController, health: DcHealth | null, options: DomainHealthOptions): DomainIssue[] {
    const { name } = dc;
    const issues: DomainIssue[] = [];
    const add = (type: DomainIssueType, text: string) =>
        issues.push({ id: issueId(type, name), type, severity: "warning", dc: name, dcId: dc.id, text: `${name}: ${text}` });

    const dbcheck = health?.dbcheck ?? null;
    if (dbcheck?.errors) {
        add("dbcheck-errors", `the database check found ${dbcheck.errors} ${dbcheck.errors === 1 ? "error" : "errors"}`);
    } else if (dbcheck && dbcheck.errors === null) {
        add("dbcheck-errors", `the database check could not be run${dbcheck.error ? ` (${dbcheck.error})` : ""}`);
    }

    if (dc.dbcheckSince) {
        // A token issued a moment ago is not a report that is late: the wait starts with it.
        const last = Math.max(Date.parse(dc.dbcheckSince) || 0, dbcheck ? Date.parse(dbcheck.receivedAt) || 0 : 0);
        const ageSeconds = (options.now - last) / 1000;
        if (ageSeconds > options.maxDbcheckAgeHours * 3600) {
            add(
                "dbcheck-overdue",
                dbcheck
                    ? `the last database check was reported ${formatDuration(ageSeconds)} ago`
                    : "no database check has been reported yet",
            );
        }
    }
    return issues;
}

/**
 * The DNS records a domain controller should have registered and has not.
 *
 * Every domain controller that answered was asked what its directory has of every domain
 * controller's records. They replicate, so normally they agree; a record counts as missing
 * when any of them misses it -- where only some do, the finding says which, and replication
 * has a finding of its own.
 *
 * One finding per domain controller, not per record: thirty missing records are one thing
 * that went wrong.
 */
function dcRecordsOf(
    dc: DomainHealthController,
    listed: readonly DomainHealthController[],
    measurements: Readonly<Record<string, DcHealth | undefined>>,
): ControllerDnsRecords | null {
    const missing = new Map<string, boolean>();
    const missingOn: string[] = [];
    let expected = 0;
    let askedOn = 0;
    for (const viewer of listed) {
        const mine = measurements[viewer.id]?.dcRecords?.controllers.find((entry) => entry.dcId.toLowerCase() === dc.id.toLowerCase());
        if (!mine) continue;
        askedOn++;
        expected = Math.max(expected, mine.expected);
        if (mine.missing.length > 0) missingOn.push(viewer.name);
        for (const { record, essential } of mine.missing) missing.set(record, (missing.get(record) ?? false) || essential);
    }
    if (askedOn === 0) return null;
    return {
        expected,
        // What a domain controller is not found without comes first, in the text as in the weight.
        missing: [...missing]
            .map(([record, essential]) => ({ record, essential }))
            .sort((a, b) => Number(b.essential) - Number(a.essential) || a.record.localeCompare(b.record)),
        missingOn: missingOn.sort(),
        askedOn,
    };
}

/** The finding for a domain controller's missing records; null for one that has them, or is not held to them yet. */
function dcRecordIssue(dc: DomainHealthController, records: ControllerDnsRecords | null, now: number): DomainIssue | null {
    if (!records || records.missing.length === 0) return null;
    // One that has just joined is still registering.
    if (dc.firstSeen && now - Date.parse(dc.firstSeen) < NEW_DC_GRACE_MS) return null;

    const names = records.missing.map(({ record }) => record);
    const more = names.length > NAMED_RECORDS ? ` and ${names.length - NAMED_RECORDS} more` : "";
    const where = records.missingOn.length < records.askedOn ? `, in the directory of ${records.missingOn.join(", ")}` : "";
    return {
        id: issueId("dc-records-missing", dc.name),
        type: "dc-records-missing",
        severity: records.missing.some(({ essential }) => essential) ? "error" : "warning",
        dc: dc.name,
        dcId: dc.id,
        text: `${dc.name}: ${names.length} of its ${records.expected} DNS records ${names.length === 1 ? "is" : "are"} missing${where}: ${names.slice(0, NAMED_RECORDS).join(", ")}${more}`,
    };
}

/**
 * What DNS still says about a domain controller that is none: a service record or a
 * replication alias for a host the directory does not list, an address under the domain's
 * name that is no domain controller's. What a demotion that was not finished leaves behind
 * -- and where clients are sent that then wait for an answer.
 */
function staleRecordIssues(measurements: Readonly<Record<string, DcHealth | undefined>>): DomainIssue[] {
    const byTarget = new Map<string, Set<string>>();
    for (const health of Object.values(measurements)) {
        for (const { target, type, name } of health?.dcRecords?.stale ?? []) {
            byTarget.set(target, (byTarget.get(target) ?? new Set()).add(`${type} ${name}`));
        }
    }
    return [...byTarget]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([target, records]) => {
            const names = [...records].sort();
            const more = names.length > NAMED_RECORDS ? ` and ${names.length - NAMED_RECORDS} more` : "";
            return {
                id: issueId("dns-stale-dc-record", "", target),
                type: "dns-stale-dc-record" as const,
                severity: "warning" as const,
                text: `DNS names ${target} as a domain controller, and the directory lists none there: ${names.slice(0, NAMED_RECORDS).join(", ")}${more}`,
            };
        });
}

/**
 * The least a secondary waits before it asks again, whatever the zone says: BIND does not
 * go below five minutes for a refresh (`min-refresh-time`) and 500 seconds for a retry
 * (`min-retry-time`) unless it is told to. A zone with a refresh of one minute would
 * otherwise have every such secondary reported as behind while it does what it should.
 */
const MIN_REFRESH_SECONDS = 300;
const MIN_RETRY_SECONDS = 500;

/** How long a secondary may be out of step with a zone before that is a finding: one refresh and one retry. */
export const secondaryGraceSeconds = (zone: { refresh?: number | null; retry?: number | null }): number =>
    Math.max(zone.refresh ?? 0, MIN_REFRESH_SECONDS) + Math.max(zone.retry ?? 0, MIN_RETRY_SECONDS);

/**
 * What is wrong with the name servers that are no domain controllers.
 *
 * One that does not answer is a finding for every client a zone sends there. One that
 * answers with another serial number than the domain controllers is a secondary that has
 * not transferred the zone -- but only once that has lasted longer than the zone allows:
 * after every change a secondary is behind until it next asks, which is how it is meant
 * to work.
 */
function nameServerIssues(servers: readonly DnsServerHealth[]): DomainIssue[] {
    const issues: DomainIssue[] = [];
    const add = (type: DomainIssueType, severity: IssueSeverity, about: string, text: string) =>
        issues.push({ id: issueId(type, "", about), type, severity, text });

    for (const server of [...servers].sort((a, b) => a.name.localeCompare(b.name))) {
        // A zone sends its clients to a server it lists. One only the configuration knows is asked by nobody else.
        const downSeverity: IssueSeverity = server.source === "ns" ? "error" : "warning";
        if (!server.ok) {
            add("dns-server-down", downSeverity, server.name, `Name server ${server.name}: does not answer${server.detail ? ` (${server.detail})` : ""}`);
            continue;
        }
        const measuredAt = Date.parse(server.collectedAt);
        for (const zone of server.zones) {
            const about = `${server.name}/${zone.zone.toLowerCase()}`;
            if (!zone.ok) {
                add(
                    "dns-server-down",
                    downSeverity,
                    about,
                    `Name server ${server.name}: does not answer for the zone ${zone.zone}${zone.detail ? `: ${zone.detail}` : ""}`,
                );
                continue;
            }
            if (!zone.outOfSyncSince || typeof zone.serial !== "number" || typeof zone.referenceSerial !== "number") continue;
            const order = compareSerial(zone.serial, zone.referenceSerial);
            if (order === 0) continue;
            // Measured still out of step later than a refresh and a retry after it was first seen so.
            const sinceMs = Date.parse(zone.outOfSyncSince);
            const lastedSeconds = (measuredAt - sinceMs) / 1000;
            if (Number.isNaN(lastedSeconds) || lastedSeconds <= secondaryGraceSeconds(zone)) continue;
            const serials = `serial ${zone.serial}, the domain controllers serve ${zone.referenceSerial}`;
            if (order < 0) {
                add(
                    "dns-secondary-behind",
                    "warning",
                    about,
                    `Name server ${server.name}: has not caught up with the zone ${zone.zone} for ${formatDuration(lastedSeconds)} (${serials})`,
                );
            } else {
                add(
                    "dns-secondary-ahead",
                    "warning",
                    about,
                    `Name server ${server.name}: is ahead of the zone ${zone.zone} and transfers nothing until the domain controllers pass it (${serials})`,
                );
            }
        }
    }
    return issues;
}

export function buildDomainHealth(
    listed: readonly DomainHealthController[],
    measurements: Readonly<Record<string, DcHealth | undefined>>,
    options: Partial<DomainHealthOptions> = {},
    nameServers: readonly DnsServerHealth[] = [],
): DomainHealth {
    const settings: DomainHealthOptions = { ...DEFAULT_DOMAIN_HEALTH_OPTIONS, now: Date.now(), ...options };
    const controllers = new Map<string, ControllerHealth>();
    const away = new Set(listed.filter((dc) => measurements[dc.id] && answersNothing(measurements[dc.id]!)).map((dc) => key(dc.name)));

    for (const dc of listed) {
        const health = measurements[dc.id] ?? null;
        const issues = health ? controllerIssues(dc, health, settings, away) : dbcheckIssues(dc, null, settings);
        const dnsRecords = dcRecordsOf(dc, listed, measurements);
        // One that answers nothing is reported as that and nothing else.
        const answersNothing = issues.some((issue) => issue.type === "dc-unreachable");
        const recordIssue = answersNothing ? null : dcRecordIssue(dc, dnsRecords, settings.now);
        if (recordIssue) issues.push(recordIssue);
        controllers.set(key(dc.name), {
            id: dc.id,
            name: dc.name,
            dnsHostName: health?.identity?.dnsHostName ?? dc.dnsHostName ?? null,
            site: health?.identity?.site ?? dc.site ?? null,
            health,
            roles: [],
            isGlobalCatalog: health?.identity?.isGlobalCatalog ?? null,
            dnsRecords,
            // Nothing can be said about one that has not been measured yet.
            status: health ? worst(issues) : "unknown",
            issues,
        });
    }

    // What counts for the domain is what the domain controllers that answered say about it.
    const views = [...controllers.values()].flatMap((dc) => (dc.health?.domain ? [{ dc, view: dc.health.domain }] : []));

    // What a domain controller that does not answer cannot say of itself, the others can.
    for (const { view } of views) {
        for (const other of view.controllers) {
            const existing = controllers.get(key(other.name));
            if (existing) existing.isGlobalCatalog ??= other.isGlobalCatalog ?? null;
        }
    }

    const domainIssues: DomainIssue[] = [];
    const fsmo = {} as DomainHealth["fsmo"];
    for (const role of FSMO_ROLES) {
        const holders = [...new Set(views.map(({ view }) => view.fsmo[role]).filter((h): h is string => !!h).map(key))];
        const named = holders.map((holder) => controllers.get(holder)?.name ?? holder);
        fsmo[role] = { holder: named.length === 1 ? named[0] : null, holders: named };
        if (views.length === 0) continue;
        if (named.length === 0) {
            domainIssues.push({
                id: issueId("fsmo-missing", "", role),
                type: "fsmo-missing",
                severity: "error",
                text: `${FSMO_ROLE_LABELS[role]}: no domain controller holds the role`,
            });
        } else if (named.length > 1) {
            domainIssues.push({
                id: issueId("fsmo-conflict", "", role),
                type: "fsmo-conflict",
                severity: "error",
                text: `${FSMO_ROLE_LABELS[role]}: the domain controllers disagree about who holds it (${named.join(", ")})`,
            });
        } else {
            controllers.get(holders[0])?.roles.push(role);
        }
    }

    domainIssues.push(...nameServerIssues(nameServers), ...staleRecordIssues(measurements));

    const list = [...controllers.values()].sort((a, b) => a.name.localeCompare(b.name));
    const issues = [...domainIssues, ...list.flatMap((dc) => dc.issues)];
    const first = views[0]?.view ?? null;
    // The newest count: the domain controllers replicate, so they agree within moments.
    const counted = views
        .filter(({ view }) => view.counts)
        .sort((a, b) => (a.dc.health!.collectedAt < b.dc.health!.collectedAt ? 1 : -1))[0]?.view.counts;

    return {
        // Without a single domain controller that answered, nothing can be said about the domain.
        status: views.length === 0 && issues.length === 0 ? "unknown" : worst(issues),
        dnsName: first?.dnsName ?? null,
        dn: first?.dn ?? null,
        domainLevel: first?.domainLevel ?? null,
        forestLevel: first?.forestLevel ?? null,
        controllers: list,
        fsmo,
        counts: counted ? { users: counted.users, groups: counted.groups, computers: counted.computers } : null,
        nameServers: [...nameServers].sort((a, b) => a.name.localeCompare(b.name)),
        issues,
    };
}

/** How a functional level reads: the Windows Server release it stands for. */
export function functionalLevelLabel(level: number | null | undefined): string {
    switch (level) {
        case 0:
            return "2000";
        case 2:
            return "2003";
        case 3:
            return "2008";
        case 4:
            return "2008 R2";
        case 5:
            return "2012";
        case 6:
            return "2012 R2";
        case 7:
            return "2016";
        default:
            return level === null || level === undefined ? "–" : String(level);
    }
}
