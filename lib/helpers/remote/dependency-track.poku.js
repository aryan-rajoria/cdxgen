import { assert, describe, it } from "poku";

import { parseMultipartFormData } from "../../cli/bomTestHelpers.poku.js";
import {
  buildDependencyTrackBomPayload,
  buildDependencyTrackBomRequest,
  encodeMultipartFormData,
  getDependencyTrackBomApiUrl,
  getDependencyTrackBomUrl,
} from "./dependency-track.js";

function parseRequest(request) {
  return parseMultipartFormData(
    request.body.toString("utf8"),
    request.contentType,
  );
}

describe("Dependency-Track helper tests", () => {
  it("returns submission URL without trailing slash duplication", () => {
    assert.strictEqual(
      getDependencyTrackBomUrl("https://dtrack.example.com/"),
      "https://dtrack.example.com/api/v1/bom",
    );
    assert.strictEqual(
      getDependencyTrackBomUrl("https://dtrack.example.com"),
      "https://dtrack.example.com/api/v1/bom",
    );
  });

  it("removes credentials, query strings, and fragments from the submission URL", () => {
    assert.strictEqual(
      getDependencyTrackBomUrl(
        "https://user:pass@dtrack.example.com/base/?token=secret#frag",
      ),
      "https://dtrack.example.com/base/api/v1/bom",
    );
  });

  it("returns a sanitized URL object for Dependency-Track requests", () => {
    const apiUrl = getDependencyTrackBomApiUrl(
      "https://user:pass@dtrack.example.com/base/?token=secret#frag",
    );
    assert.ok(apiUrl instanceof URL);
    assert.strictEqual(apiUrl?.hostname, "dtrack.example.com");
    assert.strictEqual(apiUrl?.pathname, "/base/api/v1/bom");
    assert.strictEqual(apiUrl?.username, "");
    assert.strictEqual(apiUrl?.password, "");
    assert.strictEqual(apiUrl?.search, "");
    assert.strictEqual(apiUrl?.hash, "");
  });

  it("rejects malformed or unsupported submission URLs", () => {
    assert.strictEqual(
      getDependencyTrackBomUrl("file:///tmp/dtrack"),
      undefined,
    );
    assert.strictEqual(
      getDependencyTrackBomApiUrl("file:///tmp/dtrack"),
      undefined,
    );
    assert.strictEqual(
      getDependencyTrackBomUrl("javascript:alert(1)"),
      undefined,
    );
    assert.strictEqual(
      getDependencyTrackBomApiUrl("javascript:alert(1)"),
      undefined,
    );
    assert.strictEqual(getDependencyTrackBomUrl("not a url"), undefined);
    assert.strictEqual(getDependencyTrackBomApiUrl("not a url"), undefined);
  });

  it("builds payload with parentUUID and tags", () => {
    const payload = buildDependencyTrackBomPayload({
      projectName: "child",
      projectVersion: "1.0.0",
      parentProjectId: "d9628844-5f04-4ca7-88a2-64eb6bc64db0",
      projectTag: ["tag1", "tag2"],
    });
    assert.deepStrictEqual(payload, {
      autoCreate: "true",
      parentUUID: "d9628844-5f04-4ca7-88a2-64eb6bc64db0",
      projectName: "child",
      projectTags: '[{"name":"tag1"},{"name":"tag2"}]',
      projectVersion: "1.0.0",
    });
  });

  it("builds payload with parentName and parentVersion", () => {
    const payload = buildDependencyTrackBomPayload({
      projectName: "child",
      projectVersion: "1.0.0",
      parentProjectName: "parent",
      parentProjectVersion: "2.0.0",
    });
    assert.deepStrictEqual(payload, {
      autoCreate: "true",
      parentName: "parent",
      parentVersion: "2.0.0",
      projectName: "child",
      projectVersion: "1.0.0",
    });
  });

  it("returns undefined when project identity is missing", () => {
    assert.strictEqual(buildDependencyTrackBomPayload({}), undefined);
  });

  it("supports configurable autoCreate and isLatest", () => {
    const payload = buildDependencyTrackBomPayload({
      autoCreate: false,
      isLatest: true,
      projectName: "child",
    });
    assert.deepStrictEqual(payload, {
      autoCreate: "false",
      isLatest: "true",
      projectName: "child",
      projectVersion: "main",
    });
  });

  it("defaults projectVersion to main when only projectName is provided", () => {
    const payload = buildDependencyTrackBomPayload({ projectName: "child" });
    assert.deepStrictEqual(payload, {
      autoCreate: "true",
      projectName: "child",
      projectVersion: "main",
    });
  });

  it("returns undefined when parent UUID and parent name/version are both provided", () => {
    const payload = buildDependencyTrackBomPayload({
      parentProjectId: "d9628844-5f04-4ca7-88a2-64eb6bc64db0",
      parentProjectName: "parent",
      parentProjectVersion: "1.0.0",
      projectName: "child",
    });
    assert.strictEqual(payload, undefined);
  });

  it("returns undefined when parent name/version mode is incomplete", () => {
    const payload = buildDependencyTrackBomPayload({
      parentProjectName: "parent",
      projectName: "child",
    });
    assert.strictEqual(payload, undefined);
  });

  it("encodes fields and the file part as multipart/form-data", () => {
    const request = encodeMultipartFormData(
      { autoCreate: "true", projectName: "child" },
      {
        name: "bom",
        filename: "bom.json",
        contentType: "application/vnd.cyclonedx+json",
        content: Buffer.from('{"bomFormat":"CycloneDX"}'),
      },
    );
    assert.match(
      request.contentType,
      /^multipart\/form-data; boundary=-+cdxgen[0-9a-f]{32}$/,
    );
    assert.ok(Buffer.isBuffer(request.body));
    const parts = parseRequest(request);
    assert.strictEqual(parts.autoCreate.value, "true");
    assert.strictEqual(parts.projectName.value, "child");
    assert.strictEqual(parts.bom.filename, "bom.json");
    assert.strictEqual(parts.bom.contentType, "application/vnd.cyclonedx+json");
    assert.strictEqual(parts.bom.value, '{"bomFormat":"CycloneDX"}');
    assert.ok(
      request.body.toString("utf8").endsWith("--\r\n"),
      "body must end with the closing boundary",
    );
  });

  it("uses a unique boundary for every request", () => {
    const file = {
      name: "bom",
      filename: "bom.json",
      contentType: "application/vnd.cyclonedx+json",
      content: "{}",
    };
    assert.notStrictEqual(
      encodeMultipartFormData({}, file).contentType,
      encodeMultipartFormData({}, file).contentType,
    );
  });

  it("keeps multiline and unicode field values intact", () => {
    const request = encodeMultipartFormData(
      { projectName: "line1\r\nline2", projectVersion: "1.0.0-ünïcode" },
      {
        name: "bom",
        filename: "bom.json",
        contentType: "application/vnd.cyclonedx+json",
        content: "{}",
      },
    );
    const parts = parseRequest(request);
    assert.strictEqual(parts.projectName.value, "line1\r\nline2");
    assert.strictEqual(parts.projectVersion.value, "1.0.0-ünïcode");
  });

  it("builds a multipart request carrying the BOM verbatim", () => {
    const bomContents = {
      bomFormat: "CycloneDX",
      components: [{ name: "ünïcode-pkg", version: "1.0.0" }],
    };
    const request = buildDependencyTrackBomRequest(
      {
        projectName: "child",
        projectVersion: "1.0.0",
        projectTag: "tag1",
      },
      bomContents,
    );
    const parts = parseRequest(request);
    assert.strictEqual(parts.bom.value, JSON.stringify(bomContents));
    assert.strictEqual(parts.projectName.value, "child");
    assert.strictEqual(parts.projectVersion.value, "1.0.0");
    assert.strictEqual(parts.projectTags.value, '[{"name":"tag1"}]');
    // The BOM is no longer base64 encoded, so the request stays close to the BOM size.
    assert.ok(
      request.body.length <
        Buffer.byteLength(JSON.stringify(bomContents)) + 1024,
    );
  });

  it("accepts a pre-serialized BOM string and strips its byte order mark", () => {
    const request = buildDependencyTrackBomRequest(
      { projectName: "child" },
      '\ufeff{"bomFormat":"CycloneDX"}',
    );
    assert.strictEqual(
      parseRequest(request).bom.value,
      '{"bomFormat":"CycloneDX"}',
    );
  });

  it("returns undefined when the BOM or the project coordinates are missing", () => {
    assert.strictEqual(
      buildDependencyTrackBomRequest({ projectName: "child" }, undefined),
      undefined,
    );
    assert.strictEqual(
      buildDependencyTrackBomRequest({ projectName: "child" }, ""),
      undefined,
    );
    assert.strictEqual(
      buildDependencyTrackBomRequest({}, { bomFormat: "CycloneDX" }),
      undefined,
    );
  });
});
