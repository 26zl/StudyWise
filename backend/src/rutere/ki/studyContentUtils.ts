import type { TargetedQuery } from "./ki.js";

export function extractJsonArray(text: string): string {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("AI_RESPONSE_NOT_JSON_ARRAY");
  }
  return cleaned.slice(start, end + 1);
}

export function createCourseTargetedQuery(
  courseId: number,
  courseName: string,
  moduleNames: string[],
): TargetedQuery {
  return {
    courseIdHint: courseId,
    courseHint: courseName,
    moduleHint: moduleNames[0] ?? null,
    fileHint: null,
  };
}
