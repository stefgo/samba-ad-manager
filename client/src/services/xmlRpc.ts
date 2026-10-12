/**
 * Just enough XML-RPC to ask supervisord what it runs: one call without parameters, and the
 * value that comes back.
 *
 * supervisord has no other interface that answers with data -- `supervisorctl status` is
 * this same call, printed as a table. The response is a document of nested `<value>`
 * elements, read here into plain JavaScript values. Nothing else is supported, on purpose:
 * no parameters, no `dateTime`, no `base64`. A type this reader does not know is an error
 * rather than a guess.
 */

export type XmlRpcValue = string | number | boolean | null | XmlRpcValue[] | { [key: string]: XmlRpcValue };

/** The request for a method that takes no parameters. */
export const xmlRpcCall = (method: string): string =>
    `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params></params></methodCall>`;

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

const unescape = (text: string): string =>
    text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
        if (name[0] === "#") {
            const code = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[name.toLowerCase()] ?? whole;
    });

type Token = { kind: "open" | "close" | "empty"; name: string } | { kind: "text"; text: string };

function tokenize(xml: string): Token[] {
    const tokens: Token[] = [];
    const pattern = /<\?[^>]*\?>|<!--[\s\S]*?-->|<(\/?)([A-Za-z0-9_.]+)[^>]*?(\/?)>|([^<]+)/g;
    for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) {
        if (match[2]) {
            tokens.push({ kind: match[1] ? "close" : match[3] ? "empty" : "open", name: match[2] });
        } else if (match[4] !== undefined) {
            tokens.push({ kind: "text", text: match[4] });
        }
    }
    return tokens;
}

/**
 * The value a `methodResponse` carries. Throws on a fault -- with the fault's own words --
 * and on a document that is not a response.
 */
export function parseXmlRpcResponse(xml: string): XmlRpcValue {
    const tokens = tokenize(xml);
    let at = 0;

    const skipSpace = () => {
        while (at < tokens.length) {
            const token = tokens[at];
            if (token.kind !== "text" || token.text.trim() !== "") break;
            at++;
        }
    };
    const open = (name: string) => {
        skipSpace();
        const token = tokens[at];
        if (!token || token.kind !== "open" || token.name !== name) throw new Error(`Not an XML-RPC response: expected <${name}>`);
        at++;
    };
    const close = (name: string) => {
        skipSpace();
        const token = tokens[at];
        if (!token || token.kind !== "close" || token.name !== name) throw new Error(`Not an XML-RPC response: expected </${name}>`);
        at++;
    };
    const peekOpen = (name: string): boolean => {
        skipSpace();
        const token = tokens[at];
        return !!token && token.kind === "open" && token.name === name;
    };
    /** The text up to the next tag, as it stands. */
    const text = (): string => {
        let out = "";
        while (at < tokens.length) {
            const token = tokens[at];
            if (token.kind !== "text") break;
            out += token.text;
            at++;
        }
        return unescape(out);
    };

    const value = (): XmlRpcValue => {
        open("value");
        const token = tokens[at];
        // No type element at all: the content is a string, white space included.
        if (token && token.kind === "text" && token.text.trim() !== "") {
            const bare = text();
            close("value");
            return bare;
        }
        skipSpace();
        const typed = tokens[at];
        if (!typed || typed.kind === "close") {
            close("value");
            return "";
        }
        if (typed.kind === "empty") {
            at++;
            close("value");
            if (typed.name === "string") return "";
            if (typed.name === "nil") return null;
            throw new Error(`Not an XML-RPC response: empty <${typed.name}/>`);
        }
        if (typed.kind !== "open") throw new Error("Not an XML-RPC response: text after a value");
        at++;
        let result: XmlRpcValue;
        switch (typed.name) {
            case "string":
                result = text();
                break;
            case "int":
            case "i4":
            case "i8":
            case "double": {
                result = Number(text().trim());
                if (!Number.isFinite(result)) throw new Error(`Not an XML-RPC response: <${typed.name}> is no number`);
                break;
            }
            case "boolean":
                result = text().trim() === "1";
                break;
            case "array": {
                const items: XmlRpcValue[] = [];
                open("data");
                while (peekOpen("value")) items.push(value());
                close("data");
                result = items;
                break;
            }
            case "struct": {
                const members: { [key: string]: XmlRpcValue } = {};
                while (peekOpen("member")) {
                    open("member");
                    open("name");
                    const name = text();
                    close("name");
                    members[name] = value();
                    close("member");
                }
                result = members;
                break;
            }
            default:
                throw new Error(`Not an XML-RPC response: unsupported type <${typed.name}>`);
        }
        close(typed.name);
        close("value");
        return result;
    };

    open("methodResponse");
    if (peekOpen("fault")) {
        open("fault");
        const fault = value();
        const reason = fault && typeof fault === "object" && !Array.isArray(fault) ? fault.faultString : null;
        throw new Error(typeof reason === "string" ? reason : "The call failed");
    }
    open("params");
    open("param");
    const result = value();
    close("param");
    close("params");
    close("methodResponse");
    return result;
}
