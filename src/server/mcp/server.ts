import { parseArgs } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { scopeToApp } from "../files/file-filter.ts";
import { openLocalFolder } from "../source/local-folder.ts";
import { chooseApp, findApps } from "../source/monorepo.ts";
import { toolDefinitions } from "../tools/definitions.ts";
import { toolResult } from "../tools/run-tool.ts";

const usage = "Usage: askmiyagi mcp <root> [--app <folder>]";

const mcpArgsSchema = z.object({
  positionals: z.tuple([z.string().min(1)]),
  app: z.string().min(1).optional(),
});

function parseMcpArgs(args: string[]) {
  try {
    const { positionals, values } = parseArgs({
      args,
      options: { app: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    return mcpArgsSchema.safeParse({ positionals, app: values.app });
  } catch {
    return undefined;
  }
}

export async function runMcpCommand(args: string[]) {
  const parsed = parseMcpArgs(args);
  if (!parsed?.success) {
    process.stderr.write(`${usage}\n`);
    process.exitCode = 1;
    return;
  }
  const source = await openLocalFolder(parsed.data.positionals[0]);
  if (!source.ok) {
    process.stderr.write(`${source.error}\n`);
    process.exitCode = 1;
    return;
  }
  if (parsed.data.app !== undefined) {
    const app = await chooseApp({
      apps: await findApps(source.value.root),
      requested: parsed.data.app,
    });
    if (!app.ok) {
      process.stderr.write(`${app.error}\n`);
      process.exitCode = 1;
      return;
    }
    if (app.value) scopeToApp(source.value.root, app.value);
  }

  const server = new Server({ name: "miyagi", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefinitions.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = toolDefinitions.find(({ name }) => name === params.name);
    const result = tool
      ? await tool.run(source.value.root, params.arguments)
      : toolResult(`Unknown tool: ${params.name}`, true);
    return {
      content: [
        { type: "text" as const, text: wrapUntrusted(tool?.name ?? "unknown", result.text) },
      ],
      isError: result.isError,
    };
  });
  server.onclose = () => {
    void source.value.dispose();
  };
  await server.connect(new StdioServerTransport());
}
