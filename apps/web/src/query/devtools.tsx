import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { announceQueryDevtools, onQueryDevtoolsToggle } from "./devtools-toggle";

const ReactQueryDevtoolsPanel = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((devtools) => ({
        default: devtools.ReactQueryDevtoolsPanel,
      })),
    )
  : null;

const panelPlacement: CSSProperties = {
  position: "fixed",
  insetInline: 0,
  bottom: 0,
  height: "50vh",
  zIndex: 2147483646,
};

export function QueryDevtools() {
  return ReactQueryDevtoolsPanel === null ? null : <ToggledQueryDevtools />;
}

function ToggledQueryDevtools() {
  const [shown, setShown] = useState(false);
  useEffect(() => onQueryDevtoolsToggle(window, () => setShown((current) => !current)), []);
  useEffect(() => announceQueryDevtools(window, shown), [shown]);
  if (ReactQueryDevtoolsPanel === null || !shown) return null;
  return (
    <ClientOnly>
      <Suspense fallback={null}>
        <ReactQueryDevtoolsPanel style={panelPlacement} onClose={() => setShown(false)} />
      </Suspense>
    </ClientOnly>
  );
}
