import { describe, expect, it } from "vitest";
import { createDefaultOperatorPackages, defaultOperatorDefinitions, defaultOperatorSummary } from "../lib/default-operators";

describe("default onboarding AI operators", () => {
  it("seeds the Core 12 operators with safe published and review-gated defaults", () => {
    const packages = createDefaultOperatorPackages({
      tenantId: "tenant_acme",
      ownerId: "usr_admin",
      updatedAt: "2026-06-30T12:00:00.000Z"
    });

    expect(packages).toHaveLength(12);
    expect(new Set(packages.map((operator) => operator.slug))).toEqual(new Set(defaultOperatorDefinitions.map((operator) => operator.slug)));
    expect(packages.filter((operator) => operator.status === "published").map((operator) => operator.slug)).toEqual([
      "company-profile-builder",
      "org-map-builder",
      "brain-level-designer",
      "connector-scope-planner",
      "onboarding-brief",
      "automation-opportunity-finder"
    ]);
    expect(packages.filter((operator) => operator.status === "review").map((operator) => operator.slug)).toEqual([
      "access-policy-designer",
      "department-brain-starter",
      "team-brain-starter",
      "candidate-memory-extractor",
      "decision-log-maintainer",
      "brain-health-operator"
    ]);
    expect(packages.every((operator) => operator.tenantId === "tenant_acme")).toBe(true);
    expect(packages.every((operator) => operator.ownerId === "usr_admin")).toBe(true);
    expect(packages.every((operator) => operator.requiredTools.includes("tool_brain_query"))).toBe(true);
    expect(packages.find((operator) => operator.slug === "access-policy-designer")?.permissions).toContain("policy:write");
  });

  it("shows only published operators to non-admin summaries", () => {
    expect(defaultOperatorSummary("employee")).toMatchObject({
      total: 12,
      published: 6,
      reviewGated: 6
    });
    expect(defaultOperatorSummary("employee").visible).toEqual([
      "company-profile-builder",
      "org-map-builder",
      "brain-level-designer",
      "connector-scope-planner",
      "onboarding-brief",
      "automation-opportunity-finder"
    ]);
  });
});
