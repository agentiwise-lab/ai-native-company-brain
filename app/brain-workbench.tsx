"use client";

import { useState } from "react";
import type { BrainQueryResult, BrainTier, Changeset, KnowledgeAtom, BrainEvent } from "@/lib/types";

type CommitResult = {
  atom: KnowledgeAtom;
  changeset: Changeset;
  event: BrainEvent;
};

type BrainWorkbenchProps = {
  tenantId: string;
  principalId: string;
};

const defaultCommit = {
  title: "",
  body: "",
  sourceIds: "",
  sourceUri: "",
  sourceTitle: "",
  tier: "team" as BrainTier
};

export function BrainWorkbench({ tenantId, principalId }: BrainWorkbenchProps) {
  const [query, setQuery] = useState("promotion");
  const [queryResult, setQueryResult] = useState<BrainQueryResult | null>(null);
  const [queryError, setQueryError] = useState("");
  const [queryLoading, setQueryLoading] = useState(false);
  const [commit, setCommit] = useState(defaultCommit);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [commitError, setCommitError] = useState("");
  const [commitLoading, setCommitLoading] = useState(false);

  async function runQuery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQueryLoading(true);
    setQueryError("");
    setQueryResult(null);

    try {
      const response = await fetch("/api/v1/brain/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": tenantId,
          "x-principal-id": principalId
        },
        body: JSON.stringify({ query })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Brain query failed.");
      }
      setQueryResult(payload);
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : "Brain query failed.");
    } finally {
      setQueryLoading(false);
    }
  }

  async function commitCandidate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCommitLoading(true);
    setCommitError("");
    setCommitResult(null);

    try {
      const response = await fetch("/api/v1/brain/commit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": tenantId,
          "x-principal-id": principalId
        },
        body: JSON.stringify({
          title: commit.title,
          body: commit.body,
          tier: commit.tier,
          sourceIds: commit.sourceIds
            .split(",")
            .map((sourceId) => sourceId.trim())
            .filter(Boolean),
          sourceUri: commit.sourceUri || undefined,
          sourceTitle: commit.sourceTitle || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Brain commit failed.");
      }
      setCommitResult(payload);
      setCommit(defaultCommit);
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "Brain commit failed.");
    } finally {
      setCommitLoading(false);
    }
  }

  return (
    <section className="panel workbenchPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Brain workbench</p>
          <h2>Query and commit</h2>
        </div>
        <span className="status statusGood">{principalId}</span>
      </div>

      <div className="workbenchGrid">
        <form className="workbenchForm" onSubmit={runQuery}>
          <label>
            <span>Query</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button disabled={queryLoading} type="submit">
            {queryLoading ? "Querying..." : "Run query"}
          </button>

          {queryError ? <p className="workbenchError">{queryError}</p> : null}
          {queryResult ? (
            <div className="workbenchResult">
              <strong>{queryResult.answer}</strong>
              {queryResult.citations.length === 0 ? <p>No citations matched the current access context.</p> : null}
              {queryResult.citations.map((atom) => (
                <article className="citationCard" key={atom.id}>
                  <div>
                    <strong>{atom.title}</strong>
                    <span>{atom.tier}</span>
                  </div>
                  <div className="citationStats">
                    <span>{Math.round(atom.confidence * 100)}% confidence</span>
                    <span>{Math.round(atom.freshness * 100)}% fresh</span>
                    <span>{atom.status}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </form>

        <form className="workbenchForm" onSubmit={commitCandidate}>
          <label>
            <span>Title</span>
            <input required value={commit.title} onChange={(event) => setCommit({ ...commit, title: event.target.value })} />
          </label>
          <label>
            <span>Memory</span>
            <textarea required value={commit.body} onChange={(event) => setCommit({ ...commit, body: event.target.value })} />
          </label>
          <div className="workbenchTwo">
            <label>
              <span>Source ids</span>
              <input value={commit.sourceIds} onChange={(event) => setCommit({ ...commit, sourceIds: event.target.value })} />
            </label>
            <label>
              <span>Tier</span>
              <select value={commit.tier} onChange={(event) => setCommit({ ...commit, tier: event.target.value as BrainTier })}>
                <option value="individual">Individual</option>
                <option value="team">Team</option>
                <option value="department">Department</option>
                <option value="company-main">Company main</option>
              </select>
            </label>
          </div>
          <label>
            <span>Source link</span>
            <input value={commit.sourceUri} onChange={(event) => setCommit({ ...commit, sourceUri: event.target.value })} />
          </label>
          <label>
            <span>Source title</span>
            <input value={commit.sourceTitle} onChange={(event) => setCommit({ ...commit, sourceTitle: event.target.value })} />
          </label>
          <button disabled={commitLoading} type="submit">
            {commitLoading ? "Opening review..." : "Commit candidate"}
          </button>

          {commitError ? <p className="workbenchError">{commitError}</p> : null}
          {commitResult ? (
            <div className="workbenchResult">
              <strong>{commitResult.changeset.title}</strong>
              <p>{commitResult.changeset.summary}</p>
              <div className="citationStats">
                <span>{commitResult.atom.status}</span>
                <span>{commitResult.changeset.status}</span>
                <span>{commitResult.event.action}</span>
              </div>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
