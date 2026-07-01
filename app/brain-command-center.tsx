"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  Archive,
  BadgeCheck,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Command,
  GitPullRequest,
  KeyRound,
  Layers3,
  Library,
  LockKeyhole,
  MessageSquareText,
  Plug,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ConnectorPreflight, OrgUnit, SetupState } from "@/lib/setup";
import type { BrainTier, DashboardSnapshot, RegistryItem } from "@/lib/types";

type CommandMessage = {
  id: string;
  role: "assistant" | "user";
  body: string;
};

type Props = {
  setup: SetupState;
  snapshot: DashboardSnapshot;
  connectorCounts: {
    accounts: number;
    artifacts: number;
  };
};

const tierLabels: Record<BrainTier, string> = {
  individual: "My brain",
  team: "Team brain",
  department: "Department brain",
  "company-main": "Company brain",
  "exec-protected": "Exec protected",
  regulated: "Regulated"
};

const railLinks: Array<{ label: string; detail: string; Icon: LucideIcon }> = [
  { label: "My brain", detail: "Private memory and tasks", Icon: Brain },
  { label: "My team", detail: "Team sources and rituals", Icon: Users },
  { label: "My access", detail: "Tiers, roles, approvals", Icon: KeyRound },
  { label: "Registries", detail: "Tools, skills, policies", Icon: Library }
];

const loopSteps: Array<{ label: string; Icon: LucideIcon }> = [
  { label: "Ask", Icon: MessageSquareText },
  { label: "Propose", Icon: Workflow },
  { label: "Approve", Icon: BadgeCheck },
  { label: "Audit", Icon: Archive }
];

function statusClass(status: string) {
  if (["published", "approved", "passed", "valid", "succeeded", "merged", "active", "configured", "completed", "ready"].includes(status)) {
    return "pill pillGood";
  }
  if (["review", "warning", "needs-scope", "pending", "queued", "running", "needs-approval"].includes(status)) {
    return "pill pillWarn";
  }
  if (["blocked", "failed", "rejected", "revoked", "invalid", "denied"].includes(status)) {
    return "pill pillBad";
  }
  return "pill";
}

function allowedTiersForScope(scope: OrgUnit | null) {
  if (!scope || scope.kind === "company") return null;
  if (scope.kind === "department") return new Set<BrainTier>(["department", "team"]);
  if (scope.kind === "team") return new Set<BrainTier>(["team"]);
  if (scope.kind === "exec-protected") return new Set<BrainTier>(["exec-protected"]);
  if (scope.kind === "regulated") return new Set<BrainTier>(["regulated"]);
  return null;
}

function filterRegistry(items: RegistryItem[], scope: OrgUnit | null) {
  const allowed = allowedTiersForScope(scope);
  return allowed ? items.filter((item) => allowed.has(item.tier)) : items;
}

function connectorStatus(preflight: ConnectorPreflight) {
  if (preflight.status === "ready") return "Ready for sample sync";
  if (preflight.status === "needs-scope") return "Needs scope fix";
  if (preflight.status === "blocked") return "Blocked";
  return "Not configured";
}

export function BrainCommandCenter({ setup, snapshot, connectorCounts }: Props) {
  const scopes = setup.orgUnits.filter((unit) => ["company", "department", "team", "exec-protected", "regulated"].includes(unit.kind));
  const [activeScopeId, setActiveScopeId] = useState(scopes[0]?.id ?? "");
  const [composer, setComposer] = useState("Show me what to build next, where access is risky, and which operator should run first.");
  const [messages, setMessages] = useState<CommandMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      body: "This is the command thread for the company brain. Ask in markdown; every answer should become either context, a recommendation, or a reviewable changeset."
    }
  ]);

  const activeScope = scopes.find((scope) => scope.id === activeScopeId) ?? scopes[0] ?? null;
  const allowedTiers = allowedTiersForScope(activeScope);
  const visibleAtoms = allowedTiers ? snapshot.atoms.filter((atom) => allowedTiers.has(atom.tier)) : snapshot.atoms;
  const visibleRegistry = useMemo(() => filterRegistry(snapshot.registry, activeScope), [activeScope, snapshot.registry]);
  const visibleChangesets = allowedTiers ? snapshot.changesets.filter((changeset) => allowedTiers.has(changeset.tier)) : snapshot.changesets;
  const skills = visibleRegistry.filter((item) => item.kind === "skill");
  const tools = visibleRegistry.filter((item) => item.kind === "tool");
  const operators = skills.filter((item) => item.slug.includes("builder") || item.slug.includes("starter") || item.slug.includes("operator") || item.slug.includes("finder"));
  const blockedTasks = setup.setupTasks.filter((task) => task.status === "blocked");
  const setupDone = setup.setupTasks.filter((task) => task.status === "completed").length;

  function sendCommand(nextBody = composer) {
    if (!nextBody.trim()) return;
    const body = nextBody.trim();
    const nextMessageCount = messages.length;
    setMessages((current) => [
      ...current,
      { id: `user-${nextMessageCount}`, role: "user", body },
      {
        id: `assistant-${nextMessageCount}`,
        role: "assistant",
        body: `For ${activeScope?.name ?? "Company"}, I would open a proposal instead of changing production directly. Visible context: ${visibleAtoms.length} atoms, ${skills.length} skills, ${tools.length} tools, ${visibleChangesets.length} review items.`
      }
    ]);
    setComposer("");
  }

  const commandChips = [
    "Map my company and owners",
    "Show access risks by brain tier",
    "Find automations safe to propose",
    "Design the first team brain",
    "Summarize stale memory"
  ];

  return (
    <div className="brainAppFrame">
      <aside className="brainRail" aria-label="Brain scopes">
        <div className="railBrand">
          <div className="brandGlyph">
            <Brain size={19} />
          </div>
          <div>
            <strong>Company Brain</strong>
            <span>{setup.tenant?.name ?? "Workspace"}</span>
          </div>
        </div>

        <div className="railSection">
          <p>Scopes</p>
          {scopes.map((scope) => (
            <button className={activeScope?.id === scope.id ? "railScope railScopeActive" : "railScope"} key={scope.id} type="button" onClick={() => setActiveScopeId(scope.id)}>
              {scope.kind === "team" ? <Users size={16} /> : scope.kind === "company" ? <Brain size={16} /> : <Layers3 size={16} />}
              <span>
                <strong>{scope.kind === "company" ? "Company" : scope.name}</strong>
                <small>{tierLabels[scope.tier]}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="railSection">
          <p>Control</p>
          {railLinks.map(({ label, detail, Icon }) => (
            <a className="railLink" href={`#${label.toLowerCase().replace(/\s+/g, "-")}`} key={label}>
              <Icon size={16} />
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
            </a>
          ))}
        </div>
      </aside>

      <main className="brainWorkspace">
        <header className="brainTopbar">
          <div>
            <p className="eyebrow">Command center</p>
            <h1>{activeScope?.name ?? "Company"} brain</h1>
          </div>
          <div className="topbarStats">
            <span><CircleDot size={13} /> {visibleAtoms.length} atoms</span>
            <span><Plug size={13} /> {connectorCounts.accounts} accounts</span>
            <span><GitPullRequest size={13} /> {visibleChangesets.length} reviews</span>
          </div>
        </header>

        <section className="brainCommandGrid">
          <div className="operatorConsole">
            <div className="consoleHeader">
              <div>
                <p className="eyebrow">Ask, plan, approve</p>
                <h2>The brain is operated through chat</h2>
              </div>
              <span className={statusClass(blockedTasks.length ? "blocked" : "ready")}>{blockedTasks.length ? `${blockedTasks.length} blocked` : "Ready"}</span>
            </div>

            <div className="commandChips">
              {commandChips.map((chip) => (
                <button key={chip} type="button" onClick={() => sendCommand(chip)}>
                  <Sparkles size={14} />
                  {chip}
                </button>
              ))}
            </div>

            <div className="commandThread">
              {messages.map((message) => (
                <article className={message.role === "assistant" ? "threadMessage assistantThreadMessage" : "threadMessage userThreadMessage"} key={message.id}>
                  <div className="threadIcon">{message.role === "assistant" ? <Bot size={15} /> : <Command size={15} />}</div>
                  <p>{message.body}</p>
                </article>
              ))}
            </div>

            <div className="commandComposer">
              <div className="markdownToolbar compactToolbar">
                {["##", "- item", "[ ]", "**owner**"].map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setComposer((current) => `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${label === "##" ? "## " : label === "- item" ? "- " : label === "[ ]" ? "- [ ] " : "**Owner:** "}`)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea value={composer} wrap="soft" onChange={(event) => setComposer(event.target.value)} placeholder="Ask or draft in markdown. Example: ## Launch review&#10;- [ ] confirm owners&#10;- [ ] approve first sync" />
              <button type="button" onClick={() => sendCommand()}>
                <Send size={16} />
                Send
              </button>
            </div>
          </div>

          <aside className="missionChecklist" aria-label="Setup checklist">
            <div className="checklistHeader">
              <p className="eyebrow">Setup checklist</p>
              <strong>{setupDone}/{setup.setupTasks.length} complete</strong>
            </div>
            <div className="todoStack">
              {setup.setupTasks.map((task) => (
                <div className={task.status === "completed" ? "todoItem todoDone" : "todoItem"} key={task.id}>
                  <span>{task.status === "completed" ? <CheckCircle2 size={14} /> : <Activity size={14} />}</span>
                  <strong>{task.label}</strong>
                  <small>{task.nextAction}</small>
                </div>
              ))}
            </div>

            <div className="connectorStack">
              <p className="eyebrow">Connections</p>
              {setup.connectorPreflights.map((preflight) => (
                <div className="connectorLine" key={preflight.connector}>
                  <span>
                    <Plug size={14} />
                    {preflight.connector}
                  </span>
                  <strong>{connectorStatus(preflight)}</strong>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="brainLensGrid" id="my-brain">
          <article className="lensCard">
            <div className="lensIcon"><Brain size={18} /></div>
            <p className="eyebrow">My brain</p>
            <h2>{visibleAtoms.filter((atom) => atom.tier === "individual").length} private atoms</h2>
            <span>Personal context stays separate from team memory unless promoted through review.</span>
          </article>
          <article className="lensCard" id="my-team">
            <div className="lensIcon"><Users size={18} /></div>
            <p className="eyebrow">My team</p>
            <h2>{visibleAtoms.filter((atom) => atom.tier === "team").length} team atoms</h2>
            <span>Team rituals, decisions, owners, and tool sources visible in this scope.</span>
          </article>
          <article className="lensCard" id="my-access">
            <div className="lensIcon"><ShieldCheck size={18} /></div>
            <p className="eyebrow">My access</p>
            <h2>{setup.brainLevelConfigs.filter((config) => config.enabled).length} enabled tiers</h2>
            <span>Access is constrained by tier, role, team membership, and reviewer ownership.</span>
          </article>
        </section>

        <section className="accessAndRegistryGrid">
          <article className="accessMap">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Access map</p>
                <h2>Brain tiers and approval posture</h2>
              </div>
              <LockKeyhole size={18} />
            </div>
            <div className="tierRows">
              {setup.brainLevelConfigs.map((config) => (
                <div className="tierAccessRow" key={config.tier}>
                  <span>{tierLabels[config.tier]}</span>
                  <strong>{config.enabled ? "Enabled" : "Off"}</strong>
                  <small>{config.ownerId ? "Owner set" : "Needs owner"} · {config.reviewerIds.length} reviewer(s)</small>
                  <em>{config.defaultSensitivity}</em>
                </div>
              ))}
            </div>
          </article>

          <article className="registryDesk" id="registries">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Registries</p>
                <h2>Tools, skills, operators</h2>
              </div>
              <Library size={18} />
            </div>
            <div className="registryColumns">
              <div>
                <h3>AI operators</h3>
                {operators.slice(0, 6).map((item) => (
                  <div className="registryLine" key={item.id}>
                    <span>{item.name}</span>
                    <strong className={statusClass(item.status)}>{item.status}</strong>
                  </div>
                ))}
              </div>
              <div>
                <h3>Tools</h3>
                {tools.slice(0, 6).map((item) => (
                  <div className="registryLine" key={item.id}>
                    <span>{item.name}</span>
                    <strong className={statusClass(item.status)}>{item.status}</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </section>

        <section className="automationStrip">
          <div>
            <p className="eyebrow">Operations loop</p>
            <h2>Every action moves through proposal, review, publish, monitor.</h2>
          </div>
          {loopSteps.map(({ label, Icon }) => (
            <div className="loopStep" key={label}>
              <Icon size={17} />
              <span>{label}</span>
              <ChevronRight size={14} />
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
