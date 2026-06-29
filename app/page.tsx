import {
  Activity,
  Archive,
  BadgeCheck,
  BellRing,
  Brain,
  CalendarClock,
  CircuitBoard,
  GitPullRequest,
  Layers3,
  LockKeyhole,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  Waypoints
} from "lucide-react";
import { repository } from "@/lib/repository";
import { generateAllAdapters } from "@/lib/adapters";
import { agentExportService } from "@/lib/agent-exports";
import { packageDistributionService } from "@/lib/package-distribution";
import { artifactProcessingPipeline } from "@/lib/artifact-processing";
import { candidateExtractionWorker } from "@/lib/candidate-extraction";
import { memoryConflictWorkflow } from "@/lib/memory-conflicts";
import { memoryQualityLoop } from "@/lib/memory-quality-loop";
import { summarizeQuality } from "@/lib/quality";
import { registryImportService } from "@/lib/registry-import";
import { registryPublicationPipeline } from "@/lib/registry-publication";
import { toolInvocationGateway } from "@/lib/tool-invocation-gateway";
import { getSetupState } from "@/lib/setup";
import { bootstrapTenantFromForm } from "@/app/setup/actions";
import { composioControlPlane, type ComposioState } from "@/lib/composio-control-plane";
import { composioIngestionPipeline, type ComposioIngestionState } from "@/lib/composio-ingestion";
import { connectorOps } from "@/lib/connector-ops";
import { BrainWorkbench } from "@/app/brain-workbench";
import { FlexibleConnectorConsole } from "@/app/flexible-connector-console";
import { GoogleConnectorConsole } from "@/app/google-connector-console";
import { SlackConnectorConsole } from "@/app/slack-connector-console";
import { WorkConnectorConsole } from "@/app/work-connector-console";
import type { BrainTier, Changeset, CronRun, DashboardSnapshot, Principal, RegistryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<BrainTier, string> = {
  individual: "Individual",
  team: "Team",
  department: "Department",
  "company-main": "Company main",
  "exec-protected": "Exec protected",
  regulated: "Regulated"
};

function statusClass(status: string) {
  if (["published", "approved", "passed", "succeeded", "merged", "active", "configured"].includes(status)) {
    return "status statusGood";
  }
  if (["review", "warning", "needs-approval", "checks-running", "pending"].includes(status)) {
    return "status statusWarn";
  }
  if (["blocked", "denied", "failed", "rejected", "revoked", "errored"].includes(status)) {
    return "status statusBad";
  }
  return "status";
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Brain;
}) {
  return (
    <section className="metricPanel">
      <div className="metricIcon">
        <Icon size={18} />
      </div>
      <div>
        <p className="metricLabel">{label}</p>
        <p className="metricValue">{value}</p>
        <p className="metricDetail">{detail}</p>
      </div>
    </section>
  );
}

function TierRail({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <section className="panel tierPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Governed memory</p>
          <h2>Brain tiers</h2>
        </div>
        <span className="status">review gated</span>
      </div>
      <div className="tierRail">
        {snapshot.tiers.map((tier, index) => (
          <div className="tierRow" key={tier.tier}>
            <div className="tierIndex">{String(index + 1).padStart(2, "0")}</div>
            <div className="tierBody">
              <div className="tierTop">
                <strong>{tierLabels[tier.tier]}</strong>
                <span>{tier.openChangesets} open PRs</span>
              </div>
              <div className="tierBars">
                <span style={{ inlineSize: `${Math.max(12, tier.atomCount * 28)}%` }} />
                <span style={{ inlineSize: `${Math.max(12, tier.registryCount * 26)}%` }} />
              </div>
              <div className="tierMeta">
                <span>{tier.atomCount} atoms</span>
                <span>{tier.registryCount} registry items</span>
                <span>{tier.staleCount} stale</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RegistryMatrix({ items }: { items: RegistryItem[] }) {
  const grouped = items.reduce<Record<string, RegistryItem[]>>((acc, item) => {
    acc[item.kind] ??= [];
    acc[item.kind].push(item);
    return acc;
  }, {});

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Capabilities</p>
          <h2>Registry by tier</h2>
        </div>
        <Plug size={20} />
      </div>
      <div className="registryGrid">
        {Object.entries(grouped).map(([kind, group]) => (
          <article className="registryGroup" key={kind}>
            <div className="registryKind">{kind}</div>
            {group.map((item) => (
              <div className="registryItem" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                </div>
                <div className="registryMeta">
                  <span className={statusClass(item.status)}>{item.status}</span>
                  <span>{tierLabels[item.tier]}</span>
                  <span>{item.version}</span>
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

async function RegistryImportPanel() {
  const state = await registryImportService.getState();
  const imports = state.imports.slice(0, 5);
  const draftChangesets = state.changesets.filter((changeset) => changeset.status === "draft");

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Package intake</p>
          <h2>Registry imports</h2>
        </div>
        <span className="status">{draftChangesets.length} drafts</span>
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Imports</span>
          <strong>{state.imports.length}</strong>
          <small>canonical packages</small>
        </div>
        <div className="connectionItem">
          <span>Changesets</span>
          <strong>{state.changesets.length}</strong>
          <small>review required</small>
        </div>
        <div className="connectionItem">
          <span>Invalid</span>
          <strong>{state.imports.filter((item) => item.status === "invalid").length}</strong>
          <small>needs manifest fixes</small>
        </div>
        <div className="connectionItem">
          <span>Drafts</span>
          <strong>{draftChangesets.length}</strong>
          <small>not published</small>
        </div>
      </div>
      <div className="connectionList">
        {imports.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No packages imported yet</strong>
              <span>POST /api/v1/registry/import with a canonical package manifest.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {imports.map((item) => (
          <div className="connectionRow" key={item.id}>
            <div>
              <strong>{item.slug}</strong>
              <span>
                {item.packageKind} · {item.version} · {item.packageId}
              </span>
            </div>
            <span className={statusClass(item.status)}>{item.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function RegistryPublicationPanel() {
  const state = await registryPublicationPipeline.getState();
  const checks = state.checks.slice(0, 5);
  const failedChecks = state.checks.filter((check) => check.status === "failed").length;

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Publication gate</p>
          <h2>Registry checks</h2>
        </div>
        <span className={statusClass(failedChecks > 0 ? "failed" : "passed")}>{failedChecks} failed</span>
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Checks</span>
          <strong>{state.checks.length}</strong>
          <small>lint/sandbox/evals/security</small>
        </div>
        <div className="connectionItem">
          <span>Published</span>
          <strong>{state.publications.length}</strong>
          <small>with rollback metadata</small>
        </div>
        <div className="connectionItem">
          <span>Audit</span>
          <strong>{state.auditEvents.length}</strong>
          <small>publish events</small>
        </div>
        <div className="connectionItem">
          <span>Canary</span>
          <strong>{state.publications[0]?.canaryPercent ?? 0}%</strong>
          <small>latest rollout</small>
        </div>
      </div>
      <div className="connectionList">
        {checks.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No publication checks yet</strong>
              <span>POST /api/v1/registry/publication/check before publishing.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {checks.map((check) => (
          <div className="connectionRow" key={`${check.packageId}:${check.version}:${check.id}`}>
            <div>
              <strong>{check.label}</strong>
              <span>
                {check.packageId}@{check.version} · {check.detail}
              </span>
            </div>
            <span className={statusClass(check.status)}>{check.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function ToolInvocationPanel() {
  const state = await toolInvocationGateway.getState();
  const records = state.records.slice(0, 5);
  const deniedOrApproval = state.records.filter((record) => ["denied", "needs-approval"].includes(record.status));

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Execution gateway</p>
          <h2>Tool invocations</h2>
        </div>
        <Wrench size={20} />
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Invocations</span>
          <strong>{state.records.length}</strong>
          <small>policy checked</small>
        </div>
        <div className="connectionItem">
          <span>Succeeded</span>
          <strong>{state.records.filter((record) => record.status === "succeeded").length}</strong>
          <small>Composio executed</small>
        </div>
        <div className="connectionItem">
          <span>Gated</span>
          <strong>{deniedOrApproval.length}</strong>
          <small>denied or needs approval</small>
        </div>
        <div className="connectionItem">
          <span>Audit</span>
          <strong>{state.auditEvents.length}</strong>
          <small>tool.invoke events</small>
        </div>
      </div>
      <div className="connectionList">
        {records.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No tool invocations yet</strong>
              <span>POST /api/v1/tools/invoke to execute an approved registry tool through policy.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {records.map((record) => (
          <div className="connectionRow" key={record.id}>
            <div>
              <strong>{record.toolSlug}</strong>
              <span>
                {record.principalId} · {record.connectedAccountId} · v{record.packageVersion}
              </span>
              <small>{record.decision.reasons[0] ?? "Recorded by tool invocation gateway."}</small>
            </div>
            <span className={statusClass(record.status)}>{record.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ChangesetQueue({ changesets }: { changesets: Changeset[] }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Promotion gate</p>
          <h2>Review queue</h2>
        </div>
        <GitPullRequest size={20} />
      </div>
      <div className="changesetList">
        {changesets.map((changeset) => (
          <article className="changeset" key={changeset.id}>
            <div className="changesetTop">
              <div>
                <strong>{changeset.title}</strong>
                <p>{changeset.summary}</p>
              </div>
              <span className={statusClass(changeset.status)}>{changeset.status}</span>
            </div>
            <div className="checkList">
              {changeset.checks.map((check) => (
                <div className="check" key={check.id}>
                  <span className={statusClass(check.status)}>{check.status}</span>
                  <span>{check.label}</span>
                  <small>{check.detail}</small>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CronConsole({ runs, items }: { runs: CronRun[]; items: RegistryItem[] }) {
  const cronJobs = items.filter((item) => item.kind === "cronjob");

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Self-guided loops</p>
          <h2>Scheduler</h2>
        </div>
        <CalendarClock size={20} />
      </div>
      <div className="cronShell">
        {cronJobs.map((job) => (
          <article className="cronJob" key={job.id}>
            <div>
              <strong>{job.name}</strong>
              {"schedule" in job ? <span>{job.schedule} · {job.timezone}</span> : null}
            </div>
            <span className={statusClass(job.status)}>{job.status}</span>
          </article>
        ))}
        <div className="runList">
          {runs.map((run) => (
            <div className="runRow" key={run.id}>
              <span className={statusClass(run.status)}>{run.status}</span>
              <p>{run.output}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

async function CompatibilityPanel({ items }: { items: RegistryItem[] }) {
  const adapters = generateAllAdapters(items);
  const exports = await agentExportService.getState();
  const bundles = exports.bundles.slice(0, 5);
  const failures = exports.failures.slice(0, 3);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Agent compatibility</p>
          <h2>Generated packs</h2>
        </div>
        <CircuitBoard size={20} />
      </div>
      <div className="adapterGrid">
        {adapters.map((adapter) => (
          <article className="adapter" key={adapter.target}>
            <strong>{adapter.target}</strong>
            <span>{adapter.files.length} files</span>
            <small>{adapter.files[0]?.path}</small>
          </article>
        ))}
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Bundles</span>
          <strong>{exports.bundles.length}</strong>
          <small>downloadable JSON</small>
        </div>
        <div className="connectionItem">
          <span>Targets</span>
          <strong>{new Set(exports.bundles.map((bundle) => bundle.target)).size}</strong>
          <small>Codex/Claude/OpenCode/MCP</small>
        </div>
        <div className="connectionItem">
          <span>Failures</span>
          <strong>{exports.failures.length}</strong>
          <small>block publication</small>
        </div>
        <div className="connectionItem">
          <span>Latest</span>
          <strong>{bundles[0]?.version ?? "none"}</strong>
          <small>{bundles[0]?.slug ?? "waiting for export"}</small>
        </div>
      </div>
      <div className="connectionList">
        {bundles.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No generated bundles yet</strong>
              <span>POST /api/v1/registry/exports with a published package id to generate downloads.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {bundles.map((bundle) => (
          <div className="connectionRow" key={bundle.id}>
            <div>
              <strong>
                {bundle.target} · {bundle.slug}
              </strong>
              <span>
                v{bundle.version} · {bundle.files.length} files · {bundle.downloadUrl}
              </span>
              <small>Rollback target {bundle.manifest.package.rollbackTarget}</small>
            </div>
            <span className="status statusGood">ready</span>
          </div>
        ))}
        {failures.map((failure) => (
          <div className="connectionRow" key={failure.id}>
            <div>
              <strong>{failure.slug ?? failure.packageId}</strong>
              <span>{failure.errors.join(" ")}</span>
            </div>
            <span className="status statusBad">blocked</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function PackageDistributionPanel({ principal }: { principal: Principal }) {
  const [catalog, state] = await Promise.all([
    packageDistributionService.listCatalog({ principal }),
    packageDistributionService.getState()
  ]);
  const packages = catalog.packages.slice(0, 5);
  const rollbacks = state.rollbacks.slice(0, 3);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Package distribution</p>
          <h2>Install and rollback</h2>
        </div>
        <span className="status">{state.pins.length} pins</span>
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Published</span>
          <strong>{catalog.packages.length}</strong>
          <small>visible packages</small>
        </div>
        <div className="connectionItem">
          <span>Pins</span>
          <strong>{state.pins.length}</strong>
          <small>agent installs</small>
        </div>
        <div className="connectionItem">
          <span>Rollbacks</span>
          <strong>{state.rollbacks.length}</strong>
          <small>audited changes</small>
        </div>
        <div className="connectionItem">
          <span>Impacted</span>
          <strong>{state.rollbacks.reduce((sum, rollback) => sum + rollback.dependentPackages.length, 0)}</strong>
          <small>dependent packages</small>
        </div>
      </div>
      <div className="connectionList">
        {packages.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No installable packages visible</strong>
              <span>Published packages appear here when registry policy allows this principal to install them.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {packages.map((item) => (
          <div className="connectionRow" key={`${item.packageId}:${item.version}`}>
            <div>
              <strong>
                {item.slug} · v{item.version}
              </strong>
              <span>
                quality {item.qualityScore}% · {item.compatibleAgents.join(", ")}
              </span>
              <small>{item.installOptions[0]?.installSnippet}</small>
            </div>
            <span className={statusClass(item.status)}>{item.status}</span>
          </div>
        ))}
        {rollbacks.map((rollback) => (
          <div className="connectionRow" key={rollback.id}>
            <div>
              <strong>{rollback.slug}</strong>
              <span>
                {rollback.fromVersion} {"->"} {rollback.targetVersion} · {rollback.dependentPackages.length} dependents
              </span>
              <small>{rollback.changeset.summary}</small>
            </div>
            <span className="status statusWarn">rollback</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ComposioPanel({ state }: { state: ComposioState }) {
  const configStatus = state.config?.apiKeyConfigured ? "configured" : "not configured";
  const accounts = state.connectedAccounts.slice(0, 4);
  const candidates = state.registryCandidates.slice(0, 4);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Connections</p>
          <h2>Composio control plane</h2>
        </div>
        <span className={statusClass(configStatus)}>{configStatus}</span>
      </div>

      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Project</span>
          <strong>{state.config?.projectId ?? "unconfigured"}</strong>
          <small>{state.config?.baseUrl ?? "https://backend.composio.dev"}</small>
        </div>
        <div className="connectionItem">
          <span>Accounts</span>
          <strong>{state.connectedAccounts.length}</strong>
          <small>{state.connectedAccounts.filter((account) => account.status === "active").length} active</small>
        </div>
        <div className="connectionItem">
          <span>Sessions</span>
          <strong>{state.sessions.length}</strong>
          <small>{state.sessions.filter((session) => session.status === "active").length} reusable</small>
        </div>
        <div className="connectionItem">
          <span>Tool candidates</span>
          <strong>{state.registryCandidates.length}</strong>
          <small>staged for review</small>
        </div>
      </div>

      <div className="connectionList">
        {accounts.map((account) => (
          <div className="connectionRow" key={account.id}>
            <div>
              <strong>{account.toolkitSlug}</strong>
              <span>{account.principalId}</span>
            </div>
            <span className={statusClass(account.status)}>{account.status}</span>
          </div>
        ))}
        {candidates.map((candidate) => (
          <div className="connectionRow" key={candidate.id}>
            <div>
              <strong>{candidate.name}</strong>
              <span>{candidate.slug}</span>
            </div>
            <span className={statusClass(candidate.status)}>{candidate.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function IngestionPanel({ state }: { state: ComposioIngestionState }) {
  const latestRun = state.runs[0];
  const latestArtifacts = state.artifacts.slice(0, 4);
  const latestCheckpoint = state.checkpoints[0];

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Source artifacts</p>
          <h2>Composio ingestion</h2>
        </div>
        <span className={statusClass(latestRun?.status ?? "pending")}>{latestRun?.status ?? "pending"}</span>
      </div>

      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Artifacts</span>
          <strong>{state.artifacts.length}</strong>
          <small>raw and normalized</small>
        </div>
        <div className="connectionItem">
          <span>Checkpoints</span>
          <strong>{state.checkpoints.length}</strong>
          <small>{latestCheckpoint?.id ?? "none"}</small>
        </div>
        <div className="connectionItem">
          <span>Runs</span>
          <strong>{state.runs.length}</strong>
          <small>{latestRun?.message ?? "waiting for connector sync"}</small>
        </div>
        <div className="connectionItem">
          <span>Audit events</span>
          <strong>{state.auditEvents.length}</strong>
          <small>ingest lineage</small>
        </div>
      </div>

      <div className="connectionList">
        {latestArtifacts.map((artifact) => (
          <div className="connectionRow" key={artifact.id}>
            <div>
              <strong>{artifact.source.title}</strong>
              <span>
                {artifact.connector} · {artifact.sourceObjectId} · {artifact.rawObjectKey}
              </span>
              <small>{artifact.normalizedText}</small>
            </div>
            <span className={statusClass(artifact.acl.sensitivity)}>{artifact.acl.sensitivity}</span>
          </div>
        ))}
        {latestArtifacts.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No artifacts synced yet</strong>
              <span>POST /api/v1/ingestion/composio after a Composio action runs.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

async function ConnectorOpsPanel() {
  const health = await connectorOps.health();
  const connectors = health.connectors.slice(0, 5);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Connector health</h2>
        </div>
        <span className="status">{connectors.length} connectors</span>
      </div>
      <div className="connectionList">
        {connectors.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No connector runs yet</strong>
              <span>Health appears after a connected account or ingestion run exists.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {connectors.map((connector) => (
          <div className="connectionRow" key={`${connector.connector}:${connector.connectedAccountId}`}>
            <div>
              <strong>{connector.connector}</strong>
              <span>
                {connector.connectedAccountId} · {connector.latestRun?.status ?? "no runs"} · checkpoint{" "}
                {connector.lastCheckpoint?.cursor ?? "none"}
              </span>
              {connector.recentErrors[0] ? <small>{connector.recentErrors[0].guidance}</small> : null}
            </div>
            <span className={statusClass(connector.accountStatus)}>{connector.accountStatus}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function ArtifactProcessingPanel() {
  const state = await artifactProcessingPipeline.getState();
  const records = state.records.slice(0, 5);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Memory compiler</p>
          <h2>Artifact processing</h2>
        </div>
        <span className="status">{state.chunks.length} chunks</span>
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Records</span>
          <strong>{state.records.length}</strong>
          <small>parse to index</small>
        </div>
        <div className="connectionItem">
          <span>Full text</span>
          <strong>{state.fullTextIndex.length}</strong>
          <small>indexed chunks</small>
        </div>
        <div className="connectionItem">
          <span>Vectors</span>
          <strong>{state.vectorIndex.length}</strong>
          <small>embedded chunks</small>
        </div>
        <div className="connectionItem">
          <span>Failures</span>
          <strong>{state.records.filter((record) => record.status === "failed").length}</strong>
          <small>retryable</small>
        </div>
      </div>
      <div className="connectionList">
        {records.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No artifacts processed yet</strong>
              <span>POST /api/v1/artifact-processing/process with an artifact id.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {records.map((record) => (
          <div className="connectionRow" key={record.artifactId}>
            <div>
              <strong>{record.artifactId}</strong>
              <span>
                {record.stage} · {record.chunkCount} chunks · v{record.version}
              </span>
              {record.failureReason ? <small>{record.failureReason}</small> : null}
            </div>
            <span className={statusClass(record.status)}>{record.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function CandidateExtractionPanel() {
  const state = await candidateExtractionWorker.getState();
  const latestRun = state.runs[0];
  const candidates = state.candidates.slice(0, 5);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Candidate memory</p>
          <h2>Atom extraction</h2>
        </div>
        <span className={statusClass(latestRun?.status ?? "pending")}>{latestRun?.status ?? "pending"}</span>
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Runs</span>
          <strong>{state.runs.length}</strong>
          <small>extract workers</small>
        </div>
        <div className="connectionItem">
          <span>Candidates</span>
          <strong>{state.candidates.length}</strong>
          <small>opened as PRs</small>
        </div>
        <div className="connectionItem">
          <span>Latest output</span>
          <strong>{latestRun?.candidateCount ?? 0}</strong>
          <small>{latestRun?.skippedChunkCount ?? 0} skipped chunks</small>
        </div>
        <div className="connectionItem">
          <span>Failures</span>
          <strong>{state.runs.filter((run) => run.status === "failed").length}</strong>
          <small>retry after review</small>
        </div>
      </div>
      <div className="connectionList">
        {candidates.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No candidate atoms extracted yet</strong>
              <span>POST /api/v1/candidate-extraction/run after artifacts are indexed.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {candidates.map((candidate) => (
          <div className="connectionRow" key={candidate.id}>
            <div>
              <strong>{candidate.atom.title}</strong>
              <span>
                {candidate.atom.atomType} · {candidate.targetTier} · owner {candidate.ownerId} · PR{" "}
                {candidate.changeset.id}
              </span>
              <small>{candidate.sourceEvidence.excerpt}</small>
            </div>
            <span className={statusClass(candidate.changeset.status)}>{candidate.changeset.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function MemoryConflictPanel() {
  const state = await memoryConflictWorkflow.getState();
  const openConflicts = state.conflicts.filter((conflict) => conflict.status === "review");
  const conflicts = state.conflicts.slice(0, 5);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Review intelligence</p>
          <h2>Memory conflicts</h2>
        </div>
        <span className={statusClass(openConflicts.length > 0 ? "warning" : "passed")}>{openConflicts.length} open</span>
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Conflicts</span>
          <strong>{state.conflicts.length}</strong>
          <small>duplicates and contradictions</small>
        </div>
        <div className="connectionItem">
          <span>Audit events</span>
          <strong>{state.auditEvents.length}</strong>
          <small>review decisions</small>
        </div>
        <div className="connectionItem">
          <span>Lineage</span>
          <strong>{state.lineageEvents.length}</strong>
          <small>resolution edges</small>
        </div>
        <div className="connectionItem">
          <span>Resolved</span>
          <strong>{state.conflicts.filter((conflict) => conflict.status !== "review").length}</strong>
          <small>curated outcomes</small>
        </div>
      </div>
      <div className="connectionList">
        {conflicts.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No conflicts detected yet</strong>
              <span>POST /api/v1/memory-conflicts/detect after candidate extraction.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {conflicts.map((conflict) => (
          <div className="connectionRow" key={conflict.id}>
            <div>
              <strong>{conflict.compared.candidate.title}</strong>
              <span>
                {conflict.conflictType} · {conflict.recommendedResolution} · {conflict.compared.existing.tier}
              </span>
              <small>
                Compared with {conflict.compared.existing.title} · freshness{" "}
                {Math.round(conflict.compared.existing.freshness * 100)}%
              </small>
            </div>
            <span className={statusClass(conflict.status)}>{conflict.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function MemoryQualityPanel() {
  const state = await memoryQualityLoop.getState();
  const openItems = state.queue.filter((item) => item.status === "open");
  const queue = state.queue.slice(0, 5);
  const average =
    state.scores.length === 0 ? 0 : Math.round(state.scores.reduce((sum, score) => sum + score.score, 0) / state.scores.length);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Memory health</p>
          <h2>Quality loop</h2>
        </div>
        <span className={statusClass(openItems.length > 0 ? "warning" : "passed")}>{openItems.length} reviews</span>
      </div>
      <div className="connectionGrid">
        <div className="connectionItem">
          <span>Average</span>
          <strong>{average}%</strong>
          <small>scored atoms</small>
        </div>
        <div className="connectionItem">
          <span>Scores</span>
          <strong>{state.scores.length}</strong>
          <small>signal-backed</small>
        </div>
        <div className="connectionItem">
          <span>Queue</span>
          <strong>{state.queue.length}</strong>
          <small>refresh/demote/retire</small>
        </div>
        <div className="connectionItem">
          <span>Audit</span>
          <strong>{state.auditEvents.length}</strong>
          <small>review actions</small>
        </div>
      </div>
      <div className="connectionList">
        {queue.length === 0 ? (
          <div className="connectionRow">
            <div>
              <strong>No quality reviews queued yet</strong>
              <span>POST /api/v1/memory-quality/run to score current atoms.</span>
            </div>
            <span className="status">empty</span>
          </div>
        ) : null}
        {queue.map((item) => (
          <div className="connectionRow" key={item.id}>
            <div>
              <strong>{item.atomId}</strong>
              <span>
                {item.recommendedAction} · score {item.score}% · {item.reasons[0] ?? "Needs reviewer decision"}
              </span>
            </div>
            <span className={statusClass(item.status)}>{item.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AuditPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <section className="panel auditPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Lineage</p>
          <h2>Audit trail</h2>
        </div>
        <Archive size={20} />
      </div>
      <div className="auditList">
        {snapshot.events.map((event) => (
          <div className="auditRow" key={event.id}>
            <span>{event.createdAt.slice(11, 16)}</span>
            <strong>{event.action}</strong>
            <p>{event.targetId}</p>
            <span className={statusClass(event.policyDecision)}>{event.policyDecision}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ArchitectureMap() {
  const columns = [
    ["Slack", "Email", "Docs", "Meetings", "Tickets", "CRM", "Code"],
    ["Capture", "Extract", "Candidate atoms", "Knowledge PRs", "Reviewed merge"],
    ["Individual", "Team", "Department", "Company main", "Protected"],
    ["Tools", "Skills", "Plugins", "Cron jobs", "Policies"],
    ["Codex", "Claude Code", "OpenCode", "MCP agents"]
  ];

  return (
    <section className="architectureMap" aria-label="Architecture map">
      {columns.map((column, columnIndex) => (
        <div className="archColumn" key={column.join("-")}>
          {column.map((item, itemIndex) => (
            <div className={`archNode archNode${columnIndex}`} key={item}>
              {itemIndex === 0 ? <span className="archDot" /> : null}
              {item}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function SetupView() {
  return (
    <main className="setupShell">
      <section className="setupPanel">
        <div className="setupIntro">
          <div className="brandMark">
            <Brain size={22} />
          </div>
          <p className="eyebrow">First run setup</p>
          <h1>Bootstrap Company Brain</h1>
        </div>

        <form className="setupForm" action={bootstrapTenantFromForm}>
          <label>
            <span>Tenant name</span>
            <input name="tenantName" required placeholder="Acme AI" />
          </label>
          <label>
            <span>Admin name</span>
            <input name="adminName" required placeholder="Admin User" />
          </label>
          <label>
            <span>Admin email</span>
            <input name="adminEmail" type="email" required placeholder="admin@example.com" />
          </label>
          <label>
            <span>Tenant encryption key</span>
            <input name="encryptionKey" type="password" required placeholder="Configured secret" />
          </label>
          <label>
            <span>Composio project id</span>
            <input name="composioProjectId" required placeholder="composio-project" />
          </label>
          <label className="setupCheck">
            <input name="composioApiKeyConfigured" type="checkbox" />
            <span>Composio API key is configured</span>
          </label>
          <button type="submit">Create tenant</button>
        </form>
      </section>
    </main>
  );
}

export default async function Home() {
  const setup = getSetupState();
  if (!setup.isComplete) {
    return <SetupView />;
  }

  const [snapshot, composio, ingestion] = await Promise.all([
    repository.dashboard(),
    composioControlPlane.getState(),
    composioIngestionPipeline.getState()
  ]);
  const tenantId = process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";
  const quality = summarizeQuality(snapshot.qualityScores);
  const openChangesets = snapshot.changesets.filter((changeset) => !["merged", "rolled-back"].includes(changeset.status));
  const publishedCapabilities = snapshot.registry.filter((item) => item.status === "published").length;

  return (
    <main className="appShell">
      <aside className="sideNav">
        <div className="brand">
          <div className="brandMark">
            <Brain size={22} />
          </div>
          <div>
            <strong>Company Brain</strong>
            <span>agent-native OS</span>
          </div>
        </div>
        <nav>
          <a href="#overview">
            <Activity size={16} />
            Overview
          </a>
          <a href="#tiers">
            <Layers3 size={16} />
            Tiers
          </a>
          <a href="#registry">
            <Plug size={16} />
            Registry
          </a>
          <a href="#connections">
            <Plug size={16} />
            Connections
          </a>
          <a href="#scheduler">
            <CalendarClock size={16} />
            Scheduler
          </a>
          <a href="#audit">
            <ShieldCheck size={16} />
            Audit
          </a>
        </nav>
        <div className="sideFooter">
          <LockKeyhole size={16} />
          <span>ACLs active · {setup.tenant?.name}</span>
        </div>
      </aside>

      <section className="mainContent">
        <header className="topBar">
          <div>
            <p className="eyebrow">Self-hosted control plane</p>
            <h1>Govern memory, capabilities, and scheduled agents from one review system.</h1>
          </div>
          <div className="searchBox">
            <Search size={16} />
            <span>brain.query · registry.search · audit.trace</span>
          </div>
        </header>

        <section className="heroConsole" id="overview">
          <div className="heroCopy">
            <span className="status statusGood">
              <Sparkles size={13} />
              MCP-ready
            </span>
            <h2>One substrate, two promotion rails.</h2>
            <p>
              Knowledge atoms and executable capabilities move through the same governed pipeline:
              draft, checks, review, publish, monitor, rollback. Agents get only what policy allows.
            </p>
          </div>
          <ArchitectureMap />
        </section>

        <BrainWorkbench tenantId={tenantId} principalId={snapshot.principal.id} />

        <section className="metricsGrid">
          <MetricCard
            icon={BadgeCheck}
            label="Brain quality"
            value={`${quality.average}%`}
            detail={`${quality.riskCount} items need curation`}
          />
          <MetricCard
            icon={GitPullRequest}
            label="Open reviews"
            value={String(openChangesets.length)}
            detail="knowledge and registry PRs"
          />
          <MetricCard
            icon={Plug}
            label="Published capabilities"
            value={String(publishedCapabilities)}
            detail="skills, tools, policies, cron"
          />
          <MetricCard
            icon={BellRing}
            label="Cron runs"
            value={String(snapshot.cronRuns.length)}
            detail="audited scheduled workflows"
          />
        </section>

        <section className="layoutGrid" id="tiers">
          <TierRail snapshot={snapshot} />
          <ChangesetQueue changesets={snapshot.changesets} />
        </section>

        <section id="registry">
          <RegistryMatrix items={snapshot.registry} />
        </section>

        <RegistryImportPanel />

        <RegistryPublicationPanel />

        <ToolInvocationPanel />

        <section className="layoutGrid" id="connections">
          <ComposioPanel state={composio} />
          <IngestionPanel state={ingestion} />
        </section>

        <ConnectorOpsPanel />

        <ArtifactProcessingPanel />

        <CandidateExtractionPanel />

        <MemoryConflictPanel />

        <MemoryQualityPanel />

        <SlackConnectorConsole
          tenantId={tenantId}
          principalId={snapshot.principal.id}
          accounts={composio.connectedAccounts}
          artifacts={ingestion.artifacts.filter((artifact) => artifact.connector === "slack")}
        />

        <GoogleConnectorConsole
          principalId={snapshot.principal.id}
          accounts={composio.connectedAccounts}
          artifacts={ingestion.artifacts.filter((artifact) => artifact.connector === "google-drive" || artifact.connector === "gmail")}
        />

        <WorkConnectorConsole
          principalId={snapshot.principal.id}
          accounts={composio.connectedAccounts}
          artifacts={ingestion.artifacts.filter((artifact) => artifact.connector === "github" || artifact.connector === "linear")}
        />

        <FlexibleConnectorConsole
          principalId={snapshot.principal.id}
          accounts={composio.connectedAccounts}
          artifacts={ingestion.artifacts.filter((artifact) => artifact.connector === "notion" || artifact.connector === "webhook")}
        />

        <section className="layoutGrid" id="scheduler">
          <CronConsole runs={snapshot.cronRuns} items={snapshot.registry} />
          <CompatibilityPanel items={snapshot.registry} />
        </section>

        <PackageDistributionPanel principal={snapshot.principal} />

        <section id="audit">
          <AuditPanel snapshot={snapshot} />
        </section>

        <footer className="footerBar">
          <Waypoints size={16} />
          <span>
            API: <code>/api/v1/brain/query</code> · MCP: <code>/api/mcp</code> · Docs:{" "}
            <code>docs/implementation-design.md</code>
          </span>
        </footer>
      </section>
    </main>
  );
}
