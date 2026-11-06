CREATE TABLE "graph_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"label" varchar(200),
	"incident_id" uuid,
	"created_by" uuid,
	"node_count" integer NOT NULL,
	"edge_count" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"built_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_snapshots_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "graph_snapshots_hash_check" CHECK (length("graph_snapshots"."content_hash") = 64),
	CONSTRAINT "graph_snapshots_counts_check" CHECK ("graph_snapshots"."node_count" >= 0 and "graph_snapshots"."edge_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "graph_snapshots_org_created_idx" ON "graph_snapshots" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "graph_snapshots_org_incident_idx" ON "graph_snapshots" USING btree ("organization_id","incident_id");