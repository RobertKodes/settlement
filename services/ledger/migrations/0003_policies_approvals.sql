-- Milestone F: approval policies live in `policy` (kind 'approval'); approvals reference intents by public id
-- as well, so the API can record them before the execution row exists.
BEGIN;
ALTER TABLE approval ADD COLUMN intent_public_id text;
CREATE INDEX approval_intent_public_idx ON approval (intent_public_id);
-- settlement signatures collected per party before execution (public intent id -> jsonb)
CREATE TABLE settlement_signature (
  intent_public_id text NOT NULL,
  party            text NOT NULL CHECK (party IN ('A','B')),
  signature        text NOT NULL,
  permit           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intent_public_id, party)
);
COMMIT;
