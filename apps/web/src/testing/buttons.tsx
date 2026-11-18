import { Button, type ButtonVariant } from "@factory/ui";
import { renderToString } from "react-dom/server";

/*
 * 렌더한 HTML 에서 버튼(<button>)의 변형을 읽는다. 버튼 변형은 StyleX 클래스로만 갈리므로
 * 같은 변형의 기준 버튼을 그려 클래스 묶음이 같은지로 가린다. 못 쓰는 상태(disabled)도 따로 그린다.
 */

const VARIANTS: ReadonlyArray<ButtonVariant> = ["primary", "secondary", "danger", "ghost"];

const classOf = (html: string): string => /class="([^"]*)"/.exec(html)?.[1] ?? "";

const reference = new Map<string, ButtonVariant>(
  VARIANTS.flatMap((variant) => [
    [classOf(renderToString(<Button variant={variant}>x</Button>)), variant],
    [
      classOf(
        renderToString(
          <Button variant={variant} disabled>
            x
          </Button>,
        ),
      ),
      variant,
    ],
  ]),
);

export interface RenderedButton {
  variant: ButtonVariant | "other";
  label: string;
}

export function buttonsOf(html: string): RenderedButton[] {
  return [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map((m) => ({
    variant: reference.get(classOf(m[1] ?? "")) ?? "other",
    label: (m[2] ?? "").replace(/<[^>]+>/g, "").trim(),
  }));
}
