CREATE TABLE `run_control_requests` (
	`run_id` text PRIMARY KEY,
	`control` text NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`error` text,
	CONSTRAINT `fk_run_control_requests_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "run_control_requests_control" CHECK("control" IN ('pause', 'resume'))
);
--> statement-breakpoint
ALTER TABLE `runs` ADD `paused_since` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `paused_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `pause_source` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY,
	`tracker_connection_id` text NOT NULL,
	`ticket_key` text NOT NULL,
	`ticket_title` text,
	`workspace_id` text NOT NULL,
	`tracker_project_id` text NOT NULL,
	`runner_project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`model` text,
	`worktree_name` text NOT NULL,
	`branch` text,
	`state` text NOT NULL,
	`runner_id` text,
	`assigned_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`worktree_ref` text,
	`agent_ref` text,
	`start_requested_at` integer,
	`start_failures` integer DEFAULT 0 NOT NULL,
	`start_error` text,
	`agent_result` text,
	`pr_state` text,
	`runner_unreached` integer DEFAULT false NOT NULL,
	`report_body` text,
	`pr_id` text,
	`pr_display_id` text,
	`pr_url` text,
	`pr_ci_state` text,
	`pr_checked_at` integer,
	`later_pr_state` text,
	`later_pr_state_at` integer,
	`worktree_removed_at` integer,
	`tracker_state_set_at` integer,
	`tracker_comment_id` text,
	`tracker_commented_at` integer,
	`unreachable_since` integer,
	`paused_since` integer,
	`paused_ms` integer DEFAULT 0 NOT NULL,
	`pause_source` text,
	`last_log` text,
	CONSTRAINT `fk_runs_tracker_connection_id_tracker_connections_id_fk` FOREIGN KEY (`tracker_connection_id`) REFERENCES `tracker_connections`(`id`),
	CONSTRAINT `fk_runs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_runs_runner_id_runners_id_fk` FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`),
	CONSTRAINT "runs_state" CHECK("state" IN ('queued', 'running', 'waiting-for-input', 'paused', 'disconnected', 'ended')),
	CONSTRAINT "runs_agent_result" CHECK("agent_result" IN ('reported-success', 'reported-failure', 'ended-without-report', 'timed-out', 'stopped-waiting-for-input', 'runner-disconnected', 'worktree-missing', 'canceled', 'could-not-start')),
	CONSTRAINT "runs_pr_state" CHECK("pr_state" IN ('none', 'open', 'merged', 'closed')),
	CONSTRAINT "runs_later_pr_state" CHECK("later_pr_state" IN ('merged', 'closed')),
	CONSTRAINT "runs_last_log_json" CHECK("last_log" IS NULL OR json_valid("last_log")),
	CONSTRAINT "runs_runner_unreached" CHECK("runner_unreached" IN (0, 1)),
	CONSTRAINT "runs_queued_not_started" CHECK("state" <> 'queued' OR "started_at" IS NULL),
	CONSTRAINT "runs_active_started" CHECK("state" NOT IN ('running', 'waiting-for-input', 'paused', 'disconnected') OR "started_at" IS NOT NULL),
	CONSTRAINT "runs_paused_since_iff_paused" CHECK(("state" = 'paused') = ("paused_since" IS NOT NULL)),
	CONSTRAINT "runs_paused_ms" CHECK("paused_ms" >= 0),
	CONSTRAINT "runs_pause_source" CHECK("pause_source" IN ('operator')),
	CONSTRAINT "runs_paused_has_source" CHECK("state" <> 'paused' OR "pause_source" IS NOT NULL),
	CONSTRAINT "runs_started_has_runner_worktree" CHECK("started_at" IS NULL OR ("runner_id" IS NOT NULL AND "worktree_ref" IS NOT NULL AND "branch" IS NOT NULL AND "agent_ref" IS NOT NULL)),
	CONSTRAINT "runs_not_started_ended" CHECK("state" <> 'ended' OR "started_at" IS NOT NULL OR ("agent_result" IN ('canceled', 'could-not-start') AND "pr_state" = 'none' AND "worktree_ref" IS NULL)),
	CONSTRAINT "runs_could_not_start_not_started" CHECK("agent_result" IS NULL OR "agent_result" <> 'could-not-start' OR "started_at" IS NULL),
	CONSTRAINT "runs_runner_unreached_canceled" CHECK("runner_unreached" = 0 OR ("agent_result" = 'canceled' AND "started_at" IS NOT NULL)),
	CONSTRAINT "runs_ended_at_iff_ended" CHECK(("state" = 'ended') = ("ended_at" IS NOT NULL)),
	CONSTRAINT "runs_agent_result_iff_ended" CHECK(("state" = 'ended') = ("agent_result" IS NOT NULL)),
	CONSTRAINT "runs_pr_state_iff_ended" CHECK(("state" = 'ended') = ("pr_state" IS NOT NULL)),
	CONSTRAINT "runs_later_pr_state_ended" CHECK("later_pr_state" IS NULL OR "state" = 'ended')
);
--> statement-breakpoint
INSERT INTO `__new_runs`(`id`, `tracker_connection_id`, `ticket_key`, `ticket_title`, `workspace_id`, `tracker_project_id`, `runner_project_id`, `agent_id`, `model`, `worktree_name`, `branch`, `state`, `runner_id`, `assigned_at`, `started_at`, `ended_at`, `worktree_ref`, `agent_ref`, `start_requested_at`, `start_failures`, `start_error`, `agent_result`, `pr_state`, `runner_unreached`, `report_body`, `pr_id`, `pr_display_id`, `pr_url`, `pr_ci_state`, `pr_checked_at`, `later_pr_state`, `later_pr_state_at`, `worktree_removed_at`, `tracker_state_set_at`, `tracker_comment_id`, `tracker_commented_at`, `unreachable_since`, `last_log`) SELECT `id`, `tracker_connection_id`, `ticket_key`, `ticket_title`, `workspace_id`, `tracker_project_id`, `runner_project_id`, `agent_id`, `model`, `worktree_name`, `branch`, `state`, `runner_id`, `assigned_at`, `started_at`, `ended_at`, `worktree_ref`, `agent_ref`, `start_requested_at`, `start_failures`, `start_error`, `agent_result`, `pr_state`, `runner_unreached`, `report_body`, `pr_id`, `pr_display_id`, `pr_url`, `pr_ci_state`, `pr_checked_at`, `later_pr_state`, `later_pr_state_at`, `worktree_removed_at`, `tracker_state_set_at`, `tracker_comment_id`, `tracker_commented_at`, `unreachable_since`, `last_log` FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_one_active_per_ticket` ON `runs` (`tracker_connection_id`,`ticket_key`) WHERE "runs"."state" <> 'ended';--> statement-breakpoint
CREATE INDEX `runs_ticket` ON `runs` (`tracker_connection_id`,`ticket_key`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `runs_state` ON `runs` (`state`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `runs_workspace` ON `runs` (`workspace_id`,`assigned_at`);