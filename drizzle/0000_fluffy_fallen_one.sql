CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`merchant` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`raw` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`fingerprint` text NOT NULL,
	`trip_id` text,
	`reviewed` integer DEFAULT 0 NOT NULL,
	`attachment_key` text,
	`attachment_name` text,
	`attachment_type` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receipts_owner_date` ON `receipts` (`user_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_owner_fingerprint` ON `receipts` (`user_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trips_owner` ON `trips` (`user_id`);