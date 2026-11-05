import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { CallRecord } from "../../shared/call-log.ts";
import { parseContract } from "../../shared/parse.ts";
import { pathSchema } from "../../shared/path.ts";
import { appendCallLog } from "../call-log.ts";
import { orderByImports } from "../code/import-graph.ts";
import { readRepo, renderRepoMap } from "../code/repo-map.ts";
import { createPathPlanner } from "../llm/path-planner.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { LearnerRecord } from "../teach/learner.ts";
import { readPath, withProgress, writePath } from "../teach/path.ts";
import { readProfile } from "../teach/profile.ts";
import { readJsonBody, sendError } from "./ask-route.ts";

export function createPathHandler(options: {
  root: string;
  tutorRoot: string;
  provider: LLMProvider;
  providerName: string;
  learner: LearnerRecord;
}) {
  const { root, tutorRoot, learner } = options;
  const plan = createPathPlanner(options.provider, root, {
    provider: options.providerName,
    write: (record: CallRecord) => appendCallLog(tutorRoot, record),
  });

  async function send(response: ServerResponse, path: Awaited<ReturnType<typeof readPath>>) {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(withProgress(path, await learner.explainedConcepts())));
  }

  async function planNew(request: IncomingMessage, response: ServerResponse) {
    if (!(await readJsonBody(request, response, z.object({})))) return;
    const profile = await readProfile(tutorRoot);
    if (!profile?.goal) {
      sendError(response, 400, "Set a goal first: say what you want to do with this repo");
      return;
    }
    const repo = await readRepo(root);
    const planned = await plan({
      goal: profile.goal,
      level: profile.level,
      repoMap: await renderRepoMap(repo),
      files: repo.paths,
    });
    if (!planned.ok) {
      sendError(response, 502, planned.error);
      return;
    }
    const visible = new Set(repo.paths);
    const usable = parseContract(pathSchema, {
      items: planned.value.filter((item) => visible.has(item.file)),
    });
    if (!usable.ok) {
      sendError(response, 502, "The plan named too few files that exist", usable.error);
      return;
    }
    const items = orderByImports(usable.value.items, repo.imports);
    const saved = await writePath(tutorRoot, { items });
    if (!saved.ok) {
      sendError(response, 500, "Could not save the path", saved.error);
      return;
    }
    await send(response, saved.value);
  }

  return async function handlePath(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "POST") await planNew(request, response);
    else await send(response, await readPath(tutorRoot));
  };
}
