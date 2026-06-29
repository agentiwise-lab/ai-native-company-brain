"use client";

import { useMemo, useState } from "react";
import type { NormalizedComposioArtifact } from "@/lib/composio-ingestion";

type SlackAccount = {
  id: string;
  toolkitSlug: string;
  principalId: string;
  status: "pending" | "active" | "revoked" | "errored";
};

type SlackConnectorConsoleProps = {
  tenantId: string;
  principalId: string;
  accounts: SlackAccount[];
  artifacts: NormalizedComposioArtifact[];
};

function parseChannels(input: string) {
  return input
    .split(",")
    .map((channel) => channel.trim())
    .filter(Boolean)
    .map((channel) => ({
      id: channel,
      name: channel.replace(/^#/, ""),
      teams: ["platform"],
      roles: ["admin", "reviewer", "operator", "agent"],
      sensitivity: "internal"
    }));
}

async function postJson(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Slack connector request failed.");
  }
  return payload;
}

export function SlackConnectorConsole({ tenantId, principalId, accounts, artifacts }: SlackConnectorConsoleProps) {
  const slackAccounts = useMemo(() => accounts.filter((account) => account.toolkitSlug === "slack"), [accounts]);
  const [accountId, setAccountId] = useState(slackAccounts[0]?.id ?? "");
  const [channels, setChannels] = useState("C123");
  const [workspaceId, setWorkspaceId] = useState("T123");
  const [mode, setMode] = useState<"backfill" | "incremental">("backfill");
  const [sinceTs, setSinceTs] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedAccount = slackAccounts.find((account) => account.id === accountId);

  async function run(action: "test" | "revoke" | "reauthorize" | "sync") {
    setBusy(true);
    setError("");
    setStatus("");

    try {
      if (!selectedAccount) {
        throw new Error("Select a Slack connected account.");
      }

      if (action === "sync") {
        const selectedChannels = parseChannels(channels);
        const result = await postJson("/api/v1/ingestion/slack/sync", {
          principalId,
          workspaceId,
          workspaceName: tenantId,
          mode,
          connectedAccount: {
            id: selectedAccount.id,
            status: selectedAccount.status,
            principalId: selectedAccount.principalId
          },
          selectedChannels,
          allowedChannelIds: selectedChannels.map((channel) => channel.id),
          sinceTs: sinceTs || undefined
        });
        setStatus(`${result.statuses.length} Slack threads synced`);
      } else {
        const result = await postJson(`/api/v1/composio/accounts/${selectedAccount.id}/${action}`);
        setStatus(`${selectedAccount.id} ${result.status}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Slack connector request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel workbenchPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Slack source</p>
          <h2>Connector console</h2>
        </div>
        <span className="status">{slackAccounts.length} accounts</span>
      </div>

      <div className="workbenchGrid">
        <form className="workbenchForm" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>Connected account</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Select account</option>
              {slackAccounts.map((account) => (
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
              <span>Workspace</span>
              <input value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} />
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
            <span>Channels</span>
            <input value={channels} onChange={(event) => setChannels(event.target.value)} />
          </label>
          <label>
            <span>Since ts</span>
            <input value={sinceTs} onChange={(event) => setSinceTs(event.target.value)} />
          </label>
          <button disabled={busy || !selectedAccount} onClick={() => run("sync")} type="button">
            Sync Slack
          </button>

          <div className="connectionList">
            {artifacts.slice(0, 3).map((artifact) => (
              <div className="connectionRow" key={artifact.id}>
                <div>
                  <strong>{artifact.source.title}</strong>
                  <span>{artifact.sourceObjectId}</span>
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
