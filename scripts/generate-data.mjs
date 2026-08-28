import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const NPM_PACKUMENT_URL = "https://registry.npmjs.org/npm";
const NODE_SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";
const NODE_REPOSITORY_RAW_URL = "https://raw.githubusercontent.com/nodejs/node";
const GITHUB_API_URL = "https://api.github.com";
const NPM_CLI_PULLS_PER_PAGE = 100;
const NPM_CLI_PULLS_URL = `${GITHUB_API_URL}/repos/npm/cli/pulls?state=open&per_page=${NPM_CLI_PULLS_PER_PAGE}`;

const NPM_RELEASE_STATES = Object.freeze({
  NPM_RELEASE_PR: "npm-release-pr",
  AWAITING_NODE_PR: "awaiting-node-pr",
  NODE_PR_REVIEW: "node-pr-review",
  NODE_MERGED: "node-merged",
  NODE_RELEASED: "node-released",
});

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "node-npm-versions-pages/1.0" },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function versionParts(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function latestStableByMajor(versions) {
  const latest = new Map();
  for (const version of versions) {
    if (version.includes("-")) continue;
    const parts = versionParts(version);
    if (!parts) continue;
    const major = parts[0];
    if (!latest.has(major) || compareVersions(version, latest.get(major)) > 0) {
      latest.set(major, version);
    }
  }
  return latest;
}

function isEol(eol, today) {
  return typeof eol === "string" && eol <= today;
}

async function fetchBundledNpm(ref) {
  const packageJson = await fetchJson(
    `${NODE_REPOSITORY_RAW_URL}/${encodeURIComponent(ref)}/deps/npm/package.json`,
  );
  return packageJson.version;
}

async function fetchOpenNpmCliPulls() {
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const batch = await fetchJson(`${NPM_CLI_PULLS_URL}&page=${page}`);
    pulls.push(...batch);
    if (batch.length < NPM_CLI_PULLS_PER_PAGE) break;
  }
  return pulls;
}

function extractPendingReleases(pulls) {
  return pulls
    .map((pull) => {
      const hasPendingLabel = pull.labels.some(
        ({ name }) => name === "autorelease: pending",
      );
      const version = pull.title.match(
        /^chore: release v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/i,
      )?.[1];
      const target = pull.base.ref;
      const releaseType = target === "latest"
        ? "latest"
        : /^release\/v\d+$/.test(target)
          ? "backport"
          : null;

      if (!hasPendingLabel || !version || !releaseType) return null;

      return {
        version,
        state: NPM_RELEASE_STATES.NPM_RELEASE_PR,
        releaseType,
        target,
        pullRequest: {
          number: pull.number,
          title: pull.title,
          url: pull.html_url,
          createdAt: pull.created_at,
          updatedAt: pull.updated_at,
        },
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        compareVersions(b.version, a.version)
        || b.version.localeCompare(a.version),
    );
}

function extractPendingBackports(pulls, pendingReleases) {
  const releaseTargets = new Set(
    pendingReleases
      .filter((release) => release.releaseType === "backport")
      .map((release) => release.target),
  );

  return pulls
    .map((pull) => {
      const head = pull.head.ref.match(/^backport\/v(\d+)\/(\d+)$/);
      const base = pull.base.ref.match(/^release\/v(\d+)$/);

      if (!head || !base || head[1] !== base[1]) return null;

      return {
        major: Number(base[1]),
        original: Number(head[2]),
        target: pull.base.ref,
        hasReleasePr: releaseTargets.has(pull.base.ref),
        pullRequest: {
          number: pull.number,
          title: pull.title,
          url: pull.html_url,
          createdAt: pull.created_at,
          updatedAt: pull.updated_at,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.major - a.major || b.original - a.original);
}

async function fetchOpenNpmUpgradePulls() {
  const query = encodeURIComponent(
    'repo:nodejs/node is:pr is:open label:npm in:title "deps: upgrade npm to"',
  );
  const search = await fetchJson(
    `${GITHUB_API_URL}/search/issues?q=${query}&per_page=100`,
  );
  const candidates = search.items
    .map((item) => ({
      item,
      version: item.title.match(/deps: upgrade npm to v?(\d+\.\d+\.\d+)/i)?.[1],
    }))
    .filter(({ version }) => version);

  return Promise.all(candidates.map(async ({ item, version }) => {
    const pull = await fetchJson(`${GITHUB_API_URL}/repos/nodejs/node/pulls/${item.number}`);
    return {
      number: item.number,
      url: item.html_url,
      title: item.title,
      version,
      base: pull.base.ref,
      state: NPM_RELEASE_STATES.NODE_PR_REVIEW,
    };
  }));
}

const outputArgument = process.argv.indexOf("--output");
const outputPath = resolve(
  outputArgument === -1 ? "dist/data/versions.json" : process.argv[outputArgument + 1],
);
const htmlArgument = process.argv.indexOf("--html");
const htmlPath = resolve(
  htmlArgument === -1 ? "dist/index.html" : process.argv[htmlArgument + 1],
);

const [nodeReleases, npmPackument, releaseSchedule, npmCliPulls] = await Promise.all([
  fetchJson(NODE_INDEX_URL),
  fetchJson(NPM_PACKUMENT_URL),
  fetchJson(NODE_SCHEDULE_URL),
  fetchOpenNpmCliPulls(),
]);
const pendingReleases = extractPendingReleases(npmCliPulls);
const pendingBackports = extractPendingBackports(npmCliPulls, pendingReleases);

const today = new Date().toISOString().slice(0, 10);
const lifecycleByCycle = new Map(
  Object.entries(releaseSchedule).map(([cycle, entry]) => [
    cycle.replace(/^v/, ""),
    {
      codename: entry.codename ?? false,
      eol: entry.end ?? null,
    },
  ]),
);
const releasesByCycle = new Map();

for (const release of nodeReleases) {
  const parts = versionParts(release.version);
  if (!parts) continue;
  const cycle = parts[0] === 0 ? `${parts[0]}.${parts[1]}` : String(parts[0]);
  const releases = releasesByCycle.get(cycle) ?? [];
  releases.push({
    node: release.version,
    npm: release.npm ?? null,
    date: release.date,
    lts: release.lts,
  });
  releasesByCycle.set(cycle, releases);
}

const lines = [...releasesByCycle.entries()]
  .map(([cycle, releases]) => {
    releases.sort((a, b) => compareVersions(b.node, a.node));
    const lifecycle = lifecycleByCycle.get(cycle);
    const latest = releases[0];
    const isHistoricalPreStable = versionParts(latest.node)?.[0] === 0;
    return {
      cycle,
      latestNode: latest.node,
      latestNpm: latest.npm,
      lts: latest.lts || lifecycle?.codename || false,
      eol: lifecycle?.eol ?? null,
      isEol: isEol(lifecycle?.eol, today) || (!lifecycle && isHistoricalPreStable),
      releases,
    };
  })
  .sort((a, b) => compareVersions(b.latestNode, a.latestNode));

const bundledNpmMajors = new Set(
  nodeReleases
    .map((release) => versionParts(release.npm)?.[0])
    .filter(Number.isInteger),
);
const maxBundledMajor = Math.max(...bundledNpmMajors);
const npmLatestByMajor = latestStableByMajor(Object.keys(npmPackument.versions));
const latestNpm = npmPackument["dist-tags"].latest;
const latestNpmMajor = versionParts(latestNpm)?.[0];
const maintainedLines = lines.filter(
  (line) => !line.isEol && /^\d+$/.test(line.cycle),
);
const branchVersionsPromise = Promise.all(
  maintainedLines.map(async (line) => {
    const releaseRef = `v${line.cycle}.x`;
    const stagingRef = `${releaseRef}-staging`;
    const [release, staging] = await Promise.all([
      fetchBundledNpm(releaseRef),
      fetchBundledNpm(stagingRef),
    ]);
    return [line.cycle, { releaseRef, release, stagingRef, staging }];
  }),
);
const [branchVersions, mainNpm, openNpmUpgradePulls] = await Promise.all([
  branchVersionsPromise,
  fetchBundledNpm("main"),
  fetchOpenNpmUpgradePulls(),
]);
const branchVersionsByCycle = new Map(branchVersions);
const mainNpmMajor = versionParts(mainNpm)?.[0];
const mainAvailable = npmLatestByMajor.get(mainNpmMajor);
const mainPullRequest = openNpmUpgradePulls.find(
  (pull) =>
    mainAvailable
    && pull.base === "main"
    && compareVersions(pull.version, mainAvailable) >= 0,
);
const mainUpdate = mainAvailable
  && compareVersions(mainAvailable, mainNpm) > 0
  && !mainPullRequest
  ? {
      state: NPM_RELEASE_STATES.AWAITING_NODE_PR,
      kind: "integration",
      target: "main",
      bundled: mainNpm,
      available: mainAvailable,
    }
  : null;
const pendingNodeUpdates = mainUpdate ? [mainUpdate] : [];
const stagedNodeUpdates = [];
const mergedNodeUpdates = [];
const openNodeUpdates = mainPullRequest ? [mainPullRequest] : [];

for (const line of maintainedLines) {
  const bundledMajor = versionParts(line.latestNpm)?.[0];
  const available = npmLatestByMajor.get(bundledMajor);
  const branches = branchVersionsByCycle.get(line.cycle);

  line.branchNpm = branches;
  if (!available || compareVersions(available, line.latestNpm) <= 0) {
    line.npmUpdate = null;
    continue;
  }

  if (compareVersions(branches.staging, available) >= 0) {
    line.npmUpdate = {
      state: NPM_RELEASE_STATES.NODE_MERGED,
      bundled: line.latestNpm,
      available,
      ref: branches.stagingRef,
    };
    const mergedUpdate = {
      nodeCycle: line.cycle,
      available,
      ref: branches.stagingRef,
      state: NPM_RELEASE_STATES.NODE_MERGED,
    };
    stagedNodeUpdates.push(mergedUpdate);
    mergedNodeUpdates.push(mergedUpdate);
    continue;
  }

  if (compareVersions(branches.release, available) >= 0) {
    line.npmUpdate = {
      state: NPM_RELEASE_STATES.NODE_MERGED,
      bundled: line.latestNpm,
      available,
      ref: branches.releaseRef,
    };
    mergedNodeUpdates.push({
      nodeCycle: line.cycle,
      available,
      ref: branches.releaseRef,
      state: NPM_RELEASE_STATES.NODE_MERGED,
    });
    continue;
  }

  const pullRequest = bundledMajor === mainNpmMajor
    ? mainPullRequest
    : openNpmUpgradePulls.find(
      (pull) =>
        [branches.stagingRef, branches.releaseRef].includes(pull.base)
        && compareVersions(pull.version, available) >= 0,
    );
  if (pullRequest) {
    line.npmUpdate = {
      state: NPM_RELEASE_STATES.NODE_PR_REVIEW,
      bundled: line.latestNpm,
      available,
      ref: pullRequest.base,
      pullRequest,
    };
    if (!openNodeUpdates.some(({ number }) => number === pullRequest.number)) {
      openNodeUpdates.push(pullRequest);
    }
    continue;
  }

  if (bundledMajor === mainNpmMajor && mainUpdate) {
    line.npmUpdate = {
      state: NPM_RELEASE_STATES.AWAITING_NODE_PR,
      bundled: line.latestNpm,
      available,
      ref: "main",
    };
    continue;
  }

  line.npmUpdate = {
    state: NPM_RELEASE_STATES.AWAITING_NODE_PR,
    bundled: line.latestNpm,
    available,
    ref: branches.stagingRef,
  };
  pendingNodeUpdates.push({
    state: NPM_RELEASE_STATES.AWAITING_NODE_PR,
    kind: "backport",
    target: line.cycle,
    bundled: line.latestNpm,
    available,
    ref: branches.stagingRef,
  });
}

const unbundledNewerMajors = [...npmLatestByMajor.entries()]
  .filter(([major]) => major > maxBundledMajor && major <= latestNpmMajor)
  .sort(([a], [b]) => a - b)
  .map(([major, latest]) => ({ major, latest }));

const snapshot = {
  generatedAt: new Date().toISOString(),
  releaseCount: nodeReleases.length,
  sources: {
    node: NODE_INDEX_URL,
    npm: NPM_PACKUMENT_URL,
    schedule: NODE_SCHEDULE_URL,
    nodeRepository: NODE_REPOSITORY_RAW_URL,
    npmPullRequests: NPM_CLI_PULLS_URL,
  },
  npm: {
    latest: latestNpm,
    main: mainNpm,
    maxBundledMajor,
    bundledMajors: [...bundledNpmMajors].sort((a, b) => b - a),
    pendingReleases,
    pendingBackports,
    pendingNodeUpdates,
    openNodeUpdates,
    stagedNodeUpdates,
    mergedNodeUpdates,
    unbundledNewerMajors,
  },
  lines,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);

const [template, styles, appScript] = await Promise.all([
  readFile(resolve("index.template.html"), "utf8"),
  readFile(resolve("styles.css"), "utf8"),
  readFile(resolve("app.js"), "utf8"),
]);
const repository = process.env.GITHUB_REPOSITORY;
const repositoryAttribute = repository ? ` data-repository="${repository}"` : "";
const embeddedSnapshot = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
const html = template
  .replace("<html lang=\"en\">", `<html lang="en"${repositoryAttribute}>`)
  .replace("__STYLES__", styles)
  .replace("__VERSION_DATA__", embeddedSnapshot)
  .replace("__APP_SCRIPT__", appScript.replaceAll("</script", "<\\/script"));

await mkdir(dirname(htmlPath), { recursive: true });
await writeFile(htmlPath, html);

console.log(
  `Generated ${htmlPath} and ${outputPath} with ${nodeReleases.length} Node.js releases.`,
);
