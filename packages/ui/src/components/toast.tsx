import * as stylex from "@stylexjs/stylex";
import { Toast, ToastRegion, ToastTitle, toast } from "@ui-sdk/react/toast";
import { cx } from "../cx";
import { colors, fontSize, motion, radius, shadow, space } from "../tokens.stylex";

/*
 * 끝난 행동을 알리는 짧은 한 줄(저장했어요, 할당했어요). 스스로 사라진다.
 * 실패처럼 사람이 읽고 판단해야 하는 내용은 토스트가 아니라 화면 안에 남긴다.
 *
 * 앱 루트에 <Toaster label="알림" /> 를 한 번 두고, 행동이 끝나면 showToast("저장했어요") 를 부른다.
 */

export function showToast(message: string): void {
  toast(message);
}

export interface ToasterProps {
  /** 알림 영역의 접근 가능한 이름. 메시지 파일의 글을 넘긴다. */
  label: string;
}

export function Toaster({ label }: ToasterProps) {
  return (
    <ToastRegion aria-label={label} className={cx(styles.region)}>
      {() => (
        <Toast
          className={(s) => cx(styles.toast, s.front && styles.front, s.leaving && styles.leaving)}
        >
          <ToastTitle className={cx(styles.title)} />
        </Toast>
      )}
    </ToastRegion>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(6px)" },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  region: {
    position: "fixed",
    right: space.s6,
    bottom: space.s6,
    zIndex: 300,
    width: 320,
    height: "var(--toast-front-height, 0px)",
  },
  toast: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInline: space.s4,
    borderRadius: radius.md,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
    color: colors.textPrimary,
    fontSize: fontSize.ui,
    // 시안 B 처럼 한 번에 하나만 보인다. 뒤로 밀린 토스트는 흐려지며 사라진다.
    opacity: 0,
    animationName: { default: rise, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: motion.durationToast,
    animationTimingFunction: motion.easeOut,
    transitionProperty: "opacity, transform",
    transitionDuration: motion.durationToast,
    transitionTimingFunction: motion.easeOut,
    userSelect: "none",
  },
  front: { opacity: 1 },
  leaving: { opacity: 0, transform: "translateY(6px)" },
  title: { margin: 0 },
});
