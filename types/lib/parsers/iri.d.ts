export type IRIComponents = {
    scheme: string;
    userinfo?: string;
    host?: string;
    port?: string;
    path: string;
    query?: string;
    fragment?: string;
    valid: boolean;
    error?: string;
};
/**
 * Represents the parsed components of an IRI.
 * @typedef {Object} IRIComponents
 * @property {string} scheme
 * @property {string} [userinfo]
 * @property {string} [host]
 * @property {string} [port]
 * @property {string} path
 * @property {string} [query]
 * @property {string} [fragment]
 * @property {boolean} valid
 * @property {string} [error]
 */
/**
 * Parses an IRI string according to RFC 3987.
 * @param {string} iri The IRI string to parse.
 * @returns {IRIComponents} An object containing the parsed components and validity status.
 */
export declare function parseIRI(iri: string): IRIComponents;
/**
 * Possible ways of validating an IRI.
 */
export declare const IriValidationStrategy: Readonly<{
    /**
     * Validates the IRI according to RFC 3987 using a custom parser.
     */
    Parse: "parse";
    /**
     * Validates that the IRI has a valid scheme and does not contain any character forbidden by the Turtle specification.
     */
    Pragmatic: "pragmatic";
    /**
     * Does not validate the IRI at all.
     */
    None: "none";
}>;
/**
 * Validate a given IRI according to the given strategy.
 *
 * @param {string} iri a string that may be an IRI.
 * @param {IriValidationStrategy} strategy IRI validation strategy.
 * @return {Error | undefined} An error if the IRI is invalid, or undefined if it is valid.
 */
export declare function validateIri(iri: string, strategy?: IriValidationStrategy): Error | undefined;
/**
 * Function to validate an externalReference URL for conforming to the JSON schema or bomLink
 * https://github.com/CycloneDX/cyclonedx-core-java/blob/75575318b268dda9e2a290761d7db11b4f414255/src/main/resources/bom-1.5.schema.json#L1140
 * https://datatracker.ietf.org/doc/html/rfc3987#section-2.2
 * https://cyclonedx.org/capabilities/bomlink/
 *
 * @param {String} iri IRI to validate
 *
 * @returns {Boolean} Flag indicating whether the supplied URL is valid or not
 *
 */
export declare function isValidIriReference(iri: string): boolean;
//# sourceMappingURL=iri.d.ts.map