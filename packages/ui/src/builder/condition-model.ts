/**
 * @file The choices a condition offers (RFC-010): which tests suit a field,
 *   whether a `when:` can be shown as rows at all, and what a new edge starts
 *   with, so it's never left in a state the checks would refuse.
 */

import {
  type Condition,
  type ConditionRow,
  type ConditionTest,
  conditionText,
  type NodeSays,
  oppositeOf,
  type SaidField,
  type WorkflowEdit,
  type WorkflowGraph,
} from "@krapht/ork-server/client";

type Edge = WorkflowGraph["edges"][number];

const NOTHING: NodeSays = { fields: [], canFail: false, canDeclare: false };

/** Rounds a new loop starts with: a few, and it's there to change. */
const LOOP_ROUNDS = 3;

export const saysOf = (graph: WorkflowGraph, id: string): NodeSays =>
  graph.says?.[id] ?? NOTHING;

export const TEST_LABELS: Readonly<Record<ConditionTest, string>> = {
  is: "is",
  isnt: "isn't",
  above: "is above",
  atLeast: "is at least",
  below: "is below",
  atMost: "is at most",
  contains: "contains",
  anyIs: "any is",
  allAre: "all are",
  isTrue: "is true",
  isFalse: "is false",
};

const TESTS: Readonly<Record<SaidField["kind"], readonly ConditionTest[]>> = {
  values: ["is", "isnt"],
  statuses: ["anyIs", "allAre"],
  number: ["above", "atLeast", "below", "atMost", "is", "isnt"],
  boolean: ["isTrue", "isFalse"],
  text: ["contains", "is", "isnt"],
};

export const testsFor = (field: SaidField): readonly ConditionTest[] =>
  TESTS[field.kind];

export const needsValue = (test: ConditionTest): boolean =>
  test !== "isTrue" && test !== "isFalse";

/** A list can't be compared, so no condition's choices offer one (L208). */
export const comparable = (fields: readonly SaidField[]): SaidField[] =>
  fields.filter(({ items }) => items === undefined);

/** Whether the choices can say this: a field, test and value they offer. */
const rowFits = (row: ConditionRow, fields: readonly SaidField[]): boolean => {
  const said = comparable(fields).find(({ field }) => field === row.field);
  if (said === undefined || !testsFor(said).includes(row.test)) return false;
  if (said.values === undefined || row.value === undefined) return true;
  return said.values.includes(row.value);
};

/**
 * The condition to show. What the choices can't say, a typed value on a list or
 * a field nothing declares, stays as the author wrote it, to be seen and
 * fixed.
 */
export const shownCondition = (
  { condition, when }: Pick<Edge, "condition" | "when">,
  says: NodeSays,
): Condition => {
  const read = condition ?? { mode: "succeeds" as const };
  return read.mode === "test" &&
    !read.rows.every(row => rowFits(row, says.fields))
    ? { mode: "hand", text: when ?? "" }
    : read;
};

/** A first row for this field, with its first value if it has them. */
export const rowFor = (
  field: SaidField,
  value?: ConditionRow["value"],
): ConditionRow => {
  const test = testsFor(field)[0] ?? "is";
  if (!needsValue(test)) return { field: field.field, test };
  const first = field.values?.[0] ?? (field.kind === "number" ? 0 : "");
  return { field: field.field, test, value: value ?? first };
};

/** The row a new test starts from: a field with values, if there is one. */
export const firstRow = (
  says: NodeSays,
  prefer?: string,
): ConditionRow | undefined => {
  const fields = comparable(says.fields);
  const listed = fields.find(({ values }) => (values ?? []).length > 0);
  const field = listed ?? fields[0];
  if (field === undefined) return undefined;
  const value =
    field.values?.includes(prefer ?? "") === true ? prefer : undefined;
  return rowFor(field, value);
};

const answersOf = (says: NodeSays): readonly string[] =>
  says.fields.flatMap(({ field, values }) =>
    field === "choice" ? (values ?? []).map(String) : [],
  );

const handles = ({ condition }: Edge, answer: string): boolean =>
  condition === undefined ||
  condition.mode === "succeeds" ||
  (condition.mode === "test" &&
    condition.rows.some(
      ({ test, value }) => test === "is" && value === answer,
    ));

/** A gate's answers no edge follows, which end the run. */
export const unhandledAnswers = (
  graph: WorkflowGraph,
  id: string,
): readonly string[] => {
  const out = graph.edges.filter(({ from }) => from === id);
  return out.length === 0
    ? []
    : answersOf(saysOf(graph, id)).filter(
        answer => !out.some(edge => handles(edge, answer)),
      );
};

const reaches = (graph: WorkflowGraph, from: string, to: string): boolean => {
  const seen = new Set([from]);
  const queue = [from];
  for (const at of queue) {
    for (const edge of graph.edges) {
      if (edge.from === at && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen.has(to);
};

const testOn = (row: ConditionRow | undefined): string | undefined =>
  row === undefined
    ? undefined
    : conditionText({ mode: "test", join: "all", rows: [row] });

/** What a new edge's condition starts as. */
const startingWhen = (
  graph: WorkflowGraph,
  from: string,
  to: string,
): string | undefined => {
  const says = saysOf(graph, from);
  if (reaches(graph, to, from)) {
    return testOn(firstRow(says, "changes_requested"));
  }
  const out = graph.edges.filter(edge => edge.from === from);
  const answers = answersOf(says);
  if (answers.length > 0) {
    // Its next answer no edge follows; with no edges yet, that's its first.
    const [answer] = out.length === 0 ? answers : unhandledAnswers(graph, from);
    return answer === undefined
      ? undefined
      : testOn({ field: "choice", test: "is", value: answer });
  }
  const loop = out.find(({ maxRounds }) => maxRounds !== undefined);
  if (loop?.condition !== undefined) return oppositeOf(loop.condition);
  const type = graph.nodes.find(({ id }) => id === from)?.type;
  return type === "control.router"
    ? (testOn(firstRow(says)) ?? "true")
    : undefined;
};

/**
 * Connects two nodes with what the edge needs from the start: a gate's next
 * answer, a router's test, a way out of a loop, or a closed loop's condition
 * and rounds.
 */
export const connectEdit = (
  graph: WorkflowGraph,
  from: string,
  to: string,
): WorkflowEdit => {
  const when = startingWhen(graph, from, to);
  return {
    op: "connect",
    from,
    to,
    ...(when === undefined ? {} : { when }),
    ...(reaches(graph, to, from) ? { maxRounds: LOOP_ROUNDS } : {}),
  };
};
