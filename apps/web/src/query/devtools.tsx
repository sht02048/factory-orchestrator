import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";
import { onQueryDevtoolsToggle } from "./devtools-toggle";

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((devtools) => ({
        default: devtools.ReactQueryDevtools,
      })),
    )
  : null;

export function QueryDevtools() {
  return ReactQueryDevtools === null ? null : <ToggledQueryDevtools />;
}

function ToggledQueryDevtools() {
  const [shown, setShown] = useState(false);
  useEffect(() => onQueryDevtoolsToggle(window, () => setShown((current) => !current)), []);
  if (ReactQueryDevtools === null || !shown) return null;
  return (
    <ClientOnly>
      <Suspense fallback={null}>
        <ReactQueryDevtools initialIsOpen buttonPosition="bottom-left" />
      </Suspense>
    </ClientOnly>
  );
}
