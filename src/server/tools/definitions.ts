import { z } from "zod";
import {
  findSymbolInputSchema,
  grepInputSchema,
  readFileInputSchema,
} from "../../shared/tool-inputs.ts";
import type { ToolResult } from "../../shared/tool-result.ts";
import type { AgentTool } from "../llm/agent-loop.ts";
import { findSymbolTool } from "./find-symbol.ts";
import { grepTool } from "./grep.ts";
import { readFileTool } from "./read-file.ts";

function inputJsonSchema(schema: z.ZodType) {
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema, { io: "input" });
  return { ...jsonSchema, type: "object" as const };
}

export const toolDefinitions: {
  name: string;
  description: string;
  inputSchema: AgentTool["inputSchema"];
  run: (root: string, input: unknown) => Promise<ToolResult>;
}[] = [
  {
    name: "read_file",
    description:
      "Read a file with numbered lines, a line range, or one symbol's block. Large files return an outline.",
    inputSchema: inputJsonSchema(readFileInputSchema),
    run: readFileTool,
  },
  {
    name: "grep",
    description: "Search the project's visible files for regex patterns, grouped by file.",
    inputSchema: inputJsonSchema(grepInputSchema),
    run: grepTool,
  },
  {
    name: "find_symbol",
    description: "Find where a function, class, method, variable, interface or type is defined.",
    inputSchema: inputJsonSchema(findSymbolInputSchema),
    run: findSymbolTool,
  },
];

export function agentTools(root: string): AgentTool[] {
  return toolDefinitions.map(({ name, description, inputSchema, run }) => ({
    name,
    description,
    inputSchema,
    run: (input) => run(root, input),
  }));
}
