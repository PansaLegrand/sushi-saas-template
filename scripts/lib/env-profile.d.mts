export type EnvironmentProfile = "development" | "production";

export const PROFILE_FILES: Record<
  EnvironmentProfile,
  { app: string; studio: string }
>;

export function normalizeProfile(
  value: string | undefined,
): EnvironmentProfile | null;

export function readEnvValue(contents: string, key: string): string;
export function formatEnvValue(value: string): string;
export function isSetupPlaceholder(value: string): boolean;
export function setEnvValue(
  contents: string,
  key: string,
  value: string,
  options?: { overwrite?: boolean },
): string;
export function applyEnvValues(
  contents: string,
  values: Record<string, string>,
  options?: { overwrite?: boolean },
): string;
export function prepareAppProfile(
  contents: string,
  profile: EnvironmentProfile,
  secret: (encoding: "base64" | "hex") => string,
): string;
export function prepareStudioProfile(
  contents: string,
  profile: EnvironmentProfile,
  secret: (encoding: "base64" | "hex") => string,
): string;
