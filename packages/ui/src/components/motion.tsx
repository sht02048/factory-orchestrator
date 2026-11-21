import * as stylex from "@stylexjs/stylex";
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { colors, motion, radius } from "../tokens.stylex";
import {
  chooseMoveStyle,
  diffMotionOrders,
  MOTION_BURST_LIMIT,
  reconcileMotionRows,
  type MotionBox,
  type MotionChanges,
  type MotionListOrder,
  type MotionRow,
  type MoveStyle,
} from "./motion-plan";
import { motionTokenMs, motionTokenValue } from "./motion-token";

export type MotionEnter = "expand" | "rise";
export type MotionMove = "row" | "card";
export type MotionHighlightRadius = "control" | "card";

interface ItemParts {
  wrapper: HTMLElement;
  inner: HTMLElement;
  flash: HTMLElement;
}

interface ListHandle {
  id: string;
  rows: readonly { key: string; leaving: boolean }[];
  parts: Map<string, ItemParts>;
  enter: MotionEnter;
  highlight: boolean;
  resetKey: string | undefined;
  drop: (key: string, exited: boolean) => void;
}

interface ExitRecord {
  animations: Animation[];
  returning: boolean;
  parts: ItemParts;
}

interface DroppedRow {
  listId: string;
  key: string;
  animations: readonly Animation[];
  parts: ItemParts | undefined;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const VIEW_TRANSITION_STYLE_ID = "ganger-motion-view-transition";
const VIEW_TRANSITION_PSEUDO = "::view-transition";
const MOVE_THRESHOLD = 0.5;

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function canAnimate(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    typeof Element.prototype.animate === "function"
  );
}

const exitIdOf = (listId: string, key: string) => `${listId}\0${key}`;

function restoreItem(parts: ItemParts | undefined): void {
  parts?.inner.style.removeProperty("overflow");
  parts?.wrapper.style.removeProperty("display");
}

function overlapsArea(box: DOMRect, area: MotionBox): boolean {
  return (
    box.left < area.right && area.left < box.right && box.top < area.bottom && area.top < box.bottom
  );
}

function visibleAreaOf(element: HTMLElement): MotionBox {
  const area: MotionBox = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const box = parent.getBoundingClientRect();
    area.left = Math.max(area.left, box.left);
    area.top = Math.max(area.top, box.top);
    area.right = Math.min(area.right, box.right);
    area.bottom = Math.min(area.bottom, box.bottom);
  }
  return area;
}

function ensureViewTransitionStyle(): void {
  if (document.getElementById(VIEW_TRANSITION_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = VIEW_TRANSITION_STYLE_ID;
  style.textContent = `${VIEW_TRANSITION_PSEUDO}{pointer-events:none}`;
  document.head.append(style);
}

function listContainer(list: ListHandle): HTMLElement | null {
  for (const parts of list.parts.values()) return parts.wrapper.parentElement;
  return null;
}

class MotionEngine {
  readonly lists = new Map<string, ListHandle>();
  move: MotionMove;
  private orders = new Map<string, readonly string[]>();
  private resetKeys = new Map<string, string | undefined>();
  private firstBoxes: Map<string, DOMRect> | null = null;
  private flushQueued = false;
  private firstListBoxes = new Map<string, DOMRect>();
  private readonly exits = new Map<string, ExitRecord>();
  private readonly dropped = new Map<string, DroppedRow>();
  private readonly moves = new Map<string, Animation>();
  private readonly viewTransitionNames = new Map<string, string>();
  private nextViewTransitionName = 0;
  private activeTransition: ViewTransition | null = null;

  constructor(move: MotionMove) {
    this.move = move;
  }

  capture(): void {
    if (this.firstBoxes !== null) return;
    const boxes = new Map<string, DOMRect>();
    this.firstListBoxes = new Map();
    for (const list of this.lists.values()) {
      const container = listContainer(list);
      if (container !== null) this.firstListBoxes.set(list.id, container.getBoundingClientRect());
      for (const row of list.rows) {
        const parts = list.parts.get(row.key);
        if (parts !== undefined && !row.leaving) {
          boxes.set(row.key, parts.inner.getBoundingClientRect());
        }
      }
    }
    this.firstBoxes = boxes;
  }

  report(list: ListHandle): void {
    this.lists.set(list.id, list);
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      if (this.flushQueued) this.flush(false);
    });
  }

  remove(listId: string): void {
    this.lists.delete(listId);
    this.orders.delete(listId);
    this.resetKeys.delete(listId);
  }

  runMove(update: () => void): void {
    if (
      !canAnimate() ||
      prefersReducedMotion() ||
      typeof document.startViewTransition !== "function"
    ) {
      update();
      return;
    }
    this.activeTransition?.skipTransition();
    ensureViewTransitionStyle();
    const root = document.documentElement;
    this.nameVisibleItems();
    root.style.setProperty("view-transition-name", "none");
    const transition = document.startViewTransition(() => {
      flushSync(update);
      const slides = this.flush(true);
      if (slides) this.nameVisibleItems();
      else transition.skipTransition();
    });
    this.activeTransition = transition;
    const duration = motionTokenMs(this.moveToken());
    const easing = motionTokenValue(motion.easeMove);
    transition.ready
      .then(() => {
        for (const animation of document.getAnimations()) {
          const effect = animation.effect;
          if (
            effect instanceof KeyframeEffect &&
            effect.pseudoElement?.startsWith(VIEW_TRANSITION_PSEUDO) === true
          ) {
            effect.updateTiming({ duration, easing });
          }
        }
      })
      .catch(() => undefined);
    transition.finished
      .catch(() => undefined)
      .finally(() => {
        if (this.activeTransition !== transition) return;
        this.activeTransition = null;
        this.clearViewTransitionNames();
        this.viewTransitionNames.clear();
        root.style.removeProperty("view-transition-name");
      });
  }

  private moveToken() {
    return this.move === "card" ? motion.durationCardMove : motion.durationRowMove;
  }

  private nameVisibleItems(): void {
    this.clearViewTransitionNames();
    for (const list of this.lists.values()) {
      const container = listContainer(list);
      if (container === null) continue;
      const area = visibleAreaOf(container);
      for (const row of list.rows) {
        const parts = list.parts.get(row.key);
        if (parts === undefined || row.leaving) continue;
        if (!overlapsArea(parts.inner.getBoundingClientRect(), area)) continue;
        const name =
          this.viewTransitionNames.get(row.key) ?? `ganger-motion-${this.nextViewTransitionName++}`;
        this.viewTransitionNames.set(row.key, name);
        parts.inner.style.setProperty("view-transition-name", name);
      }
    }
  }

  private clearViewTransitionNames(): void {
    for (const list of this.lists.values()) {
      for (const parts of list.parts.values()) {
        parts.inner.style.removeProperty("view-transition-name");
      }
    }
  }

  private flush(insideViewTransition: boolean): boolean {
    this.flushQueued = false;
    const first = this.firstBoxes ?? new Map<string, DOMRect>();
    this.firstBoxes = null;
    const firstListBoxes = this.firstListBoxes;
    this.firstListBoxes = new Map();
    this.releaseReturnedRows();

    const settled: ListHandle[] = [];
    const fresh: ListHandle[] = [];
    for (const list of this.lists.values()) {
      const known = this.orders.has(list.id) && this.resetKeys.get(list.id) === list.resetKey;
      (known ? settled : fresh).push(list);
    }
    for (const list of fresh) this.settleFreshList(list);

    const beforeOrders: MotionListOrder[] = settled.map((list) => ({
      listId: list.id,
      keys: this.orders.get(list.id) ?? [],
    }));
    const afterOrders: MotionListOrder[] = settled.map((list) => ({
      listId: list.id,
      keys: list.rows.filter((row) => !row.leaving).map((row) => row.key),
    }));
    const changes = diffMotionOrders(beforeOrders, afterOrders);
    const changedLists = new Set(
      afterOrders
        .filter(({ keys }, index) => {
          const previous = beforeOrders[index]?.keys ?? [];
          return keys.length !== previous.length || keys.some((key, at) => key !== previous[at]);
        })
        .map(({ listId }) => listId),
    );
    for (const list of this.lists.values()) {
      this.orders.set(
        list.id,
        list.rows.filter((row) => !row.leaving).map((row) => row.key),
      );
      this.resetKeys.set(list.id, list.resetKey);
    }

    if (!canAnimate()) {
      this.finishWithoutMotion(settled, changes);
      return false;
    }

    const reduced = prefersReducedMotion();
    const quiet = reduced || changes.count > MOTION_BURST_LIMIT;
    this.hideCrossedLeavers(settled, changes);
    for (const list of settled) this.playPresence(list, changes, quiet);
    const moving = settled.filter((list) => changedLists.has(list.id));
    return this.playMoves(moving, changes, first, firstListBoxes, reduced, insideViewTransition);
  }

  private releaseReturnedRows(): void {
    for (const [exitId, entry] of this.dropped) {
      const list = this.lists.get(entry.listId);
      const row = list?.rows.find(({ key }) => key === entry.key);
      if (row?.leaving === true) continue;
      this.dropped.delete(exitId);
      if (row === undefined) continue;
      for (const animation of entry.animations) animation.cancel();
      restoreItem(entry.parts);
    }
  }

  private dropRow(list: ListHandle, key: string, exited: boolean, record?: ExitRecord): void {
    const exitId = exitIdOf(list.id, key);
    if (this.dropped.has(exitId)) return;
    this.dropped.set(exitId, {
      listId: list.id,
      key,
      animations: record?.animations ?? [],
      parts: record?.parts ?? list.parts.get(key),
    });
    list.drop(key, exited);
  }

  private cancelExit(listId: string, key: string): void {
    const exitId = exitIdOf(listId, key);
    const record = this.exits.get(exitId);
    if (record === undefined) return;
    this.exits.delete(exitId);
    for (const animation of record.animations) animation.cancel();
    restoreItem(record.parts);
  }

  private settleFreshList(list: ListHandle): void {
    for (const row of list.rows) {
      this.cancelExit(list.id, row.key);
      if (row.leaving) this.dropRow(list, row.key, false);
    }
  }

  private finishWithoutMotion(lists: readonly ListHandle[], changes: MotionChanges): void {
    for (const list of lists) {
      for (const row of list.rows) {
        this.cancelExit(list.id, row.key);
        if (row.leaving) this.dropRow(list, row.key, !changes.crossed.has(row.key));
      }
    }
  }

  private hideCrossedLeavers(lists: readonly ListHandle[], changes: MotionChanges): void {
    for (const list of lists) {
      for (const row of list.rows) {
        if (!row.leaving || !changes.crossed.has(row.key)) continue;
        const parts = list.parts.get(row.key);
        this.cancelExit(list.id, row.key);
        if (parts !== undefined) parts.wrapper.style.display = "none";
        this.dropRow(list, row.key, false);
      }
    }
  }

  private playPresence(list: ListHandle, changes: MotionChanges, quiet: boolean): void {
    for (const row of list.rows) {
      const parts = list.parts.get(row.key);
      if (parts === undefined) continue;
      const exitId = exitIdOf(list.id, row.key);
      const record = this.exits.get(exitId);
      if (row.leaving) {
        if (changes.crossed.has(row.key) || this.dropped.has(exitId)) continue;
        if (record === undefined) this.startExit(list, row.key, parts, quiet);
        else if (record.returning) {
          record.returning = false;
          for (const animation of record.animations) animation.reverse();
        }
        continue;
      }
      if (record !== undefined && !record.returning) {
        record.returning = true;
        for (const animation of record.animations) animation.reverse();
        continue;
      }
      if (changes.entered.has(row.key)) {
        this.startEnter(list, row.key, parts, quiet);
      }
    }
  }

  private startEnter(list: ListHandle, key: string, parts: ItemParts, quiet: boolean): void {
    const easing = motionTokenValue(motion.easeOut);
    if (quiet) {
      parts.inner.animate(
        { opacity: [0, 1] },
        { duration: motionTokenMs(motion.durationReducedFade), easing },
      );
      return;
    }
    if (list.enter === "rise") {
      parts.inner.animate(
        { opacity: [0, 1], transform: ["translateY(6px)", "none"] },
        { duration: motionTokenMs(motion.durationLineEnter), easing },
      );
      return;
    }
    const duration = motionTokenMs(motion.durationItemEnter);
    parts.inner.style.overflow = "hidden";
    const expansion = parts.wrapper.animate(
      { gridTemplateRows: ["0fr", "1fr"], opacity: [0, 1] },
      { duration, easing },
    );
    parts.inner.animate({ transform: ["translateY(-6px)", "none"] }, { duration, easing });
    const exitId = exitIdOf(list.id, key);
    const unclip = () => {
      if (!this.exits.has(exitId)) parts.inner.style.removeProperty("overflow");
    };
    expansion.finished.then(unclip).catch(unclip);
    if (list.highlight) this.playArrival(parts);
  }

  private startExit(list: ListHandle, key: string, parts: ItemParts, quiet: boolean): void {
    const easing = motionTokenValue(motion.easeOut);
    const exitId = exitIdOf(list.id, key);
    const animations: Animation[] = [];
    if (quiet) {
      animations.push(
        parts.wrapper.animate(
          { opacity: [1, 0] },
          { duration: motionTokenMs(motion.durationReducedFade), easing, fill: "both" },
        ),
      );
    } else {
      parts.inner.style.overflow = "hidden";
      animations.push(
        parts.wrapper.animate(
          { gridTemplateRows: ["1fr", "0fr"], opacity: [1, 0] },
          { duration: motionTokenMs(motion.durationItemExit), easing, fill: "both" },
        ),
      );
    }
    const record: ExitRecord = { animations, returning: false, parts };
    this.exits.set(exitId, record);
    Promise.all(animations.map((animation) => animation.finished))
      .then(() => {
        if (this.exits.get(exitId) !== record) return;
        this.exits.delete(exitId);
        if (record.returning) {
          for (const animation of animations) animation.cancel();
          parts.inner.style.removeProperty("overflow");
          return;
        }
        this.dropRow(list, key, true, record);
      })
      .catch(() => {
        if (this.exits.get(exitId) === record) this.exits.delete(exitId);
      });
  }

  private playArrival(parts: ItemParts): void {
    parts.flash.animate(
      { opacity: [1, 0] },
      { duration: motionTokenMs(motion.durationArrival), easing: motionTokenValue(motion.easeOut) },
    );
  }

  private playMoves(
    lists: readonly ListHandle[],
    changes: MotionChanges,
    first: ReadonlyMap<string, DOMRect>,
    firstListBoxes: ReadonlyMap<string, DOMRect>,
    reduced: boolean,
    insideViewTransition: boolean,
  ): boolean {
    const planned: {
      key: string;
      parts: ItemParts;
      dx: number;
      dy: number;
      style: MoveStyle;
      crossed: boolean;
      changed: boolean;
    }[] = [];
    for (const list of lists) {
      const container = listContainer(list);
      const listFrom = firstListBoxes.get(list.id);
      const listTo = container?.getBoundingClientRect();
      const listDx =
        listFrom !== undefined && listTo !== undefined ? listFrom.left - listTo.left : 0;
      const listDy = listFrom !== undefined && listTo !== undefined ? listFrom.top - listTo.top : 0;
      for (const row of list.rows) {
        if (row.leaving) continue;
        const parts = list.parts.get(row.key);
        const from = first.get(row.key);
        if (parts === undefined || from === undefined) continue;
        this.moves.get(row.key)?.cancel();
        this.moves.delete(row.key);
        const to = parts.inner.getBoundingClientRect();
        const crossed = changes.crossed.has(row.key);
        const changed = crossed || changes.displaced.has(row.key);
        const dx = from.left - to.left - (crossed ? 0 : listDx);
        const dy = from.top - to.top - (crossed ? 0 : listDy);
        const shifted = Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD;
        if (!shifted && !crossed) continue;
        const style = chooseMoveStyle({
          changeCount: changes.count,
          reducedMotion: reduced,
          crossesList: crossed,
          from,
          to,
          visibleArea: visibleAreaOf(parts.inner),
        });
        planned.push({ key: row.key, parts, dx, dy, style, crossed, changed });
      }
    }

    const slides = planned.filter((move) => move.changed).every((move) => move.style === "slide");
    if (insideViewTransition && slides) {
      for (const move of planned) if (move.crossed) this.playArrival(move.parts);
      return true;
    }

    const duration = motionTokenMs(this.moveToken());
    const easing = motionTokenValue(motion.easeMove);
    for (const move of planned) {
      if (move.style === "fade") {
        if (!move.changed) continue;
        move.parts.inner.animate(
          { opacity: [0, 1] },
          {
            duration: motionTokenMs(motion.durationReducedFade),
            easing: motionTokenValue(motion.easeOut),
          },
        );
        continue;
      }
      const animation = move.parts.inner.animate(
        { transform: [`translate(${move.dx}px, ${move.dy}px)`, "none"] },
        { duration, easing },
      );
      this.moves.set(move.key, animation);
      if (move.crossed) this.playArrival(move.parts);
    }
    return false;
  }
}

const MotionContext = createContext<MotionEngine | null>(null);

class BeforeCommit extends Component<{ engine: MotionEngine }> {
  override getSnapshotBeforeUpdate(): null {
    this.props.engine.capture();
    return null;
  }

  override componentDidUpdate(): void {}

  override render(): ReactNode {
    return null;
  }
}

export interface MotionScopeProps {
  move?: MotionMove;
  children: ReactNode;
}

export function MotionScope({ move = "row", children }: MotionScopeProps) {
  const [engine] = useState(() => new MotionEngine(move));
  useLayoutEffect(() => {
    engine.move = move;
  }, [engine, move]);
  return <MotionContext.Provider value={engine}>{children}</MotionContext.Provider>;
}

export function useMotionMove(): (update: () => void) => void {
  const engine = useContext(MotionContext);
  return useCallback(
    (update: () => void) => {
      if (engine === null) update();
      else engine.runMove(update);
    },
    [engine],
  );
}

export interface MotionListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  children: (item: T, state: { leaving: boolean }) => ReactNode;
  enter?: MotionEnter;
  highlight?: boolean;
  highlightRadius?: MotionHighlightRadius;
  resetKey?: string;
  onExited?: (key: string) => void;
  as?: "div" | "li";
}

export function MotionList<T>(props: MotionListProps<T>) {
  const engine = useContext(MotionContext);
  if (engine === null) {
    return (
      <MotionScope>
        <MotionList {...props} />
      </MotionScope>
    );
  }
  return <ScopedMotionList {...props} engine={engine} />;
}

interface RowsState<T> {
  items: readonly T[];
  resetKey: string | undefined;
  rows: readonly MotionRow<T>[];
}

function ScopedMotionList<T>({
  engine,
  items,
  getKey,
  children,
  enter = "expand",
  highlight = enter === "expand",
  highlightRadius = "control",
  resetKey,
  onExited,
  as = "div",
}: MotionListProps<T> & { engine: MotionEngine }) {
  const id = useId();
  const [state, setState] = useState<RowsState<T>>(() => ({
    items,
    resetKey,
    rows: reconcileMotionRows([], items, getKey),
  }));
  let current = state;
  if (state.items !== items || state.resetKey !== resetKey) {
    const previous = state.resetKey === resetKey ? state.rows : [];
    current = { items, resetKey, rows: reconcileMotionRows(previous, items, getKey) };
    setState(current);
  }

  const onExitedRef = useRef(onExited);
  const partsRef = useRef(new Map<string, ItemParts>());
  const drop = useCallback((key: string, exited: boolean) => {
    setState((latest) => ({
      ...latest,
      rows: latest.rows.filter((row) => !(row.key === key && row.leaving)),
    }));
    if (exited) onExitedRef.current?.(key);
  }, []);

  useLayoutEffect(() => {
    onExitedRef.current = onExited;
    engine.report({
      id,
      rows: current.rows,
      parts: partsRef.current,
      enter,
      highlight,
      resetKey,
      drop,
    });
  });
  useLayoutEffect(() => () => engine.remove(id), [engine, id]);

  return (
    <>
      <BeforeCommit engine={engine} />
      {current.rows.map((row) => (
        <MotionItem
          key={row.key}
          as={as}
          itemKey={row.key}
          leaving={row.leaving}
          highlightRadius={highlightRadius}
          partsMap={partsRef.current}
        >
          {children(row.item, { leaving: row.leaving })}
        </MotionItem>
      ))}
    </>
  );
}

interface MotionItemProps {
  as: "div" | "li";
  itemKey: string;
  leaving: boolean;
  highlightRadius: MotionHighlightRadius;
  partsMap: Map<string, ItemParts>;
  children: ReactNode;
}

function MotionItem({
  as: Wrapper,
  itemKey,
  leaving,
  highlightRadius,
  partsMap,
  children,
}: MotionItemProps) {
  const wrapperRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    const flash = flashRef.current;
    if (wrapper === null || inner === null || flash === null) return;
    partsMap.set(itemKey, { wrapper, inner, flash });
    return () => {
      partsMap.delete(itemKey);
    };
  }, [itemKey, partsMap]);
  return (
    <Wrapper
      ref={(node: HTMLElement | null) => {
        wrapperRef.current = node;
      }}
      data-motion-key={itemKey}
      inert={leaving}
      {...stylex.props(styles.wrapper)}
    >
      <div ref={innerRef} {...stylex.props(styles.inner)}>
        {children}
        <span
          ref={flashRef}
          aria-hidden="true"
          data-motion-flash=""
          {...stylex.props(styles.flash, flashRadius[highlightRadius])}
        />
      </div>
    </Wrapper>
  );
}

const styles = stylex.create({
  wrapper: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gridTemplateRows: "1fr",
    listStyle: "none",
  },
  inner: { position: "relative", minWidth: 0, minHeight: 0 },
  flash: {
    position: "absolute",
    inset: 0,
    backgroundColor: `color-mix(in oklch, ${colors.accent} 18%, transparent)`,
    opacity: 0,
    pointerEvents: "none",
  },
});

const flashRadius = stylex.create({
  control: { borderRadius: radius.control },
  card: { borderRadius: radius.card },
});
