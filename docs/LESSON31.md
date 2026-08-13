# Lesson 31 - DevOps BOMs: Helm charts, Jenkins, and GitHub Actions workflows

Your build system is software too. A GitHub Action referenced with `uses:` is
a third-party program that runs with your repository credentials. A Jenkins
plugin is a jar that runs on your controller. A Helm chart dependency pulls
workloads into your cluster from a repository you probably do not audit.
Application SBOMs miss all of this, and CI/CD definitions are a recurring
target in supply-chain attacks. This lesson covers the three core DevOps
types (`helm`, `jenkins`, `github`), what each parser actually extracts, and
how to audit for pinned versus floating versions.

## Learning Objective

Pre-requisites: Node.js 24 or newer and `@cdxgen/cdxgen` installed globally.

By the end of this lesson you will be able to:

1. Generate a BOM from Helm charts, Jenkins plugins, and GitHub workflows.
2. Describe what becomes a component, a service, or formulation data.
3. Audit the BOM for mutable refs, floating versions, and risky triggers.

## Step 1: Helm charts

```shell
cdxgen -t helm . -o bom-helm.json
```

The collector (`createHelmBom` in `lib/cli/managedBom.js`) globs `*.yaml`
files recursively and hands each to `parseHelmYamlData`
(`lib/ecosystems/parsers-misc.js`). A `Chart.yaml`-shaped file yields:

- the chart itself: `name`, `version`, `description`, `home` as homepage
- each `dependencies` entry: name, version, `repository` as a reference

Components carry `pkg:helm/<name>@<version>` purls. A range such as
`version: "4.22.*"` is kept verbatim, visibly marking the dependency as
floating rather than resolved (Step 5 shows how to query them).

A cache mode inventories chart repositories instead:

```shell
cdxgen -t helm-index -o bom-index.json   # scans $HOME/.cache/helm/repository
```

`helm-index` turns each `index.yaml` entry into a component, keeping the
repository digest as a sha256 hash.

Know the limits: the parser reads YAML documents, it does not render
templates, so images in `values.yaml` or `templates/*.yaml` are out of scope.
Use `-t universal` (docker-compose, Dockerfile, kubernetes manifests) for
image-level inventory; that emits container components and `services[]`.

## Step 2: Jenkins

```shell
cdxgen -t jenkins . -o bom-jenkins.json
```

The `-t jenkins` type is about plugin archives, not pipeline definitions. The
collector finds `*.hpi` files, extracts each as a jar archive, and parses the
bundled JavaScript for Maven dependencies, so components carry
`pkg:maven/...` purls.

The `Jenkinsfile` itself is handled by a separate formulation parser. It is
deliberately lightweight: declarative `pipeline { stages { ... } }` syntax
only, parsed with regex heuristics. Scripted Groovy pipelines are not
supported, and deeply nested stages may parse incompletely. Enable it with
`--include-formulation`:

```shell
cdxgen -t jenkins --include-formulation . -o bom-jenkins.json
```

When a pipeline declares a docker agent (`agent { docker { image 'node:20-alpine' } }`),
the image is emitted as a `container` component, and stages become tasks
with their `sh`/`bat`/`powershell` commands as steps.

## Step 3: GitHub Actions workflows

```shell
cdxgen -t github . -o bom-gh.json
```

The collector globs `.github/workflows/*.{yml,yaml}` and runs a deeper parser
(`lib/inventory/ciParsers/githubActions.js`). Every step with an external
`uses:` reference becomes a component:

```json
{
  "type": "application",
  "name": "checkout",
  "group": "actions",
  "purl": "pkg:github/actions/checkout@v4",
  "scope": "required",
  "evidence": { "identity": [{ "field": "purl", "confidence": 0.5 }] }
}
```

Each component also carries `cdx:github:*` properties, including:

- `cdx:github:action:uses`, `cdx:github:action:versionPinningType` (`sha`,
  `tag`, `branch`, or `unknown`), and `cdx:github:action:isShaPinned`
- workflow context copied onto every action: `cdx:github:workflow:name`,
  `:file`, `:triggers`, `:hasWritePermissions`, `:writeScopes`, and
  `:hasHighRiskTrigger` (true for `pull_request_target`, `issue_comment`,
  `workflow_run`)
- job context: `cdx:github:job:name`, `:runner`, self-hosted detection

Jobs that call a reusable workflow (`uses: owner/repo/.github/workflows/x.yml@ref`)
become their own components tagged `reusable-workflow`. Composite actions
under `.github/actions/` are not parsed as separate units today.

With `--include-formulation`, the same parser additionally emits
`formulation[].workflows[]` with jobs as tasks, steps with commands, and
security annotations on run steps (untrusted interpolation, runner state
mutation, exfiltration indicators).

## Step 4: What shows up where

| Source                    | components[]                         | services[] | formulation[]                          |
| ------------------------- | ------------------------------------ | ---------- | -------------------------------------- |
| `-t helm`                 | charts and chart dependencies        | -          | -                                      |
| `-t helm-index`           | published charts with digests        | -          | -                                      |
| `-t jenkins`              | maven deps found inside `.hpi` files | -          | -                                      |
| Jenkinsfile (formulation) | docker agent images as containers    | -          | pipeline, stages, steps                |
| `-t github`               | external actions, reusable workflows | -          | workflows with `--include-formulation` |
| `-t universal`            | container images                     | yes        | -                                      |

## Step 5: Audit pinned versus floating versions

The pinning state is already on every action component, so jq lists every
action not pinned to a commit SHA:

```shell
jq -r '.components[] | select((.purl // "") | startswith("pkg:github/")) |
  select((.properties[]? | select(.name == "cdx:github:action:isShaPinned") | .value) != "true") |
  .purl' bom-gh.json
```

For rule-based auditing, use the built-in BOM audit engine. `--bom-audit`
automatically enables `--include-formulation` so workflow data reaches the
rules:

```shell
cdxgen -t github --bom-audit --bom-audit-categories ci-permission . -o bom-gh.json
```

The `ci-permission` rules include CI-001 (unpinned action in a workflow with
write permissions, high), CI-003 (mutable tag instead of a SHA, medium),
CI-004 (`pull_request_target` trigger, medium), and CI-019 (dispatch chains
combining fork context with credentials, critical). The full catalog is in
[BOM_AUDIT.md](BOM_AUDIT.md).

For Helm, floating versions surface from the component version field:

```shell
jq -r '.components[] | select((.purl // "") | startswith("pkg:helm/")) |
  select((.version // "") | test("\\*|>=|<|~")) | "\(.name) \(.version)"' bom-helm.json
```

## Step 6: CI sketch for a platform repository

Combine the types in one invocation, then audit the result:

```yaml
jobs:
  devops-bom:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @cdxgen/cdxgen
      - name: Generate DevOps BOM
        run: cdxgen -t github,helm,jenkins,universal --include-formulation -o bom-devops.json .
      - name: Audit CI and workflow risks
        run: cdxgen -t github --bom-audit --bom-audit-categories ci-permission .
      - name: Fail on unpinned actions
        run: |
          unpinned=$(jq '[.components[] | select((.purl // "") | startswith("pkg:github/")) |
            select((.properties[]? | select(.name == "cdx:github:action:isShaPinned") | .value) != "true")] | length' bom-devops.json)
          test "$unpinned" -eq 0
      - uses: actions/upload-artifact@v4
        with:
          name: devops-bom
          path: bom-devops.json
```

A repository mid-migration may want a warning threshold instead of zero.

## What to take away

1. `-t helm` parses Chart.yaml-style documents (chart plus dependencies);
   images in values or templates are out of scope, use `-t universal`.
2. `-t jenkins` inventories `.hpi` plugin archives; Jenkinsfile parsing is a
   declarative-only heuristic and experimental for complex pipelines.
3. `-t github` produces one component per external action and reusable
   workflow, with pinning, trigger, and permission context attached.
4. `--include-formulation` adds CI/CD workflows, tasks, and steps, and
   `--bom-audit` turns it on automatically.
5. Pinning discipline (SHA-pinned actions, exact chart versions) is queryable
   with jq and enforceable with the `ci-permission` rules.
