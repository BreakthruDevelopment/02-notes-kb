CREATE TABLE "ai_usage" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_day_kind_pk" PRIMARY KEY("day","kind"),
	CONSTRAINT "ai_usage_kind_chk" CHECK ("ai_usage"."kind" in ('embed','ask'))
);
--> statement-breakpoint
CREATE TABLE "ask_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"sources" integer DEFAULT 0 NOT NULL,
	"refused" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ask_event_mode_chk" CHECK ("ask_event"."mode" in ('vector','keyword','demo'))
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"index_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_title_len" CHECK (char_length("note"."title") between 1 and 200),
	CONSTRAINT "note_visibility_chk" CHECK ("note"."visibility" in ('private','workspace')),
	CONSTRAINT "note_index_status_chk" CHECK ("note"."index_status" in ('ready','pending')),
	CONSTRAINT "note_body_len" CHECK (char_length("note"."body") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "note_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(768),
	"embedding_model" text,
	"search_text" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
	CONSTRAINT "note_chunk_note_ord_uq" UNIQUE("note_id","ord"),
	CONSTRAINT "note_chunk_content_len" CHECK (char_length("note_chunk"."content") <= 1500),
	CONSTRAINT "note_chunk_search_text_len" CHECK (char_length("note_chunk"."search_text") <= 1710)
);
--> statement-breakpoint
CREATE TABLE "note_share" (
	"note_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"permission" text DEFAULT 'read' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_share_note_id_user_id_pk" PRIMARY KEY("note_id","user_id"),
	CONSTRAINT "note_share_permission_chk" CHECK ("note_share"."permission" in ('read','edit'))
);
--> statement-breakpoint
CREATE TABLE "rate_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_event_kind_chk" CHECK ("rate_event"."kind" in ('share','demo_load'))
);
--> statement-breakpoint
DROP TABLE "item" CASCADE;--> statement-breakpoint
ALTER TABLE "ask_event" ADD CONSTRAINT "ask_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_chunk" ADD CONSTRAINT "note_chunk_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_share" ADD CONSTRAINT "note_share_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_share" ADD CONSTRAINT "note_share_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_event" ADD CONSTRAINT "rate_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_event_user_at_idx" ON "ask_event" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "note_owner_id_idx" ON "note" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "note_visibility_idx" ON "note" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "note_chunk_embedding_hnsw_idx" ON "note_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "note_chunk_tsv_gin_idx" ON "note_chunk" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "note_share_user_id_idx" ON "note_share" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_event_user_kind_at_idx" ON "rate_event" USING btree ("user_id","kind","at");