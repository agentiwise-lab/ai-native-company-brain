"use client";

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, Check, Database, KeyRound, Layers3, ListChecks, LockKeyhole, MessageSquareText, Plug, Sparkles, UserRoundCog } from "lucide-react";
import type { BrainTier } from "@/lib/types";
import type { OnboardingMode } from "@/lib/setup";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  body: string;
};

const defaultConnectors = ["slack", "google-drive", "gmail", "notion", "github", "linear"];
const connectorOptions = [
  ["slack", "Slack"],
  ["google-drive", "Drive"],
  ["gmail", "Gmail"],
  ["notion", "Notion"],
  ["github", "GitHub"],
  ["linear", "Linear"],
  ["crm", "CRM"],
  ["meetings", "Meetings"]
] as const;

const tierOptions: Array<{ tier: BrainTier; label: string; detail: string; defaultEnabled: boolean }> = [
  { tier: "individual", label: "My brain", detail: "Private working memory.", defaultEnabled: true },
  { tier: "team", label: "Team", detail: "Shared team context.", defaultEnabled: true },
  { tier: "department", label: "Department", detail: "Function-level playbooks.", defaultEnabled: true },
  { tier: "company-main", label: "Company", detail: "Approved org-wide memory.", defaultEnabled: true },
  { tier: "exec-protected", label: "Exec protected", detail: "Sensitive leadership context.", defaultEnabled: false },
  { tier: "regulated", label: "Regulated", detail: "Restricted data domains.", defaultEnabled: false }
];

const starterPrompt = `## Company context
We are building an AI-native operating system for our company.

Departments: Product, Engineering, Revenue, Operations
Teams: Platform, Customer Experience, Growth
People: Harshit - admin and reviewer

Goals:
- Build a source-backed company brain
- Make team knowledge usable by approved agents
- Find safe automation opportunities

Challenges:
- Knowledge is scattered across tools
- Access rules need to stay obvious
- Sensitive planning should not leak into team memory

Sensitive areas: exec planning, customer secrets, regulated data`;

function parseList(value: string) {
  return value
    .split(/[,;\n]+/)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function parseContext(markdown: string) {
  const buckets: Record<"departments" | "teams" | "people" | "goals" | "challenges" | "sensitiveAreas", string[]> = {
    departments: [],
    teams: [],
    people: [],
    goals: [],
    challenges: [],
    sensitiveAreas: []
  };
  const keyMap: Record<string, keyof typeof buckets> = {
    department: "departments",
    departments: "departments",
    team: "teams",
    teams: "teams",
    people: "people",
    person: "people",
    goals: "goals",
    goal: "goals",
    challenges: "challenges",
    challenge: "challenges",
    sensitive: "sensitiveAreas",
    "sensitive areas": "sensitiveAreas"
  };

  let activeKey: keyof typeof buckets | null = null;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    const headingMatch = line.match(/^(departments?|teams?|people|person|goals?|challenges?|sensitive(?: areas)?):\s*(.*)$/i);
    if (headingMatch) {
      activeKey = keyMap[headingMatch[1].toLowerCase()];
      buckets[activeKey].push(...parseList(headingMatch[2]));
      continue;
    }
    if (activeKey && /^[-*]\s+/.test(line)) {
      buckets[activeKey].push(line.replace(/^[-*]\s+/, "").trim());
    }
  }

  return {
    departments: buckets.departments.length ? buckets.departments : ["Product", "Engineering", "Revenue", "Operations"],
    teams: buckets.teams.length ? buckets.teams : ["Platform", "Customer Experience", "Growth"],
    people: buckets.people.length ? buckets.people : ["Admin - owner and reviewer"],
    goals: buckets.goals.length ? buckets.goals : ["Build a source-backed company brain"],
    challenges: buckets.challenges.length ? buckets.challenges : ["Keep access and automation safe"],
    sensitiveAreas: buckets.sensitiveAreas.length ? buckets.sensitiveAreas : ["exec planning", "customer secrets", "regulated data"]
  };
}

function insertSnippet(textarea: HTMLTextAreaElement | null, snippet: string, setComposer: (next: string) => void) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const nextValue = `${textarea.value.slice(0, start)}${snippet}${textarea.value.slice(end)}`;
  setComposer(nextValue);
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.selectionStart = start + snippet.length;
    textarea.selectionEnd = start + snippet.length;
  });
}

export function OnboardingChatSetup() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<OnboardingMode>("supabase-local");
  const [connectors, setConnectors] = useState(() => new Set(defaultConnectors));
  const [tiers, setTiers] = useState(() => new Set(tierOptions.filter((option) => option.defaultEnabled).map((option) => option.tier)));
  const [tenantName, setTenantName] = useState("AI Native Company");
  const [adminName, setAdminName] = useState("Admin User");
  const [adminEmail, setAdminEmail] = useState("admin@example.com");
  const [encryptionKey, setEncryptionKey] = useState("local-dev-key");
  const [composioProjectId, setComposioProjectId] = useState("composio-project");
  const [composioReady, setComposioReady] = useState(true);
  const [approveSetupPlan, setApproveSetupPlan] = useState(true);
  const [supabaseProjectRef, setSupabaseProjectRef] = useState("");
  const [supabaseProjectUrl, setSupabaseProjectUrl] = useState("");
  const [composer, setComposer] = useState(starterPrompt);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-start",
      role: "assistant",
      body: "Describe the company in markdown. I will turn it into departments, teams, goals, sensitive areas, connector scope, and a setup checklist."
    }
  ]);

  const transcript = useMemo(() => [...messages.filter((message) => message.role === "user").map((message) => message.body), composer].join("\n\n"), [composer, messages]);
  const context = useMemo(() => parseContext(transcript), [transcript]);
  const checklist = [
    { label: "Operating mode", done: Boolean(mode) },
    { label: "Company context", done: transcript.trim().length > 120 },
    { label: "Brain levels", done: tiers.size >= 4 },
    { label: "Tool connections", done: connectors.size > 0 },
    { label: "Owner and reviewer", done: Boolean(adminName && adminEmail) },
    { label: "Approval gate", done: approveSetupPlan }
  ];

  function toggleConnector(id: string) {
    setConnectors((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTier(tier: BrainTier) {
    setTiers((current) => {
      const next = new Set(current);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  }

  function addChatMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!composer.trim()) return;
    const body = composer.trim();
    setMessages((current) => [
      ...current,
      { id: `user-${current.length}`, role: "user", body },
      {
        id: `assistant-${current.length}`,
        role: "assistant",
        body: `Captured ${context.departments.length} departments, ${context.teams.length} teams, ${context.goals.length} goals, and ${context.sensitiveAreas.length} sensitive areas. Review the checklist and launch when it matches reality.`
      }
    ]);
    setComposer("");
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      addChatMessage(event);
    }
  }

  return (
    <>
      <input name="tenantName" type="hidden" value={tenantName} />
      <input name="adminName" type="hidden" value={adminName} />
      <input name="adminEmail" type="hidden" value={adminEmail} />
      <input name="encryptionKey" type="hidden" value={encryptionKey} />
      <input name="composioProjectId" type="hidden" value={composioProjectId} />
      <input name="mode" type="hidden" value={mode} />
      <input name="companyDescription" type="hidden" value={transcript} />
      <input name="departments" type="hidden" value={context.departments.join("\n")} />
      <input name="teams" type="hidden" value={context.teams.join("\n")} />
      <input name="people" type="hidden" value={context.people.join("\n")} />
      <input name="goals" type="hidden" value={context.goals.join("\n")} />
      <input name="challenges" type="hidden" value={context.challenges.join("\n")} />
      <input name="sensitiveAreas" type="hidden" value={context.sensitiveAreas.join("\n")} />
      <input name="supabaseProjectRef" type="hidden" value={supabaseProjectRef} />
      <input name="supabaseProjectUrl" type="hidden" value={supabaseProjectUrl} />
      {composioReady ? <input name="composioApiKeyConfigured" type="hidden" value="on" /> : null}
      {approveSetupPlan ? <input name="approveSetupPlan" type="hidden" value="on" /> : null}
      {[...connectors].map((connector) => (
        <input key={connector} name="selectedConnectors" type="hidden" value={connector} />
      ))}
      {[...tiers].map((tier) => (
        <input key={tier} name="selectedBrainTiers" type="hidden" value={tier} />
      ))}

      <div className="setupChatShell">
        <aside className="setupChecklistPanel" aria-label="Onboarding checklist">
          <div className="setupBrandBlock">
            <div className="brandGlyph">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="eyebrow">Company brain setup</p>
              <h1>Start with chat.</h1>
            </div>
          </div>

          <div className="modeGrid" aria-label="Setup mode">
            {[
              { id: "supabase-local", label: "Local", detail: "Dev-ready Supabase." },
              { id: "supabase-cloud", label: "Cloud", detail: "Existing project." },
              { id: "demo", label: "Demo", detail: "Seeded cockpit." }
            ].map((option) => (
              <button className={mode === option.id ? "modeCard modeCardActive" : "modeCard"} key={option.id} type="button" onClick={() => setMode(option.id as OnboardingMode)}>
                <Database size={15} />
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>

          {mode === "supabase-cloud" ? (
            <div className="compactSettings">
              <label>
                <span>Project ref</span>
                <input value={supabaseProjectRef} onChange={(event) => setSupabaseProjectRef(event.target.value)} placeholder="abcd1234" />
              </label>
              <label>
                <span>Project URL</span>
                <input value={supabaseProjectUrl} onChange={(event) => setSupabaseProjectUrl(event.target.value)} placeholder="https://project.supabase.co" />
              </label>
            </div>
          ) : null}

          <div className="todoStack">
            {checklist.map((item) => (
              <div className={item.done ? "todoItem todoDone" : "todoItem"} key={item.label}>
                <span>{item.done ? <Check size={14} /> : <ListChecks size={14} />}</span>
                <strong>{item.label}</strong>
              </div>
            ))}
          </div>

          <div className="compactSettings">
            <label>
              <span>Company</span>
              <input value={tenantName} onChange={(event) => setTenantName(event.target.value)} />
            </label>
            <label>
              <span>Admin</span>
              <input value={adminName} onChange={(event) => setAdminName(event.target.value)} />
            </label>
            <label>
              <span>Email</span>
              <input value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} />
            </label>
            <label>
              <span>Encryption key</span>
              <input value={encryptionKey} onChange={(event) => setEncryptionKey(event.target.value)} type="password" />
            </label>
            <label>
              <span>Composio project</span>
              <input value={composioProjectId} onChange={(event) => setComposioProjectId(event.target.value)} />
            </label>
          </div>
        </aside>

        <main className="setupConversationPanel">
          <div className="chatSurface">
            <div className="chatHeader">
              <div>
                <p className="eyebrow">Markdown command thread</p>
                <h2>Tell the brain how the company works</h2>
              </div>
              <span className="keyboardHint">⌘ Enter adds to setup</span>
            </div>
            <div className="messageStack">
              {messages.map((message) => (
                <article className={message.role === "assistant" ? "chatBubble assistantBubble" : "chatBubble userBubble"} key={message.id}>
                  <div className="bubbleIcon">{message.role === "assistant" ? <Bot size={15} /> : <UserRoundCog size={15} />}</div>
                  <p>{message.body}</p>
                </article>
              ))}
            </div>
            <div className="markdownToolbar" aria-label="Markdown shortcuts">
              {[
                ["##", "## Section\n"],
                ["- item", "- "],
                ["[ ]", "- [ ] "],
                ["owner", "**Owner:** "],
                ["risk", "**Risk:** "]
              ].map(([label, snippet]) => (
                <button key={label} type="button" onClick={() => insertSnippet(textareaRef.current, snippet, setComposer)}>
                  {label}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              className="markdownComposer"
              value={composer}
              wrap="soft"
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Write in markdown: departments, teams, goals, challenges, sensitive areas, tool notes..."
            />
            <div className="composerActions">
              <button className="ghostButton" type="button" onClick={addChatMessage}>
                <MessageSquareText size={16} />
                Add to setup
              </button>
              <button className="primaryButton" type="submit">
                Activate brain plan
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          <aside className="setupExtractPanel" aria-label="Setup preview">
            <section>
              <p className="eyebrow">Extracted structure</p>
              <div className="chipCloud">
                {context.departments.map((department) => (
                  <span key={department}>{department}</span>
                ))}
                {context.teams.map((team) => (
                  <span key={team}>{team}</span>
                ))}
              </div>
            </section>

            <section>
              <p className="eyebrow">Brains to create</p>
              <div className="tierPicker">
                {tierOptions.map((option) => (
                  <button className={tiers.has(option.tier) ? "tierPick tierPickActive" : "tierPick"} key={option.tier} type="button" onClick={() => toggleTier(option.tier)}>
                    <Layers3 size={15} />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <p className="eyebrow">Tools to connect</p>
              <div className="connectorPicker">
                {connectorOptions.map(([id, label]) => (
                  <button className={connectors.has(id) ? "connectorPick connectorPickActive" : "connectorPick"} key={id} type="button" onClick={() => toggleConnector(id)}>
                    <Plug size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="permissionStrip">
              <button className={composioReady ? "toggleLine toggleLineActive" : "toggleLine"} type="button" onClick={() => setComposioReady((current) => !current)}>
                <KeyRound size={15} />
                Composio key configured
              </button>
              <button className={approveSetupPlan ? "toggleLine toggleLineActive" : "toggleLine"} type="button" onClick={() => setApproveSetupPlan((current) => !current)}>
                <LockKeyhole size={15} />
                Approve first plan
              </button>
            </section>
          </aside>
        </main>
      </div>
    </>
  );
}
