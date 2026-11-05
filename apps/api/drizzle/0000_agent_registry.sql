CREATE TABLE "agent_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"capability" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"identity_type" varchar(32) NOT NULL,
	"identity_value" varchar(255) NOT NULL,
	"verification_status" varchar(32) DEFAULT 'unverified' NOT NULL,
	"chain_id" integer,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identities_type_check" CHECK ("agent_identities"."identity_type" in ('ens','evm_address','did','api_client','other')),
	CONSTRAINT "agent_identities_verification_check" CHECK ("agent_identities"."verification_status" in ('unverified','pending','verified','failed')),
	CONSTRAINT "agent_identities_verified_at_check" CHECK (("agent_identities"."verification_status" = 'verified') = ("agent_identities"."verified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "agent_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"previous_status" varchar(32),
	"new_status" varchar(32) NOT NULL,
	"actor_id" uuid,
	"reason" text NOT NULL,
	"incident_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_status_history_new_check" CHECK ("agent_status_history"."new_status" in ('active','suspended','compromised','inactive')),
	CONSTRAINT "agent_status_history_prev_check" CHECK ("agent_status_history"."previous_status" is null or "agent_status_history"."previous_status" in ('active','suspended','compromised','inactive'))
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"agent_type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_status_check" CHECK ("agents"."status" in ('active','suspended','compromised','inactive')),
	CONSTRAINT "agents_type_check" CHECK ("agents"."agent_type" in ('llm','workflow','service','wallet','other')),
	CONSTRAINT "agents_name_not_blank" CHECK (length(btrim("agents"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status_history" ADD CONSTRAINT "agent_status_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_audit_logs_agent_idx" ON "agent_audit_logs" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_capabilities_unique" ON "agent_capabilities" USING btree ("agent_id","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identities_org_unique" ON "agent_identities" USING btree ("organization_id","identity_type",lower("identity_value"),coalesce("chain_id", 0));--> statement-breakpoint
CREATE INDEX "agent_identities_agent_idx" ON "agent_identities" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_status_history_agent_idx" ON "agent_status_history" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_org_name_unique" ON "agents" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "agents_org_status_idx" ON "agents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "agents_org_type_idx" ON "agents" USING btree ("organization_id","agent_type");--> statement-breakpoint
CREATE INDEX "agents_org_created_idx" ON "agents" USING btree ("organization_id","created_at","id");