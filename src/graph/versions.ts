import api, { route } from "@forge/api";

import { versionAri } from "./queries";

/**
 * Project versions, for the page's release picker.
 *
 * This is the one place the app uses Jira REST rather than the Teamwork Graph, and
 * only because the graph has no curated query for "the versions of this project".
 * It is scoped to a single project, so the extra `read:jira-work` scope buys one
 * dropdown and nothing else.
 */

export interface ProjectVersion {
  /** Jira's version id. Needed to build the version's graph ARI. */
  id: string;
  name: string;
  released: boolean;
  releaseDate?: string;
}

/**
 * Unreleased first, then most recent release date, then name. A release gate is
 * used before shipping, so the next unreleased version is the default choice.
 */
export function sortVersions(versions: ProjectVersion[]): ProjectVersion[] {
  return [...versions].sort((a, b) => {
    if (a.released !== b.released) return a.released ? 1 : -1;
    const byDate = (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
    return byDate !== 0 ? byDate : b.name.localeCompare(a.name, undefined, { numeric: true });
  });
}

export async function listProjectVersions(projectKey: string): Promise<ProjectVersion[]> {
  const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectKey}/versions`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Jira returned ${response.status} when listing versions for ${projectKey}`);
  }

  const body = (await response.json()) as unknown;
  const raw = Array.isArray(body) ? body : [];

  const versions = raw
    .map((value) => {
      if (!value || typeof value !== "object") return undefined;
      const record = value as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : undefined;
      const id = record.id === undefined || record.id === null ? undefined : String(record.id);
      if (!name || !id) return undefined;
      return {
        id,
        name,
        released: record.released === true,
        ...(typeof record.releaseDate === "string" ? { releaseDate: record.releaseDate } : {}),
      } satisfies ProjectVersion;
    })
    .filter((version): version is ProjectVersion => version !== undefined);

  // `first` does not apply here, but an unbounded project would still be a huge
  // dropdown: the picker shows the 25 most relevant versions.
  return sortVersions(versions).slice(0, 25);
}

/**
 * Graph ARI for a version, looked up by the name the user actually said.
 *
 * The graph only filters nodes on `ari`, so the name has to be turned into an id
 * somewhere, and Jira REST is the only place that mapping exists. Returns undefined
 * rather than throwing: an unknown version becomes an honest "could not resolve"
 * caveat instead of a failed page.
 */
export async function resolveVersionAri(
  projectKey: string,
  versionName: string,
  cloudId: string | undefined,
): Promise<string | undefined> {
  if (!cloudId) return undefined;

  try {
    const versions = await listProjectVersions(projectKey);
    const match = versions.find(
      (version) => version.name.trim().toLowerCase() === versionName.trim().toLowerCase(),
    );
    return match === undefined ? undefined : versionAri(cloudId, match.id);
  } catch {
    return undefined;
  }
}
