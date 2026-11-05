CREATE TABLE "dependency_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dependency_id" uuid NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_reference" varchar(500),
	"discovery_run_id" uuid,
	"evidence_kind" varchar(16) NOT NULL,
	"evidence_reference" varchar(500),
	"source_version" varchar(100),
	"confidence" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dependency_evidence_source_check" CHECK ("dependency_evidence"."source_type" in ('manual','agent_configuration','workflow_definition','permission_configuration','runtime_event','external_integration')),
	CONSTRAINT "dependency_evidence_kind_check" CHECK ("dependency_evidence"."evidence_kind" in ('declared','configured','observed')),
	CONSTRAINT "dependency_evidence_confidence_check" CHECK ("dependency_evidence"."confidence" >= 0 and "dependency_evidence"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "resources" DROP CONSTRAINT "resources_type_check";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_type" varchar(64);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "owner_reference" varchar(255);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "external_reference" varchar(255);--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "external_reference" varchar(255);--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dependency_evidence" ADD CONSTRAINT "dependency_evidence_dependency_fk" FOREIGN KEY ("dependency_id","organization_id") REFERENCES "public"."dependencies"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dependency_evidence_dep_idx" ON "dependency_evidence" USING btree ("organization_id","dependency_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dependency_evidence_run_unique" ON "dependency_evidence" USING btree ("dependency_id","discovery_run_id","source_type",coalesce("source_reference", '')) WHERE "dependency_evidence"."discovery_run_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_org_external_ref_unique" ON "agents" USING btree ("organization_id",lower("external_reference")) WHERE "agents"."external_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "resources_org_external_ref_unique" ON "resources" USING btree ("organization_id",lower("external_reference")) WHERE "resources"."external_reference" is not null;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_type_check" CHECK ("resources"."resource_type" in ('api','database','wallet','credential','storage','service','workflow','mcp_server','queue','other'));