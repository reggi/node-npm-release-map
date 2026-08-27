import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const NPM_PACKUMENT_URL = "https://registry.npmjs.org/npm";
const NODE_SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";
const NODE_REPOSITORY_RAW_URL = "https://raw.githubusercontent.com/nodejs/node";
const GITHUB_API_URL = "https://api.github.com";

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
      version: item.title.match(/^deps: upgrade npm to v?(\d+\.\d+\.\d+)$/i)?.[1],
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
    };
  }));
}

const outputArgument = process.argv.indexOf("--output");
const outputPath = resolve(
  outputArgument === -1 ? "data/versions.json" : process.argv[outputArgument + 1],
);
const htmlArgument = process.argv.indexOf("--html");
const htmlPath = resolve(
  htmlArgument === -1 ? "index.html" : process.argv[htmlArgument + 1],
);

const [nodeReleases, npmPackument, releaseSchedule] = await Promise.all([
  fetchJson(NODE_INDEX_URL),
  fetchJson(NPM_PACKUMENT_URL),
  fetchJson(NODE_SCHEDULE_URL),
]);

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
  ? { kind: "integration", target: "main", bundled: mainNpm, available: mainAvailable }
  : null;
const pendingNodeUpdates = mainUpdate ? [mainUpdate] : [];
const stagedNodeUpdates = [];
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
      status: "staged",
      bundled: line.latestNpm,
      available,
      ref: branches.stagingRef,
    };
    stagedNodeUpdates.push({
      nodeCycle: line.cycle,
      available,
      ref: branches.stagingRef,
    });
    continue;
  }

  if (compareVersions(branches.release, available) >= 0) {
    line.npmUpdate = {
      status: "release-branch",
      bundled: line.latestNpm,
      available,
      ref: branches.releaseRef,
    };
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
      status: "open-pr",
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
      status: "awaiting-main",
      bundled: line.latestNpm,
      available,
      ref: "main",
    };
    continue;
  }

  line.npmUpdate = {
    status: "backport",
    bundled: line.latestNpm,
    available,
    ref: branches.stagingRef,
  };
  pendingNodeUpdates.push({
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
  },
  npm: {
    latest: latestNpm,
    main: mainNpm,
    maxBundledMajor,
    bundledMajors: [...bundledNpmMajors].sort((a, b) => b - a),
    pendingNodeUpdates,
    openNodeUpdates,
    stagedNodeUpdates,
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
const plausibleDomain = process.env.PLAUSIBLE_DOMAIN;
const html = template
  .replace("<html lang=\"en\">", `<html lang="en"${repositoryAttribute}>`)
  .replace("__STYLES__", styles)
  .replace("__VERSION_DATA__", embeddedSnapshot)
  .replace("__APP_SCRIPT__", appScript.replaceAll("</script", "<\\/script"))
  .replace(
    /<script[^>]*data-domain="__PLAUSIBLE_DOMAIN__"[^>]*><\/script>\n?/,
    plausibleDomain
      ? `<script defer data-domain="${plausibleDomain}" src="https://plausible.io/js/script.js"></script>\n`
      : "",
  );

await mkdir(dirname(htmlPath), { recursive: true });
await writeFile(htmlPath, html);

console.log(
  `Generated ${htmlPath} and ${outputPath} with ${nodeReleases.length} Node.js releases.`,
);
