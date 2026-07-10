declare const _setWorkspaces: unique symbol;
declare const Base: any;
declare class Arborist extends Base {
    options: {
        nodeVersion: any;
        Arborist: Function;
        binLinks: boolean;
        cache: any;
        dryRun: boolean;
        formatPackageLock: boolean;
        force: boolean;
        global: boolean;
        ignoreScripts: boolean;
        installStrategy: any;
        lockfileVersion: any;
        packageLockOnly: boolean;
        path: any;
        rebuildBundle: boolean;
        replaceRegistryHost: any;
        savePrefix: unknown;
        scriptShell: any;
        workspaces: any;
        workspacesEnabled: boolean;
    };
    replaceRegistryHost: any;
    cache: any;
    diff: any;
    path: any;
    constructor(options?: {});
    workspaceNodes(tree: any, workspaces: any): any[];
    workspaceDependencySet(tree: any, workspaces: any, includeWorkspaceRoot: any): Set<any>;
    excludeWorkspacesDependencySet(tree: any): Set<any>;
    [_setWorkspaces](node: any): Promise<any>;
    dedupe(options?: {}): Promise<any>;
}
export default Arborist;
//# sourceMappingURL=index.d.ts.map