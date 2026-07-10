-- Migration: 0015_rooms_seed_prompt
-- Adds optional seed_prompt column to rooms for meeting opening prompts.

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS seed_prompt text;

-- Allow bramha_app to set/clear the seed_prompt column
GRANT UPDATE (seed_prompt) ON rooms TO bramha_app;

-- Migrator retains full access
GRANT ALL PRIVILEGES ON rooms TO bramha_migrator;
