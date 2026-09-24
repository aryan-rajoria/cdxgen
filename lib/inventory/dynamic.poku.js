import esmock from "esmock";
import { assert, describe, it } from "poku";

import {
  groupHttpEntriesToServices,
  parseEgressEntries,
} from "./traceRunner.js";

describe("groupHttpEntriesToServices()", () => {
  it("returns empty object for empty input", () => {
    const result = groupHttpEntriesToServices([]);
    assert.deepEqual(result, {});
  });

  it("groups entries by host and port", () => {
    const entries = [
      {
        method: "GET",
        host: "api.example.com",
        path: "/v1/users",
        port: 443,
        protocol: "https",
      },
      {
        method: "POST",
        host: "api.example.com",
        path: "/v1/users",
        port: 443,
        protocol: "https",
      },
      {
        method: "GET",
        host: "other.example.com",
        path: "/health",
        port: 443,
        protocol: "https",
      },
    ];
    const result = groupHttpEntriesToServices(entries);
    const keys = Object.keys(result);
    assert.strictEqual(keys.length, 2);
    assert.ok(keys[0].includes("api.example.com"));
    assert.ok(keys[1].includes("other.example.com"));
  });

  it("collects endpoints as a Set of full URLs", () => {
    const entries = [
      {
        method: "GET",
        host: "api.example.com",
        path: "/v1/users",
        port: 443,
        protocol: "https",
      },
    ];
    const result = groupHttpEntriesToServices(entries);
    const service = result[Object.keys(result)[0]];
    assert.ok(service.endpoints instanceof Set);
    assert.strictEqual(service.endpoints.size, 1);
    assert.ok(service.endpoints.has("https://api.example.com/v1/users"));
  });

  it("includes port in endpoint when non-default", () => {
    const entries = [
      {
        method: "GET",
        host: "api.example.com",
        path: "/health",
        port: 8080,
        protocol: "http",
      },
    ];
    const result = groupHttpEntriesToServices(entries);
    const service = result[Object.keys(result)[0]];
    assert.ok(service.endpoints.has("http://api.example.com:8080/health"));
  });

  it("adds httpMethod property for each unique method", () => {
    const entries = [
      {
        method: "GET",
        host: "api.example.com",
        path: "/v1/users",
        port: 443,
        protocol: "https",
      },
      {
        method: "POST",
        host: "api.example.com",
        path: "/v1/users",
        port: 443,
        protocol: "https",
      },
    ];
    const result = groupHttpEntriesToServices(entries);
    const service = result[Object.keys(result)[0]];
    const methods = service.properties.filter(
      (p) => p.name === "cdx:service:httpMethod",
    );
    assert.strictEqual(methods.length, 2);
    assert.ok(methods.some((p) => p.value === "GET"));
    assert.ok(methods.some((p) => p.value === "POST"));
  });

  it("deduplicates httpMethod properties", () => {
    const entries = [
      {
        method: "GET",
        host: "api.example.com",
        path: "/v1/users",
        port: 443,
        protocol: "https",
      },
      {
        method: "GET",
        host: "api.example.com",
        path: "/v1/items",
        port: 443,
        protocol: "https",
      },
    ];
    const result = groupHttpEntriesToServices(entries);
    const service = result[Object.keys(result)[0]];
    const methods = service.properties.filter(
      (p) => p.name === "cdx:service:httpMethod",
    );
    assert.strictEqual(methods.length, 1);
  });

  it("records only query parameter names, never their values", () => {
    const entries = [
      {
        method: "GET",
        host: "api.example.com",
        path: "/search",
        port: 443,
        protocol: "https",
        query: "q=test&token=s3cr3t&q=again",
      },
    ];
    const result = groupHttpEntriesToServices(entries);
    const service = result[Object.keys(result)[0]];
    const queries = service.properties.filter(
      (p) => p.name === "cdx:dynamic:httpQueryParams",
    );
    assert.strictEqual(queries.length, 1);
    assert.strictEqual(queries[0].value, "q,token");
    assert.ok(!JSON.stringify(service.properties).includes("s3cr3t"));
  });

  it("uses the http scheme and default port for plain-HTTP entries", () => {
    const result = groupHttpEntriesToServices([
      { method: "GET", host: "h.example.com", port: 80, protocol: "http" },
    ]);
    const service = result[Object.keys(result)[0]];
    assert.ok(service.endpoints.has("http://h.example.com/"));
  });

  it("handles entries without a path", () => {
    const entries = [
      { method: "GET", host: "api.example.com", port: 443, protocol: "https" },
    ];
    const result = groupHttpEntriesToServices(entries);
    const service = result[Object.keys(result)[0]];
    assert.ok(service.endpoints.has("https://api.example.com/"));
  });
});

describe("parseEgressEntries()", () => {
  it("maps proxy-connect and proxy-violation audit entries to authorities", () => {
    const entries = parseEgressEntries([
      {
        type: "proxy-connect",
        target: "registry.npmjs.org:443",
        details: "connect",
      },
      {
        type: "proxy-connect",
        target: "registry.npmjs.org:443",
        details: "connect",
      },
      {
        type: "proxy-connect",
        target: "mirror.example.org:8080",
        details: "http",
      },
      { type: "proxy-violation", target: "CONNECT evil.example.com:443" },
      {
        type: "proxy-violation",
        target: "GET http://leak.example.com/p?token=x",
      },
      { type: "proxy-violation", target: "CONNECT [2001:db8::1]:443" },
      { type: "file-read", target: "/etc/hosts" },
    ]);
    assert.deepEqual(entries, [
      {
        host: "registry.npmjs.org",
        port: 443,
        protocol: "https",
        decision: "allowed",
      },
      {
        host: "mirror.example.org",
        port: 8080,
        protocol: "http",
        decision: "allowed",
      },
      {
        host: "evil.example.com",
        port: 443,
        protocol: "https",
        decision: "denied",
      },
      {
        host: "leak.example.com",
        port: 80,
        protocol: "http",
        decision: "denied",
      },
      { host: "2001:db8::1", port: 443, protocol: "https", decision: "denied" },
    ]);
  });

  it("returns an empty list without an audit log", () => {
    assert.deepEqual(parseEgressEntries(undefined), []);
  });
});

describe("buildDynamicComponents() egress services", () => {
  it("adds proxy egress decisions as services and returns the dry-run summary", async () => {
    const { buildDynamicComponents } = await esmock("./dynamic.js", {
      "./traceRunner.js": {
        executeAndTrace: async () => ({
          libPaths: [],
          httpAccessEntries: [],
          egressEntries: [
            {
              host: "registry.npmjs.org",
              port: 443,
              protocol: "https",
              decision: "allowed",
            },
            {
              host: "evil.example.com",
              port: 443,
              protocol: "https",
              decision: "denied",
            },
          ],
          dryRunSummary: { totalEvents: 2 },
        }),
        groupHttpEntriesToServices,
      },
    });
    const { services, dryRunSummary } = await buildDynamicComponents("true");
    assert.deepEqual(
      services.map((s) => [s.name, s.endpoints, s.properties[0].value]),
      [
        [
          "dynamic-registry.npmjs.org-443",
          ["https://registry.npmjs.org"],
          "allowed",
        ],
        [
          "dynamic-evil.example.com-443",
          ["https://evil.example.com"],
          "denied",
        ],
      ],
    );
    assert.deepEqual(dryRunSummary, { totalEvents: 2 });
  });
});
