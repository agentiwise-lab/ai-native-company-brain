"use client";

import { useMemo, useState } from "react";
import type { NormalizedComposioArtifact } from "@/lib/composio-ingestion";

type GoogleAccount = {
  id: string;
  toolkitSlug: string;
  principalId: string;
  status: "pending" | "active" | "revoked" | "errored";
};

type GoogleConnectorConsoleProps = {
  principalId: string;
  accounts: GoogleAccount[];
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
    throw new Error(payload.error ?? "Google connector request failed.");
  }
  return payload;
}

export function GoogleConnectorConsole({ principalId, accounts, artifacts }: GoogleConnectorConsoleProps) {
  const googleAccounts = useMemo(
    () => accounts.filter((account) => account.toolkitSlug.includes("google") || account.toolkitSlug.includes("gmail")),
    [accounts]
  );
  const [accountId, setAccountId] = useState(googleAccounts[0]?.id ?? "");
  const [kind, setKind] = useState<"drive" | "gmail">("drive");
  const [scope, setScope] = useState("drive.readonly");
  const [mode, setMode] = useState<"backfill" | "incremental">("backfill");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedAccount = googleAccounts.find((account) => account.id === accountId);

  function updateKind(nextKind: "drive" | "gmail") {
    setKind(nextKind);
    setScope(nextKind === "drive" ? "drive.readonly" : "gmail.readonly");
  }

  async function run(action: "test" | "revoke" | "reauthorize" | "sync") {
    setBusy(true);
    setError("");
    setStatus("");

    try {
      if (!selectedAccount) {
        throw new Error("Select a Google connected account.");
      }

      if (action === "sync") {
        const result = await postJson("/api/v1/ingestion/google/sync", {
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
              name: kind === "drive" ? "Drive" : "Gmail",
              teams: ["platform"],
              roles: ["admin", "reviewer", "operator", "agent"],
              sensitivity: kind === "gmail" ? "confidential" : "internal"
            }
          ],
          allowedScopes: [scope]
        });
        setStatus(`${result.statuses.length} Google sources synced`);
      } else {
        const result = await postJson(`/api/v1/composio/accounts/${selectedAccount.id}/${action}`);
        setStatus(`${selectedAccount.id} ${result.status}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google connector request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel workbenchPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Google sources</p>
          <h2>Drive and Gmail</h2>
        </div>
        <span className="status">{googleAccounts.length} accounts</span>
      </div>

      <div className="workbenchGrid">
        <form className="workbenchForm" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>Connected account</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Select account</option>
              {googleAccounts.map((account) => (
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
              <select value={kind} onChange={(event) => updateKind(event.target.value as "drive" | "gmail")}>
                <option value="drive">Drive</option>
                <option value="gmail">Gmail</option>
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
            Sync Google
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
