import type { AgentTarget, RegistryItem, SkillPackage, ToolDefinition } from "./types";

export type GeneratedAdapter = {
  target: AgentTarget;
  files: Array<{
    path: string;
    content: string;
  }>;
};

function skillItems(items: RegistryItem[]): SkillPackage[] {
  return items.filter((item): item is SkillPackage => item.kind === "skill");
}

function toolItems(items: RegistryItem[]): ToolDefinition[] {
  return items.filter((item): item is ToolDefinition => item.kind === "tool");
}

function renderSkill(skill: SkillPackage) {
  return `---\nname: ${skill.slug}\ndescription: ${skill.description}\nversion: ${skill.version}\ntier: ${skill.tier}\nowner: ${skill.ownerId}\n---\n\n${skill.skillMarkdown}\n\n## Dependencies\n\n${skill.dependencies.map((dependency) => `- ${dependency}`).join("\n") || "- None"}\n`;
}

export function generateCodexAdapter(items: RegistryItem[]): GeneratedAdapter {
  const skills = skillItems(items);
  const tools = toolItems(items);

  return {
    target: "codex",
    files: [
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
                version: "0.1.0"
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
            version: "0.1.0",
            skills: skills.map((skill) => `skills/${skill.slug}/SKILL.md`),
            mcpServers: {
              companyBrain: {
                command: "npx",
                args: ["company-brain-mcp", "--url", "${COMPANY_BRAIN_URL}"]
              }
            },
            tools: tools.map((tool) => tool.slug)
          },
          null,
          2
        )
      },
      ...skills.map((skill) => ({
        path: `codex/company-brain/skills/${skill.slug}/SKILL.md`,
        content: renderSkill(skill)
      }))
    ]
  };
}

export function generateClaudeAdapter(items: RegistryItem[]): GeneratedAdapter {
  const skills = skillItems(items);

  return {
    target: "claude-code",
    files: [
      {
        path: "claude-code/marketplace.json",
        content: JSON.stringify(
          {
            name: "Company Brain Registry",
            plugins: [
              {
                id: "company-brain",
                version: "0.1.0",
                description: "Curated company brain skills, MCP tools, and scheduled workflows."
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
    ]
  };
}

export function generateOpenCodeAdapter(items: RegistryItem[]): GeneratedAdapter {
  const skills = skillItems(items);
  const tools = toolItems(items);

  return {
    target: "opencode",
    files: [
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
              skill: {
                [skills.map((skill) => skill.slug).join("|") || "*"]: "allow"
              },
              tool: Object.fromEntries(tools.map((tool) => [tool.slug, "ask"]))
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
    ]
  };
}

export function generateGenericAgentsAdapter(items: RegistryItem[]): GeneratedAdapter {
  const skills = skillItems(items);

  return {
    target: "generic-mcp",
    files: [
      {
        path: "generic-agents/AGENTS.md",
        content: `# Company Brain Agent Instructions\n\nUse the Company Brain MCP server for governed organizational memory, approved skills, registry discovery, cron workflows, and audit traces.\n\n## MCP server\n\n${"${COMPANY_BRAIN_URL}"}/api/mcp\n\n## Available approved skills\n\n${skills.map((skill) => `- ${skill.slug}: ${skill.description}`).join("\n")}\n`
      },
      ...skills.map((skill) => ({
        path: `generic-agents/.agents/skills/${skill.slug}/SKILL.md`,
        content: renderSkill(skill)
      }))
    ]
  };
}

export function generateAllAdapters(items: RegistryItem[]) {
  return [
    generateCodexAdapter(items),
    generateClaudeAdapter(items),
    generateOpenCodeAdapter(items),
    generateGenericAgentsAdapter(items)
  ];
}
