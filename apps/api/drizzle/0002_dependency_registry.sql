CREATE TABLE "dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_agent_id" uuid,
	"source_resource_id" uuid,
	"source_id" uuid GENERATED ALWAYS AS (coalesce(source_agent_id, source_resource_id)) STORED,
	"target_type" varchar(16) NOT NULL,
	"target_agent_id" uuid,
	"target_resource_id" uuid,
	"target_id" uuid GENERATED ALWAYS AS (coalesce(target_agent_id, target_resource_id)) STORED,
	"dependency_type" varchar(16) NOT NULL,
	"relationship" varchar(100) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"observed_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dependencies_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "dependencies_source_type_check" CHECK ("dependencies"."source_type" in ('agent','resource')),
	CONSTRAINT "dependencies_target_type_check" CHECK ("dependencies"."target_type" in ('agent','resource')),
	CONSTRAINT "dependencies_type_check" CHECK ("dependencies"."dependency_type" in ('authority','resource','operational')),
	CONSTRAINT "dependencies_status_check" CHECK ("dependencies"."status" in ('active','inactive')),
	CONSTRAINT "dependencies_confidence_check" CHECK ("dependencies"."confidence" >= 0 and "dependencies"."confidence" <= 1),
	CONSTRAINT "dependencies_version_check" CHECK ("dependencies"."version" >= 1),
	CONSTRAINT "dependencies_relationship_not_blank" CHECK (length(btrim("dependencies"."relationship")) > 0),
	CONSTRAINT "dependencies_source_ref_check" CHECK (("dependencies"."source_type" = 'agent' and "dependencies"."source_agent_id" is not null and "dependencies"."source_resource_id" is null)
        or ("dependencies"."source_type" = 'resource' and "dependencies"."source_resource_id" is not null and "dependencies"."source_agent_id" is null)),
	CONSTRAINT "dependencies_target_ref_check" CHECK (("dependencies"."target_type" = 'agent' and "dependencies"."target_agent_id" is not null and "dependencies"."target_resource_id" is null)
        or ("dependencies"."target_type" = 'resource' and "dependencies"."target_resource_id" is not null and "dependencies"."target_agent_id" is null)),
	CONSTRAINT "dependencies_no_self_reference" CHECK (not ("dependencies"."source_type" = "dependencies"."target_type" and coalesce("dependencies"."source_agent_id", "dependencies"."source_resource_id") = coalesce("dependencies"."target_agent_id", "dependencies"."target_resource_id"))),
	CONSTRAINT "dependencies_type_matrix_check" CHECK (("dependencies"."dependency_type" = 'authority' and "dependencies"."source_type" = 'agent' and "dependencies"."target_type" = 'agent')
        or ("dependencies"."dependency_type" = 'resource' and "dependencies"."source_type" = 'agent' and "dependencies"."target_type" = 'resource')
        or ("dependencies"."dependency_type" = 'operational' and not ("dependencies"."source_type" = 'resource' and "dependencies"."target_type" = 'resource')))
);
--> statement-breakpoint
CREATE TABLE "dependency_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dependency_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dependency_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dependency_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"change_type" varchar(16) NOT NULL,
	"changed_by" uuid,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dependency_versions_change_check" CHECK ("dependency_versions"."change_type" in ('created','updated','activated','deactivated','removed'))
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"resource_type" varchar(32) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "resources_type_check" CHECK ("resources"."resource_type" in ('api','database','wallet','credential','storage','service','workflow','other')),
	CONSTRAINT "resources_name_not_blank" CHECK (length(btrim("resources"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_id_org_unique" UNIQUE("id","organization_id");
--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_source_agent_fk" FOREIGN KEY ("source_agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_source_resource_fk" FOREIGN KEY ("source_resource_id","organization_id") REFERENCES "public"."resources"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_target_agent_fk" FOREIGN KEY ("target_agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_target_resource_fk" FOREIGN KEY ("target_resource_id","organization_id") REFERENCES "public"."resources"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency_audit_logs" ADD CONSTRAINT "dependency_audit_logs_dependency_fk" FOREIGN KEY ("dependency_id","organization_id") REFERENCES "public"."dependencies"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency_versions" ADD CONSTRAINT "dependency_versions_dependency_fk" FOREIGN KEY ("dependency_id","organization_id") REFERENCES "public"."dependencies"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dependencies_pair_unique" ON "dependencies" USING btree ("organization_id","source_type",coalesce("source_agent_id", "source_resource_id"),"target_type",coalesce("target_agent_id", "target_resource_id"),"dependency_type");--> statement-breakpoint
CREATE INDEX "dependencies_org_source_idx" ON "dependencies" USING btree ("organization_id","source_type","source_agent_id","source_resource_id");--> statement-breakpoint
CREATE INDEX "dependencies_org_target_idx" ON "dependencies" USING btree ("organization_id","target_type","target_agent_id","target_resource_id");--> statement-breakpoint
CREATE INDEX "dependencies_org_type_status_idx" ON "dependencies" USING btree ("organization_id","dependency_type","status");--> statement-breakpoint
CREATE INDEX "dependencies_org_created_idx" ON "dependencies" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "dependency_audit_logs_dep_idx" ON "dependency_audit_logs" USING btree ("organization_id","dependency_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dependency_versions_unique" ON "dependency_versions" USING btree ("dependency_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_org_name_unique" ON "resources" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "resources_org_created_idx" ON "resources" USING btree ("organization_id","created_at","id");