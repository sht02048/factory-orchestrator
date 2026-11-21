import * as stylex from "@stylexjs/stylex";
import {
  Button,
  MotionList,
  MotionScope,
  PILL_STATUSES,
  Section,
  StatusPill,
  Text,
  useMotionMove,
} from "@ganger/ui";
import { colors, radius, space } from "@ganger/ui/tokens.stylex";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useStatusName } from "../status";

interface Board {
  queued: readonly number[];
  running: readonly number[];
}

const FIRST_BOARD: Board = { queued: [1, 2, 3, 4], running: [5, 6] };
const FIRST_NEW_ITEM = 7;
const BURST_SIZE = 4;

const cardKey = (id: number) => `card-${id}`;

function moveFirstQueued(board: Board): Board {
  const [first, ...queued] = board.queued;
  if (first === undefined) return board;
  return { queued, running: [first, ...board.running] };
}

function moveBurst(board: Board): Board {
  const moved = board.queued.slice(0, BURST_SIZE);
  const returned = moved.length === 0 ? board.running.slice(0, BURST_SIZE) : [];
  return {
    queued: [...board.queued.slice(moved.length), ...returned],
    running: [...moved, ...board.running.slice(returned.length)],
  };
}

function raiseLast(ids: readonly number[]): readonly number[] {
  const last = ids.at(-1);
  return last === undefined ? ids : [last, ...ids.slice(0, -1)];
}

export function MotionSection() {
  const t = useTranslations("ds.motionDemo");
  return (
    <div id="motionPrimitives">
      <Section title={t("title")} note={t("note")}>
        <MotionScope move="card">
          <BoardDemo />
        </MotionScope>
        <TimelineDemo />
        <PillDemo />
      </Section>
    </div>
  );
}

function BoardDemo() {
  const t = useTranslations("ds.motionDemo");
  const move = useMotionMove();
  const [board, setBoard] = useState(FIRST_BOARD);
  const [exited, setExited] = useState(0);
  const nextId = useRef(FIRST_NEW_ITEM);

  const renderCard = (id: number) => (
    <div data-motion-card={id} {...stylex.props(styles.card)}>
      <Text variant="ui">{t("card", { id })}</Text>
    </div>
  );
  const column = (label: string, ids: readonly number[]) => (
    <div {...stylex.props(styles.column)}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <div data-motion-column={label} {...stylex.props(styles.cards)}>
        <MotionList
          items={ids}
          getKey={cardKey}
          highlightRadius="control"
          onExited={() => setExited((count) => count + 1)}
        >
          {renderCard}
        </MotionList>
      </div>
    </div>
  );

  return (
    <div {...stylex.props(styles.demo)}>
      <div {...stylex.props(styles.actions)}>
        <Button
          onClick={() => {
            const id = nextId.current++;
            setBoard((current) => ({ ...current, queued: [id, ...current.queued] }));
          }}
        >
          {t("add")}
        </Button>
        <Button
          onClick={() => setBoard((current) => ({ ...current, queued: current.queued.slice(1) }))}
        >
          {t("remove")}
        </Button>
        <Button onClick={() => move(() => setBoard(moveFirstQueued))}>{t("move")}</Button>
        <Button
          onClick={() => setBoard((current) => ({ ...current, queued: raiseLast(current.queued) }))}
        >
          {t("reorder")}
        </Button>
        <Button onClick={() => setBoard(moveBurst)}>{t("burst")}</Button>
      </div>
      <div {...stylex.props(styles.board)}>
        {column(t("queued"), board.queued)}
        {column(t("running"), board.running)}
      </div>
      <Text variant="meta" role="status">
        {t("exited", { count: exited })}
      </Text>
    </div>
  );
}

function TimelineDemo() {
  const t = useTranslations("ds.motionDemo");
  const [lines, setLines] = useState<readonly number[]>([1, 2]);
  return (
    <div {...stylex.props(styles.demo)}>
      <div {...stylex.props(styles.actions)}>
        <Button onClick={() => setLines((current) => [...current, current.length + 1])}>
          {t("addLine")}
        </Button>
      </div>
      <ol data-motion-timeline="" {...stylex.props(styles.timeline)}>
        <MotionList items={lines} getKey={String} enter="rise" as="li">
          {(line) => <Text variant="ui">{t("line", { line })}</Text>}
        </MotionList>
      </ol>
    </div>
  );
}

function PillDemo() {
  const t = useTranslations("ds.motionDemo");
  const statusName = useStatusName();
  const [index, setIndex] = useState(0);
  const status = PILL_STATUSES[index % PILL_STATUSES.length] ?? "queued";
  return (
    <div {...stylex.props(styles.demo)}>
      <div {...stylex.props(styles.actions)}>
        <StatusPill status={status} changeMotion>
          {statusName(status)}
        </StatusPill>
        <Button onClick={() => setIndex((current) => current + 1)}>{t("nextStatus")}</Button>
      </div>
    </div>
  );
}

const styles = stylex.create({
  demo: { display: "flex", flexDirection: "column", gap: space.s3, marginBottom: space.s5 },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  board: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: space.s4 },
  column: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  cards: { display: "flex", flexDirection: "column", minHeight: 240 },
  card: {
    marginBottom: space.s1,
    padding: space.s3,
    borderRadius: radius.control,
    backgroundColor: colors.bgCard,
  },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
});
