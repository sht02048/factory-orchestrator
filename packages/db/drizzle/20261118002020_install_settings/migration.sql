CREATE TABLE `install_settings` (
	`id` integer PRIMARY KEY,
	`instance_id` text NOT NULL,
	`web_address` text,
	`webhook_address` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "install_settings_single_row" CHECK("id" = 1)
);
