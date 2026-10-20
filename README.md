# fhir-ig-workflows

Shared GitHub Actions workflows for building and publishing FHIR Implementation Guides created from [IneraFHIRTemplate](https://github.com/Inera-AB/IneraFHIRTemplate).

An IG repo keeps only short caller workflows that point here. Fixes and improvements to the build and release flow are made once, in this repo, and reach every IG that uses the same major version.

## Workflows

| Workflow | What it does | Caller permissions |
|---|---|---|
| `build.yml` | Branch build. Deploys `main` to the root and other branches to `branches/<branch>/` of the IG repo's own GitHub Pages; updates the IG's entry in the IG catalog | `contents: write` |
| `release.yml` | Publishes a release with IG Publisher's publication mode (`-go-publish`) into the shared web root. A tag publishes to `web-repo`, a run on a branch to `test-web-repo` | `contents: read` |
| `validate.yml` | Runs SUSHI and keeps the output as an artifact | — |
| `pr-qa.yml` | Builds the IG of a pull request and posts the QA summary as a comment | `contents: read`, `pull-requests: write` |
| `cleanup.yml` | Removes a deleted branch's build directory from `gh-pages` | `contents: write` |

They use three composite actions from this repo:

- `actions/setup-ig-tools`: Node.js and SUSHI, Java, Ruby and Jekyll, the FHIR package cache and the IG Publisher
- `actions/qa-comment`: the QA comment on pull requests
- `actions/history-assets`: copies the history template's styles and scripts into an IG folder in the web root, which the publisher only does on a first publication

## Using them from an IG repo

Each caller is a few lines. These are the files in [IneraFHIRTemplate](https://github.com/Inera-AB/IneraFHIRTemplate/tree/main/.github/workflows):

```yaml
# .github/workflows/release.yml
name: Publish release
on:
  push:
    tags:
      - '[0-9]+.[0-9]+.[0-9]+'
      - '[0-9]+.[0-9]+.[0-9]+-*'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  release:
    uses: Inera-AB/fhir-ig-workflows/.github/workflows/release.yml@v1
    secrets: inherit
```

```yaml
# .github/workflows/publish.yml
name: Build and publish IG
on:
  push:
    branches: [main, develop, 'feature/**', 'support/**']
  workflow_dispatch:
permissions:
  contents: write
jobs:
  build:
    uses: Inera-AB/fhir-ig-workflows/.github/workflows/build.yml@v1
    secrets: inherit
```

Inputs with their defaults are listed at the top of each workflow. The ones a caller is most likely to change:

| Input | Workflows | Default |
|---|---|---|
| `tx-server` | `build`, `release` | `https://tx.fhir.org/r4` (an R5 IG uses `https://tx.fhir.org/r5`) |
| `web-repo` | `release` | `inera-ab/fhir-portal` |
| `test-web-repo` | `release` | `inera-ab/fhir-portal-test` |
| `catalog-repo` | `build` | `inera-ab/fhir-portal` |
| `publisher-version` | `build`, `release`, `pr-qa` | `latest` |

### Secrets

`release.yml` and `build.yml` use `FHIR_PORTAL_TOKEN`: a fine-grained PAT with **Contents: Read and write** on the web repos. Within the `inera-ab` organisation, `secrets: inherit` passes it on. Repos outside the organisation pass their own token explicitly:

```yaml
jobs:
  release:
    uses: Inera-AB/fhir-ig-workflows/.github/workflows/release.yml@v1
    with:
      web-repo: example-org/fhir-site
      test-web-repo: example-org/fhir-site-test
    secrets:
      FHIR_PORTAL_TOKEN: ${{ secrets.WEB_TOKEN }}
```

The web repo needs the files IG Publisher's publication mode expects in its web root (`publish-setup.json`, feeds, `package-registry.json`, `templates/`); see [inera-ab/fhir-portal](https://github.com/Inera-AB/fhir-portal).

## Versions

Callers pin a major version: `@v1`. `v1` is a moving tag that points to the latest `v1.x.y` release.

- A fix or a backwards-compatible addition: tag `v1.x.y` and move `v1` to it. Every caller on `@v1` gets it on its next run.
- A change that needs callers to change (a new required input, a renamed workflow, a different web root layout): release as `v2`. Callers move to `@v2` when they are ready.

The workflows refer to the composite actions in this repo by the same major version (`@v1`). A new major version updates those references too.

Before moving `v1`, test the change from an IG repo against the test web root: point a branch's caller at the commit (`@<sha>`) and run *Publish release* manually on that branch. A change to a composite action is only picked up if the workflow's reference to it points at the same commit while testing.

## Development

```bash
node --test actions/qa-comment/*.test.js
actionlint
```

The `Test` workflow runs both on every push and pull request.
