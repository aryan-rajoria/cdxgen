/**
 * Method to parse python requires_dist attribute found in pypi setup.py
 *
 * @param {String} dist_string string
 */
export declare function parsePyRequiresDist(dist_string: string): {
    name: string;
    version: string;
} | undefined;
/**
 * Method to parse pipfile.lock data
 *
 * @param {Object} lockData JSON data from Pipfile.lock
 */
export declare function parsePiplockData(lockData: Object): Promise<any[]>;
export declare function addComponentProperty(component: any, name: any, value: any): void;
/**
 * Method to parse python pyproject.toml file
 *
 * @param {string} tomlFile pyproject.toml file
 * @returns {Object} Object with parent component, root dependencies, and metadata.
 */
export declare function parsePyProjectTomlFile(tomlFile: string): Object;
/**
 * Derive a file name for a file entry of a python lock file.
 *
 *  - poetry.lock `[metadata.files]` entries carry a `file` key.
 *  - pdm.lock `[metadata.files]` entries carry a `url` key (no `file`).
 *  - pylock.toml / uv.lock artifacts can carry an explicit `name`, a local
 *    `path`, and/or a `url`.
 *
 * @param {object} fileEntry A single lock-file file entry.
 * @returns {string | undefined} The derived file name, or undefined when none can be derived.
 */
export declare function derivePythonLockMetadataFileName(fileEntry: object): string | undefined;
/**
 * Method to parse python lock files such as poetry.lock, pdm.lock, uv.lock, and pylock.toml.
 *
 * @param {string} lockData Raw TOML text from poetry.lock, pdm.lock, uv.lock, or pylock.toml
 * @param {string} lockFile Lock file name for evidence
 * @param {string} pyProjectFile pyproject.toml file
 */
export declare function parsePyLockData(lockData: string, lockFile: string, pyProjectFile: string): Promise<{
    pkgList: any[];
    dependenciesList: any[];
    parentComponent?: undefined;
    rootList?: undefined;
    pyLockProperties?: undefined;
    workspaceWarningShown?: undefined;
} | {
    parentComponent: any;
    pkgList: any[];
    rootList: {
        name: any;
        version: any;
        description: any;
        properties: never[];
    }[];
    dependenciesList: {
        ref: string;
        dependsOn: any[];
    }[];
    pyLockProperties: any[];
    workspaceWarningShown: boolean;
}>;
/**
 * Method to parse requirements.txt file. This must be replaced with atom parsedeps.
 *
 * @param {String} reqFile Requirements.txt file
 * @param {Boolean} fetchDepsInfo Fetch dependencies info from pypi
 *
 * @returns {Promise[Array<Object>]} List of direct dependencies from the requirements file
 */
export declare function parseReqFile(reqFile: string, fetchDepsInfo?: boolean): any;
/**
 * Parse environment markers into structured format
 *
 * @param {String} markersStr Raw markers string
 * @returns {Array<Object>} Structured markers array
 */
export declare function parseReqEnvMarkers(markersStr: string): Array<Object>;
/**
 * Method to parse setup.py data
 *
 * @param {Object} setupPyData Contents of setup.py
 */
export declare function parseSetupPyFile(setupPyData: Object): Promise<Object[]>;
/**
 * Method to parse pixi.lock data
 *
 * @param {String} pixiLockFileName  pixi.lock file name
 * @param {String} path File path
 */
export declare function parsePixiLockFile(pixiLockFileName: string, path: string): {
    pkgList: any;
    formulationList: any[];
    rootList: any[];
    dependenciesList: {
        ref: string;
        dependsOn: any[];
    }[];
    frozen: boolean;
};
/**
 * Method to parse pixi.toml file
 *
 * @param {String} pixiToml
 */
export declare function parsePixiTomlFile(pixiToml: string): {};
/**
 * Method to run cli command `pixi install`
 *
 *
 */
export declare function generatePixiLockFile(_path: any): void;
/**
 * Parse a Mojo `mojoproject.toml` manifest.
 *
 * Mojo projects are pixi-managed, so conda and PyPI dependencies pulled through
 * pixi.lock already keep their correct registered types via the pixi path.
 * Only Mojo's *own* packages — declared in `mojoproject.toml` — need special
 * handling: `mojo` is not a registered purl type, so each is emitted as
 * `pkg:generic/...` with a `cdx:purl:proposedType=mojo` property.
 *
 * The manifest is TOML. The `[project]` table carries the project's name and
 * version; `[dependencies]` maps dependency names to version specifiers. A
 * declared version range (e.g. `==0.1.0`, `>=0.2`) is normalised to its
 * concrete version when one is present, otherwise the version is omitted.
 *
 * @param {string} mojoProjectFile Path to `mojoproject.toml`
 * @returns {{ pkgList: object[], parentComponent: object }}
 */
export declare function parseMojoProject(mojoProjectFile: string): {
    pkgList: object[];
    parentComponent: object;
};
//# sourceMappingURL=parsers-python.d.ts.map