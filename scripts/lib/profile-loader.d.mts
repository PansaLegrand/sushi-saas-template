export const DEVELOPMENT_APP_FILES: readonly string[];
export const DEVELOPMENT_STUDIO_FILES: readonly string[];

export type LoadedProfile = {
  path: string;
  relativePath: string;
  values: Record<string, string>;
};

export function readFirstProfile(
  root: string,
  candidates: readonly string[],
): LoadedProfile | null;

export function loadDevelopmentAppProfile(root: string): LoadedProfile | null;
