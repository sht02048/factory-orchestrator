import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChangeChannel } from "./channel";
import type { ChangeChannelTarget } from "./channel";

export function queryClientTarget(queryClient: QueryClient): ChangeChannelTarget {
  return {
    invalidate: (keys) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    },
    invalidateAll: () => void queryClient.invalidateQueries(),
    refetchVisible: () => void queryClient.refetchQueries({ type: "active" }),
  };
}

const RenderedChangeSeq = createContext<number | null>(null);

export function RenderedChangeSeqProvider({
  seq,
  children,
}: {
  seq: number | null;
  children: ReactNode;
}) {
  const [first] = useState(seq);
  return <RenderedChangeSeq.Provider value={first}>{children}</RenderedChangeSeq.Provider>;
}

export function ChangeEventsSubscription() {
  const queryClient = useQueryClient();
  const renderedSeq = useContext(RenderedChangeSeq);
  const [after] = useState(renderedSeq);
  useEffect(() => {
    const channel = new ChangeChannel({
      after,
      open: (url) => new EventSource(url),
      target: queryClientTarget(queryClient),
    });
    const followVisibility = () => {
      if (document.visibilityState === "hidden") channel.hide();
      else channel.show();
    };
    channel.start();
    followVisibility();
    document.addEventListener("visibilitychange", followVisibility);
    return () => {
      document.removeEventListener("visibilitychange", followVisibility);
      channel.close();
    };
  }, [after, queryClient]);
  return null;
}
