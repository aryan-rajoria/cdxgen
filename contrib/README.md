# Useful scripts

## Validate SBOM using jsonschema

```shell
python bom-validate.py --json ../test/data/vuln-spring-1.5.bom.json
```

## Generate wrapdb releases

```shell
git clone https://github.com/mesonbuild/wrapdb --depth=1
cd wrapdb
python <path to cdxgen>/contrib/wrapdb.py
```

Copy the generated wrapdb-releases.json to the `data` directory.

## Profile aborted requests against the server

Measures what a disconnecting client costs the cdxgen HTTP server, in memory
and in CPU. `--probe-port` preloads `server-mem-probe.mjs` into the server
child so growth can be judged by post-GC heap statistics rather than by RSS,
which overstates it.

```shell
node contrib/server-abort-poc.mjs --requests 500 --no-abort --port 19340 --sample-every 50 --probe-port 19540
```

Abort mid-generation and compare the wasted CPU against a full generation:

```shell
node contrib/server-abort-poc.mjs --mode amplify --requests 20 --port 19341
```
