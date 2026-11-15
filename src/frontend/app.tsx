import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@forge/bridge";
import ForgeReconciler, {
  Badge,
  Box,
  Heading,
  Inline,
  Link,
  ProgressBar,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
} from "@forge/react";

import type { PageTone, PageView } from "./view";

/**
 * The Jira project page.
 *
 * Deliberately thin: it holds a selected version and renders whatever the resolver
 * returns. Every sentence, tone and ordering decision lives in `view.ts`, so what
 * the page shows and what an agent says come from the same code.
 *
 * `render: native` in the manifest pairs this file with the resolver function.
 */

interface VersionOption {
  label: string;
  value: string;
}

type VersionsResponse =
  | { ok: true; projectKey: string; versions: Array<{ name: string; released: boolean }>; defaultVersion?: string }
  | { ok: false; message: string };

type ReadinessResponse = { ok: true; view: PageView } | { ok: false; message: string };

/** A Select change can arrive as an option, a list of them, or a bare value. */
function optionValue(option: unknown): string | undefined {
  if (typeof option === "string") return option;
  if (Array.isArray(option)) return optionValue(option[0]);
  if (option && typeof option === "object" && "value" in option) {
    const value = (option as { value?: unknown }).value;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function badgeAppearance(tone: PageTone): "success" | "warning" | "important" | "default" {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "critical":
      return "important";
    case "unknown":
      return "default";
  }
}

/** ProgressBar only accepts `success | default | inverse`, so the score is also printed. */
function progressAppearance(tone: PageTone): "success" | "default" {
  return tone === "success" ? "success" : "default";
}

function severityAppearance(severity: "blocker" | "warning" | "info"): "important" | "warning" | "default" {
  if (severity === "blocker") return "important";
  if (severity === "warning") return "warning";
  return "default";
}

const App = () => {
  const [projectKey, setProjectKey] = useState<string>();
  const [options, setOptions] = useState<VersionOption[]>([]);
  const [selected, setSelected] = useState<VersionOption>();
  const [view, setView] = useState<PageView>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    invoke<VersionsResponse>("listVersions")
      // `invoke` is typed as a union with an envelope variant, so the response is
      // narrowed explicitly at the boundary rather than trusted by the compiler.
      .then((raw) => {
        const result = raw as unknown as VersionsResponse;
        if (cancelled) return;
        if (!result.ok) {
          setError(result.message);
          setLoading(false);
          return;
        }

        const list = result.versions.map((version) => ({
          label: version.released ? `${version.name} (released)` : version.name,
          value: version.name,
        }));

        setProjectKey(result.projectKey);
        setOptions(list);

        const initial = result.defaultVersion ?? list[0]?.value;
        const match = list.find((option) => option.value === initial);
        if (match) setSelected(match);
        else setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not load versions.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (versionName: string) => {
    setLoading(true);
    setError(undefined);

    try {
      const raw = await invoke<ReadinessResponse>("getReadiness", { versionName });
      const result = raw as unknown as ReadinessResponse;
      if (result.ok) setView(result.view);
      else setError(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not score this release.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) void load(selected.value);
  }, [selected, load]);

  return (
    <Box padding="space.200">
      <Stack space="space.200">
        <Inline spread="space-between" alignBlock="center">
          <Stack space="space.050">
            <Heading size="medium">Ship Confidence</Heading>
            <Text size="small" color="color.text.subtlest">
              {projectKey ? `Release gate for ${projectKey}` : "Release gate"}
            </Text>
          </Stack>

          {options.length > 0 ? (
            <Box>
              <Select
                options={options}
                value={selected}
                placeholder="Pick a version"
                onChange={(option: unknown) => {
                  const value = optionValue(option);
                  const match = options.find((candidate) => candidate.value === value);
                  if (match) setSelected(match);
                }}
              />
            </Box>
          ) : null}
        </Inline>

        {error !== undefined ? (
          <SectionMessage appearance="error" title="This release could not be scored">
            <Text>{error}</Text>
          </SectionMessage>
        ) : null}

        {/* A project with no versions has nothing to score. Without this the page
            renders its header and looks broken. */}
        {error === undefined && !loading && options.length === 0 ? (
          <SectionMessage appearance="information" title="No versions to score">
            <Text>
              This space has no Jira versions yet. Add one in Space settings then reload this page.
            </Text>
          </SectionMessage>
        ) : null}

        {view === undefined && loading ? (
          <Box>
            <Spinner size="medium" />
          </Box>
        ) : null}

        {view !== undefined ? (
          <Stack space="space.200">
            {view.notice !== undefined ? (
              <SectionMessage appearance="warning" title="Partial picture">
                <Text>{view.notice}</Text>
              </SectionMessage>
            ) : null}

            <Box padding="space.200">
              <Stack space="space.100">
                <Inline space="space.100" alignBlock="center">
                  <Badge appearance={badgeAppearance(view.tone)}>{view.verdictLabel}</Badge>
                  <Text weight="medium">
                    {view.projectKey} {view.versionName}
                  </Text>
                </Inline>

                <Text size="small" color="color.text.subtlest">
                  {view.countLine}
                </Text>

                <Inline space="space.100" alignBlock="center">
                  <ProgressBar value={view.score} appearance={progressAppearance(view.tone)} />
                  <Text weight="medium">{view.score}/100</Text>
                </Inline>

                <Text>{view.nextStep}</Text>
              </Stack>
            </Box>

            {view.factors.length > 0 ? (
              <Stack space="space.100">
                <Heading size="small">Risk factors</Heading>
                {view.factors.map((factor) => (
                  <Box key={factor.id} padding="space.100">
                    <Stack space="space.050">
                      <Inline space="space.100" alignBlock="center">
                        <Badge appearance={severityAppearance(factor.severity)}>
                          {factor.severity}
                        </Badge>
                        <Text weight="medium">{factor.title}</Text>
                        <Text size="small" color="color.text.subtlest">
                          −{factor.penalty}
                        </Text>
                      </Inline>

                      {factor.detail.length > 0 ? <Text size="small">{factor.detail}</Text> : null}

                      {factor.url !== undefined ? (
                        <Link href={factor.url} openNewTab>
                          {factor.workItemKey ?? "Open in Jira"}
                        </Link>
                      ) : null}
                    </Stack>
                  </Box>
                ))}

                {view.factorsTruncated ? (
                  <Text size="small" color="color.text.subtlest">
                    Showing the {view.factors.length} highest-severity factors. Ask the agent for the
                    full list.
                  </Text>
                ) : null}
              </Stack>
            ) : null}

            <Stack space="space.100">
              <Heading size="small">What this answer could read</Heading>
              {view.coverage.map((entry) => (
                <Inline key={entry.source} space="space.100" alignBlock="center">
                  <Badge appearance={badgeAppearance(entry.tone)}>{entry.status}</Badge>
                  <Text size="small">{entry.label}</Text>
                  {entry.detail !== undefined ? (
                    <Text size="small" color="color.text.subtlest">
                      {entry.detail}
                    </Text>
                  ) : null}
                </Inline>
              ))}
            </Stack>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
};

/**
 * A native UI Kit resource must mount itself: exporting the component is not
 * enough, and the page renders blank if this call is missing.
 */
ForgeReconciler.render(<App />);

export default App;
