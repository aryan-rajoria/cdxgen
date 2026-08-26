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
 * Build the form fields for a Dependency-Track BOM submission.
 *
 * Field names follow the `multipart/form-data` variant of `/api/v1/bom`, which differs
 * from the JSON variant: the JSON body calls the flag `isLatestProjectVersion` and takes
 * `projectTags` as an array of objects, while the form takes `isLatest` and a
 * comma-separated tag list.
 *
 * @param {Object} args CLI/server arguments
 * @returns {Object | undefined} field map if the project coordinates are valid
 */
export declare function buildDependencyTrackBomPayload(args: Object): Object | undefined;
/**
 * Encode text fields and a single file part as a `multipart/form-data` body.
 *
 * @param {Object} fields Text fields keyed by field name
 * @param {Object} file File part
 * @param {string} file.name Field name of the file part
 * @param {string} file.filename File name reported to the server
 * @param {string} file.contentType Content type of the file part
 * @param {Buffer} file.content File content
 * @returns {{ body: Buffer, contentType: string }} encoded body and its content type
 */
export declare function encodeMultipartFormData(fields: Object, file: {
    name: string;
    filename: string;
    contentType: string;
    content: Buffer;
}): {
    body: Buffer;
    contentType: string;
};
/**
 * Build the `multipart/form-data` request for Dependency-Track BOM submission.
 *
 * The JSON variant of the endpoint carries the BOM as a base64 string, which Jackson
 * refuses to read beyond 20,000,000 characters - roughly a 15 MB BOM, which container
 * image scans exceed routinely. The form variant carries the BOM as a file part and has
 * no such limit, and is what the server recommends for large uploads.
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