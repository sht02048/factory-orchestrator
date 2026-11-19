import * as stylex from "@stylexjs/stylex";
import { Button, KanbanCard, StatusPill, buttonStyles } from "@ganger/ui";
import { useId } from "react";
import type { ReactNode, Ref } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { HomeRun } from "@ganger/app/home/model";
import { todoTagOf } from "@ganger/app/home/model";
import { questionSummary } from "@ganger/app/question";
import { RunKey, useRunText } from "./run-text";

export type SheetMode = "summary" | "answer";

interface CardParts {
  detail?: ReactNode;
  meta?: ReactNode;
  time?: ReactNode;
  action?: ReactNode;
}

export function RunCard({
  run,
  tagged,
  all,
  selected,
  openRef,
  onOpen,
}: {
  run: HomeRun;
  tagged: boolean;
  all: boolean;
  selected: boolean;
  openRef: Ref<HTMLButtonElement>;
  onOpen: (mode: SheetMode) => void;
}) {
  const tag = tagged ? todoTagOf(run) : null;
  const titleId = useId();
  const parts = useCardParts(run, tag !== null, all, titleId, onOpen);
  const statusName = useRunText().statusName;
  return (
    <li data-run={run.id} data-tag={tag ?? undefined}>
      <KanbanCard
        {...(tag === null ? {} : { tag: <StatusPill status={tag}>{statusName(tag)}</StatusPill> })}
        title={<RunKey run={run} />}
        titleId={titleId}
        {...parts}
        selected={selected}
        openRef={openRef}
        onOpen={() => onOpen("summary")}
      />
    </li>
  );
}

function useCardParts(
  run: HomeRun,
  tagged: boolean,
  all: boolean,
  titleId: string,
  onOpen: (mode: SheetMode) => void,
): CardParts {
  const t = useTranslations("home.card");
  const text = useRunText();
  const { ago, elapsed } = useTime();
  const withFlags = (line: string) => (run.cancelling ? `${line} · ${t("cancelling")}` : line);
  const runner = withFlags(text.runnerLine(run, all));
  const workspace = all ? ` · ${run.workspace.name}` : "";
  switch (run.state) {
    case "queued":
      return { detail: text.queued(run), meta: runner, time: elapsed(run.waitMs) };
    case "running":
      return {
        meta: runner,
        ...(run.executionMs === null ? {} : { time: elapsed(run.executionMs) }),
      };
    case "waiting-for-input": {
      const time = run.waitingMs === null ? {} : { time: elapsed(run.waitingMs) };
      const input = run.input;
      if (input === null) return { detail: t("inputUnknown"), meta: runner, ...time };
      switch (input.kind) {
        case "question":
          return input.answered
            ? { detail: questionSummary(input.body, input.choices), meta: t("answered"), ...time }
            : {
                detail: questionSummary(input.body, input.choices),
                meta: runner,
                ...time,
                action: (
                  <Button
                    variant="secondary"
                    aria-describedby={titleId}
                    onClick={() => onOpen("answer")}
                  >
                    {t("answer")}
                  </Button>
                ),
              };
        case "permission":
          return {
            detail: t("permission", { command: input.detail }),
            meta: input.denied ? t("denied") : runner,
            ...time,
          };
      }
      return {};
    }
    case "disconnected":
      return { detail: text.unreachable(run), meta: withFlags(text.agentName(run.agent)) };
    case "ended": {
      const time = ago(run.endedAt, run.endedAgoMs);
      const pr = run.pullRequest;
      const prLine = pr === null ? null : t("pullRequest", { pr: pr.displayId });
      if (tagged && run.summary === "human-check")
        return {
          meta: `${prLine ?? t("humanCheckNoPr")}${workspace}`,
          time,
          ...(pr === null
            ? {}
            : {
                action: (
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    data-variant="secondary"
                    aria-describedby={titleId}
                    {...stylex.props(...buttonStyles("secondary"))}
                  >
                    {t("openPr")}
                  </a>
                ),
              }),
        };
      if (tagged && run.summary === "failed")
        return { detail: text.agentResult(run), meta: runner, time };
      return {
        meta: [text.statusName(run.summary), prLine, all ? run.workspace.name : null]
          .filter((part) => part !== null)
          .join(" · "),
        time,
      };
    }
  }
}
