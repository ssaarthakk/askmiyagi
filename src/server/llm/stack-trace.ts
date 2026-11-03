import { wrapUntrusted } from "../../shared/untrusted.ts";
import { anchorFrame, type Frame } from "../code/frame-anchor.ts";

type Collapsed = { collapsed: number };
type StackTrace = { message: string; items: (Frame | Collapsed)[] };

const frameLine = /^\s*at\s+(?:(.+?)\s+\((.+)\)|(\S+))$/;
const location = /^(.+):(\d+):(\d+)$/;
const hiddenFile = /^node:|(?:^|[\\/])node_modules[\\/]/;

function parseFrame(line: string): Frame | Collapsed | undefined {
  const match = frameLine.exec(line);
  if (!match) return undefined;
  const where = location.exec(match[2] ?? match[3] ?? "");
  const file = where?.[1];
  if (!where || !file || hiddenFile.test(file)) return { collapsed: 1 };
  const name = match[1]?.replace(/^async\s+/, "");
  return {
    ...(name ? { function: name } : {}),
    file,
    line: Number(where[2]),
    column: Number(where[3]),
  };
}

export const stackTraceRules = `Explaining a stack trace:
- The message holds the learner's stack trace in an untrusted block: the error message, then frames from the newest call to the oldest. Frames in the project are anchored to its files. Node and node_modules frames are collapsed; never explain them.
- Order the steps symptom, then trace back to where the bad value was created, then fix options. First the symptom: what the error says and the line that threw it. Then walk back through the callers, one step for each frame that matters, until you reach where the bad value was first made or let through. Last, fix options: two or three ways to fix it, each with its trade-off, and say which one you would pick.
- Anchor each step at the frame's file and line in the project. A frame marked with a warning does not match the code: tell the learner and use the function's real position (read it first) instead of that line.
- Say plainly when the cause is not in the trace or you are not sure. Never invent a cause. Use read_file for code around a frame.`;

export function parseStackTrace(text: string): StackTrace | undefined {
  const message: string[] = [];
  const items: (Frame | Collapsed)[] = [];
  let frames = 0;
  for (const line of text.split(/\r?\n/)) {
    const frame = parseFrame(line);
    if (!frame) {
      message.push(line);
      continue;
    }
    frames += 1;
    const last = items.at(-1);
    if ("collapsed" in frame && last && "collapsed" in last) last.collapsed += 1;
    else items.push(frame);
  }
  return frames < 2 ? undefined : { message: message.join("\n").trim(), items };
}

export async function anchorStackTrace(root: string, trace: StackTrace): Promise<StackTrace> {
  const items = await Promise.all(
    trace.items.map(async (item) =>
      "collapsed" in item ? item : { ...item, ...(await anchorFrame(root, item)) },
    ),
  );
  return { ...trace, items };
}

export function stackTraceWarnings(trace: StackTrace) {
  return trace.items.flatMap((item) => ("warning" in item && item.warning ? [item.warning] : []));
}

export function formatStackTrace(trace: StackTrace): string {
  const lines = trace.items.map((item) => {
    if ("collapsed" in item) {
      return `... ${item.collapsed} frame${item.collapsed === 1 ? "" : "s"} from Node or node_modules collapsed`;
    }
    const where = `${item.file}:${item.line}:${item.column}`;
    const warning = item.warning ? ` [warning: ${item.warning}]` : "";
    return `at ${item.function ? `${item.function} (${where})` : where}${warning}`;
  });
  return wrapUntrusted("stack_trace", [trace.message, ...lines].filter(Boolean).join("\n"));
}
