import { CLIENT_STATUS } from "./constants.js";
import { DC_PORTS, FSMO_ROLES, FSMO_ROLE_LABELS, type DcHealth, type FsmoRole } from "./dcHealth.js";

/**
 * The domain as a whole, derived from what every agent last measured. Never stored: the
 * backend's events and the dashboard both call `buildDomainHealth` on the same input, so
 * they cannot disagree about what is wrong.
 *
 * A single domain controller can only speak for itself. Whether two of them disagree about
 * who holds a role, whether one has fallen behind, whether a clock has drifted -- that only
 * shows when their measurements are laid next to each other, which is what happens here.
 */

export type DomainStatus = "healthy" | "degraded" | "critical" | "unknown";
export type IssueSeverity = "warning" | "error";

export type DomainIssueType =
    | "agent-offline"
    | "no-agent"
    | "container-stopped"
    | "container-unhealthy"
    | "ldap-unreachable"
    | "samba-not-running"
    | "port-closed"
    | "not-synchronized"
    | "replication-failing"
    | "replication-stale"
    | "fsmo-missing"
    | "fsmo-conflict"
    | "clock-offset"
    | "dbcheck-errors";

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
    /** The client behind that domain controller, where there is one, for a link to its page. */
    clientId?: string;
    text: string;
}

/** What `buildDomainHealth` needs to know of a client. */
export interface DomainHealthClient {
    id: string;
    hostname?: string | null;
    displayName?: string | null;
    status?: string | null;
}

/** One domain controller: what the directory lists, joined with the agent next to it. */
export interface DomainController {
    /** The server's name in the directory, upper case as Samba writes it; the client's name without a measurement. */
    name: string;
    dnsHostName: string | null;
    site: string | null;
    /** Null for a domain controller the directory lists and no agent reports for. */
    clientId: string | null;
    /** Whether its agent is connected. */
    online: boolean;
    /** The last measurement, however old. Stale while the agent is offline. */
    health: DcHealth | null;
    /** The roles the domain controllers agree it holds. */
    roles: FsmoRole[];
    isGlobalCatalog: boolean | null;
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
    controllers: DomainController[];
    /** Who holds each role. `holders` has more than one entry where the DCs disagree. */
    fsmo: Record<FsmoRole, { holder: string | null; holders: string[] }>;
    counts: { users: number; groups: number; computers: number } | null;
    /** Every finding, the domain's own first, then by domain controller. */
    issues: DomainIssue[];
}

export interface DomainHealthOptions {
    /** From when on a clock is too far off. Kerberos refuses at five minutes. */
    maxClockOffsetSeconds: number;
    /** How old the last successful replication of a link may be. */
    maxReplicationAgeMinutes: number;
    /** The moment the ages are measured against. */
    now: number;
}

export const DEFAULT_DOMAIN_HEALTH_OPTIONS = {
    maxClockOffsetSeconds: 300,
    maxReplicationAgeMinutes: 60,
} as const;

/** The Samba services without which a domain controller does not serve the directory. */
const REQUIRED_PROCESSES = ["ldap_server", "kdc_server", "rpc_server", "dreplsrv"] as const;

const key = (name: string) => name.toUpperCase();

const issueId = (type: DomainIssueType, dc = "", about = ""): string => `${type}|${key(dc)}|${about}`;

/**
 * The thresholds as the settings block holds them, with the defaults for what is missing or
 * no number. The server's events and the dashboard both read them through here.
 */
export function domainHealthOptionsFromSettings(
    settings: Readonly<Record<string, unknown>>,
): Pick<DomainHealthOptions, "maxClockOffsetSeconds" | "maxReplicationAgeMinutes"> {
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
    };
}

function clientLabel(client: DomainHealthClient): string {
    return client.displayName || client.hostname || client.id;
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

/**
 * What one measurement says is wrong with the domain controller it came from. Only for a
 * connected agent: the last measurement of one that is away describes a moment that is over.
 */
function controllerIssues(name: string, clientId: string, health: DcHealth, options: DomainHealthOptions): DomainIssue[] {
    const issues: DomainIssue[] = [];
    const add = (type: DomainIssueType, severity: IssueSeverity, text: string, about = "") =>
        issues.push({ id: issueId(type, name, about), type, severity, dc: name, clientId, text: `${name}: ${text}` });

    const container = health.container;
    if (container && !container.running) {
        add("container-stopped", "error", `the Samba container is ${container.state}`);
        // Everything else would only repeat that Samba is not there.
        return issues;
    }
    if (container?.health === "unhealthy") {
        add("container-unhealthy", "warning", "the Samba container reports itself unhealthy");
    }

    const ldapError = health.errors.find((error) => error.source === "ldap");
    if (!health.identity && ldapError) {
        add("ldap-unreachable", "error", `the directory does not answer (${ldapError.message})`);
    }

    if (health.processes) {
        const running = new Set(health.processes.filter((p) => p.pids.length > 0).map((p) => p.name));
        const missing = REQUIRED_PROCESSES.filter((service) => !running.has(service));
        if (missing.length > 0) {
            add("samba-not-running", "error", `Samba service not running: ${missing.join(", ")}`);
        }
    }

    for (const port of health.ports ?? []) {
        if (port.open) continue;
        const required = DC_PORTS.find((known) => known.port === port.port)?.required ?? false;
        add("port-closed", required ? "error" : "warning", `${port.name} (port ${port.port}) does not answer`, String(port.port));
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

    if (health.dbcheck?.errors) {
        add(
            "dbcheck-errors",
            "warning",
            `the database check found ${health.dbcheck.errors} ${health.dbcheck.errors === 1 ? "error" : "errors"}`,
        );
    }

    return issues;
}

export function buildDomainHealth(
    clients: readonly DomainHealthClient[],
    measurements: Readonly<Record<string, DcHealth | undefined>>,
    options: Partial<DomainHealthOptions> = {},
): DomainHealth {
    const settings: DomainHealthOptions = { ...DEFAULT_DOMAIN_HEALTH_OPTIONS, now: Date.now(), ...options };
    const controllers = new Map<string, DomainController>();
    const domainIssues: DomainIssue[] = [];

    // The agents first: each is a domain controller, named by what it measured.
    for (const client of clients) {
        const health = measurements[client.id] ?? null;
        const online = client.status === CLIENT_STATUS.ONLINE;
        const name = health?.identity?.name ?? health?.dcName ?? clientLabel(client);
        const issues: DomainIssue[] = [];
        if (!online) {
            issues.push({
                id: issueId("agent-offline", name),
                type: "agent-offline",
                severity: "warning",
                dc: name,
                clientId: client.id,
                text: `${name}: its agent is offline, nothing is known about it`,
            });
        } else if (health) {
            issues.push(...controllerIssues(name, client.id, health, settings));
        }
        controllers.set(key(name), {
            name,
            dnsHostName: health?.identity?.dnsHostName ?? null,
            site: health?.identity?.site ?? null,
            clientId: client.id,
            online,
            health,
            roles: [],
            isGlobalCatalog: health?.identity?.isGlobalCatalog ?? null,
            // An offline agent says nothing about its DC, and neither does one that has not measured yet.
            status: !online || !health ? "unknown" : worst(issues),
            issues,
        });
    }

    // What counts for the domain is what connected agents measured.
    const live = [...controllers.values()].filter((dc) => dc.online && dc.health?.domain);
    const views = live.map((dc) => ({ dc, view: dc.health!.domain! }));

    // Then the domain controllers the directory lists and nobody reports for.
    for (const { view } of views) {
        for (const listed of view.controllers) {
            const existing = controllers.get(key(listed.name));
            if (existing) {
                existing.dnsHostName ??= listed.dnsHostName ?? null;
                existing.site ??= listed.site ?? null;
                existing.isGlobalCatalog ??= listed.isGlobalCatalog ?? null;
                continue;
            }
            const issue: DomainIssue = {
                id: issueId("no-agent", listed.name),
                type: "no-agent",
                severity: "warning",
                dc: listed.name,
                text: `${listed.name}: is a domain controller of this domain, but no agent is registered for it`,
            };
            controllers.set(key(listed.name), {
                name: listed.name,
                dnsHostName: listed.dnsHostName ?? null,
                site: listed.site ?? null,
                clientId: null,
                online: false,
                health: null,
                roles: [],
                isGlobalCatalog: listed.isGlobalCatalog ?? null,
                status: "unknown",
                issues: [issue],
            });
        }
    }

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

    const list = [...controllers.values()].sort((a, b) => a.name.localeCompare(b.name));
    const issues = [...domainIssues, ...list.flatMap((dc) => dc.issues)];
    const first = views[0]?.view ?? null;
    // The newest count: the domain controllers replicate, so they agree within moments.
    const counted = views
        .filter(({ view }) => view.counts)
        .sort((a, b) => (a.dc.health!.collectedAt < b.dc.health!.collectedAt ? 1 : -1))[0]?.view.counts;

    return {
        // Without a single measurement of a connected agent nothing can be said.
        status: views.length === 0 ? "unknown" : worst(issues),
        dnsName: first?.dnsName ?? null,
        dn: first?.dn ?? null,
        domainLevel: first?.domainLevel ?? null,
        forestLevel: first?.forestLevel ?? null,
        controllers: list,
        fsmo,
        counts: counted ? { users: counted.users, groups: counted.groups, computers: counted.computers } : null,
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
