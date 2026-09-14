CREATE TABLE `report_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`template_key` text,
	`template_name` text
);
--> statement-breakpoint
CREATE TABLE `report_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`file_key` text NOT NULL,
	`filename` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_share_token` ON `report_shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `report_share_owner` ON `report_shares` (`user_id`);