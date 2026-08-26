const grid = document.querySelector("#release-grid");
const hideEolInput = document.querySelector("#hide-eol");
const status = document.querySelector("#npm-status");
const majorStatus = document.querySelector("#npm-major-status");

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

function renderNpmStatus(npm) {
  const pending = npm.pendingNodeUpdates;
  const openPullRequests = npm.openNodeUpdates;

  if (pending.length) {
    const pendingText = pending
      .map((update) => update.kind === "integration"
        ? `npm ${update.available} for Node.js main`
        : `npm ${update.available} backport for Node.js ${update.target}`)
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
    const pullRequestText = openPullRequests
      .map((pull) =>
        `<a href="${escapeHtml(pull.url)}">nodejs/node#${pull.number}</a> updates npm to ${escapeHtml(pull.version)} on <code>${escapeHtml(pull.base)}</code>`)
      .join("; ");
    status.className = "npm-status callout";
    status.innerHTML = `
      <div class="status-icon">↗</div>
      <div>
        <p class="status-label">Open Node.js pull request</p>
        <h2>An npm update PR already exists</h2>
        <p>${pullRequestText}.</p>
      </div>`;
    return;
  }

  status.innerHTML = `
    <div class="status-icon">✓</div>
    <div>
      <p class="status-label">Node.js integration status</p>
      <h2>No npm integrations need action</h2>
      <p>${npm.stagedNodeUpdates.length
        ? "Newer npm releases are already queued on Node.js staging branches."
        : "Supported Node.js lines bundle the latest applicable npm releases."}</p>
    </div>`;
}

function renderNpmMajorStatus(missing) {
  if (!missing.length) {
    majorStatus.hidden = true;
    return;
  }

  const versions = missing.map(({ latest }) => `npm ${latest}`).join(", ");
  majorStatus.hidden = false;
  majorStatus.innerHTML = `
    <div class="status-icon">!</div>
    <div>
    <p class="status-label">Unbundled npm major</p>
    <h2>${escapeHtml(versions)} ${missing.length === 1 ? "is" : "are"} not bundled with Node.js yet</h2>
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
        <span>npm ${escapeHtml(release.npm ?? "not bundled")}</span>
        <time datetime="${escapeHtml(release.date)}">${formatDate(release.date)}</time>
      </div>`).join("");
    let updateLabel = "";
    if (line.npmUpdate?.status === "staged") {
      updateLabel = `npm ${line.npmUpdate.available} queued in ${line.npmUpdate.ref} for the next Node.js release`;
    } else if (line.npmUpdate?.status === "release-branch") {
      updateLabel = `npm ${line.npmUpdate.available} is on the release branch`;
    } else if (line.npmUpdate?.status === "open-pr") {
      updateLabel = `npm ${line.npmUpdate.available} has open PR #${line.npmUpdate.pullRequest.number} targeting ${line.npmUpdate.ref}`;
    } else if (line.npmUpdate?.status === "awaiting-main") {
      updateLabel = `npm ${line.npmUpdate.available} awaiting main integration`;
    } else if (line.npmUpdate?.status === "backport") {
      updateLabel = `npm ${line.npmUpdate.available} backport available`;
    }
    const npmUpdate = line.npmUpdate?.status === "open-pr"
      ? `<span class="update-note">npm ${escapeHtml(line.npmUpdate.available)} has open <a href="${escapeHtml(line.npmUpdate.pullRequest.url)}">PR #${line.npmUpdate.pullRequest.number}</a> targeting ${escapeHtml(line.npmUpdate.ref)}</span>`
      : updateLabel
        ? `<span class="update-note ${line.npmUpdate.status === "staged" ? "staged" : ""}">${escapeHtml(updateLabel)}</span>`
        : "";

    return `
      <details class="release-line">
        <summary>
          <div>
            <span class="meta-label">Latest mapping</span>
            <div class="version-pair">
              <span class="node-version">${escapeHtml(line.latestNode)}</span>
              <span class="pair-arrow">→</span>
              <span class="npm-version">npm ${escapeHtml(line.latestNpm ?? "—")}</span>
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
