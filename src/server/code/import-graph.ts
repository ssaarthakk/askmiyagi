import type { PathItem } from "../../shared/path.ts";
import type { ImportGraph } from "./repo-map.ts";

function cycleGroups(graph: ImportGraph) {
  const visitOrder = new Map<string, number>();
  const stack: string[] = [];
  const groupOf = new Map<string, string[]>();

  function visit(file: string) {
    const order = visitOrder.size;
    visitOrder.set(file, order);
    stack.push(file);
    let lowest = order;
    for (const next of graph.get(file) ?? []) {
      if (!visitOrder.has(next)) lowest = Math.min(lowest, visit(next));
      else if (!groupOf.has(next)) lowest = Math.min(lowest, visitOrder.get(next) ?? lowest);
    }
    if (lowest === order) {
      const members = stack.splice(stack.indexOf(file)).toSorted();
      for (const member of members) groupOf.set(member, members);
    }
    return lowest;
  }

  return (file: string) => {
    if (!visitOrder.has(file)) visit(file);
    return groupOf.get(file) ?? [file];
  };
}

export function orderByImports(items: PathItem[], graph: ImportGraph) {
  const imported = new Set([...graph.values()].flatMap((imports) => [...imports]));
  const groupOf = cycleGroups(graph);
  const depths = new Map<string, number>();

  function depth(file: string): number {
    const known = depths.get(file);
    if (known !== undefined) return known;
    const members = groupOf(file);
    const outside = members
      .flatMap((member) => [...(graph.get(member) ?? [])])
      .filter((dependency) => !members.includes(dependency));
    const start = Math.max(-1, ...outside.map(groupDepth)) + 1;
    members.forEach((member, rank) => {
      depths.set(member, start + rank);
    });
    return depths.get(file) ?? start;
  }

  function groupDepth(file: string) {
    return Math.max(...groupOf(file).map(depth));
  }

  return items
    .map((item, index) => ({
      item,
      index,
      unimported: !imported.has(item.file),
      depth: depth(item.file),
    }))
    .toSorted(
      (left, right) =>
        Number(left.unimported) - Number(right.unimported) ||
        left.depth - right.depth ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}
