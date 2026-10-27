import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { pickSelection } from "./selection.ts";

const doc = "export async function uploadClip(path: string) {\n  return path;\n}\n";

function stateWith(selection: EditorSelection) {
  return EditorState.create({ doc, selection });
}

describe("pickSelection", () => {
  it("turns selected text into its lines and exact text", () => {
    const from = doc.indexOf("return");
    const state = stateWith(EditorSelection.single(from, from + "return path;".length));

    expect(pickSelection(state, "src/upload.ts")).toEqual({
      file: "src/upload.ts",
      start: 2,
      end: 2,
      text: "return path;",
    });
  });

  it("covers every line a multi-line selection touches", () => {
    const state = stateWith(EditorSelection.single(7, doc.indexOf("}\n", 40) + 1));

    expect(pickSelection(state, "a.ts")).toMatchObject({ start: 1, end: 3 });
  });

  it("does not count the next line when the selection ends at its very start", () => {
    const state = stateWith(EditorSelection.single(0, doc.indexOf("  return")));

    expect(pickSelection(state, "a.ts")).toMatchObject({ start: 1, end: 1 });
  });

  it("selects the line of a clicked symbol with the identifier as the text", () => {
    const state = stateWith(EditorSelection.single(doc.indexOf("uploadClip") + 3));

    expect(pickSelection(state, "a.ts")).toEqual({
      file: "a.ts",
      start: 1,
      end: 1,
      text: "uploadClip",
    });
  });

  it("picks nothing for a click that is not on a symbol", () => {
    const state = stateWith(EditorSelection.single(doc.indexOf("  return") + 1));

    expect(pickSelection(state, "a.ts")).toBeUndefined();
  });

  it("picks nothing for a selection of only whitespace", () => {
    const from = doc.indexOf("  return");
    const state = stateWith(EditorSelection.single(from, from + 2));

    expect(pickSelection(state, "a.ts")).toBeUndefined();
  });
});
