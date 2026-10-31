import { z } from "zod";
import { type EvalResult, gradeDimensions, gradesSchema } from "../../shared/eval-result.ts";
import { table } from "./score-table.ts";

export const humanGradesSchema = z.array(
  gradesSchema.extend({ case: z.number().int().nonnegative() }),
);

type HumanGrades = z.infer<typeof humanGradesSchema>;

export function formatCalibration(result: EvalResult, humans: HumanGrades) {
  const pairs = humans.flatMap((human) => {
    const item = result.cases[human.case];
    if (item === undefined) {
      throw new Error(`The result has no case ${human.case} (it has ${result.cases.length})`);
    }
    return item.runs.flatMap((run) =>
      run.grades === undefined ? [] : [{ human, judge: run.grades }],
    );
  });
  if (pairs.length === 0) return "No judge grades to compare. Run the eval with --judge.\n";
  const rows = gradeDimensions.map((name) => {
    const gaps = pairs.map(({ human, judge }) => Math.abs(human[name] - judge[name]));
    const exact = gaps.filter((gap) => gap === 0).length;
    const near = gaps.filter((gap) => gap <= 1).length;
    return [name, `${exact}/${pairs.length}`, `${near}/${pairs.length}`];
  });
  return `${table([["dimension", "exact", "within 1"], ...rows])}
`;
}
