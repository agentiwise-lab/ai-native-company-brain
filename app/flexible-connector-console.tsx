"use client";

import { useMemo, useState } from "react";
import type { NormalizedComposioArtifact } from "@/lib/composio-ingestion";

type FlexibleAccount = {
  id: string;
  toolkitSlug: string;
  principalId: string;
  status: "pending" | "active" | "revoked" | "errored";
};

type FlexibleConnectorConsoleProps = {
  principalId: string;
  accounts: FlexibleAccount[];
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
    throw new Error(payload.error ?? "Flexible connector request failed.");
  }
  return payload;
}

export function FlexibleConnectorConsole({ principalId, accounts, artifacts }: FlexibleConnectorConsoleProps) {
  const notionAccounts = useMemo(() => accounts.filter((account) => account.toolkitSlug.includes("notion")), [accounts]);
  const [accountId, setAccountId] = useState(notionAccounts[0]?.id ?? "");
  const [sourceId, setSourceId] = useState("page_123");
  const [sourceName, setSourceName] = useState("Operating handbook");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedAccount = notionAccounts.find((account) => account.id === accountId);

  async function run(action: "test" | "revoke" | "reauthorize" | "sync" | "disable" | "replay") {
    setBusy(true);
    setError("");
    setStatus("");

    try {
      if (action === "disable" || action === "replay") {
        await postJson("/api/v1/ingestion/flexible", {
          action,
          sourceId: `notion:${sourceId}`
        });
        setStatus(`${sourceId} ${action} recorded`);
        return;
      }

      if (!selectedAccount) {
        throw new Error("Select a Notion connected account.");
      }

      if (action === "sync") {
        const result = await postJson("/api/v1/ingestion/flexible/notion/sync", {
          principalId,
          mode: "backfill",
          connectedAccount: {
            id: selectedAccount.id,
            status: selectedAccount.status,
            principalId: selectedAccount.principalId
          },
          selectedSources: [
            {
              id: sourceId,
              kind: "page",
              name: sourceName,
              teams: ["platform"],
              roles: ["admin", "reviewer", "operator", "agent"],
              sensitivity: "internal"
            }
          ],
          allowedSourceIds: [sourceId]
        });
        setStatus(`${result.statuses.length} Notion sources synced`);
      } else {
        const result = await postJson(`/api/v1/composio/accounts/${selectedAccount.id}/${action}`);
        setStatus(`${selectedAccount.id} ${result.status}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Flexible connector request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel workbenchPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Flexible sources</p>
          <h2>Notion and webhooks</h2>
        </div>
        <span className="status">{notionAccounts.length} accounts</span>
      </div>

      <div className="workbenchGrid">
        <form className="workbenchForm" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>Notion account</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Select account</option>
              {notionAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.id} · {account.status}
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
              <span>Source id</span>
              <input value={sourceId} onChange={(event) => setSourceId(event.target.value)} />
            </label>
            <label>
              <span>Name</span>
              <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
            </label>
          </div>
          <button disabled={busy || !selectedAccount} onClick={() => run("sync")} type="button">
            Sync Notion
          </button>
          <div className="connectorButtonRow">
            <button disabled={busy} onClick={() => run("disable")} type="button">
              Disable
            </button>
            <button disabled={busy} onClick={() => run("replay")} type="button">
              Replay
            </button>
          </div>

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
