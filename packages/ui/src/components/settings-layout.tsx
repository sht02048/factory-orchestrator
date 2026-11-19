import * as stylex from "@stylexjs/stylex";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { focusStyles } from "./focus";
import { ChevronRightIcon } from "./icons";
import { textStyles } from "./text";
import { VisuallyHidden } from "./visually-hidden";
import { breakpoints, colors, fonts, fontSize, radius, size, space } from "../tokens.stylex";

export interface SettingsLayoutProps {
  nav?: ReactNode;
  children: ReactNode;
}

export function SettingsLayout({ nav, children }: SettingsLayoutProps) {
  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.navColumn)}>{nav}</div>
        <div {...stylex.props(styles.body)}>{children}</div>
      </div>
    </div>
  );
}

export interface SectionNavItem {
  id: string;
  label: string;
  problem?: boolean;
}

export interface SectionNavProps {
  label: string;
  items: ReadonlyArray<SectionNavItem>;
  problemLabel: string;
}

const CURRENT_LINE_OFFSET = 96;

export function SectionNav({ label, items, problemLabel }: SectionNavProps) {
  const [current, setCurrent] = useState(items[0]?.id ?? "");
  const pinned = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  const ids = items.map((item) => item.id).join(" ");

  useEffect(() => {
    const sections = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const first = sections[0];
    if (first === undefined) return undefined;
    const scroller = scrollParent(first);
    let frame = 0;
    const update = () => {
      frame = 0;
      if (pinned.current) return;
      setCurrent(currentSection(sections, scroller));
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    const unpin = () => {
      pinned.current = false;
    };
    update();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    for (const event of ["wheel", "touchmove", "keydown"] as const) {
      window.addEventListener(event, unpin, { passive: true });
    }
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const event of ["wheel", "touchmove", "keydown"] as const) {
        window.removeEventListener(event, unpin);
      }
    };
  }, [ids]);

  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (list === null || link === null || link === undefined) return;
    if (list.scrollWidth <= list.clientWidth) return;
    const start = link.offsetLeft - list.offsetLeft;
    const end = start + link.offsetWidth;
    if (start < list.scrollLeft) list.scrollLeft = start;
    else if (end > list.scrollLeft + list.clientWidth) list.scrollLeft = end - list.clientWidth;
  }, [current]);

  const go = useCallback((event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id);
    if (section === null) return;
    event.preventDefault();
    pinned.current = true;
    setCurrent(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    const heading = section.querySelector<HTMLElement>("[data-section-heading]");
    (heading ?? section).focus({ preventScroll: true });
  }, []);

  return (
    <nav aria-label={label} {...stylex.props(styles.nav)}>
      <ul ref={listRef} {...stylex.props(styles.navList)}>
        {items.map((item) => {
          const isCurrent = item.id === current;
          return (
            <li key={item.id} {...stylex.props(styles.navItem)}>
              <a
                href={`#${item.id}`}
                onClick={(event) => go(event, item.id)}
                {...(isCurrent ? { "aria-current": "location" as const } : {})}
                {...stylex.props(
                  textStyles("ui"),
                  styles.navLink,
                  isCurrent && styles.navLinkCurrent,
                  focusStyles.ring,
                )}
              >
                {item.label}
                {item.problem === true ? (
                  <>
                    <span aria-hidden="true" {...stylex.props(styles.problemDot)} />
                    <VisuallyHidden>{problemLabel}</VisuallyHidden>
                  </>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node !== null) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight)
      return node;
    node = node.parentElement;
  }
  return null;
}

function currentSection(
  sections: ReadonlyArray<HTMLElement>,
  scroller: HTMLElement | null,
): string {
  const top = scroller === null ? 0 : scroller.getBoundingClientRect().top;
  const atEnd =
    scroller === null
      ? window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  const scrolled = scroller === null ? window.scrollY > 0 : scroller.scrollTop > 0;
  if (atEnd && scrolled) return sections.at(-1)?.id ?? "";
  let found = sections[0]?.id ?? "";
  for (const section of sections) {
    if (section.getBoundingClientRect().top - top <= CURRENT_LINE_OFFSET) found = section.id;
  }
  return found;
}

export interface SettingsSectionProps {
  id: string;
  title: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ id, title, info, actions, children }: SettingsSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        <h2
          id={headingId}
          tabIndex={-1}
          data-section-heading=""
          {...stylex.props(textStyles("subheading"), styles.sectionTitle, focusStyles.ring)}
        >
          {title}
        </h2>
        {info}
        {actions === undefined ? null : (
          <div {...stylex.props(styles.sectionActions)}>{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}

export function SettingsGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      {...(label === undefined ? {} : { role: "group", "aria-label": label })}
      {...stylex.props(styles.group)}
    >
      {children}
    </div>
  );
}

export type SettingsDetailTone = "default" | "problem";

export interface SettingsRowProps {
  label: ReactNode;
  labelId?: string;
  labelFor?: string;
  info?: ReactNode;
  detail?: ReactNode;
  detailTone?: SettingsDetailTone;
  detailMono?: boolean;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  message?: ReactNode;
  expanded?: ReactNode;
  formOnly?: boolean;
  wideControl?: boolean;
  disabled?: boolean;
  id?: string;
  ref?: Ref<HTMLDivElement>;
}

export function SettingsRow({
  label,
  labelId,
  labelFor,
  info,
  detail,
  detailTone = "default",
  detailMono = false,
  value,
  control,
  status,
  message,
  expanded,
  formOnly = false,
  wideControl = false,
  disabled = false,
  id,
  ref,
}: SettingsRowProps) {
  const open = expanded !== undefined && expanded !== null && expanded !== false;
  if (open && formOnly) {
    return (
      <div
        ref={ref}
        data-editing=""
        {...(id === undefined ? {} : { id })}
        {...stylex.props(styles.row, styles.rowOpen)}
      >
        <div {...stylex.props(styles.editor, styles.editorOnly)}>{expanded}</div>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      {...(open ? { "data-editing": "" } : {})}
      {...(id === undefined ? {} : { id })}
      {...stylex.props(styles.row, open && styles.rowOpen)}
    >
      <div {...stylex.props(styles.rowMain, wideControl && styles.rowMainWide)}>
        <RowText
          label={label}
          labelId={labelId}
          labelFor={labelFor}
          info={info}
          detail={detail}
          detailTone={detailTone}
          detailMono={detailMono}
          disabled={disabled}
          value={value}
        />
        <span {...stylex.props(styles.rowEnd, wideControl && styles.rowEndWide)}>
          {value === undefined ? null : (
            <span {...stylex.props(textStyles("ui"), styles.value)}>{value}</span>
          )}
          <span role="status" {...stylex.props(textStyles("meta"), styles.status)}>
            {status}
          </span>
          {control}
        </span>
      </div>
      {message === undefined || message === null ? null : (
        <div {...stylex.props(styles.message)}>{message}</div>
      )}
      {open ? <div {...stylex.props(styles.editor)}>{expanded}</div> : null}
    </div>
  );
}

export interface SettingsLinkRowRenderProps {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export interface SettingsLinkRowProps {
  label: ReactNode;
  detail?: ReactNode;
  detailTone?: SettingsDetailTone;
  value?: ReactNode;
  id?: string;
  render: (props: SettingsLinkRowRenderProps) => ReactNode;
}

export function SettingsLinkRow({
  label,
  detail,
  detailTone = "default",
  value,
  id,
  render,
}: SettingsLinkRowProps) {
  return (
    <div {...(id === undefined ? {} : { id })} {...stylex.props(styles.row)}>
      {render({
        ...stylex.props(styles.rowMain, styles.linkRow, focusStyles.ringInset),
        children: (
          <>
            <RowText
              label={label}
              labelId={undefined}
              labelFor={undefined}
              info={undefined}
              detail={detail}
              detailTone={detailTone}
              detailMono={false}
              disabled={false}
              value={value}
            />
            <span {...stylex.props(styles.rowEnd)}>
              {value === undefined ? null : (
                <span {...stylex.props(textStyles("ui"), styles.value, styles.linkValue)}>
                  {value}
                </span>
              )}
              <span {...stylex.props(styles.chevron)}>
                <ChevronRightIcon />
              </span>
            </span>
          </>
        ),
      })}
    </div>
  );
}

function RowText({
  label,
  labelId,
  labelFor,
  info,
  detail,
  detailTone,
  detailMono,
  disabled,
  value,
}: {
  label: ReactNode;
  labelId: string | undefined;
  labelFor: string | undefined;
  info: ReactNode;
  detail: ReactNode;
  detailTone: SettingsDetailTone;
  detailMono: boolean;
  disabled: boolean;
  value: ReactNode;
}) {
  return (
    <span {...stylex.props(styles.rowText)}>
      <span {...stylex.props(styles.labelLine)}>
        {labelFor === undefined ? (
          <span
            {...(labelId === undefined ? {} : { id: labelId })}
            {...stylex.props(textStyles("title", disabled ? "disabled" : "strong"))}
          >
            {label}
          </span>
        ) : (
          <label
            htmlFor={labelFor}
            {...(labelId === undefined ? {} : { id: labelId })}
            {...stylex.props(
              textStyles("title", disabled ? "disabled" : "strong"),
              !disabled && styles.labelClickable,
            )}
          >
            {label}
          </label>
        )}
        {info === undefined || info === null ? null : (
          <span {...stylex.props(styles.infoSlot)}>{info}</span>
        )}
      </span>
      {detail === undefined || detail === null ? null : (
        <span
          {...stylex.props(
            textStyles("meta", detailTone === "problem" ? "problem" : undefined),
            detailMono && styles.mono,
            styles.detail,
          )}
        >
          {detail}
        </span>
      )}
      {value === undefined || value === null ? null : (
        <span {...stylex.props(textStyles("meta"), styles.detail, styles.valueBelow)}>{value}</span>
      )}
    </span>
  );
}

const NAV_TOP_HEIGHT = `calc(${size.iconButton} + 2 * ${space.s3} + ${space.s4})`;

const styles = stylex.create({
  frame: { containerType: "inline-size", minWidth: 0 },
  layout: {
    display: "grid",
    gridTemplateColumns: {
      default: `${size.settingsNavWidth} minmax(0, ${size.settingsBodyWidth})`,
      [breakpoints.settingsNavTop]: "minmax(0, 1fr)",
    },
    columnGap: space.s10,
    paddingTop: { default: space.s8, [breakpoints.settingsNavTop]: 0 },
    paddingInline: {
      default: space.s8,
      [breakpoints.settingsNavTop]: 0,
    },
    paddingBottom: `max(${space.s10}, var(--pinned-toast-space, 0px) + ${space.s10})`,
  },
  navColumn: {
    minWidth: 0,
    position: "sticky",
    top: { default: space.s8, [breakpoints.settingsNavTop]: 0 },
    alignSelf: "start",
    zIndex: 1,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.s10,
    minWidth: 0,
    paddingInline: { default: 0, [breakpoints.settingsNavTop]: space.s4 },
    paddingTop: { default: 0, [breakpoints.settingsNavTop]: space.s5 },
  },
  nav: {
    backgroundColor: { default: "transparent", [breakpoints.settingsNavTop]: colors.bgCanvas },
    borderBottomWidth: { default: 0, [breakpoints.settingsNavTop]: 1 },
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
  },
  navList: {
    display: "flex",
    flexDirection: { default: "column", [breakpoints.settingsNavTop]: "row" },
    gap: { default: space.px2, [breakpoints.settingsNavTop]: space.px6 },
    margin: 0,
    paddingBlock: { default: 0, [breakpoints.settingsNavTop]: space.s3 },
    paddingInline: { default: 0, [breakpoints.settingsNavTop]: space.s4 },
    listStyle: "none",
    overflowX: { default: "visible", [breakpoints.settingsNavTop]: "auto" },
    scrollbarWidth: "none",
  },
  navItem: { flexShrink: 0 },
  navLink: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: { default: size.control, [breakpoints.settingsNavTop]: size.iconButton },
    paddingInline: space.s3,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      [breakpoints.settingsNavTop]: colors.bgCard,
      ":hover": colors.bgHover,
    },
    color: colors.textSecondary,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  navLinkCurrent: {
    backgroundColor: {
      default: colors.bgSelected,
      [breakpoints.settingsNavTop]: colors.bgSelected,
      ":hover": colors.bgSelected,
    },
    color: colors.textPrimary,
  },
  problemDot: {
    flexShrink: 0,
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
    backgroundColor: colors.problem,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    scrollMarginTop: { default: space.s8, [breakpoints.settingsNavTop]: NAV_TOP_HEIGHT },
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    minHeight: size.control,
  },
  sectionTitle: { margin: 0 },
  sectionActions: { display: "flex", gap: space.s2, marginInlineStart: "auto" },
  group: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
    overflow: "clip",
  },
  row: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    borderTopWidth: { default: 0, ":not(:first-child)": 1 },
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  rowOpen: { backgroundColor: colors.bgCardHover },
  rowMain: {
    display: "flex",
    alignItems: "center",
    gap: { default: space.s4, [breakpoints.settingsRowStacked]: space.s3 },
    minHeight: size.rowMinHeight,
    paddingBlock: space.s3,
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
  },
  rowMainWide: { flexWrap: { default: "nowrap", [breakpoints.settingsRowStacked]: "wrap" } },
  rowEndWide: {
    flexBasis: { default: "auto", [breakpoints.settingsRowStacked]: "100%" },
    maxWidth: { default: "60%", [breakpoints.settingsRowStacked]: "100%" },
  },
  linkRow: {
    color: "inherit",
    textDecoration: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    flexGrow: 1,
    minWidth: 0,
  },
  labelClickable: { cursor: "pointer" },
  labelLine: { display: "block", minWidth: 0 },
  infoSlot: {
    display: "inline-flex",
    verticalAlign: "middle",
    marginInlineStart: space.s1,
    marginBlock: `calc(-1 * ${space.s1})`,
  },
  detail: { overflowWrap: "anywhere" },
  mono: { fontFamily: fonts.mono },
  rowEnd: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    flexShrink: 0,
    maxWidth: "60%",
    marginInlineStart: "auto",
  },
  valueBelow: { display: { default: "none", [breakpoints.settingsRowStacked]: "block" } },
  value: {
    display: { default: "inline", [breakpoints.settingsRowStacked]: "none" },
    minWidth: 0,
    color: colors.textSecondary,
    textAlign: "end",
    overflowWrap: "anywhere",
  },
  linkValue: { fontSize: fontSize.small },
  status: { whiteSpace: "nowrap" },
  chevron: { display: "inline-flex", color: colors.textTertiary },
  message: {
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
    paddingBottom: space.s3,
    marginTop: `calc(-1 * ${space.s1})`,
  },
  editorOnly: { paddingTop: space.s4 },
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
    paddingBottom: space.s4,
  },
});
