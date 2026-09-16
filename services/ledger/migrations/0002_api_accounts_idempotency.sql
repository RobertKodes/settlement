-- API-level idempotency records (ADR-0024) and the signer public key of passkey wallets.
BEGIN;

CREATE TABLE api_idempotency (
  scope       text NOT NULL,                      -- account id (or 'anon')
  key         text NOT NULL,                      -- Idempotency-Key header
  fingerprint text NOT NULL,                      -- sha256 of the request payload
  status      integer NOT NULL,
  body        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE INDEX api_idempotency_created_idx ON api_idempotency (created_at);   -- 24 h retention sweep

-- Passkey (P-256) public key for smart-account wallets: {"qx": "0x…", "qy": "0x…", "salt": "0x…"}.
ALTER TABLE wallet ADD COLUMN signer jsonb;

COMMIT;
