import { isAllowedHttpHost } from "../helpers/utils.js";
export { isAllowedHttpHost };
/**
 * Method to safely parse value passed via the query string or body.
 *
 * @param {string|number|Array<string|number>} raw
 * @returns {string|number|boolean|Array<string|number|boolean>}
 * @throws {TypeError} if raw (or any array element) isn’t string or number
 */
export declare function parseValue(raw: string | number | Array<string | number>): string | number | boolean | Array<string | number | boolean>;
/**
 * Parses allowed query/body parameters into a typed options object.
 * Query parameters take priority over body parameters. Handles the
 * `type` → `projectType` rename, lifecycle-based `installDeps` defaulting,
 * and profile option expansion.
 *
 * @param {Object} q Parsed query string key/value map
 * @param {Object} [body={}] Parsed request body key/value map
 * @param {Object} [options={}] Seed options object to merge results into
 * @returns {Object} Populated options object
 */
export declare function parseQueryString(q: Object, body?: Object, options?: Object): Object;
/**
 * Extracts query parameters from an incoming HTTP request object.
 * Handles repeated keys by collecting their values into an array.
 * Returns an empty object if the URL cannot be parsed.
 *
 * @param {Object} req Node.js/connect HTTP request object
 * @returns {Object} Key/value map of query parameters from the request URL
 */
export declare function getQueryParams(req: Object): Object;
declare const configureServer: (cdxgenServer: any) => void;
declare const start: (options: any) => void;
export { configureServer, start };
//# sourceMappingURL=server.d.ts.map