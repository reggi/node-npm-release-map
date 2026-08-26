import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const NPM_PACKUMENT_URL = "https://registry.npmjs.org/npm";
const NODE_SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";

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

for (const line of lines) {
  const bundledMajor = versionParts(line.latestNpm)?.[0];
  const available = npmLatestByMajor.get(bundledMajor);
  line.npmUpdate = available && compareVersions(available, line.latestNpm) > 0
    ? { bundled: line.latestNpm, available }
    : null;
}

const pendingNodeUpdates = lines
  .filter((line) => !line.isEol && line.npmUpdate)
  .map((line) => ({
    nodeCycle: line.cycle,
    ...line.npmUpdate,
  }));
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
  },
  npm: {
    latest: latestNpm,
    maxBundledMajor,
    bundledMajors: [...bundledNpmMajors].sort((a, b) => b - a),
    pendingNodeUpdates,
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
