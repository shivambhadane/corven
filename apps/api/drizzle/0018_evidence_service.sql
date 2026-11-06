CREATE TABLE "evidence_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"target" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"anchored_hash" varchar(64) NOT NULL,
	"external_reference" varchar(200),
	"chain_id" integer,
	"contract_address" varchar(64),
	"block_number" bigint,
	"confirmations" integer,
	"required_confirmations" integer,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_anchors_one_per_target" UNIQUE("evidence_id","target"),
	CONSTRAINT "evidence_anchors_target_check" CHECK ("evidence_anchors"."target" in ('arkiv','ethereum')),
	CONSTRAINT "evidence_anchors_status_check" CHECK ("evidence_anchors"."status" in ('submitted','confirmed','failed'))
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"previous_evidence_id" uuid,
	"previous_hash" varchar(64),
	"content" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_by_type" varchar(8) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_records_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "evidence_records_sequence_unique" UNIQUE("incident_id","sequence"),
	CONSTRAINT "evidence_records_status_check" CHECK ("evidence_records"."status" in ('sealed','anchor_pending','anchored','anchor_failed','verified','invalid')),
	CONSTRAINT "evidence_records_hash_check" CHECK ("evidence_records"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "evidence_verification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"valid" boolean NOT NULL,
	"checks" jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD CONSTRAINT "evidence_anchors_evidence_fk" FOREIGN KEY ("evidence_id","organization_id") REFERENCES "public"."evidence_records"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_verification_logs" ADD CONSTRAINT "evidence_verification_logs_evidence_fk" FOREIGN KEY ("evidence_id","organization_id") REFERENCES "public"."evidence_records"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_records_incident_idx" ON "evidence_records" USING btree ("organization_id","incident_id","sequence");--> statement-breakpoint
CREATE INDEX "evidence_verification_logs_idx" ON "evidence_verification_logs" USING btree ("organization_id","evidence_id","created_at");