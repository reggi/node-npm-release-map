const grid = document.querySelector("#release-grid");
const hideEolInput = document.querySelector("#hide-eol");
const status = document.querySelector("#npm-status");
const releaseStatus = document.querySelector("#npm-release-status");
const backportStatus = document.querySelector("#npm-backport-status");
const majorStatus = document.querySelector("#npm-major-status");

const NPM_RELEASE_STATES = Object.freeze({
  AWAITING_NODE_PR: "awaiting-node-pr",
  NODE_PR_REVIEW: "node-pr-review",
  NODE_MERGED: "node-merged",
});

let snapshot;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatDate = (value) =>
  new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));

function getNpmUpdateState(update) {
  if (update?.state) return update.state;
  if (["staged", "release-branch"].includes(update?.status)) {
    return NPM_RELEASE_STATES.NODE_MERGED;
  }
  if (update?.status === "open-pr") {
    return NPM_RELEASE_STATES.NODE_PR_REVIEW;
  }
  if (["awaiting-main", "backport"].includes(update?.status)) {
    return NPM_RELEASE_STATES.AWAITING_NODE_PR;
  }
  return null;
}

function renderNpmStatus(npm) {
  const pending = npm.pendingNodeUpdates;
  const openPullRequests = npm.openNodeUpdates;

  if (pending.length) {
    const pendingText = pending
      .map((update) => update.kind === "integration"
        ? `npm@${update.available} for Node.js main`
        : `npm@${update.available} backport for Node.js ${update.target}`)
      .join("; ");

    status.className = "npm-status callout";
    status.innerHTML = `
      <div class="status-icon">↗</div>
      <div>
        <p class="status-label">Available npm integrations</p>
        <h2>npm updates need Node.js integration</h2>
        <p>${escapeHtml(pendingText)}.</p>
      </div>`;
    return;
  }

  if (openPullRequests.length) {
    const pullRequests = openPullRequests
      .map((pull) =>
        `<li>
          <a href="${escapeHtml(pull.url)}" target="_blank" rel="noopener noreferrer">nodejs/node#${pull.number}</a>
          <span>— updates to npm@${escapeHtml(pull.version)} on <code>${escapeHtml(pull.base)}</code></span>
        </li>`)
      .join("");
    status.className = "npm-status callout";
    status.innerHTML = `
      <div class="status-icon">↗</div>
      <div>
        <p class="status-label">Open Node.js pull requests</p>
        <h2>${openPullRequests.length === 1
          ? "An npm update PR is open in nodejs/node"
          : `${openPullRequests.length} npm update PRs are open in nodejs/node`}</h2>
        <ul class="pull-request-list">${pullRequests}</ul>
      </div>`;
    return;
  }

  status.innerHTML = `
    <div class="status-icon">✓</div>
    <div>
      <p class="status-label">Node.js integration status</p>
      <h2>No npm integrations need action</h2>
      <p>${(npm.mergedNodeUpdates ?? npm.stagedNodeUpdates).length
        ? "Newer npm releases are already merged into Node.js branches."
        : "Supported Node.js lines bundle the latest applicable npm releases."}</p>
    </div>`;
}

function renderPendingReleases(pendingReleases) {
  if (!pendingReleases.length) {
    releaseStatus.hidden = true;
    return;
  }

  const releases = pendingReleases.map((release) => {
    const action = release.releaseType === "backport"
      ? `prepares npm@${release.version} as a backport from ${release.target}`
      : `prepares npm@${release.version} from ${release.target}`;
    return `
      <li>
        <a href="${escapeHtml(release.pullRequest.url)}" target="_blank" rel="noopener noreferrer">npm/cli#${release.pullRequest.number}</a>
        <span>— ${escapeHtml(action)}</span>
      </li>`;
  }).join("");

  releaseStatus.hidden = false;
  releaseStatus.innerHTML = `
    <div class="status-icon">↗</div>
    <div>
      <p class="status-label">Pending npm releases</p>
      <h2>${pendingReleases.length === 1
        ? "An npm release PR is open in npm/cli"
        : `${pendingReleases.length} npm release PRs are open in npm/cli`}</h2>
      <ul class="pull-request-list">${releases}</ul>
    </div>`;
}

function renderPendingBackports(pendingBackports) {
  if (!pendingBackports.length) {
    backportStatus.hidden = true;
    return;
  }

  const byMajor = new Map();
  for (const backport of pendingBackports) {
    const entry = byMajor.get(backport.major)
      ?? { major: backport.major, target: backport.target, count: 0 };
    entry.count += 1;
    byMajor.set(backport.major, entry);
  }

  const items = [...byMajor.values()]
    .sort((a, b) => b.major - a.major)
    .map(({ major, target, count }) => {
      const searchUrl = `https://github.com/npm/cli/pulls?q=${encodeURIComponent(`is:pr is:open base:${target}`)}`;
      return `
    <li>
      <a href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer">npm@${escapeHtml(major)} backport PRs</a>
      <span>— list of all ${escapeHtml(count)} open backport pull ${count === 1 ? "request" : "requests"}</span>
    </li>`;
    })
    .join("");

  backportStatus.hidden = false;
  backportStatus.innerHTML = `
    <div class="status-icon">↗</div>
    <div>
      <p class="status-label">Pending npm backports</p>
      <h2>${pendingBackports.length === 1
        ? "An npm backport PR is open in npm/cli"
        : `${pendingBackports.length} npm backport PRs are open in npm/cli`}</h2>
      <ul class="pull-request-list">${items}</ul>
    </div>`;
}

function renderNpmMajorStatus(missing) {
  if (!missing.length) {
    majorStatus.hidden = true;
    return;
  }

  const versions = missing.map(({ latest }) => `npm@${latest}`).join(", ");
  majorStatus.hidden = false;
  majorStatus.innerHTML = `
    <div class="status-icon">!</div>
    <div>
      <p class="status-label">Unbundled npm major</p>
      <h2>${escapeHtml(versions)} ${missing.length === 1 ? "is" : "are"} not bundled with Node.js yet</h2>
      <p>Node.js has not published a release containing ${missing.length === 1 ? "this npm major" : "these npm majors"}.</p>
    </div>`;
}

function render() {
  const hideEol = hideEolInput.checked;
  const lines = snapshot.lines.filter((line) => {
    if (hideEol && line.isEol) return false;
    return true;
  });

  document.querySelector("#result-count").textContent =
    `${lines.length} of ${snapshot.lines.length} lines`;

  if (!lines.length) {
    grid.innerHTML = '<div class="empty-state">No version lines match these filters.</div>';
    return;
  }

  grid.innerHTML = lines.map((line) => {
    const lifecycle = line.isEol
      ? `<span class="badge eol">EOL</span>`
      : line.lts
        ? `<span class="badge lts">LTS · ${escapeHtml(line.lts)}</span>`
        : `<span class="badge">Current</span>`;
    const eol = line.eol === false
      ? "Supported"
      : line.eol
        ? formatDate(line.eol)
        : line.isEol
          ? "End of life"
          : "Not recorded";
    const rows = line.releases.map((release) => `
      <div class="release-row">
        <span>Node.js ${escapeHtml(release.node)}</span>
        <span>${release.npm ? `npm@${escapeHtml(release.npm)}` : "npm not bundled"}</span>
        <time datetime="${escapeHtml(release.date)}">${formatDate(release.date)}</time>
      </div>`).join("");
    const updateState = getNpmUpdateState(line.npmUpdate);
    let updateLabel = "";
    if (updateState === NPM_RELEASE_STATES.NODE_MERGED) {
      updateLabel = `npm@${line.npmUpdate.available} is merged into ${line.npmUpdate.ref} for a future Node.js release`;
    } else if (updateState === NPM_RELEASE_STATES.NODE_PR_REVIEW) {
      updateLabel = `npm@${line.npmUpdate.available} has open PR #${line.npmUpdate.pullRequest.number} targeting ${line.npmUpdate.ref}`;
    } else if (updateState === NPM_RELEASE_STATES.AWAITING_NODE_PR) {
      updateLabel = line.npmUpdate.ref === "main"
        ? `npm@${line.npmUpdate.available} awaiting main integration`
        : `npm@${line.npmUpdate.available} backport available`;
    }
    const npmUpdate = updateState === NPM_RELEASE_STATES.NODE_PR_REVIEW
      ? `<span class="update-note">npm@${escapeHtml(line.npmUpdate.available)} has open <a href="${escapeHtml(line.npmUpdate.pullRequest.url)}" target="_blank" rel="noopener noreferrer">PR #${line.npmUpdate.pullRequest.number}</a> targeting ${escapeHtml(line.npmUpdate.ref)}</span>`
      : updateLabel
        ? `<span class="update-note ${updateState === NPM_RELEASE_STATES.NODE_MERGED ? "staged" : ""}">${escapeHtml(updateLabel)}</span>`
        : "";

    return `
      <details class="release-line">
        <summary>
          <div>
            <span class="meta-label">Latest mapping</span>
            <div class="version-pair">
              <span class="node-version">${escapeHtml(line.latestNode)}</span>
              <span class="pair-arrow">→</span>
              <span class="npm-version">${line.latestNpm ? `npm@${escapeHtml(line.latestNpm)}` : "npm —"}</span>
            </div>
            ${npmUpdate}
          </div>
          <div>
            <span class="meta-label">Lifecycle</span>
            <span class="meta-value">${escapeHtml(eol)}</span>
          </div>
          <div>
            <span class="meta-label">Published releases</span>
            <span class="meta-value">${line.releases.length}</span>
          </div>
          ${lifecycle}
          <span class="chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="release-list">${rows}</div>
      </details>`;
  }).join("");
}

async function init() {
  try {
    const embeddedData = document.querySelector("#version-data")?.textContent;
    if (embeddedData && embeddedData !== "__VERSION_DATA__") {
      snapshot = JSON.parse(embeddedData);
    } else {
      const response = await fetch("./data/versions.json");
      if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
      snapshot = await response.json();
    }

    const generatedAt = new Date(snapshot.generatedAt);
    const generatedElement = document.querySelector("#generated-at");
    generatedElement.dateTime = snapshot.generatedAt;
    generatedElement.textContent = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(generatedAt) + " UTC";

    const repository = document.documentElement.dataset.repository;
    if (repository) {
      document.querySelector("#source-link").href = `https://github.com/${repository}`;
    } else {
      document.querySelector("#source-link").hidden = true;
    }

    renderPendingReleases(snapshot.npm.pendingReleases ?? []);
    renderPendingBackports(snapshot.npm.pendingBackports ?? []);
    renderNpmStatus(snapshot.npm);
    renderNpmMajorStatus(snapshot.npm.unbundledNewerMajors);
    render();
  } catch (error) {
    status.className = "npm-status alert";
    status.innerHTML = `
      <div class="status-icon">!</div>
      <div>
        <p class="status-label">Snapshot unavailable</p>
        <h2>The daily release data could not be loaded</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>`;
    grid.innerHTML = '<div class="empty-state">No release data is available.</div>';
  }
}

hideEolInput.addEventListener("change", render);
init();
