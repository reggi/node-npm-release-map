import { useEffect, useMemo, useState } from "react";
import {
  AlertIcon,
  CheckCircleFillIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LinkExternalIcon,
  MarkGithubIcon,
  PackageIcon,
  RocketIcon,
  SyncIcon,
} from "@primer/octicons-react";
import {
  Button,
  Checkbox,
  FormControl,
  Heading,
  Label,
  Link,
  Spinner,
  Text,
} from "@primer/react";

function Box({ as: Component = "div", ...props }) {
  return <Component {...props} />;
}

const NPM_RELEASE_STATES = Object.freeze({
  AWAITING_NODE_PR: "awaiting-node-pr",
  NODE_PR_REVIEW: "node-pr-review",
  NODE_MERGED: "node-merged",
});

const npmReleaseQuery = 'is:pr is:open label:"autorelease: pending"';
const npmBackportQuery = "is:pr is:open backport";
const nodeIntegrationQuery =
  'repo:nodejs/node is:pr is:open label:npm in:title "deps: upgrade npm to"';

const githubPullSearchUrl = (repository, query) =>
  `https://github.com/${repository}/pulls?q=${encodeURIComponent(query)}`;

const escapePath = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

function formatDate(value) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatGeneratedAt(value) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatNodeVersion(value) {
  return `Node.js ${value}`;
}

function VersionBadge({ product, version }) {
  const label =
    product === "node"
      ? version === "main"
        ? "Node.js main"
        : formatNodeVersion(version)
      : `npm@${version}`;

  return <span className={`version-badge ${product}`}>{label}</span>;
}

function BranchReference({ repository, branch }) {
  const product = repository === "nodejs/node" ? "node" : "npm";
  return (
    <Link
      className={`branch-reference ${product}`}
      href={`https://github.com/${repository}/tree/${encodeURIComponent(branch)}`}
      target="_blank"
      rel="noreferrer"
    >
      <GitBranchIcon size={12} />
      {repository}#{branch}
    </Link>
  );
}

function getNpmUpdateState(update) {
  if (update?.state) return update.state;
  if (["staged", "release-branch"].includes(update?.status)) {
    return NPM_RELEASE_STATES.NODE_MERGED;
  }
  if (update?.status === "open-pr") return NPM_RELEASE_STATES.NODE_PR_REVIEW;
  if (["awaiting-main", "backport"].includes(update?.status)) {
    return NPM_RELEASE_STATES.AWAITING_NODE_PR;
  }
  return null;
}

function useHashRoute() {
  const getRoute = () => {
    if (window.location.hash === "#/branch-state") return "branch-state";
    if (window.location.hash === "#/release-status") return "release-status";
    return "map";
  };
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const updateRoute = () => setRoute(getRoute());
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  return route;
}

function App() {
  const route = useHashRoute();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(escapePath("/data/versions.json"))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Snapshot request failed (${response.status})`);
        }
        return response.json();
      })
      .then(setSnapshot)
      .catch(setError);
  }, []);

  return (
    <Box className="app-shell">
      <SiteHeader route={route} />
      <Box as="main" className="page-shell">
        {error ? <ErrorState message={error.message} /> : null}
        {!snapshot && !error ? <LoadingState /> : null}
        {snapshot && route === "map" ? <ReleaseMap snapshot={snapshot} /> : null}
        {snapshot && route === "branch-state" ? (
          <BranchState snapshot={snapshot} />
        ) : null}
        {snapshot && route === "release-status" ? (
          <ReleaseStatus snapshot={snapshot} />
        ) : null}
      </Box>
      {snapshot ? <SiteFooter snapshot={snapshot} /> : null}
    </Box>
  );
}

function SiteHeader({ route }) {
  return (
    <Box as="header" className="site-header">
      <Box className="header-inner">
        <Box className="brand">
          <Box className="brand-mark">
            <PackageIcon size={20} />
          </Box>
          <Box>
            <Text className="brand-owner">Node.js release tools</Text>
            <Heading as="h1" className="brand-name">
              Node.js <span>↔</span> npm
            </Heading>
          </Box>
        </Box>
        <Button
          as="a"
          href="https://github.com/reggi/node-npm-release-map"
          target="_blank"
          rel="noreferrer"
          leadingVisual={MarkGithubIcon}
        >
          View source
        </Button>
      </Box>
      <Box as="nav" className="tab-bar" aria-label="Dashboard pages">
        <Box className="tab-inner">
          <a className={route === "map" ? "tab active" : "tab"} href="#/">
            <PackageIcon size={16} />
            Node.js → npm
          </a>
          <a
            className={route === "branch-state" ? "tab active" : "tab"}
            href="#/branch-state"
          >
            <SyncIcon size={16} />
            npm → Node.js
          </a>
          <a
            className={route === "release-status" ? "tab active" : "tab"}
            href="#/release-status"
          >
            <RocketIcon size={16} />
            Release status
          </a>
        </Box>
      </Box>
    </Box>
  );
}

function PageIntro({ eyebrow, title, description, visual: Visual }) {
  return (
    <Box className="page-intro">
      <Box>
        <Text className="eyebrow">{eyebrow}</Text>
        <Heading as="h2">{title}</Heading>
        <Text as="p">{description}</Text>
      </Box>
      <Box className="intro-visual" aria-hidden="true">
        <Visual size={32} />
      </Box>
    </Box>
  );
}

function ReleaseMap({ snapshot }) {
  const [hideEol, setHideEol] = useState(true);
  const lines = useMemo(
    () => snapshot.lines.filter((line) => !hideEol || !line.isEol),
    [hideEol, snapshot.lines],
  );

  return (
    <>
      <PageIntro
        eyebrow="Published release reference"
        title="Node.js → npm"
        description="Start here when you need to confirm what users actually receive. Each row shows the newest published Node.js release in a release line and the npm version bundled with it."
        visual={PackageIcon}
      />

      <Box className="info-banner">
        <CheckCircleFillIcon size={18} />
        <Text>
          This page starts with Node.js and shows the npm version bundled with
          it. To start with an npm major and find its Node.js branches, open the{" "}
          <a href="#/branch-state">npm → Node.js page</a>. For
          active npm release work, open the{" "}
          <a href="#/release-status">release status page</a>.
        </Text>
      </Box>

      <Box className="section-toolbar">
        <Box>
          <Heading as="h3">Node.js release lines</Heading>
          <Text as="p">
            Showing {lines.length} of {snapshot.lines.length} release lines
          </Text>
        </Box>
        <FormControl>
          <Checkbox
            checked={hideEol}
            onChange={(event) => setHideEol(event.target.checked)}
          />
          <FormControl.Label>Hide end of life lines</FormControl.Label>
        </FormControl>
      </Box>

      <Box className="release-table" role="table">
        <Box className="table-header" role="row">
          <Text role="columnheader">Latest mapping</Text>
          <Text role="columnheader">Lifecycle</Text>
          <Text role="columnheader">Published releases</Text>
          <Text role="columnheader">Status</Text>
        </Box>
        {lines.map((line) => (
          <ReleaseLine key={line.cycle} line={line} />
        ))}
      </Box>
    </>
  );
}

function BranchState({ snapshot }) {
  return (
    <>
      <PageIntro
        eyebrow="Current branch state"
        title="npm → Node.js"
        description={
          <>
            Start with <VersionBadge product="npm" version="10" />,{" "}
            <VersionBadge product="npm" version="11" />, or{" "}
            <VersionBadge product="npm" version="12" /> and see every maintained
            Node.js branch that currently carries it. This is current internal
            state, not a release checklist.
          </>
        }
        visual={SyncIcon}
      />

      <Box className="info-banner">
        <GitBranchIcon size={18} />
        <Text>
          This page answers which Node.js branches contain each npm major.
          Published means users can receive the version in a Node.js release.
          Merged* means it is on a branch but has not shipped yet. When that
          Node.js branch next publishes a release, the npm version will be
          included.
        </Text>
      </Box>

      <MajorTrackingMatrix majors={snapshot.npm.trackedMajors ?? []} />

      <Box className="manual-panel branch-manual-panel">
        <Box>
          <Text className="manual-title">Manual verification</Text>
          <Text as="p">
            Search nodejs/node for open npm upgrade pull requests, then compare
            the target branch with the registry and branch versions above.
          </Text>
          <code>{nodeIntegrationQuery}</code>
        </Box>
        <Button
          as="a"
          href={`https://github.com/search?q=${encodeURIComponent(nodeIntegrationQuery)}&type=pullrequests`}
          target="_blank"
          rel="noreferrer"
          trailingVisual={LinkExternalIcon}
        >
          Search integration pull requests
        </Button>
      </Box>
    </>
  );
}

function ReleaseLine({ line }) {
  const updateState = getNpmUpdateState(line.npmUpdate);
  const lifecycle = line.isEol ? "EOL" : line.lts ? "LTS" : "Current";
  const eol =
    line.eol === false
      ? "Supported"
      : line.eol
        ? `Ends ${formatDate(line.eol)}`
        : line.isEol
          ? "End of life"
          : "Not recorded";

  let updateNote = null;
  if (updateState === NPM_RELEASE_STATES.NODE_MERGED) {
    updateNote = (
      <>
        <VersionBadge product="npm" version={line.npmUpdate.available} /> is
        merged into{" "}
        <BranchReference repository="nodejs/node" branch={line.npmUpdate.ref} />
      </>
    );
  } else if (updateState === NPM_RELEASE_STATES.NODE_PR_REVIEW) {
    updateNote = (
      <>
        <VersionBadge product="npm" version={line.npmUpdate.available} /> has an
        open integration pull request
      </>
    );
  } else if (updateState === NPM_RELEASE_STATES.AWAITING_NODE_PR) {
    updateNote = (
      <>
        <VersionBadge product="npm" version={line.npmUpdate.available} /> is
        available for integration
      </>
    );
  }

  return (
    <details className="release-line">
      <summary>
        <Box className="mapping-cell">
          <VersionBadge product="node" version={line.latestNode} />
          <Text className="mapping-arrow">→</Text>
          {line.latestNpm ? (
            <VersionBadge product="npm" version={line.latestNpm} />
          ) : (
            <Text>npm not bundled</Text>
          )}
          {updateNote ? <Text className="update-note">{updateNote}</Text> : null}
        </Box>
        <Box>
          <Text className="cell-label">Lifecycle</Text>
          <Text>{eol}</Text>
        </Box>
        <Box>
          <Text className="cell-label">Published releases</Text>
          <Text>{line.releases.length}</Text>
        </Box>
        <Label
          className={`lifecycle-label ${
            line.isEol ? "eol" : line.lts ? "lts" : "current"
          }`}
          variant={line.isEol ? "danger" : line.lts ? "success" : "accent"}
        >
          {line.lts ? `${lifecycle} · ${line.lts}` : lifecycle}
        </Label>
      </summary>
      <Box className="release-history">
        {line.releases.map((release) => (
          <Box className="history-row" key={release.node}>
            <VersionBadge product="node" version={release.node} />
            {release.npm ? (
              <VersionBadge product="npm" version={release.npm} />
            ) : (
              <Text>npm not bundled</Text>
            )}
            <Text>{formatDate(release.date)}</Text>
          </Box>
        ))}
      </Box>
    </details>
  );
}

function ReleaseStatus({ snapshot }) {
  const checks = buildReleaseChecks(snapshot.npm);

  return (
    <>
      <PageIntro
        eyebrow="In flight release work"
        title="Follow active npm release work, one check at a time"
        description="Read from top to bottom. These checks focus on work a release engineer needs to inspect before npm publication. Current npm and Node.js branch state lives on its own page."
        visual={RocketIcon}
      />

      <Box className="status-summary">
        <Box>
          <Text className="eyebrow">Daily snapshot</Text>
          <Heading as="h3">Automated checks complete</Heading>
        </Box>
        <Label className="snapshot-label" variant="success">
          Generated {formatGeneratedAt(snapshot.generatedAt)} UTC
        </Label>
      </Box>

      <Box className="reading-guide">
        <CheckCircleFillIcon size={18} />
        <Text>
          <strong>Checked and clear</strong> means the check ran and found no
          action. Open results explain which release pull requests or backports
          need inspection.
        </Text>
      </Box>

      <Box className="check-list">
        {checks.map((check, index) => (
          <ReleaseCheck
            check={check}
            number={index + 1}
            isLast={index === checks.length - 1}
            key={check.title}
          />
        ))}
      </Box>
    </>
  );
}

function buildReleaseChecks(npm) {
  const pendingReleases = npm.pendingReleases ?? [];
  const pendingBackports = npm.pendingBackports ?? [];

  const backportsByMajor = new Map();
  for (const backport of pendingBackports) {
    const entry = backportsByMajor.get(backport.major) ?? {
      major: backport.major,
      target: backport.target,
      count: 0,
    };
    entry.count += 1;
    backportsByMajor.set(backport.major, entry);
  }

  return [
    {
      icon: GitPullRequestIcon,
      title: "Check for a pending npm release",
      eyebrow: "npm publication",
      description:
        "A Release Please pull request means npm publication is still in progress. Confirm it is merged and published before starting Node.js integration.",
      tone: pendingReleases.length ? "attention" : "clear",
      status: pendingReleases.length
        ? `${pendingReleases.length} open`
        : "Checked and clear",
      empty: "No open npm release pull requests matched the release query.",
      results: pendingReleases.map((release) => ({
        label: `npm/cli#${release.pullRequest.number}`,
        href: release.pullRequest.url,
        detail: (
          <>
            <VersionBadge product="npm" version={release.version} /> release from{" "}
            <BranchReference repository="npm/cli" branch={release.target} />
          </>
        ),
      })),
      manual: {
        href: githubPullSearchUrl("npm/cli", npmReleaseQuery),
        label: "Search npm release pull requests",
        query: npmReleaseQuery,
        note: "Search npm/cli for Release Please pull requests that are still pending.",
      },
    },
    {
      icon: GitBranchIcon,
      title: "Check npm release branch backports",
      eyebrow: "npm backports",
      description:
        "Backport pull requests collect fixes for older npm majors. Required backports should be merged before the matching npm release is prepared.",
      tone: pendingBackports.length ? "attention" : "clear",
      status: pendingBackports.length
        ? `${pendingBackports.length} open`
        : "Checked and clear",
      empty: "No open npm backport pull requests matched the backport search.",
      results: [...backportsByMajor.values()]
        .sort((a, b) => b.major - a.major)
        .map(({ major, target, count }) => ({
          label: <VersionBadge product="npm" version={major} />,
          href: githubPullSearchUrl("npm/cli", `is:pr is:open base:${target}`),
          detail: (
            <>
              {count} open {count === 1 ? "pull request" : "pull requests"}{" "}
              targeting <BranchReference repository="npm/cli" branch={target} />
            </>
          ),
        })),
      manual: {
        href: githubPullSearchUrl("npm/cli", npmBackportQuery),
        label: "Search npm backports",
        query: npmBackportQuery,
        note: "Search npm/cli for open backport work, then confirm the source and target branches.",
      },
    },
  ];
}

function ReleaseCheck({ check, number, isLast }) {
  const Icon = check.icon;
  const statusVariant =
    check.tone === "warning"
      ? "danger"
      : check.tone === "attention"
        ? "attention"
        : check.tone === "progress"
          ? "accent"
          : "success";

  return (
    <Box className={`release-check ${check.tone}`}>
      <Box className="check-rail" aria-hidden="true">
        <Box className="step-number">{number}</Box>
        {!isLast ? <Box className="step-line" /> : null}
      </Box>
      <Box className="check-card">
        <Box className="check-heading">
          <Box className="check-title">
            <Box className="check-icon">
              <Icon size={18} />
            </Box>
            <Box>
              <Text className="eyebrow">{check.eyebrow}</Text>
              <Heading as="h3">{check.title}</Heading>
            </Box>
          </Box>
          <Label className="check-status-label" variant={statusVariant}>
            {check.status}
          </Label>
        </Box>
        <Text as="p" className="check-description">
          {check.description}
        </Text>

        {check.results.length ? (
          <Box className="result-list">
            {check.results.map((result, index) => (
              <Box className="result-row" key={`${result.label}-${index}`}>
                <Box>
                  {result.href ? (
                    <Link href={result.href} target="_blank" rel="noreferrer">
                      {result.label}
                    </Link>
                  ) : (
                    <Text as="strong">{result.label}</Text>
                  )}
                </Box>
                <Box className="result-detail">
                  <Text>{result.detail}</Text>
                  {result.links?.length ? (
                    <Box className="result-links">
                      {result.links.map((link) => (
                        <Link
                          href={link.href}
                          key={link.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {link.label} <LinkExternalIcon size={12} />
                        </Link>
                      ))}
                    </Box>
                  ) : null}
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box className="clear-result">
            <CheckCircleFillIcon size={16} />
            <Text>{check.empty}</Text>
          </Box>
        )}

        <Box className="manual-panel">
          <Box>
            <Text className="manual-title">Manual verification</Text>
            <Text as="p">{check.manual.note}</Text>
            {check.manual.query ? <code>{check.manual.query}</code> : null}
          </Box>
          <Button
            as="a"
            href={check.manual.href}
            target="_blank"
            rel="noreferrer"
            trailingVisual={LinkExternalIcon}
          >
            {check.manual.label}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

const branchStatus = {
  published: { label: "Published", variant: "success" },
  current: { label: "Current", variant: "success" },
  merged: { label: "Merged*", variant: "accent" },
  "in-review": { label: "In review", variant: "attention" },
  "needs-action": { label: "Needs action", variant: "danger" },
};

function MajorTrackingMatrix({ majors }) {
  return (
    <Box className="major-matrix">
      {majors.map((item) => (
        <Box className="major-card" key={item.major}>
          <Box className="major-heading">
            <Box>
              <Heading as="h4">
                <VersionBadge product="npm" version={item.major} />
              </Heading>
              <Text>
                Latest registry release:{" "}
                {item.latest ? (
                  <VersionBadge product="npm" version={item.latest} />
                ) : (
                  <strong>Not found</strong>
                )}
              </Text>
            </Box>
            <Label
              className={`major-status ${item.status}`}
              variant={item.status === "unassigned" ? "danger" : "success"}
            >
              {item.status === "unassigned"
                ? "No Node.js branch assigned"
                : `${item.branches.length} ${
                    item.branches.length === 1 ? "branch" : "branches"
                  }`}
            </Label>
          </Box>

          {item.branches.length ? (
            <Box className="branch-table">
              {item.branches.map((branch) => {
                const status = branchStatus[branch.status];
                return (
                  <Box
                    className="branch-row"
                    key={`${item.major}-${branch.releaseRef}`}
                  >
                    <Box>
                      <BranchReference
                        repository="nodejs/node"
                        branch={branch.releaseRef}
                      />
                    </Box>
                    <Box>
                      <Text className="branch-label">
                        {branch.publishedNode ? "Published" : "Branch version"}
                      </Text>
                      <Box className="version-pair">
                        {branch.publishedNode ? (
                          <VersionBadge
                            product="node"
                            version={branch.publishedNode}
                          />
                        ) : null}
                        <VersionBadge
                          product="npm"
                          version={branch.publishedNpm ?? branch.releaseNpm}
                        />
                      </Box>
                    </Box>
                    <Box>
                      <Text className="branch-label">Latest on branch</Text>
                      <Box className="version-pair">
                        <BranchReference
                          repository="nodejs/node"
                          branch={branch.stagingRef ?? branch.releaseRef}
                        />
                        <VersionBadge
                          product="npm"
                          version={branch.stagingNpm ?? branch.releaseNpm}
                        />
                      </Box>
                    </Box>
                    <Box className="branch-state">
                      <Label
                        className={`branch-status ${branch.status}`}
                        variant={status.variant}
                      >
                        {status.label}
                      </Label>
                      <BranchProvenance branch={branch} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box className="unassigned-major">
              <AlertIcon size={16} />
              <Text>
                <VersionBadge product="npm" version={item.latest} /> is
                available, but no maintained Node.js branch currently carries{" "}
                <VersionBadge product="npm" version={item.major} />.
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

function BranchProvenance({ branch }) {
  const links = [
    branch.status === "published" && branch.publishedNode
      ? {
          label: "View release artifact",
          href: `https://github.com/nodejs/node/blob/${encodeURIComponent(branch.publishedNode)}/deps/npm/package.json`,
        }
      : null,
    branch.pullRequest
      ? {
          label: `PR #${branch.pullRequest.number}`,
          href: branch.pullRequest.url,
        }
      : null,
    branch.provenance?.commit
      ? {
          label: `Commit ${branch.provenance.commit.shortSha}`,
          href: branch.provenance.commit.url,
        }
      : null,
    branch.provenance?.pullRequest
      ? {
          label: `PR #${branch.provenance.pullRequest.number}`,
          href: branch.provenance.pullRequest.url,
        }
      : null,
  ].filter(
    (link, index, items) =>
      link && items.findIndex((item) => item?.href === link.href) === index,
  );

  if (!links.length) return null;
  return (
    <Box className="branch-links">
      {links.map((link) => (
        <Link href={link.href} key={link.href} target="_blank" rel="noreferrer">
          {link.label}
        </Link>
      ))}
    </Box>
  );
}

function LoadingState() {
  return (
    <Box className="center-state">
      <Spinner size="large" />
      <Heading as="h2">Loading the daily snapshot</Heading>
      <Text>Reading Node.js releases, npm versions, and open pull requests.</Text>
    </Box>
  );
}

function ErrorState({ message }) {
  return (
    <Box className="center-state error-state">
      <AlertIcon size={32} />
      <Heading as="h2">The daily snapshot could not be loaded</Heading>
      <Text>{message}</Text>
    </Box>
  );
}

function SiteFooter({ snapshot }) {
  return (
    <Box as="footer" className="site-footer">
      <Box className="footer-inner">
        <Box className="footer-summary">
          <Box className="brand-mark footer-mark">
            <PackageIcon size={18} />
          </Box>
          <Box>
            <Text as="strong">Node.js ↔ npm release map</Text>
            <Text>
              Snapshot generated {formatGeneratedAt(snapshot.generatedAt)} UTC
            </Text>
          </Box>
        </Box>
        <Box as="nav" className="footer-nav" aria-label="Footer navigation">
          <Link href="#/">Node.js → npm</Link>
          <Link href="#/branch-state">npm → Node.js</Link>
          <Link href="#/release-status">Release status</Link>
          <Link
            href="https://github.com/reggi/node-npm-release-map"
            target="_blank"
            rel="noreferrer"
          >
            <MarkGithubIcon size={16} /> Source
          </Link>
        </Box>
      </Box>
    </Box>
  );
}

export default App;
