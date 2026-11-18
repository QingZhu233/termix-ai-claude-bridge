-- ai 0001: create every table this plugin owns.
-- Generated from migrations/snapshot.json so a fresh install has a schema.

CREATE TABLE IF NOT EXISTS "p_ai_exposure_observations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "hostId" INTEGER NOT NULL,
  "ownerId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "at" TEXT NOT NULL,
  "payload" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_exposure_observation_source" ON "p_ai_exposure_observations" ("hostId", "ownerId", "source");

CREATE TABLE IF NOT EXISTS "p_ai_exposure_entries" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "hostId" INTEGER NOT NULL,
  "ownerId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "payload" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_exposure_entry_source" ON "p_ai_exposure_entries" ("hostId", "ownerId", "source");

CREATE TABLE IF NOT EXISTS "p_ai_exposure_changes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "hostId" INTEGER NOT NULL,
  "ownerId" TEXT NOT NULL,
  "at" TEXT NOT NULL,
  "noticeStatus" TEXT NOT NULL,
  "payload" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_exposure_notices" ON "p_ai_exposure_changes" ("noticeStatus", "ownerId");

CREATE TABLE IF NOT EXISTS "p_ai_providers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "syncId" TEXT,
  "userId" TEXT NOT NULL,
  "providerType" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "baseUrl" TEXT,
  "apiKeyPrefix" TEXT,
  "defaultModel" TEXT,
  "contextWindow" INTEGER,
  "modelOverrides" TEXT,
  "advanced" TEXT,
  "enabled" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_providers_user_label" ON "p_ai_providers" ("userId", "label");

CREATE TABLE IF NOT EXISTS "p_ai_conversations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT,
  "providerId" INTEGER,
  "model" TEXT,
  "mode" TEXT NOT NULL,
  "targets" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_conversations_user" ON "p_ai_conversations" ("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "p_ai_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "toolCalls" TEXT,
  "reasoning" TEXT,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_messages_conversation" ON "p_ai_messages" ("conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "p_ai_proposals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" TEXT,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "appliedAt" TEXT,
  "resultSummary" TEXT,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_proposals_user" ON "p_ai_proposals" ("userId", "status");

CREATE INDEX IF NOT EXISTS "idx_ai_proposals_conversation" ON "p_ai_proposals" ("conversationId");

CREATE TABLE IF NOT EXISTS "p_ai_agent_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "hostId" INTEGER NOT NULL,
  "providerId" INTEGER NOT NULL,
  "agent" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "cwd" TEXT NOT NULL,
  "executable" TEXT NOT NULL,
  "nativeId" TEXT,
  "title" TEXT,
  "archived" INTEGER NOT NULL,
  "queuePaused" INTEGER NOT NULL,
  "draft" TEXT,
  "attachments" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_agent_sessions_user" ON "p_ai_agent_sessions" ("userId");

CREATE TABLE IF NOT EXISTS "p_ai_agent_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "requestId" TEXT,
  "choices" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_agent_events_session_seq" ON "p_ai_agent_events" ("sessionId", "seq");

CREATE TABLE IF NOT EXISTS "p_ai_agent_queue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "promptId" TEXT NOT NULL,
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
  "createdAt" TEXT NOT NULL
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
  "createdAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_cli_runs_conversation" ON "p_ai_cli_runs" ("conversationId");

CREATE TABLE IF NOT EXISTS "p_ai_usage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "providerId" INTEGER,
  "model" TEXT NOT NULL,
  "conversationId" INTEGER,
  "source" TEXT NOT NULL,
  "promptTokens" INTEGER NOT NULL,
  "completionTokens" INTEGER NOT NULL,
  "estimated" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_usage_user" ON "p_ai_usage" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ai_usage_created" ON "p_ai_usage" ("createdAt");

CREATE INDEX IF NOT EXISTS "idx_ai_usage_conversation" ON "p_ai_usage" ("conversationId");

CREATE TABLE IF NOT EXISTS "p_ai_task_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "automationId" INTEGER NOT NULL,
  "automationRunId" INTEGER,
  "presetId" TEXT,
  "title" TEXT NOT NULL,
  "autonomy" TEXT NOT NULL,
  "hostIds" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "dryRun" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "severity" TEXT,
  "summary" TEXT,
  "report" TEXT,
  "plan" TEXT,
  "decidedBy" TEXT,
  "decidedAt" TEXT,
  "expiresAt" TEXT,
  "conversationId" INTEGER,
  "promptTokens" INTEGER NOT NULL,
  "completionTokens" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL,
  "finishedAt" TEXT
);

CREATE INDEX IF NOT EXISTS "idx_ai_task_runs_user" ON "p_ai_task_runs" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ai_task_runs_automation" ON "p_ai_task_runs" ("automationId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ai_task_runs_status" ON "p_ai_task_runs" ("status");

CREATE TABLE IF NOT EXISTS "p_ai_preset_links" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "presetId" TEXT NOT NULL,
  "presetVersion" INTEGER NOT NULL,
  "automationId" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_preset_links_user" ON "p_ai_preset_links" ("userId");

CREATE TABLE IF NOT EXISTS "p_ai_task_presets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "shared" INTEGER NOT NULL,
  "config" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_task_presets_user" ON "p_ai_task_presets" ("userId");

CREATE INDEX IF NOT EXISTS "idx_ai_task_presets_shared" ON "p_ai_task_presets" ("shared");

CREATE TABLE IF NOT EXISTS "p_ai_assets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "hostId" INTEGER,
  "name" TEXT NOT NULL,
  "ips" TEXT NOT NULL,
  "zone" TEXT,
  "zoneSource" TEXT,
  "multiZone" INTEGER NOT NULL,
  "facts" TEXT,
  "collectedAt" TEXT,
  "removedAt" TEXT,
  "role" TEXT,
  "roleSource" TEXT,
  "importance" TEXT,
  "importanceSource" TEXT,
  "importanceReason" TEXT,
  "system" TEXT,
  "systemSource" TEXT,
  "annotatedAt" TEXT,
  "annotationFingerprint" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_assets_host" ON "p_ai_assets" ("hostId");

CREATE INDEX IF NOT EXISTS "idx_ai_assets_zone" ON "p_ai_assets" ("zone");

CREATE TABLE IF NOT EXISTS "p_ai_asset_edges" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fromAsset" INTEGER NOT NULL,
  "toAsset" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "detail" TEXT,
  "evidence" TEXT,
  "source" TEXT NOT NULL,
  "firstSeen" TEXT NOT NULL,
  "lastSeen" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_asset_edges_pair" ON "p_ai_asset_edges" ("fromAsset", "toAsset", "type");

CREATE INDEX IF NOT EXISTS "idx_ai_asset_edges_to" ON "p_ai_asset_edges" ("toAsset");

CREATE TABLE IF NOT EXISTS "p_ai_asset_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "startedAt" TEXT NOT NULL,
  "finishedAt" TEXT,
  "status" TEXT NOT NULL,
  "hostsTotal" INTEGER NOT NULL,
  "hostsOk" INTEGER NOT NULL,
  "hostsFailed" INTEGER NOT NULL,
  "errorSummary" TEXT,
  "tokens" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_asset_runs_started" ON "p_ai_asset_runs" ("startedAt");

CREATE TABLE IF NOT EXISTS "p_ai_zones" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "cidr" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);
