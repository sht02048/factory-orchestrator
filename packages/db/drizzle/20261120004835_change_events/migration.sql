CREATE TABLE `change_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`target_id` text,
	`workspace_id` text,
	`part` text,
	`at` integer NOT NULL,
	CONSTRAINT "change_events_kind" CHECK("kind" IN ('run', 'runner', 'assignment', 'workspace', 'settings', 'tracker')),
	CONSTRAINT "change_events_part" CHECK("part" IN ('log'))
);
--> statement-breakpoint
CREATE TABLE `change_events_pruned` (
	`id` integer PRIMARY KEY,
	`through_seq` integer NOT NULL,
	CONSTRAINT "change_events_pruned_single" CHECK("id" = 1),
	CONSTRAINT "change_events_pruned_through" CHECK("through_seq" >= 0)
);
--> statement-breakpoint
CREATE INDEX `change_events_at` ON `change_events` (`at`);