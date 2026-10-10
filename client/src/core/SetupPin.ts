import crypto from "crypto";
import { logger } from "@sadm/shared/node";
import { DEFAULT_AGENT_PORT } from "@sadm/shared";
import { config } from "./Config.js";
import { getIdentity } from "./Identity.js";

/**
 * The PIN that guards registration -- `POST /api/register` on the agent's own web server,
 * where the agent is pointed at a server (inbound), and `/ws/register`, where a server
 * dials in and hands the agent its identity (outbound).
 *
 * Both decide which server this agent trusts from then on. They listen on every interface,
 * and whoever registers the agent receives what it reports about this host and can make it
 * change the directory. Before this PIN, anyone who could reach the agent's web port could do
 * that through the register page, and outbound registration needed a secret the operator had
 * to write into config.yaml first.
 *
 * So the check is a shared secret that is printed to the agent's log, where only someone who
 * can already read the machine's logs (`docker logs sadm-client`) can see it. An agent given
 * `SADM_REGISTRATION_SECRET` for an unattended rollout accepts that on `/ws/register` as well.
 *
 * The PIN exists only while the agent has no identity: with the register page enabled, or
 * while it waits for an outbound registration and has no secret. It is dropped with the
 * registration, and the register page closes with it -- registering again means deleting
 * identity.json and restarting the agent, which prints a new PIN.
 *
 * Deliberately never persisted to config.yaml: it is regenerated on every start, and what is
 * never written never has to be cleaned up.
 */

/**
 * No 0/O, no 1/I/L. The PIN is read off a terminal and typed into a browser on another
 * machine, so the characters that are routinely confused there are simply absent.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP = 4;
const GROUPS = 2;

/** Failed attempts before the PIN is rotated, ending an online brute force. */
const MAX_ATTEMPTS = 5;

let currentPin: string | null = null;
let failedAttempts = 0;
let webUiPort = DEFAULT_AGENT_PORT;

/** Where the PIN can be used, so the log names only the ways that are open. */
export interface SetupPinUses {
    /** The register page is served. */
    registerPage: boolean;
    /** The agent serves `/ws/register`; named in the log only while it is unregistered. */
    outbound: boolean;
}

let uses: SetupPinUses = { registerPage: true, outbound: false };

function generate(): string {
    const groups: string[] = [];
    for (let g = 0; g < GROUPS; g++) {
        let group = "";
        for (let i = 0; i < GROUP; i++) {
            // randomInt over the alphabet length, not a byte modulo it: 256 is not a
            // multiple of 31, so the modulo would favour the first characters.
            group += ALPHABET[crypto.randomInt(ALPHABET.length)];
        }
        groups.push(group);
    }
    return groups.join("-");
}

/** Strips the cosmetic hyphen and case, so what the operator types matches what we made. */
function normalize(value: string): string {
    return value.trim().toUpperCase().replace(/-/g, "");
}

/** Writes the PIN and the page it belongs to into the log as one block an operator can spot. */
function logPin(pin: string): void {
    const rule = "─".repeat(46);
    logger.info(rule);
    logger.info(`  Setup PIN:  ${pin}`);
    if (uses.registerPage) {
        // The scheme follows what the web server was actually started with; an operator sent
        // to http:// on a TLS agent would get a connection reset and no idea why.
        const scheme = config.tls ? "https" : "http";
        logger.info(`  Web UI:     ${scheme}://<this-host>:${webUiPort}/register`);
    }
    if (uses.outbound && !getIdentity()) {
        logger.info("  Outbound:   enter it in the server's Add Client wizard");
    }
    logger.info("  The PIN is required to register this agent.");
    logger.info(rule);
}

/** Creates the PIN for this process and logs it. Called once the web server listens. */
export function initSetupPin(port: number, pinUses: SetupPinUses): void {
    webUiPort = port;
    uses = pinUses;
    rotateSetupPin();
}

/** Replaces the PIN with a new one and logs it. */
export function rotateSetupPin(): void {
    currentPin = generate();
    failedAttempts = 0;
    logPin(currentPin);
}

/**
 * Drops the PIN without a successor: a registration has used it, and a registered agent has
 * nothing left it could open.
 */
export function retireSetupPin(): void {
    currentPin = null;
    failedAttempts = 0;
}

/**
 * Checks a PIN presented by a caller.
 *
 * After MAX_ATTEMPTS failures the PIN is rotated and the new one logged. That ends an online
 * guessing attack without locking the operator out permanently — they read the new value
 * from the same place they read the first one.
 */
export function verifySetupPin(input: string): boolean {
    if (!currentPin) return false;

    const expected = Buffer.from(normalize(currentPin), "utf8");
    const actual = Buffer.from(normalize(input), "utf8");

    // timingSafeEqual throws on a length mismatch, so the lengths are compared first. That
    // leaks only the length of a fixed-format PIN, which is public anyway.
    const ok =
        expected.length === actual.length &&
        crypto.timingSafeEqual(expected, actual);

    if (ok) {
        failedAttempts = 0;
        return true;
    }

    failedAttempts++;
    if (failedAttempts >= MAX_ATTEMPTS) {
        logger.warn(
            { attempts: failedAttempts },
            "Too many failed setup PIN attempts — rotating the PIN",
        );
        rotateSetupPin();
    }
    return false;
}
