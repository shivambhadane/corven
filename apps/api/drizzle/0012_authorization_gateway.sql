CREATE TABLE "agent_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"secret_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "agent_credentials_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "agent_credentials_status_check" CHECK ("agent_credentials"."status" in ('active','revoked')),
	CONSTRAINT "agent_credentials_hash_check" CHECK ("agent_credentials"."secret_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "credential_rotation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"previous_credential_id" uuid,
	"action" varchar(16) NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" varchar(8) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_history_action_check" CHECK ("credential_rotation_history"."action" in ('issued','rotated','revoked'))
);
--> statement-breakpoint
CREATE TABLE "enforcement_action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "enforcement_action_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enforcement_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid,
	"plan_hash" varchar(64),
	"edge_id" uuid,
	"kind" varchar(32) NOT NULL,
	"agent_id" uuid,
	"resource_id" uuid,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"adapter" varchar(64),
	"approval_basis" varchar(24) NOT NULL,
	"approval_ref" varchar(200),
	"reason" text NOT NULL,
	"result" jsonb,
	"failure_reason" text,
	"external_reference" varchar(500),
	"idempotency_key" varchar(200),
	"requested_by" uuid NOT NULL,
	"requested_by_type" varchar(8) NOT NULL,
	"correlation_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enforcement_actions_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "enforcement_actions_status_check" CHECK ("enforcement_actions"."status" in ('pending','submitted','executed','failed','unsupported','rolled_back')),
	CONSTRAINT "enforcement_actions_kind_check" CHECK ("enforcement_actions"."kind" in ('revoke_resource_access','suspend_agent','revoke_credentials','revoke_authority','block_operational_trigger')),
	CONSTRAINT "enforcement_actions_basis_check" CHECK ("enforcement_actions"."approval_basis" in ('plan_approval','admin_override'))
);
--> statement-breakpoint
CREATE TABLE "execution_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"resource_ref" varchar(200) NOT NULL,
	"resource_id" uuid,
	"action" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"precheck_decision_id" uuid,
	"recheck_decision_id" uuid,
	"executor" varchar(64),
	"simulated" boolean DEFAULT false NOT NULL,
	"external_reference" varchar(500),
	"failure_reason" text,
	"result" jsonb,
	"payload_hash" varchar(64),
	"correlation_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_records_status_check" CHECK ("execution_records"."status" in ('pending','denied','failed','submitted','executed'))
);
--> statement-breakpoint
CREATE TABLE "gateway_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" varchar(8) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"correlation_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"stage" varchar(12) NOT NULL,
	"resource_ref" varchar(200) NOT NULL,
	"resource_id" uuid,
	"action" varchar(64) NOT NULL,
	"decision" varchar(8) NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"permission_id" uuid,
	"permission_version" integer,
	"payload_hash" varchar(64),
	"credential_id" uuid,
	"correlation_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_decisions_stage_check" CHECK ("gateway_decisions"."stage" in ('check','precheck','recheck')),
	CONSTRAINT "gateway_decisions_decision_check" CHECK ("gateway_decisions"."decision" in ('allow','deny'))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "permissions_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "permissions_status_check" CHECK ("permissions"."status" in ('active','revoked')),
	CONSTRAINT "permissions_action_check" CHECK (length(btrim("permissions"."action")) > 0)
);
--> statement-breakpoint
CREATE TABLE "resource_enforcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"mode" varchar(16) NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_enforcement_unique" UNIQUE("organization_id","resource_id"),
	CONSTRAINT "resource_enforcement_mode_check" CHECK ("resource_enforcement"."mode" in ('gateway','advisory'))
);
--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agent_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_rotation_history" ADD CONSTRAINT "credential_history_credential_fk" FOREIGN KEY ("credential_id","organization_id") REFERENCES "public"."agent_credentials"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_action_events" ADD CONSTRAINT "enforcement_action_events_action_fk" FOREIGN KEY ("action_id","organization_id") REFERENCES "public"."enforcement_actions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_agent_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_resource_fk" FOREIGN KEY ("resource_id","organization_id") REFERENCES "public"."resources"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_agent_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_resource_fk" FOREIGN KEY ("resource_id","organization_id") REFERENCES "public"."resources"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_enforcement" ADD CONSTRAINT "resource_enforcement_resource_fk" FOREIGN KEY ("resource_id","organization_id") REFERENCES "public"."resources"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_one_active" ON "agent_credentials" USING btree ("agent_id") WHERE "agent_credentials"."status" = 'active';--> statement-breakpoint
CREATE INDEX "agent_credentials_agent_idx" ON "agent_credentials" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "credential_history_agent_idx" ON "credential_rotation_history" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "enforcement_action_events_idx" ON "enforcement_action_events" USING btree ("organization_id","action_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "enforcement_actions_idem" ON "enforcement_actions" USING btree ("organization_id","idempotency_key") WHERE "enforcement_actions"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "enforcement_actions_restriction_idx" ON "enforcement_actions" USING btree ("organization_id","agent_id","resource_id","status");--> statement-breakpoint
CREATE INDEX "enforcement_actions_incident_idx" ON "enforcement_actions" USING btree ("organization_id","incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_records_request_unique" ON "execution_records" USING btree ("organization_id","agent_id","request_id");--> statement-breakpoint
CREATE INDEX "execution_records_agent_idx" ON "execution_records" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "gateway_audit_logs_idx" ON "gateway_audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_decisions_request_stage" ON "gateway_decisions" USING btree ("organization_id","agent_id","request_id","stage");--> statement-breakpoint
CREATE INDEX "gateway_decisions_agent_idx" ON "gateway_decisions" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_one_active" ON "permissions" USING btree ("organization_id","agent_id","resource_id","action") WHERE "permissions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "permissions_lookup_idx" ON "permissions" USING btree ("organization_id","agent_id","resource_id","status");