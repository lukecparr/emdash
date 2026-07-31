CREATE TABLE `pull_request_viewer_flags` (
	`pull_request_url` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`review_requested` integer DEFAULT 0 NOT NULL,
	`authored` integer DEFAULT 0 NOT NULL,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`pull_request_url`, `provider_account_id`),
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_prvf_provider_account_id` ON `pull_request_viewer_flags` (`provider_account_id`);