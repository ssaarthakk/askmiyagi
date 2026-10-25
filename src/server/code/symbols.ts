import type { Node } from "web-tree-sitter";
import type { Result } from "../../shared/result.ts";
import type { symbolKinds } from "../../shared/tool-inputs.ts";

type SymbolKind = (typeof symbolKinds)[number];
export type SymbolDefinition = {
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  node: Node;
  signature: string;
  exported: boolean;
  container?: "class" | "interface";
};
type Context = { prefix: string; exported: boolean; ambient: boolean };

const declarationKinds = new Map<string, SymbolKind>([
  ["function_declaration", "function"],
  ["generator_function_declaration", "function"],
  ["function_signature", "function"],
  ["class_declaration", "class"],
  ["abstract_class_declaration", "class"],
  ["interface_declaration", "interface"],
  ["type_alias_declaration", "type"],
]);
const memberKinds = new Map<string, SymbolKind>([
  ["method_definition", "method"],
  ["method_signature", "method"],
  ["abstract_method_signature", "method"],
  ["public_field_definition", "variable"],
  ["field_definition", "variable"],
  ["property_signature", "variable"],
]);
const functionValues = ["arrow_function", "function_expression", "generator_function"];

export function compact(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function textBefore(node: Node, end: Node | null) {
  return compact(end ? node.text.slice(0, end.startIndex - node.startIndex) : node.text);
}

function nodeName(node: Node) {
  return (node.childForFieldName("name") ?? node.childForFieldName("property"))?.text;
}

function bindingNames(node: Node): string[] {
  if (["identifier", "shorthand_property_identifier_pattern"].includes(node.type)) {
    return [node.text];
  }
  if (node.type === "pair_pattern") {
    const value = node.childForFieldName("value");
    return value ? bindingNames(value) : [];
  }
  if (node.type === "assignment_pattern" || node.type === "object_assignment_pattern") {
    const left = node.childForFieldName("left") ?? node.namedChildren[0];
    return left ? bindingNames(left) : [];
  }
  if (["object_pattern", "array_pattern", "rest_pattern"].includes(node.type)) {
    return node.namedChildren.flatMap(bindingNames);
  }
  return [];
}

export function findDefinitions(root: Node, path: string) {
  const found: SymbolDefinition[] = [];

  function addMembers(
    parent: SymbolDefinition,
    container: "class" | "interface",
    ambient: boolean,
  ) {
    for (const member of parent.node.childForFieldName("body")?.namedChildren ?? []) {
      const kind = memberKinds.get(member.type);
      const name = nodeName(member);
      if (
        !kind ||
        !name ||
        (container === "class" && member.type === "method_signature" && !ambient)
      )
        continue;
      found.push({
        kind,
        name,
        qualifiedName: `${parent.name}.${name}`,
        node: member,
        signature: textBefore(member, member.childForFieldName("body")),
        exported: false,
        container,
      });
    }
  }

  function addVariables(node: Node, context: Context) {
    const keyword = node.childForFieldName("kind")?.text ?? "var";
    for (const declarator of node.namedChildren) {
      if (declarator.type !== "variable_declarator") continue;
      const value = declarator.childForFieldName("value");
      const isFunction =
        keyword === "const" && value !== null && functionValues.includes(value.type);
      const end = isFunction ? value.childForFieldName("body") : value;
      const declared = textBefore(declarator, end).replace(/\s*=$/, "");
      const signature = compact(`${context.prefix}${keyword} ${declared}`);
      const binding = declarator.childForFieldName("name");
      for (const name of binding ? bindingNames(binding) : []) {
        found.push({
          kind: isFunction ? "function" : "variable",
          name,
          qualifiedName: name,
          node: declarator,
          signature,
          exported: context.exported,
        });
      }
    }
  }

  function visit(node: Node, context: Context) {
    if (node.type === "export_statement" || node.type === "ambient_declaration") {
      for (const child of node.namedChildren) {
        visit(child, {
          prefix: context.prefix + node.text.slice(0, child.startIndex - node.startIndex),
          exported: context.exported || node.type === "export_statement",
          ambient: context.ambient || node.type === "ambient_declaration",
        });
      }
      return;
    }
    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      addVariables(node, context);
      return;
    }
    const kind = declarationKinds.get(node.type);
    const name = nodeName(node);
    if (!kind || !name || (node.type === "function_signature" && !context.ambient)) return;
    const definition: SymbolDefinition = {
      kind,
      name,
      qualifiedName: name,
      node,
      signature: compact(context.prefix + textBefore(node, node.childForFieldName("body"))),
      exported: context.exported,
    };
    found.push(definition);
    if (kind === "class" || kind === "interface") addMembers(definition, kind, context.ambient);
  }

  for (const child of root.namedChildren) {
    visit(child, { prefix: "", exported: false, ambient: /\.d\.[mc]?ts$/.test(path) });
  }
  return found;
}

export function matchesName(definition: SymbolDefinition, name: string) {
  return definition.name === name || definition.qualifiedName === name;
}

export function lineRange(node: Node) {
  return `${node.startPosition.row + 1}-${node.endPosition.row + 1}`;
}

export function uniqueDefinition(
  root: Node,
  path: string,
  symbol: string,
): Result<SymbolDefinition> {
  const candidates = findDefinitions(root, path).filter((definition) =>
    matchesName(definition, symbol),
  );
  const [candidate] = candidates;
  if (!candidate) return { ok: false, error: `Symbol not found: ${symbol}` };
  if (candidates.length > 1) {
    const names = candidates
      .map(({ qualifiedName, node }) => `${qualifiedName} ${lineRange(node)}`)
      .join(", ");
    return { ok: false, error: `Symbol is ambiguous: ${symbol}. Candidates: ${names}` };
  }
  return { ok: true, value: candidate };
}

export function signatureDefinitions(root: Node, path: string) {
  return findDefinitions(root, path).filter(
    (definition, index, all) =>
      (definition.kind !== "variable" ||
        definition.exported ||
        definition.container === "interface") &&
      definition.node.id !== all[index - 1]?.node.id,
  );
}
