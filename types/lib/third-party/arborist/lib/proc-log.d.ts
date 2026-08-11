declare const noop: () => void;
declare const log: {
    silly: typeof noop;
    verbose: typeof noop;
    info: typeof noop;
    timing: typeof noop;
    http: typeof noop;
    notice: typeof noop;
    warn: typeof noop;
    error: typeof noop;
    pause: typeof noop;
    resume: typeof noop;
};
declare const time: {
    start: () => any;
    end: typeof noop;
    emit: typeof noop;
};
export { log, time };
//# sourceMappingURL=proc-log.d.ts.map