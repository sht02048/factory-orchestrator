import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderScreen } from "../../placeholder/placeholder-screen";

export const Route = createFileRoute("/_app/settings")({
  component: () => <PlaceholderScreen screen="settings" />,
});
