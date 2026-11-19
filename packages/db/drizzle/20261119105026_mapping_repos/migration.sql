CREATE TABLE `mapping_repos` (
	`tracker_connection_id` text NOT NULL,
	`tracker_project_id` text NOT NULL,
	`runner_project_id` text NOT NULL,
	`is_default` integer NOT NULL,
	`label_id` text,
	`position` integer NOT NULL,
	CONSTRAINT `mapping_repos_pk` PRIMARY KEY(`tracker_connection_id`, `tracker_project_id`, `runner_project_id`),
	CONSTRAINT `fk_mapping_repos_tracker_connection_id_tracker_project_id_mappings_tracker_connection_id_tracker_project_id_fk` FOREIGN KEY (`tracker_connection_id`,`tracker_project_id`) REFERENCES `mappings`(`tracker_connection_id`,`tracker_project_id`) ON DELETE CASCADE,
	CONSTRAINT "mapping_repos_is_default" CHECK("is_default" IN (0, 1)),
	CONSTRAINT "mapping_repos_default_no_label" CHECK("is_default" = 0 OR "label_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_repos_one_default` ON `mapping_repos` (`tracker_connection_id`,`tracker_project_id`) WHERE "mapping_repos"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_repos_label_once` ON `mapping_repos` (`tracker_connection_id`,`tracker_project_id`,`label_id`) WHERE "mapping_repos"."label_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO `mapping_repos` (`tracker_connection_id`, `tracker_project_id`, `runner_project_id`, `is_default`, `label_id`, `position`) SELECT `tracker_connection_id`, `tracker_project_id`, `runner_project_id`, 1, NULL, 0 FROM `mappings`;--> statement-breakpoint
ALTER TABLE `mappings` DROP COLUMN `runner_project_id`;