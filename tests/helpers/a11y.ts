import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function formatViolations(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 3)
        .map((node) => `  - ${node.target.join(" ")}`)
        .join("\n");
      return `${violation.id} [${violation.impact ?? "unknown"}]: ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

export async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  expect(
    seriousViolations,
    seriousViolations.length > 0
      ? `Axe fant alvorlige tilgjengelighetsfeil:\n\n${formatViolations(seriousViolations)}`
      : undefined,
  ).toHaveLength(0);
}
