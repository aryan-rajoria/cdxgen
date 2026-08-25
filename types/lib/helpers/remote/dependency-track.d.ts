import { Buffer } from "node:buffer";
/**
 * Returns the Dependency-Track BOM API URL as a sanitized URL object.
 *
 * @param {string} serverUrl Dependency-Track server URL
 * @returns {URL | undefined} API URL to submit BOM payload
 */
export declare function getDependencyTrackBomApiUrl(serverUrl: string): URL | undefined;
/**
 * Returns the Dependency-Track BOM API URL string.
 *
 * @param {string} serverUrl Dependency-Track server URL
 * @returns {string | undefined} API URL to submit BOM payload
 */
export declare function getDependencyTrackBomUrl(serverUrl: string): string | undefined;
/**
 * Build the form fields for Dependency-Track BOM submission. The BOM itself is
 * transmitted as a separate multipart file part and is therefore not included here.
 *
 * @param {Object} args CLI/server arguments
 * @returns {Object | undefined} field map if project coordinates are valid
 */
export declare function buildDependencyTrackBomPayload(args: Object): Object | undefined;
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
export declare function encodeMultipartFormData(fields: Object, file: {
    name: string;
    filename: string;
    contentType: string;
    content: Buffer | string;
}): {
    body: Buffer;
    contentType: string;
};
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
export declare function buildDependencyTrackBomRequest(args: Object, bomContents: Object | string): {
    body: Buffer;
    contentType: string;
} | undefined;
//# sourceMappingURL=dependency-track.d.ts.map