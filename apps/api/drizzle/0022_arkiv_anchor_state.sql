ALTER TABLE "evidence_anchors" ADD COLUMN "error_code" varchar(40);--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD COLUMN "retryable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD COLUMN "external_tx" varchar(200);--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD COLUMN "external_expires_block" bigint;