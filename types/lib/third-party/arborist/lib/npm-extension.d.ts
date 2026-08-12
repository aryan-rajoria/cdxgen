declare class NpmExtension {
    present: boolean;
    root: any;
    path: any;
    format: any;
    hash: any;
    constructor();
    load(): Promise<void>;
    apply(): void;
}
declare namespace NpmExtension {
    export { NpmExtension };
    export { hasExtensionFile };
}
declare const hasExtensionFile: () => boolean;
export default NpmExtension;
export { hasExtensionFile, NpmExtension };
//# sourceMappingURL=npm-extension.d.ts.map