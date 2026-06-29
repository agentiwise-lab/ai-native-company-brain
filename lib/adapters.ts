import type { AgentTarget, RegistryItem, SkillPackage, ToolDefinition } from "./types";

export type GeneratedAdapter = {
  target: AgentTarget;
  files: Array<{
    path: string;
    content: string;
  }>;
};

export type PermissionMapping = {
  permission: string;
  opencode: "allow" | "ask";
  risk: "read" | "execute" | "write";
};

export type AdapterPackageManifest = {
  target: AgentTarget;
  package: {
    id: string;
    kind: RegistryItem["kind"];
    name: string;
    slug: string;
    version: string;
    tier: RegistryItem["tier"];
    ownerId: string;
    rollbackTarget: string;
    status: RegistryItem["status"];
  };
  mcpEndpoints: string[];
  permissions: PermissionMapping[];
  dependencies: string[];
  requiredTools: string[];
  examples: string[];
  changelog: string[];
  files: string[];
};

export type AdapterValidationResult = {
  ok: boolean;
  errors: string[];
};

const agentTargets: AgentTarget[] = ["codex", "claude-code", "opencode", "generic-mcp"];
const supportedPermissionNamespaces = new Set(["audit", "brain", "cron", "policy", "registry", "tool"]);

function skillItems(items: RegistryItem[]): SkillPackage[] {
  return items.filter((item): item is SkillPackage => item.kind === "skill" && item.status === "published");
}

function toolItems(items: RegistryItem[]): ToolDefinition[] {
  return items.filter((item): item is ToolDefinition => item.kind === "tool" && item.status === "published");
}

function list(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function rollbackTarget(item: RegistryItem) {
  return "rollbackTarget" in item && item.rollbackTarget ? item.rollbackTarget : "previous";
}

export function examplesFor(item: RegistryItem) {
  if (item.kind === "skill") {
    return item.examples;
  }
  if (item.kind === "cronjob") {
    return [item.prompt];
  }
  return [item.description];
}

export function changelogFor(item: RegistryItem) {
  if (item.kind === "skill") {
    return item.changelog;
  }
  return [`${item.version}: Exported canonical ${item.kind} package metadata.`];
}

export function mapPermission(permission: string): PermissionMapping {
  const composio = permission.match(/^composio:([a-z0-9-]+):(read|execute|write|admin|delete)$/i);
  if (composio) {
    const action = composio[2].toLowerCase();
    const risk = action === "read" ? "read" : action === "execute" ? "execute" : "write";
    return {
      permission,
      opencode: risk === "write" ? "ask" : "allow",
      risk
    };
  }

  const generic = permission.match(/^([a-z]+):([a-z-]+)$/i);
  if (!generic || !supportedPermissionNamespaces.has(generic[1].toLowerCase())) {
    throw new Error(`Unsupported permission mapping: ${permission}.`);
  }

  const action = generic[2].toLowerCase();
  const risk = /write|publish|install|delete|admin|commit|review|run|invoke/.test(action)
    ? action === "invoke" || action === "run"
      ? "execute"
      : "write"
    : "read";
  return {
    permission,
    opencode: risk === "read" ? "allow" : "ask",
    risk
  };
}

function allPermissionMappings(items: RegistryItem[]) {
  return items.flatMap((item) => item.permissions.map(mapPermission));
}

function renderSkill(skill: SkillPackage) {
  return `---\nname: ${skill.slug}\ndescription: ${skill.description}\nversion: ${skill.version}\ntier: ${skill.tier}\nowner: ${skill.ownerId}\nrollback_target: ${rollbackTarget(skill)}\n---\n\n${skill.skillMarkdown}\n\n## Permissions\n\n${list(skill.permissions)}\n\n## Required Tools\n\n${list(skill.requiredTools)}\n\n## Dependencies\n\n${list(skill.dependencies)}\n\n## Examples\n\n${list(skill.examples)}\n\n## Changelog\n\n${list(skill.changelog)}\n\n## Rollback\n\nRollback target: ${rollbackTarget(skill)}\n`;
}

function packageManifestFile(target: AgentTarget, item: RegistryItem, files: string[], items: RegistryItem[]) {
  return {
    path: `${target}/company-brain-package.json`,
    content: JSON.stringify(createAdapterPackageManifest(target, item, files, items), null, 2)
  };
}

export function createAdapterPackageManifest(target: AgentTarget, item: RegistryItem, files: string[], items: RegistryItem[]): AdapterPackageManifest {
  return {
    target,
    package: {
      id: item.id,
      kind: item.kind,
      name: item.name,
      slug: item.slug,
      version: item.version,
      tier: item.tier,
      ownerId: item.ownerId,
      rollbackTarget: rollbackTarget(item),
      status: item.status
    },
    mcpEndpoints: ["${COMPANY_BRAIN_URL}/api/mcp"],
    permissions: allPermissionMappings(items),
    dependencies: item.dependencies,
    requiredTools: item.requiredTools,
    examples: examplesFor(item),
    changelog: changelogFor(item),
    files
  };
}

export function validateAdapterGeneration(item: RegistryItem, registryItems: RegistryItem[] = []): AdapterValidationResult {
  const errors: string[] = [];
  if (item.adapterTargets.length === 0) {
    errors.push("No adapter targets configured.");
  }
  const unsupportedTargets = item.adapterTargets.filter((target) => !agentTargets.includes(target));
  if (unsupportedTargets.length > 0) {
    errors.push(`Unsupported adapter targets: ${unsupportedTargets.join(", ")}.`);
  }

  try {
    item.permissions.forEach(mapPermission);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unsupported permission mapping.");
  }

  const packageIds = new Set(registryItems.flatMap((entry) => [entry.id, entry.slug]));
  const toolIds = new Set(registryItems.filter((entry) => entry.kind === "tool").flatMap((entry) => [entry.id, entry.slug]));
  const missingDependencies = item.dependencies.filter((dependency) => !dependency.startsWith("atom_") && !packageIds.has(dependency));
  const missingRequiredTools = item.requiredTools.filter((tool) => !toolIds.has(tool));
  if (missingDependencies.length > 0) {
    errors.push(`Missing dependencies: ${missingDependencies.join(", ")}.`);
  }
  if (missingRequiredTools.length > 0) {
    errors.push(`Missing required tools: ${missingRequiredTools.join(", ")}.`);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function generateCodexAdapter(items: RegistryItem[], rootItem = items[0]): GeneratedAdapter {
  const skills = skillItems(items);
  const tools = toolItems(items);
  const baseFiles = [
    {
      path: "codex/marketplace.json",
      content: JSON.stringify(
        {
          name: "Company Brain Registry",
          plugins: [
            {
              id: "company-brain",
              name: "Company Brain",
              description: "Governed memory, skills, registry, cron, and audit tools.",
              version: rootItem?.version ?? "0.1.0",
              rollbackTarget: rootItem ? rollbackTarget(rootItem) : "previous"
            }
          ]
        },
        null,
        2
      )
    },
    {
      path: "codex/company-brain/.codex-plugin/manifest.json",
      content: JSON.stringify(
        {
          id: "company-brain",
          name: "Company Brain",
          version: rootItem?.version ?? "0.1.0",
          rollbackTarget: rootItem ? rollbackTarget(rootItem) : "previous",
          skills: skills.map((skill) => `skills/${skill.slug}/SKILL.md`),
          mcpServers: {
            companyBrain: {
              command: "npx",
              args: ["company-brain-mcp", "--url", "${COMPANY_BRAIN_URL}"]
            }
          },
          permissions: allPermissionMappings(items),
          tools: tools.map((tool) => ({ slug: tool.slug, permissions: tool.permissions, auditPolicy: tool.auditPolicy }))
        },
        null,
        2
      )
    },
    ...skills.map((skill) => ({
      path: `codex/company-brain/skills/${skill.slug}/SKILL.md`,
      content: renderSkill(skill)
    }))
  ];
  return {
    target: "codex",
    files: rootItem ? [...baseFiles, packageManifestFile("codex", rootItem, baseFiles.map((file) => file.path), items)] : baseFiles
  };
}

export function generateClaudeAdapter(items: RegistryItem[], rootItem = items[0]): GeneratedAdapter {
  const skills = skillItems(items);
  const baseFiles = [
    {
      path: "claude-code/marketplace.json",
      content: JSON.stringify(
        {
          name: "Company Brain Registry",
          plugins: [
            {
              id: "company-brain",
              version: rootItem?.version ?? "0.1.0",
              rollbackTarget: rootItem ? rollbackTarget(rootItem) : "previous",
              description: "Curated company brain skills, MCP tools, and scheduled workflows.",
              permissions: allPermissionMappings(items)
            }
          ]
        },
        null,
        2
      )
    },
    {
      path: "claude-code/.mcp.json",
      content: JSON.stringify(
        {
          mcpServers: {
            companyBrain: {
              type: "http",
              url: "${COMPANY_BRAIN_URL}/api/mcp"
            }
          }
        },
        null,
        2
      )
    },
    ...skills.map((skill) => ({
      path: `claude-code/.claude/skills/${skill.slug}/SKILL.md`,
      content: renderSkill(skill)
    }))
  ];
  return {
    target: "claude-code",
    files: rootItem ? [...baseFiles, packageManifestFile("claude-code", rootItem, baseFiles.map((file) => file.path), items)] : baseFiles
  };
}

export function generateOpenCodeAdapter(items: RegistryItem[], rootItem = items[0]): GeneratedAdapter {
  const skills = skillItems(items);
  const tools = toolItems(items);
  const permissions = allPermissionMappings(items);
  const baseFiles = [
    {
      path: "opencode/opencode.json",
      content: JSON.stringify(
        {
          mcp: {
            companyBrain: {
              url: "${COMPANY_BRAIN_URL}/api/mcp"
            }
          },
          permission: {
            skill: Object.fromEntries(skills.map((skill) => [skill.slug, "allow"])),
            tool: Object.fromEntries(tools.map((tool) => [tool.slug, "ask"])),
            registry: Object.fromEntries(permissions.map((mapping) => [mapping.permission, mapping.opencode]))
          }
        },
        null,
        2
      )
    },
    ...skills.map((skill) => ({
      path: `opencode/.opencode/skills/${skill.slug}/SKILL.md`,
      content: renderSkill(skill)
    })),
    ...tools.map((tool) => ({
      path: `opencode/.opencode/tools/${tool.slug}.ts`,
      content: `import { tool } from "@opencode-ai/plugin";\n\nexport default tool({\n  description: ${JSON.stringify(tool.description)},\n  args: ${JSON.stringify(tool.inputSchema, null, 2)},\n  async execute(input) {\n    const response = await fetch(process.env.COMPANY_BRAIN_URL + "/api/mcp", {\n      method: "POST",\n      headers: { "content-type": "application/json" },\n      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name: ${JSON.stringify(tool.slug)}, arguments: input } })\n    });\n    return await response.json();\n  }\n});\n`
    }))
  ];
  return {
    target: "opencode",
    files: rootItem ? [...baseFiles, packageManifestFile("opencode", rootItem, baseFiles.map((file) => file.path), items)] : baseFiles
  };
}

export function generateGenericAgentsAdapter(items: RegistryItem[], rootItem = items[0]): GeneratedAdapter {
  const skills = skillItems(items);
  const baseFiles = [
    {
      path: "generic-agents/AGENTS.md",
      content: `# Company Brain Agent Instructions\n\nUse the Company Brain MCP server for governed organizational memory, approved skills, registry discovery, cron workflows, and audit traces.\n\n## MCP server\n\n${"${COMPANY_BRAIN_URL}"}/api/mcp\n\n## Permissions\n\n${list([...new Set(items.flatMap((item) => item.permissions))])}\n\n## Available approved skills\n\n${skills.map((skill) => `- ${skill.slug}: ${skill.description}`).join("\n") || "- None"}\n`
    },
    ...skills.map((skill) => ({
      path: `generic-agents/.agents/skills/${skill.slug}/SKILL.md`,
      content: renderSkill(skill)
    }))
  ];
  return {
    target: "generic-mcp",
    files: rootItem ? [...baseFiles, packageManifestFile("generic-mcp", rootItem, baseFiles.map((file) => file.path), items)] : baseFiles
  };
}

export function generateAdapterForTarget(target: AgentTarget, items: RegistryItem[], rootItem = items[0]) {
  if (target === "codex") {
    return generateCodexAdapter(items, rootItem);
  }
  if (target === "claude-code") {
    return generateClaudeAdapter(items, rootItem);
  }
  if (target === "opencode") {
    return generateOpenCodeAdapter(items, rootItem);
  }
  return generateGenericAgentsAdapter(items, rootItem);
}

export function generateAllAdapters(items: RegistryItem[]) {
  return agentTargets.map((target) => generateAdapterForTarget(target, items));
}
