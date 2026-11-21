ALTER TABLE `runs` ADD `agent_brief` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `brief_before` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `brief_after` text DEFAULT '' NOT NULL;