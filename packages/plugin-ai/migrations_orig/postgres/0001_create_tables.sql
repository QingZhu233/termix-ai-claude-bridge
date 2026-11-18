-- ai 0001: create every table this plugin owns.
-- Generated from migrations/snapshot.json so a fresh install has a schema.

CREATE TABLE IF NOT EXISTS "p_ai_exposure_observations" (
  "id" VARCHAR(64) NOT NULL PRIMARY KEY,
  "hostId" INTEGER NOT NULL,
  "ownerId" VARCHAR(255) NOT NULL,
  "source" VARCHAR(32) NOT NULL,
  "at" TIMESTAMP NOT NULL,
  "payload" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_exposure_observation_source" ON "p_ai_exposure_observations" ("hostId", "ownerId", "source");

CREATE TABLE IF NOT EXISTS "p_ai_exposure_entries" (
  "key" VARCHAR(64) NOT NULL PRIMARY KEY,
  "hostId" INTEGER NOT NULL,
  "ownerId" VARCHAR(255) NOT NULL,
  "source" VARCHAR(32) NOT NULL,
  "payload" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_exposure_entry_source" ON "p_ai_exposure_entries" ("hostId", "ownerId", "source");

CREATE TABLE IF NOT EXISTS "p_ai_exposure_changes" (
  "id" VARCHAR(64) NOT NULL PRIMARY KEY,
  "hostId" INTEGER NOT NULL,
  "ownerId" VARCHAR(255) NOT NULL,
  "at" TIMESTAMP NOT NULL,
  "noticeStatus" VARCHAR(16) NOT NULL,
  "payload" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_exposure_notices" ON "p_ai_exposure_changes" ("noticeStatus", "ownerId");

CREATE TABLE IF NOT EXISTS "p_ai_providers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "syncId" VARCHAR(255),
  "userId" TEXT NOT NULL,
  "providerType" TEXT NOT NULL,
  "label" VARCHAR(255) NOT NULL,
  "baseUrl" TEXT,
  "apiKeyPrefix" TEXT,
  "defaultModel" TEXT,
  "contextWindow" INTEGER,
  "modelOverrides" TEXT,
  "advanced" TEXT,
  "enabled" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_providers_user_label" ON "p_ai_providers" ("userId", "label");

CREATE TABLE IF NOT EXISTS "p_ai_conversations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT,
  "providerId" INTEGER,
  "model" TEXT,
  "mode" VARCHAR(16) NOT NULL,
  "targets" TEXT,
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_conversations_user" ON "p_ai_conversations" ("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "p_ai_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "toolCalls" TEXT,
  "reasoning" TEXT,
  "createdAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_messages_conversation" ON "p_ai_messages" ("conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "p_ai_proposals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" VARCHAR(255) NOT NULL,
  "summary" TEXT,
  "payload" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "appliedAt" TEXT,
  "resultSummary" TEXT,
  "createdAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_proposals_user" ON "p_ai_proposals" ("userId", "status");

CREATE INDEX IF NOT EXISTS "idx_ai_proposals_conversation" ON "p_ai_proposals" ("conversationId");

CREATE TABLE IF NOT EXISTS "p_ai_agent_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" VARCHAR(36) NOT NULL,
  "userId" TEXT NOT NULL,
  "hostId" INTEGER NOT NULL,
  "providerId" INTEGER NOT NULL,
  "agent" VARCHAR(32) NOT NULL,
  "model" TEXT NOT NULL,
  "cwd" TEXT NOT NULL,
  "executable" TEXT NOT NULL,
  "nativeId" TEXT,
  "title" TEXT,
  "archived" BOOLEAN NOT NULL,
  "queuePaused" BOOLEAN NOT NULL,
  "draft" TEXT,
  "attachments" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_agent_sessions_user" ON "p_ai_agent_sessions" ("userId");

CREATE TABLE IF NOT EXISTS "p_ai_agent_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" VARCHAR(36) NOT NULL,
  "userId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "text" TEXT NOT NULL,
  "requestId" TEXT,
  "choices" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_agent_events_session_seq" ON "p_ai_agent_events" ("sessionId", "seq");

CREATE TABLE IF NOT EXISTS "p_ai_agent_queue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" VARCHAR(36) NOT NULL,
  "userId" TEXT NOT NULL,
  "promptId" VARCHAR(36) NOT NULL,
  "position" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "attachmentIds" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_agent_queue_session" ON "p_ai_agent_queue" ("sessionId", "position");

CREATE TABLE IF NOT EXISTS "p_ai_ops_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "hostId" INTEGER NOT NULL,
  "command" TEXT NOT NULL,
  "exitCode" INTEGER,
  "durationMs" INTEGER NOT NULL,
  "output" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_ops_runs_conversation" ON "p_ai_ops_runs" ("conversationId");

CREATE TABLE IF NOT EXISTS "p_ai_cli_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "args" TEXT NOT NULL,
  "exitCode" INTEGER,
  "durationMs" INTEGER NOT NULL,
  "output" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_cli_runs_conversation" ON "p_ai_cli_runs" ("conversationId");

CREATE TABLE IF NOT EXISTS "p_ai_usage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "providerId" INTEGER,
  "model" TEXT NOT NULL,
  "conversationId" INTEGER,
  "source" VARCHAR(16) NOT NULL,
  "promptTokens" INTEGER NOT NULL,
  "completionTokens" INTEGER NOT NULL,
  "estimated" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_usage_user" ON "p_ai_usage" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ai_usage_created" ON "p_ai_usage" ("createdAt");

CREATE INDEX IF NOT EXISTS "idx_ai_usage_conversation" ON "p_ai_usage" ("conversationId");

CREATE TABLE IF NOT EXISTS "p_ai_task_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "automationId" INTEGER NOT NULL,
  "automationRunId" INTEGER,
  "presetId" VARCHAR(64),
  "title" TEXT NOT NULL,
  "autonomy" VARCHAR(16) NOT NULL,
  "hostIds" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "dryRun" BOOLEAN NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "severity" VARCHAR(16),
  "summary" TEXT,
  "report" TEXT,
  "plan" TEXT,
  "decidedBy" VARCHAR(255),
  "decidedAt" TIMESTAMP,
  "expiresAt" TIMESTAMP,
  "conversationId" INTEGER,
  "promptTokens" INTEGER NOT NULL,
  "completionTokens" INTEGER NOT NULL,
  "createdAt" TIMESTAMP NOT NULL,
  "finishedAt" TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_ai_task_runs_user" ON "p_ai_task_runs" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ai_task_runs_automation" ON "p_ai_task_runs" ("automationId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ai_task_runs_status" ON "p_ai_task_runs" ("status");

CREATE TABLE IF NOT EXISTS "p_ai_preset_links" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "presetId" VARCHAR(64) NOT NULL,
  "presetVersion" INTEGER NOT NULL,
  "automationId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_preset_links_user" ON "p_ai_preset_links" ("userId");

CREATE TABLE IF NOT EXISTS "p_ai_task_presets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "shared" BOOLEAN NOT NULL,
  "config" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_task_presets_user" ON "p_ai_task_presets" ("userId");

CREATE INDEX IF NOT EXISTS "idx_ai_task_presets_shared" ON "p_ai_task_presets" ("shared");

CREATE TABLE IF NOT EXISTS "p_ai_assets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" VARCHAR(255) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "hostId" INTEGER,
  "name" TEXT NOT NULL,
  "ips" TEXT NOT NULL,
  "zone" VARCHAR(120),
  "zoneSource" VARCHAR(16),
  "multiZone" BOOLEAN NOT NULL,
  "facts" TEXT,
  "collectedAt" TIMESTAMP,
  "removedAt" TIMESTAMP,
  "role" TEXT,
  "roleSource" VARCHAR(16),
  "importance" VARCHAR(16),
  "importanceSource" VARCHAR(16),
  "importanceReason" TEXT,
  "system" VARCHAR(120),
  "systemSource" VARCHAR(16),
  "annotatedAt" TIMESTAMP,
  "annotationFingerprint" VARCHAR(64),
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_assets_host" ON "p_ai_assets" ("hostId");

CREATE INDEX IF NOT EXISTS "idx_ai_assets_zone" ON "p_ai_assets" ("zone");

CREATE TABLE IF NOT EXISTS "p_ai_asset_edges" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fromAsset" INTEGER NOT NULL,
  "toAsset" INTEGER NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "detail" TEXT,
  "evidence" TEXT,
  "source" VARCHAR(16) NOT NULL,
  "firstSeen" TIMESTAMP NOT NULL,
  "lastSeen" TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_asset_edges_pair" ON "p_ai_asset_edges" ("fromAsset", "toAsset", "type");

CREATE INDEX IF NOT EXISTS "idx_ai_asset_edges_to" ON "p_ai_asset_edges" ("toAsset");

CREATE TABLE IF NOT EXISTS "p_ai_asset_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" VARCHAR(16) NOT NULL,
  "trigger" VARCHAR(16) NOT NULL,
  "startedAt" TIMESTAMP NOT NULL,
  "finishedAt" TIMESTAMP,
  "status" VARCHAR(16) NOT NULL,
  "hostsTotal" INTEGER NOT NULL,
  "hostsOk" INTEGER NOT NULL,
  "hostsFailed" INTEGER NOT NULL,
  "errorSummary" TEXT,
  "tokens" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_asset_runs_started" ON "p_ai_asset_runs" ("startedAt");

CREATE TABLE IF NOT EXISTS "p_ai_zones" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" VARCHAR(120) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "cidr" VARCHAR(64) NOT NULL,
  "priority" INTEGER NOT NULL,
  "createdBy" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL
);
