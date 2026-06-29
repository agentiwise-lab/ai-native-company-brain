"use client";

import { useMemo, useState } from "react";
import type { NormalizedComposioArtifact } from "@/lib/composio-ingestion";

type WorkAccount = {
  id: string;
  toolkitSlug: string;
  principalId: string;
  status: "pending" | "active" | "revoked" | "errored";
};

type WorkConnectorConsoleProps = {
  principalId: string;
  accounts: WorkAccount[];
  artifacts: NormalizedComposioArtifact[];
};

async function postJson(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Work connector request failed.");
  }
  return payload;
}

export function WorkConnectorConsole({ principalId, accounts, artifacts }: WorkConnectorConsoleProps) {
  const workAccounts = useMemo(
    () => accounts.filter((account) => account.toolkitSlug.includes("github") || account.toolkitSlug.includes("linear")),
    [accounts]
  );
  const [accountId, setAccountId] = useState(workAccounts[0]?.id ?? "");
  const [kind, setKind] = useState<"github" | "linear">("github");
  const [scope, setScope] = useState("github:repo:agentiwise-lab/ai-native-company-brain");
  const [mode, setMode] = useState<"backfill" | "incremental">("backfill");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedAccount = workAccounts.find((account) => account.id === accountId);

  function updateKind(nextKind: "github" | "linear") {
    setKind(nextKind);
    setScope(nextKind === "github" ? "github:repo:agentiwise-lab/ai-native-company-brain" : "linear:project:AI-Native Company Brain");
  }

  async function run(action: "test" | "revoke" | "reauthorize" | "sync") {
    setBusy(true);
    setError("");
    setStatus("");

    try {
      if (!selectedAccount) {
        throw new Error("Select a GitHub or Linear connected account.");
      }

      if (action === "sync") {
        const result = await postJson("/api/v1/ingestion/work/sync", {
          principalId,
          mode,
          connectedAccount: {
            id: selectedAccount.id,
            status: selectedAccount.status,
            principalId: selectedAccount.principalId
          },
          selectedSources: [
            {
              kind,
              scope,
              name: kind === "github" ? "GitHub repository" : "Linear project",
              teams: ["platform"],
              roles: ["admin", "reviewer", "operator", "agent"],
              sensitivity: "internal"
            }
          ],
          allowedScopes: [scope]
        });
        setStatus(`${result.statuses.length} work items synced`);
      } else {
        const result = await postJson(`/api/v1/composio/accounts/${selectedAccount.id}/${action}`);
        setStatus(`${selectedAccount.id} ${result.status}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Work connector request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel workbenchPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Product work</p>
          <h2>GitHub and Linear</h2>
        </div>
        <span className="status">{workAccounts.length} accounts</span>
      </div>

      <div className="workbenchGrid">
        <form className="workbenchForm" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>Connected account</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Select account</option>
              {workAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.id} · {account.toolkitSlug} · {account.status}
                </option>
              ))}
            </select>
          </label>
          <div className="connectorButtonRow">
            <button disabled={busy || !selectedAccount} onClick={() => run("test")} type="button">
              Test
            </button>
            <button disabled={busy || !selectedAccount} onClick={() => run("revoke")} type="button">
              Revoke
            </button>
            <button disabled={busy || !selectedAccount} onClick={() => run("reauthorize")} type="button">
              Reauthorize
            </button>
          </div>
          {status ? <div className="workbenchResult">{status}</div> : null}
          {error ? <p className="workbenchError">{error}</p> : null}
        </form>

        <form className="workbenchForm" onSubmit={(event) => event.preventDefault()}>
          <div className="workbenchTwo">
            <label>
              <span>Source</span>
              <select value={kind} onChange={(event) => updateKind(event.target.value as "github" | "linear")}>
                <option value="github">GitHub</option>
                <option value="linear">Linear</option>
              </select>
            </label>
            <label>
              <span>Mode</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as "backfill" | "incremental")}>
                <option value="backfill">Backfill</option>
                <option value="incremental">Incremental</option>
              </select>
            </label>
          </div>
          <label>
            <span>Scope</span>
            <input value={scope} onChange={(event) => setScope(event.target.value)} />
          </label>
          <button disabled={busy || !selectedAccount} onClick={() => run("sync")} type="button">
            Sync work
          </button>

          <div className="connectionList">
            {artifacts.slice(0, 3).map((artifact) => (
              <div className="connectionRow" key={artifact.id}>
                <div>
                  <strong>{artifact.source.title}</strong>
                  <span>{artifact.connector} · {artifact.sourceObjectId}</span>
                </div>
                <span className="status">{artifact.acl.sensitivity}</span>
              </div>
            ))}
          </div>
        </form>
      </div>
    </section>
  );
}
