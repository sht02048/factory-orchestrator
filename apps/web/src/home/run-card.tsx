import * as stylex from "@stylexjs/stylex";
import { Button, KanbanCard, Menu, MenuItem, MoreIcon, StatusPill, buttonStyles } from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import type { RunControl } from "@ganger/core";
import { useId, useState } from "react";
import type { ReactNode, Ref } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { HomeRun } from "@ganger/app/home/model";
import { todoTagOf } from "@ganger/app/home/model";
import { availableRunControl } from "@ganger/app/run-control-view";
import type { RunControlView } from "@ganger/app/run-control-view";
import { RunKey, useRunText } from "./run-text";

export type SheetMode = "summary" | "answer";

interface CardParts {
  detail?: ReactNode;
  meta?: ReactNode;
  time?: ReactNode;
  action?: ReactNode;
  menu?: ReactNode;
}

export function RunCard({
  run,
  tagged,
  all,
  selected,
  openRef,
  onOpen,
  onControl,
}: {
  run: HomeRun;
  tagged: boolean;
  all: boolean;
  selected: boolean;
  openRef: Ref<HTMLButtonElement>;
  onOpen: (mode: SheetMode) => void;
  onControl: (control: RunControl) => Promise<void>;
}) {
  const todoTag = tagged ? todoTagOf(run) : null;
  const tag: PillStatus | null = todoTag ?? (run.state === "paused" ? "paused" : null);
  const titleId = useId();
  const [sending, setSending] = useState(false);
  const control = (kind: RunControl): void => {
    setSending(true);
    void onControl(kind).finally(() => setSending(false));
  };
  const parts = useCardParts(run, todoTag !== null, all, titleId, onOpen, {
    onControl: control,
    sending,
  });
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
  { onControl, sending }: { onControl: (control: RunControl) => void; sending: boolean },
): CardParts {
  const t = useTranslations("home.card");
  const tDomain = useTranslations("domain");
  const text = useRunText();
  const { ago, elapsed } = useTime();
  const controlFlag = controlPendingKey(run.control);
  const withFlags = (line: string) =>
    [line, run.cancelling ? t("cancelling") : null, controlFlag === null ? null : t(controlFlag)]
      .filter((part) => part !== null)
      .join(" · ");
  const runner = withFlags(text.runnerLine(run, all));
  const available = availableRunControl(run.state, run.cancelling, run.control);
  const failed =
    run.control?.status === "failed"
      ? {
          detail: t(run.control.control === "pause" ? "pauseFailed" : "resumeFailed", {
            reason: tDomain(`runControlFailure.${run.control.reason}`),
          }),
        }
      : {};
  const workspace = all ? ` · ${run.workspace.name}` : "";
  switch (run.state) {
    case "queued":
      return { detail: text.queued(run), meta: runner, time: elapsed(run.waitMs) };
    case "running":
      return {
        ...failed,
        meta: runner,
        ...(run.executionMs === null ? {} : { time: elapsed(run.executionMs) }),
        ...(available === "pause"
          ? {
              menu: (
                <Menu
                  variant="icon"
                  label={t("menu", { key: run.ticketKey })}
                  trigger={<MoreIcon />}
                >
                  <MenuItem value="pause" onSelect={() => onControl("pause")}>
                    {t("pause")}
                  </MenuItem>
                </Menu>
              ),
            }
          : {}),
      };
    case "paused":
      return {
        ...failed,
        meta: runner,
        ...(run.pausedMs === null
          ? {}
          : { time: t("pausedFor", { elapsed: elapsed(run.pausedMs) }) }),
        ...(available === "resume"
          ? {
              action: (
                <Button
                  variant="secondary"
                  aria-describedby={titleId}
                  disabled={sending}
                  onClick={() => onControl("resume")}
                >
                  {t("resume")}
                </Button>
              ),
            }
          : {}),
      };
    case "waiting-for-input": {
      const time = run.waitingMs === null ? {} : { time: elapsed(run.waitingMs) };
      const input = run.input;
      if (input === null) return { detail: t("inputUnknown"), meta: runner, ...time };
      switch (input.kind) {
        case "question":
          return input.answered
            ? { detail: input.body, meta: t("answered"), ...time }
            : {
                detail: input.body,
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

function controlPendingKey(control: RunControlView | null): "pausing" | "resuming" | null {
  if (control?.status !== "pending") return null;
  return control.control === "pause" ? "pausing" : "resuming";
}
