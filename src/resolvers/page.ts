import Resolver from "@forge/resolver";

import { createForgeGraphClient } from "../graph/forge-client";
import { listProjectVersions, type ProjectVersion } from "../graph/versions";
import {
  accountIdFromContext,
  buildPageView,
  parsePageRequest,
  projectKeyFromContext,
} from "../tools/page-report";
import type { PageView } from "../frontend/view";

/**
 * Resolver for the Jira project page.
 *
 * Two calls, both read-only: list the project's versions for the picker, then score
 * one of them. The project key is read from the resolver context, not from the
 * browser payload, so the page can only ever ask about its own project.
 */

interface ResolverRequest {
  payload?: unknown;
  context?: unknown;
}

export type ListVersionsResult =
  | { ok: true; projectKey: string; versions: ProjectVersion[]; defaultVersion?: string }
  | { ok: false; message: string };

export type ReadinessResult = { ok: true; view: PageView } | { ok: false; message: string };

const resolver = new Resolver();

resolver.define("listVersions", async (req: ResolverRequest): Promise<ListVersionsResult> => {
  const projectKey = projectKeyFromContext(req.context);
  if (!projectKey) {
    return {
      ok: false,
      message:
        "This page could not work out which project it is on. Open Ship Confidence from a Jira project page.",
    };
  }

  try {
    const versions = await listProjectVersions(projectKey);
    const next = versions.find((version) => !version.released);

    return {
      ok: true,
      projectKey,
      versions,
      ...(next === undefined ? {} : { defaultVersion: next.name }),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Could not list versions: ${error.message}`
          : "Could not list versions for this project.",
    };
  }
});

resolver.define("getReadiness", async (req: ResolverRequest): Promise<ReadinessResult> => {
  const contextProjectKey = projectKeyFromContext(req.context);
  const request = parsePageRequest({
    payload: req.payload,
    ...(contextProjectKey === undefined ? {} : { contextProjectKey }),
  });

  if (request.kind === "missing") {
    return {
      ok: false,
      message: `This page needs a ${request.missing.join(" and ")} before it can score a release.`,
    };
  }

  const accountId = accountIdFromContext(req.context);

  const view = await buildPageView(
    { client: createForgeGraphClient() },
    {
      projectKey: request.projectKey,
      versionName: request.versionName,
      ...(accountId === undefined ? {} : { accountId }),
    },
  );

  return { ok: true, view };
});

export const handler = resolver.getDefinitions();
