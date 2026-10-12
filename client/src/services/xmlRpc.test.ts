import { describe, expect, it } from "vitest";
import { parseXmlRpcResponse, xmlRpcCall } from "./xmlRpc.js";

const response = (value: string) => `<?xml version='1.0'?>\n<methodResponse>\n<params>\n<param>\n${value}\n</param>\n</params>\n</methodResponse>\n`;

describe("parseXmlRpcResponse", () => {
    // What supervisord answers `supervisor.getAllProcessInfo` with, shortened to two fields each.
    it("reads an array of structs, as supervisord lists its processes", () => {
        const xml = response(
            `<value><array><data>
<value><struct>
<member><name>name</name><value><string>samba</string></value></member>
<member><name>state</name><value><int>20</int></value></member>
<member><name>statename</name><value><string>RUNNING</string></value></member>
</struct></value>
<value><struct>
<member><name>name</name><value><string>bind</string></value></member>
<member><name>spawnerr</name><value><string></string></value></member>
<member><name>exitstatus</name><value><i4>-1</i4></value></member>
</struct></value>
</data></array></value>`,
        );
        expect(parseXmlRpcResponse(xml)).toEqual([
            { name: "samba", state: 20, statename: "RUNNING" },
            { name: "bind", spawnerr: "", exitstatus: -1 },
        ]);
    });

    it("reads a value without a type as a string, and unescapes what XML escapes", () => {
        expect(parseXmlRpcResponse(response("<value>a &lt; b &amp; c</value>"))).toBe("a < b & c");
        expect(parseXmlRpcResponse(response("<value><string>caf&#233;</string></value>"))).toBe("café");
    });

    it("reads booleans, empty strings and empty arrays", () => {
        expect(parseXmlRpcResponse(response("<value><boolean>1</boolean></value>"))).toBe(true);
        expect(parseXmlRpcResponse(response("<value><string/></value>"))).toBe("");
        expect(parseXmlRpcResponse(response("<value><array><data></data></array></value>"))).toEqual([]);
    });

    it("throws a fault with the reason the server gave", () => {
        const fault = `<methodResponse><fault><value><struct>
<member><name>faultCode</name><value><int>1</int></value></member>
<member><name>faultString</name><value><string>UNKNOWN_METHOD</string></value></member>
</struct></value></fault></methodResponse>`;
        expect(() => parseXmlRpcResponse(fault)).toThrow("UNKNOWN_METHOD");
    });

    it("refuses what is no response, and a type it does not read", () => {
        expect(() => parseXmlRpcResponse("<html><body>502</body></html>")).toThrow("Not an XML-RPC response");
        expect(() => parseXmlRpcResponse(response("<value><base64>AAAA</base64></value>"))).toThrow("unsupported type <base64>");
    });
});

describe("xmlRpcCall", () => {
    it("writes a call without parameters", () => {
        expect(xmlRpcCall("supervisor.getAllProcessInfo")).toContain("<methodName>supervisor.getAllProcessInfo</methodName>");
    });
});
