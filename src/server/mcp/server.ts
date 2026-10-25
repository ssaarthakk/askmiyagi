import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  findSymbolInputSchema,
  grepInputSchema,
  readFileInputSchema,
} from "../../shared/tool-inputs.ts";
import type { ToolResult } from "../../shared/tool-result.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { openLocalFolder } from "../source/local-folder.ts";
import { findSymbolTool } from "../tools/find-symbol.ts";
import { grepTool } from "../tools/grep.ts";
import { readFileTool } from "../tools/read-file.ts";
import { toolResult } from "../tools/run-tool.ts";

const usage = "Usage: miyagi mcp <root>";

const tools: {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run: (root: string, input: unknown) => Promise<ToolResult>;
}[] = [
  {
    name: "read_file",
    description:
      "Read a file with numbered lines, a line range, or one symbol's block. Large files return an outline.",
    inputSchema: readFileInputSchema,
    run: readFileTool,
  },
  {
    name: "grep",
    description: "Search the project's visible files for regex patterns, grouped by file.",
    inputSchema: grepInputSchema,
    run: grepTool,
  },
  {
    name: "find_symbol",
    description: "Find where a function, class, method, variable, interface or type is defined.",
    inputSchema: findSymbolInputSchema,
    run: findSymbolTool,
  },
];

export async function runMcpCommand(args: string[]) {
  const parsed = z.tuple([z.string().min(1)]).safeParse(args);
  if (!parsed.success) {
    process.stderr.write(`${usage}\n`);
    process.exitCode = 1;
    return;
  }
  const source = await openLocalFolder(parsed.data[0]);
  if (!source.ok) {
    process.stderr.write(`${source.error}\n`);
    process.exitCode = 1;
    return;
  }

  const server = new Server({ name: "miyagi", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema: z.toJSONSchema(inputSchema, { io: "input" }) as { type: "object" },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = tools.find(({ name }) => name === params.name);
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
