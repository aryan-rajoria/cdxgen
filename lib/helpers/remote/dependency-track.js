import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";

import { hasDangerousUnicode } from "../../core/activity.js";

/**
 * Returns the Dependency-Track BOM API URL as a sanitized URL object.
 *
 * @param {string} serverUrl Dependency-Track server URL
 * @returns {URL | undefined} API URL to submit BOM payload
 */
export function getDependencyTrackBomApiUrl(serverUrl) {
  const rawServerUrl = `${serverUrl || ""}`.trim();
  if (!rawServerUrl || hasDangerousUnicode(rawServerUrl)) {
    return undefined;
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(rawServerUrl);
  } catch {
    return undefined;
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return undefined;
  }
  if (!parsedUrl.hostname || hasDangerousUnicode(parsedUrl.hostname)) {
    return undefined;
  }
  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";
  parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/+$/, "")}/api/v1/bom`;
  return parsedUrl;
}

/**
 * Returns the Dependency-Track BOM API URL string.
 *
 * @param {string} serverUrl Dependency-Track server URL
 * @returns {string | undefined} API URL to submit BOM payload
 */
export function getDependencyTrackBomUrl(serverUrl) {
  return getDependencyTrackBomApiUrl(serverUrl)?.toString();
}

/**
 * Build the form fields for Dependency-Track BOM submission. The BOM itself is
 * transmitted as a separate multipart file part and is therefore not included here.
 *
 * @param {Object} args CLI/server arguments
 * @returns {Object | undefined} field map if project coordinates are valid
 */
export function buildDependencyTrackBomPayload(args) {
  const autoCreate =
    typeof args.autoCreate === "boolean"
      ? args.autoCreate
      : args.autoCreate !== "false";
  const bomPayload = {
    autoCreate: String(autoCreate),
  };
  if (
    typeof args.projectId !== "undefined" ||
    typeof args.projectName !== "undefined"
  ) {
    if (typeof args.projectId !== "undefined") {
      bomPayload.project = args.projectId;
    }
    if (typeof args.projectName !== "undefined") {
      bomPayload.projectName = args.projectName;
    }
    // Dependency-Track submissions use "main" as fallback when no version is provided.
    bomPayload.projectVersion = args.projectVersion || "main";
  } else {
    return undefined;
  }
  const parentProjectId = args.parentProjectId || args.parentUUID;
  const hasParentUuidMode = typeof parentProjectId !== "undefined";
  const hasParentName = typeof args.parentProjectName !== "undefined";
  const hasParentVersion = typeof args.parentProjectVersion !== "undefined";
  const hasParentCoordsMode = hasParentName || hasParentVersion;
  if (hasParentUuidMode && hasParentCoordsMode) {
    return undefined;
  }
  if (!hasParentUuidMode && hasParentName !== hasParentVersion) {
    return undefined;
  }
  if (hasParentUuidMode) {
    bomPayload.parentUUID = parentProjectId;
  }
  if (hasParentName && hasParentVersion) {
    bomPayload.parentName = args.parentProjectName;
    bomPayload.parentVersion = args.parentProjectVersion;
  }
  if (
    typeof args.isLatest === "boolean" ||
    args.isLatest === "true" ||
    args.isLatest === "false"
  ) {
    bomPayload.isLatest = String(
      typeof args.isLatest === "boolean"
        ? args.isLatest
        : args.isLatest === "true",
    );
  }
  if (typeof args.projectTag !== "undefined") {
    bomPayload.projectTags = JSON.stringify(
      (Array.isArray(args.projectTag)
        ? args.projectTag
        : [args.projectTag]
      ).map((tag) => ({ name: tag })),
    );
  }
  return bomPayload;
}

/**
 * Encode fields and a single file part as a `multipart/form-data` body.
 *
 * @param {Object} fields Text fields keyed by field name
 * @param {Object} file File part
 * @param {string} file.name Field name of the file part
 * @param {string} file.filename File name reported to the server
 * @param {string} file.contentType Content type of the file part
 * @param {Buffer | string} file.content File content
 * @returns {{ body: Buffer, contentType: string }} encoded body and its content type
 */
export function encodeMultipartFormData(fields, file) {
  // A random boundary keeps the delimiter from colliding with the BOM content.
  const boundary = `--------------------------cdxgen${randomBytes(16).toString("hex")}`;
  const chunks = [];
  const pushPart = (header, content) => {
    chunks.push(
      Buffer.from(`--${boundary}\r\n${header}\r\n\r\n`),
      Buffer.isBuffer(content) ? content : Buffer.from(String(content)),
      Buffer.from("\r\n"),
    );
  };
  for (const [name, value] of Object.entries(fields)) {
    pushPart(`Content-Disposition: form-data; name="${name}"`, value);
  }
  pushPart(
    `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}`,
    file.content,
  );
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * Build the `multipart/form-data` request for Dependency-Track BOM submission.
 *
 * Dependency-Track rejects large BOMs sent as base64 inside a JSON body, since the
 * encoded string exceeds Jackson's maximum string length. The multipart endpoint
 * transmits the BOM verbatim and has no such limit.
 *
 * @param {Object} args CLI/server arguments
 * @param {Object | string} bomContents BOM Json
 * @returns {{ body: Buffer, contentType: string } | undefined} request body and content type if the arguments are valid
 */
export function buildDependencyTrackBomRequest(args, bomContents) {
  if (!bomContents) {
    return undefined;
  }
  const fields = buildDependencyTrackBomPayload(args);
  if (!fields) {
    return undefined;
  }
  const bomString =
    typeof bomContents === "string" ? bomContents : JSON.stringify(bomContents);
  return encodeMultipartFormData(fields, {
    name: "bom",
    filename: "bom.json",
    contentType: "application/vnd.cyclonedx+json",
    // Strip any UTF-8 BOM marker, which Dependency-Track's parser rejects.
    content: Buffer.from(bomString.replace(/^﻿/, "")),
  });
}
