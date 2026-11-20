CREATE TABLE `tracker_webhook_receipts` (
	`tracker_connection_id` text PRIMARY KEY,
	`last_received_at` integer,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	`first_rejected_at` integer,
	CONSTRAINT `fk_tracker_webhook_receipts_tracker_connection_id_tracker_connections_id_fk` FOREIGN KEY (`tracker_connection_id`) REFERENCES `tracker_connections`(`id`) ON DELETE CASCADE,
	CONSTRAINT "tracker_webhook_receipts_rejected_count" CHECK("rejected_count" >= 0),
	CONSTRAINT "tracker_webhook_receipts_first_rejected" CHECK(("rejected_count" = 0) = ("first_rejected_at" IS NULL))
);
