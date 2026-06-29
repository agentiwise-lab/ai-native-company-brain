import { brainTiers, type BrainTier, type KnowledgeAtom, type Principal, type RegistryItem } from "./types";

const tierRank = new Map<BrainTier, number>(brainTiers.map((tier, index) => [tier, index]));

export function canAccessTier(principal: Principal, tier: BrainTier) {
  return principal.tiers.includes(tier);
}

export function isTierAtLeast(left: BrainTier, right: BrainTier) {
  return (tierRank.get(left) ?? 0) >= (tierRank.get(right) ?? 0);
}

export function canReadAtom(principal: Principal, atom: KnowledgeAtom) {
  if (!canAccessTier(principal, atom.tier)) {
    return {
      allowed: false,
      reason: `Principal cannot access ${atom.tier}.`
    };
  }

  if (!atom.acl.roles.includes(principal.role)) {
    return {
      allowed: false,
      reason: `Role ${principal.role} is not allowed for ${atom.title}.`
    };
  }

  if (atom.acl.teams.length > 0 && !atom.acl.teams.some((team) => principal.teams.includes(team))) {
    return {
      allowed: false,
      reason: `Principal is not in any required team for ${atom.title}.`
    };
  }

  return {
    allowed: true,
    reason: "Allowed by tier, role, and team ACL."
  };
}

export function canDiscoverRegistryItem(principal: Principal, item: RegistryItem) {
  if (!canAccessTier(principal, item.tier)) {
    return {
      allowed: false,
      reason: `Principal cannot discover ${item.tier} registry items.`
    };
  }

  if (item.permissions.some((permission) => permission.endsWith(":write")) && principal.role === "employee") {
    return {
      allowed: false,
      reason: "Write-capable registry items are hidden from employees by default."
    };
  }

  if (item.status === "blocked" && principal.role !== "admin") {
    return {
      allowed: false,
      reason: "Blocked registry items require admin visibility."
    };
  }

  return {
    allowed: true,
    reason: "Allowed by registry discovery policy."
  };
}

export function enforceChangesetMerge(checks: Array<{ status: string; label: string }>) {
  const failed = checks.filter((check) => check.status === "failed");
  const pending = checks.filter((check) => check.status === "pending");

  if (failed.length > 0) {
    return {
      allowed: false,
      reasons: failed.map((check) => `${check.label} failed`)
    };
  }

  if (pending.length > 0) {
    return {
      allowed: false,
      reasons: pending.map((check) => `${check.label} is pending`)
    };
  }

  return {
    allowed: true,
    reasons: ["All required checks passed."]
  };
}
