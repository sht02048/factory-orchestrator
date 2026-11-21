ALTER TABLE `runs` ADD `continued_from_run_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `continue_message` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `continue_place` text;--> statement-breakpoint
CREATE INDEX `runs_continued_from` ON `runs` (`continued_from_run_id`);