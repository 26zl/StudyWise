import type { UIPreferences } from "common/auth";

// Slår sammen UI-preferanser uten å miste felter som allerede finnes lokalt.
export function mergeUIPreferences(
  current: UIPreferences | undefined,
  updated: UIPreferences | undefined,
): UIPreferences | undefined {
  if (!updated) {
    return current;
  }

  return {
    ...(current ?? {}),
    ...updated,
  };
}
