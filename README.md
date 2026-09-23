# Node.js ↔ npm release map

A Vite and React dashboard built with GitHub Primer. It separates published Node.js to npm mappings, current npm to Node.js branch state, and active release work.

## Pages

### Node.js → npm

The homepage starts with a Node.js release line and answers: **Which npm version ships with it?**

It shows every published Node.js release line and the npm version bundled with its latest release. Expand a row to inspect every published release in that line.

End of life Node.js lines are hidden by default and can be shown with the page filter.

### npm → Node.js

The **npm → Node.js** tab starts with npm@10, npm@11, or npm@12 and shows every maintained Node.js branch that carries it. Each branch is marked as published, current, merged, in review, pending release, npm action, Node.js action, or out of date. An npm major without a maintained Node.js branch is shown as unassigned.

Each npm major has a collapsed **Integration details and remediation** section. Expand it to see pending npm publication, the exact npm team workflow command, an open Node.js integration pull request, Node.js release team backports, or confirmation that no action is required.

### Release status

The **Release status** tab answers: **What npm release work is still moving through the release process?**

It presents two actionable checks in order:

1. Pending npm release pull requests
2. npm release branch backports

Every check remains visible when it finds no results. A clear result means the check ran and found no action. Each step also includes the GitHub query or source needed to verify the result manually.

For a printable checklist that opens in Microsoft Word, use [Node.js to npm Release Checklist](docs/npm-release-checklist.rtf).

### State explorer

The **State explorer** link in the footer opens a fixture driven catalog of branch state and release workflow scenarios that may not exist in the live repository snapshot.

The selected fixture replaces the snapshot for the complete application, including the Node.js to npm map, npm to Node.js branch state, release status, and footer. A collapsible full height scenario drawer reserves space on the left and pushes the remaining application to the right so both surfaces stay interactive. A full width warning above the navigation identifies the page as test fixture data rather than real repository state. Hiding the drawer keeps the fixture active, while closing fixtures restores the corresponding live page and live snapshot. Repository, pull request, and commit references are displayed without links.

Scenarios are defined in [`public/data/state-scenarios.json`](public/data/state-scenarios.json). Each scenario provides the same snapshot shaped data passed to the production branch state or release status component.

## Release status checks

### 1. Check for a pending npm release

This check finds open Release Please pull requests in `npm/cli`.

If a result appears, npm publication is still in progress. Open the pull request and confirm whether it is ready to merge or waiting on additional work.

Manual verification:

```text
Repository: https://github.com/npm/cli/pulls
Query: is:pr is:open label:"autorelease: pending"
```

### 2. Check npm backport work

This check finds open pull requests related to backports for maintained npm release branches.

If a result appears, inspect the source and target branches. Required backports should be merged before the matching npm release is prepared.

Manual verification:

```text
Repository: https://github.com/npm/cli/pulls
Query: is:pr is:open backport
```

## npm → Node.js branch state

The npm → Node.js page compares the latest registry release for npm@10, npm@11, and npm@12 with every maintained Node.js branch that carries that major or has an open integration pull request for it.

Each branch can show:

1. **Published:** The latest npm version is included in a published Node.js release.
2. **Current:** The latest npm version is present on Node.js `main`.
3. **Merged*:** The latest npm version is on a Node.js release or staging branch but has not shipped yet. When that branch next publishes a Node.js release, the npm version will be included.
4. **In review:** A matching Node.js integration pull request is open.
5. **Pending release:** A newer npm release is still being prepared in `npm/cli`.
6. **npm action:** The npm team must create the listed Node.js integration pull request.
7. **Node.js action:** The Node.js release team must backport an existing integration to the branch.
8. **Out of date:** The branch is behind and no more specific action was detected.
9. **No Node.js branch assigned:** The npm major is available but no maintained Node.js branch carries it.

Expand **Integration details and remediation** under an npm major to see the owner and exact next step. For npm team action, the dashboard shows the exact `gh workflow run create-node-pr.yml` command. When Node.js `main` carries the npm major, only the `main` pull request is created. Lower maintained lines are listed as Node.js release team follow-up backports after that pull request merges.

Manual verification:

```text
Search: https://github.com/search?type=pullrequests
Query: repo:nodejs/node is:pr is:open label:npm in:title "deps: upgrade npm to"
```

## Release pipeline

![Timeline showing the detectable states from an npm release pull request through publication in Node.js](docs/npm-release-pipeline.svg)

An npm version moves through these states:

1. Release Please opens or updates an npm release pull request.
2. The npm release pull request is merged and npm is published.
3. The npm team creates a Node.js integration pull request.
4. The Node.js integration pull request is reviewed and merged.
5. A published Node.js release bundles the npm version.

The first two stages are owned by the npm team. The remaining stages are owned by the Node.js team.

## Development

Install dependencies:

```sh
npm install
```

Generate a fresh snapshot and start the Vite development server:

```sh
npm run dev
```

Build the same `dist/` artifact used by GitHub Pages:

```sh
npm run build
```

Preview the production build:

```sh
npm run preview
```

The build command first writes the generated snapshot to `public/data/versions.json`, then Vite copies it into `dist/data/versions.json`.

## Data sources

The daily snapshot uses:

1. [Node.js release index](https://nodejs.org/dist/index.json)
2. [Official Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)
3. [npm registry packument](https://registry.npmjs.org/npm)
4. Open [npm CLI pull requests](https://github.com/npm/cli/pulls)
5. npm versions in maintained `nodejs/node` release, staging, and `main` branches

## Deployment

The GitHub Pages workflow installs dependencies with `npm ci`, runs `npm run build`, and uploads `dist/`.

It deploys on every push to `main`, on manual dispatch, and daily at 06:17 UTC.

Trigger an immediate dashboard refresh and deployment:

```sh
gh workflow run pages.yml -R reggi/node-npm-release-map
```
