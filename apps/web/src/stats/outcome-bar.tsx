import * as stylex from "@stylexjs/stylex";
import { textStyles } from "@factory/ui";
import { colors, radius, size, space } from "@factory/ui/tokens.stylex";
import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { OutcomeCounts, StatsGroup } from "./model";

export type OutcomeTone = "merged" | "check" | "failed" | "canceled";

export function outcomeSegments(
  outcomes: OutcomeCounts,
): ReadonlyArray<{ tone: OutcomeTone; value: number }> {
  return [
    { tone: "merged", value: outcomes.merged },
    { tone: "check", value: outcomes["human-check"] },
    { tone: "failed", value: outcomes.failed },
    { tone: "canceled", value: outcomes.canceled },
  ];
}

export function OutcomeBar({ outcomes, label }: { outcomes: OutcomeCounts; label: string }) {
  return (
    <span role="img" aria-label={label} title={label} {...stylex.props(styles.track)}>
      {outcomeSegments(outcomes).map((segment) =>
        segment.value === 0 ? null : (
          <span
            key={segment.tone}
            style={{ flexGrow: segment.value }}
            {...stylex.props(styles.segment, fill[segment.tone])}
          />
        ),
      )}
    </span>
  );
}

export function FailureBar({ runs, max }: { runs: number; max: number }) {
  return (
    <span aria-hidden="true" {...stylex.props(styles.track)}>
      <span
        style={{ width: `${max === 0 ? 0 : (runs / max) * 100}%` }}
        {...stylex.props(styles.failureFill, fill.failed)}
      />
    </span>
  );
}

export function useOutcomeLabel(): (outcomes: OutcomeCounts) => string {
  const t = useTranslations("stats");
  return (outcomes) =>
    t("result", {
      merged: outcomes.merged,
      check: outcomes["human-check"],
      failed: outcomes.failed,
      canceled: outcomes.canceled,
    });
}

export function BreakdownTable({
  caption,
  groups,
  nameOf,
  runsHref,
  onOpenRuns,
}: {
  caption: string;
  groups: ReadonlyArray<StatsGroup>;
  nameOf: (group: StatsGroup) => string;
  runsHref?: (group: StatsGroup) => string;
  onOpenRuns?: (group: StatsGroup) => void;
}) {
  const t = useTranslations("stats");
  const { duration } = useTime();
  const outcomeLabel = useOutcomeLabel();
  return (
    <table {...stylex.props(styles.table)}>
      <caption {...stylex.props(styles.screenReaderOnly)}>{caption}</caption>
      <colgroup>
        <col />
        <col {...stylex.props(styles.runsColumn)} />
        <col {...stylex.props(styles.resultColumn)} />
        <col {...stylex.props(styles.leadColumn)} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" {...stylex.props(textStyles("label"), styles.th)}>
            {t("columns.name")}
          </th>
          <th scope="col" {...stylex.props(textStyles("label"), styles.th, styles.end)}>
            {t("columns.runs")}
          </th>
          <th scope="col" {...stylex.props(textStyles("label"), styles.th)}>
            {t("columns.result")}
          </th>
          <th scope="col" {...stylex.props(textStyles("label"), styles.th, styles.end)}>
            {t("columns.leadTime")}
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr
            key={group.key}
            {...(onOpenRuns === undefined
              ? {}
              : {
                  onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                    if (event.target instanceof Element && event.target.closest("a") !== null)
                      return;
                    onOpenRuns(group);
                  },
                })}
            {...stylex.props(onOpenRuns !== undefined && styles.openable)}
          >
            <th scope="row" {...stylex.props(textStyles("title"), styles.td, styles.name)}>
              {runsHref === undefined ? (
                nameOf(group)
              ) : (
                <a
                  href={runsHref(group)}
                  aria-label={t("openRuns", { name: nameOf(group) })}
                  onClick={(event) => {
                    if (onOpenRuns === undefined || !isPlainClick(event)) return;
                    event.preventDefault();
                    onOpenRuns(group);
                  }}
                  {...stylex.props(styles.runsLink)}
                >
                  {nameOf(group)}
                </a>
              )}
            </th>
            <td {...stylex.props(textStyles("ui"), styles.td, styles.end, styles.numeric)}>
              {group.runs}
            </td>
            <td {...stylex.props(styles.td)}>
              <OutcomeBar outcomes={group.outcomes} label={outcomeLabel(group.outcomes)} />
            </td>
            <td {...stylex.props(textStyles("ui"), styles.td, styles.end, styles.numeric)}>
              {group.leadTime === null ? t("notApplicable") : duration(group.leadTime.p50Ms)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const styles = stylex.create({
  openable: { cursor: "pointer" },
  runsLink: {
    color: "inherit",
    textDecoration: { default: "none", ":hover": "underline", ":focus-visible": "underline" },
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": "2px solid currentColor" },
    outlineOffset: 2,
  },
  track: {
    display: "flex",
    gap: space.px2,
    width: "100%",
    height: space.s2,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.bgInset,
  },
  segment: { minWidth: space.px2, height: "100%" },
  failureFill: { height: "100%" },
  table: {
    width: "100%",
    tableLayout: "fixed",
    borderCollapse: "collapse",
  },
  runsColumn: { width: "10%" },
  resultColumn: { width: "40%" },
  leadColumn: { width: "16%" },
  th: {
    height: size.control,
    paddingInline: space.s3,
    textAlign: "start",
    whiteSpace: "nowrap",
  },
  td: {
    height: size.rowMinHeight,
    paddingInline: space.s3,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  name: {
    overflow: "hidden",
    textAlign: "start",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  end: { textAlign: "end" },
  numeric: { fontVariantNumeric: "tabular-nums" },
  screenReaderOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});

const hatch = `repeating-linear-gradient(135deg, transparent 0 2px, ${colors.bgCanvas} 2px 3px)`;

export const fill = stylex.create({
  merged: { backgroundColor: colors.merged },
  check: { backgroundColor: colors.check },
  failed: { backgroundColor: colors.problem },
  canceled: { backgroundColor: colors.idle, backgroundImage: hatch },
});
