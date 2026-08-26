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

  if (pending.length) {
    const pendingByVersion = new Map();
    for (const update of pending) {
      const updates = pendingByVersion.get(update.available) ?? [];
      updates.push(update);
      pendingByVersion.set(update.available, updates);
    }
    const pendingText = [...pendingByVersion]
      .map(([available, updates]) =>
        `npm ${available} for Node.js ${updates.map(({ nodeCycle }) => nodeCycle).join(" and ")}`)
      .join("; ");

    status.className = "npm-status callout";
    status.innerHTML = `
      <div class="status-icon">↗</div>
      <div>
        <p class="status-label">Available npm integrations</p>
        <h2>Newer npm releases are available for Node.js</h2>
        <p>${escapeHtml(pendingText)}.</p>
      </div>`;
    return;
  }

  status.innerHTML = `
    <div class="status-icon">✓</div>
    <div>
      <p class="status-label">npm major coverage</p>
      <h2>Bundled npm majors are up to date</h2>
      <p>Each npm major currently bundled with a supported Node.js line is at its latest release.</p>
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
    <div class="status-icon">↗</div>
    <div>
    <p class="status-label">Unbundled npm major</p>
    <h2>${escapeHtml(versions)} ${missing.length === 1 ? "is" : "are"} not bundled with Node.js yet</h2>
    <p>This is separate from updates to npm majors already included in supported Node.js lines.</p>
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
    const npmUpdate = line.npmUpdate
      ? `<span class="update-note">npm ${escapeHtml(line.npmUpdate.available)} available</span>`
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
