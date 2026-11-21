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

function tokenValue(token: unknown): string {
  const name = /var\((--[^,)]+)/.exec(String(token))?.[1];
  if (name === undefined) return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function tokenMs(token: unknown): number {
  const value = Number.parseFloat(tokenValue(token));
  return Number.isFinite(value) ? value : 0;
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

class MotionEngine {
  readonly lists = new Map<string, ListHandle>();
  move: MotionMove;
  private orders = new Map<string, readonly string[]>();
  private resetKeys = new Map<string, string | undefined>();
  private firstBoxes: Map<string, DOMRect> | null = null;
  private flushQueued = false;
  private readonly exits = new Map<string, ExitRecord>();
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
    for (const list of this.lists.values()) {
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
    const duration = tokenMs(this.moveToken());
    const easing = tokenValue(motion.easeMove);
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
        root.style.removeProperty("view-transition-name");
      });
  }

  private moveToken() {
    return this.move === "card" ? motion.durationCardMove : motion.durationRowMove;
  }

  private nameVisibleItems(): void {
    this.clearViewTransitionNames();
    for (const list of this.lists.values()) {
      for (const row of list.rows) {
        const parts = list.parts.get(row.key);
        if (parts === undefined || row.leaving) continue;
        const box = parts.inner.getBoundingClientRect();
        if (box.bottom < 0 || box.top > window.innerHeight) continue;
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
    return this.playMoves(settled, changes, first, reduced, insideViewTransition);
  }

  private settleFreshList(list: ListHandle): void {
    for (const row of list.rows) {
      const exitId = `${list.id}\0${row.key}`;
      const record = this.exits.get(exitId);
      if (record !== undefined) {
        this.exits.delete(exitId);
        for (const animation of record.animations) animation.cancel();
      }
      if (row.leaving) list.drop(row.key, false);
    }
  }

  private finishWithoutMotion(lists: readonly ListHandle[], changes: MotionChanges): void {
    for (const list of lists) {
      for (const row of list.rows) {
        if (row.leaving) list.drop(row.key, !changes.crossed.has(row.key));
      }
    }
  }

  private hideCrossedLeavers(lists: readonly ListHandle[], changes: MotionChanges): void {
    for (const list of lists) {
      for (const row of list.rows) {
        if (!row.leaving || !changes.crossed.has(row.key)) continue;
        const parts = list.parts.get(row.key);
        if (parts !== undefined) parts.wrapper.style.display = "none";
        list.drop(row.key, false);
      }
    }
  }

  private playPresence(list: ListHandle, changes: MotionChanges, quiet: boolean): void {
    for (const row of list.rows) {
      const parts = list.parts.get(row.key);
      if (parts === undefined) continue;
      const exitId = `${list.id}\0${row.key}`;
      const record = this.exits.get(exitId);
      if (row.leaving) {
        if (changes.crossed.has(row.key)) continue;
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
        this.startEnter(list, parts, quiet);
      }
    }
  }

  private startEnter(list: ListHandle, parts: ItemParts, quiet: boolean): void {
    const easing = tokenValue(motion.easeOut);
    if (quiet) {
      parts.inner.animate(
        { opacity: [0, 1] },
        { duration: tokenMs(motion.durationReducedFade), easing },
      );
      return;
    }
    if (list.enter === "rise") {
      parts.inner.animate(
        { opacity: [0, 1], transform: ["translateY(6px)", "none"] },
        { duration: tokenMs(motion.durationLineEnter), easing },
      );
      return;
    }
    const duration = tokenMs(motion.durationItemEnter);
    parts.inner.style.overflow = "hidden";
    const expansion = parts.wrapper.animate(
      { gridTemplateRows: ["0fr", "1fr"], opacity: [0, 1] },
      { duration, easing },
    );
    parts.inner.animate({ transform: ["translateY(-6px)", "none"] }, { duration, easing });
    const unclip = () => parts.inner.style.removeProperty("overflow");
    expansion.finished.then(unclip).catch(unclip);
    if (list.highlight) this.playArrival(parts);
  }

  private startExit(list: ListHandle, key: string, parts: ItemParts, quiet: boolean): void {
    const easing = tokenValue(motion.easeOut);
    const exitId = `${list.id}\0${key}`;
    const animations: Animation[] = [];
    if (quiet) {
      animations.push(
        parts.wrapper.animate(
          { opacity: [1, 0] },
          { duration: tokenMs(motion.durationReducedFade), easing, fill: "both" },
        ),
      );
    } else {
      parts.inner.style.overflow = "hidden";
      animations.push(
        parts.wrapper.animate(
          { gridTemplateRows: ["1fr", "0fr"], opacity: [1, 0] },
          { duration: tokenMs(motion.durationItemExit), easing, fill: "both" },
        ),
      );
    }
    const record: ExitRecord = { animations, returning: false };
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
        list.drop(key, true);
      })
      .catch(() => {
        if (this.exits.get(exitId) === record) this.exits.delete(exitId);
      });
  }

  private playArrival(parts: ItemParts): void {
    parts.flash.animate(
      { opacity: [1, 0] },
      { duration: tokenMs(motion.durationArrival), easing: tokenValue(motion.easeOut) },
    );
  }

  private playMoves(
    lists: readonly ListHandle[],
    changes: MotionChanges,
    first: ReadonlyMap<string, DOMRect>,
    reduced: boolean,
    insideViewTransition: boolean,
  ): boolean {
    const planned: {
      key: string;
      parts: ItemParts;
      from: DOMRect;
      to: DOMRect;
      style: MoveStyle;
      crossed: boolean;
      changed: boolean;
    }[] = [];
    for (const list of lists) {
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
        const shifted =
          Math.abs(from.left - to.left) > MOVE_THRESHOLD ||
          Math.abs(from.top - to.top) > MOVE_THRESHOLD;
        if (!shifted && !crossed) continue;
        const style = chooseMoveStyle({
          changeCount: changes.count,
          reducedMotion: reduced,
          crossesList: crossed,
          from,
          to,
          visibleArea: visibleAreaOf(parts.inner),
        });
        planned.push({ key: row.key, parts, from, to, style, crossed, changed });
      }
    }

    const slides = planned.every((move) => move.style === "slide");
    if (insideViewTransition && slides) {
      for (const move of planned) if (move.crossed) this.playArrival(move.parts);
      return true;
    }

    const duration = tokenMs(this.moveToken());
    const easing = tokenValue(motion.easeMove);
    for (const move of planned) {
      if (move.style === "fade") {
        if (!move.changed) continue;
        move.parts.inner.animate(
          { opacity: [0, 1] },
          { duration: tokenMs(motion.durationReducedFade), easing: tokenValue(motion.easeOut) },
        );
        continue;
      }
      const dx = move.from.left - move.to.left;
      const dy = move.from.top - move.to.top;
      const animation = move.parts.inner.animate(
        { transform: [`translate(${dx}px, ${dy}px)`, "none"] },
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
