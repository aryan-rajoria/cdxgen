# cdxgen build introspection

Overall: resolved (100/100) — every scanned ecosystem is at its best achievable fidelity; nothing needs fixing.

## Ecosystems

| ecosystem | tier | score | components | edges | confidence |
| --- | --- | --- | --- | --- | --- |
| go | resolved | 100 | 3 | 2 | medium |

## Evidence

### go

Tools:

| tool | expected | resolved | missing | mismatched |
| --- | --- | --- | --- | --- |
| go |  | 1.23.0 (PATH) |  |  |

## Reproduce

```sh
cdxgen -t go --no-install-deps -o bom.json
```

- cdxgen version: `13.0.0`; runtime: Node.js 22.0.0
- Inputs fingerprint: `sha256:f000000000000000000000000000000000000000000000000000000000000000`
