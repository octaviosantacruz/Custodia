-- Migration 036: per-user quick-access and recent workspace preferences.
BEGIN;

CREATE TABLE public.user_workspace_preferences (
  actor_id TEXT PRIMARY KEY,
  visible_workspaces JSONB NOT NULL DEFAULT '["safes"]'::jsonb,
  hidden_workspaces JSONB NOT NULL DEFAULT '[]'::jsonb,
  recent_workspaces JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_preferences_visible_array CHECK (jsonb_typeof(visible_workspaces) = 'array'),
  CONSTRAINT workspace_preferences_hidden_array CHECK (jsonb_typeof(hidden_workspaces) = 'array'),
  CONSTRAINT workspace_preferences_recent_array CHECK (jsonb_typeof(recent_workspaces) = 'array'),
  CONSTRAINT workspace_preferences_visible_limit CHECK (jsonb_array_length(visible_workspaces) <= 6),
  CONSTRAINT workspace_preferences_recent_limit CHECK (jsonb_array_length(recent_workspaces) <= 8)
);

COMMIT;
