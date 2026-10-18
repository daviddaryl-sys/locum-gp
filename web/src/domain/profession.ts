export type Profession = "gp" | "pharmacist";

export const PROFESSIONS = [
  { value: "gp", label: "GP" },
  { value: "pharmacist", label: "Pharmacist" },
] as const;

export function parseProfession(value: unknown): Profession | null {
  return value === "gp" || value === "pharmacist" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readProfession(settings: unknown): Profession | null {
  if (!isRecord(settings) || !isRecord(settings.profile)) return null;
  return parseProfession(settings.profile.profession);
}

export function mergeProfession(
  settings: Record<string, unknown>,
  profession: Profession,
): Record<string, unknown> {
  const profile = isRecord(settings.profile) ? settings.profile : {};

  return {
    ...settings,
    profile: {
      ...profile,
      profession,
    },
  };
}
