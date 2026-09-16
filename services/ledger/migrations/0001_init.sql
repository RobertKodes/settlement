-- Schema v1: every entity from blueprint section 27, grouped. See services/ledger/README.md and ADR-0015.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ---------------------------------------------------------------- identity & authorization
CREATE TABLE "user" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash    bytea NOT NULL UNIQUE,            -- sha256(lowercase email); the email itself is not stored here
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE institution (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name    text NOT NULL,
  jurisdiction  char(2) NOT NULL,                 -- ISO 3166-1 alpha-2
  status        text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding','active','suspended','closed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Product account: the unified account of blueprint section 6. Handle is what humans type (institution-b).
CREATE TABLE account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle          text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind            text NOT NULL CHECK (kind IN ('consumer','business','institutional','agent','service')),
  owner_user_id   uuid REFERENCES "user"(id),
  institution_id  uuid REFERENCES institution(id),
  parent_account_id uuid REFERENCES account(id),  -- AI-agent subaccounts (section 22)
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_user_id IS NOT NULL OR institution_id IS NOT NULL)
);

CREATE TABLE role (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,               -- owner, administrator, trader, treasury_operator, approver, compliance_reviewer, auditor, api_service, settlement_agent
  description text NOT NULL
);

CREATE TABLE account_member (
  account_id  uuid NOT NULL REFERENCES account(id),
  user_id     uuid NOT NULL REFERENCES "user"(id),
  role_id     uuid NOT NULL REFERENCES role(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id, role_id)
);

-- Policy rules (section 6): approval thresholds, allowlists, limits, agent budgets. Body is a versioned JSON document.
CREATE TABLE policy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(id),
  kind        text NOT NULL CHECK (kind IN ('approval','allowlist','limit','agent_budget','recovery','spending')),
  version     integer NOT NULL DEFAULT 1,
  body        jsonb NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, kind, version)
);

CREATE TABLE session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES "user"(id),
  device_id     uuid,
  token_hash    bytea NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES "user"(id),
  credential_id bytea NOT NULL UNIQUE,            -- WebAuthn credential id
  public_key    bytea NOT NULL,
  label         text,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE session ADD CONSTRAINT session_device_fk FOREIGN KEY (device_id) REFERENCES device(id);

CREATE TABLE api_key (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(id),
  key_hash    bytea NOT NULL UNIQUE,
  prefix      text NOT NULL,                      -- first 8 chars, shown in the UI
  scopes      text[] NOT NULL,
  ip_allowlist cidr[],
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- chain
CREATE TABLE wallet (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES account(id),
  kind          text NOT NULL CHECK (kind IN ('smart_account','eoa','external','custody','multisig')),
  provider      text,                             -- circle_modular, walletconnect, fireblocks, ...
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Blockchain addresses are separate from product identities (section 27).
CREATE TABLE address (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id   uuid NOT NULL REFERENCES wallet(id),
  chain_id    bigint NOT NULL,
  address     bytea NOT NULL CHECK (octet_length(address) = 20),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, address)
);

-- Decimals are per (symbol, chain): Arc native USDC is 18, its ERC-20 view is 6 (ADR-0018).
CREATE TABLE asset (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol      text NOT NULL,
  chain_id    bigint NOT NULL,
  address     bytea CHECK (address IS NULL OR octet_length(address) = 20),  -- NULL = native gas asset
  decimals    smallint NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  kind        text NOT NULL CHECK (kind IN ('stablecoin','native','erc20','rwa','lp')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (chain_id, symbol, address)   -- NULL address = native asset, one per (chain, symbol)
);

CREATE TABLE chain_transaction (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id      bigint NOT NULL,
  tx_hash       bytea NOT NULL CHECK (octet_length(tx_hash) = 32),
  block_number  bigint,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','included','reverted','soft_final','l1_final','reorged')),
  l1_tx_hash    bytea CHECK (l1_tx_hash IS NULL OR octet_length(l1_tx_hash) = 32),
  observed_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash)
);

-- ---------------------------------------------------------------- ledger (double entry)
CREATE TABLE ledger_account (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid REFERENCES account(id),        -- NULL for house accounts (fees, suspense, provider float)
  asset_id    uuid NOT NULL REFERENCES asset(id),
  kind        text NOT NULL CHECK (kind IN ('available','pending','settled','fees','external','suspense','reversed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (account_id, asset_id, kind)   -- house accounts have NULL account_id and must still be unique
);

CREATE TABLE ledger_transaction (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  kind            text NOT NULL CHECK (kind IN ('transfer','swap','settlement','fee','fiat_in','fiat_out','bridge_in','bridge_out','reversal','adjustment')),
  reference_type  text,                           -- intent | settlement | fiat_transfer | chain_transaction
  reference_id    uuid,
  reverses_id     uuid REFERENCES ledger_transaction(id),
  posted_at       timestamptz NOT NULL DEFAULT now(),
  description     text
);

CREATE TABLE ledger_entry (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transaction(id),
  ledger_account_id     uuid NOT NULL REFERENCES ledger_account(id),
  asset_id              uuid NOT NULL REFERENCES asset(id),
  amount                numeric(78,0) NOT NULL CHECK (amount <> 0),   -- +debit / -credit, base units
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entry_account_idx ON ledger_entry (ledger_account_id, created_at);

CREATE OR REPLACE FUNCTION ledger_entry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger_entry is append-only; post a reversing ledger_transaction'; END $$;
CREATE TRIGGER ledger_entry_no_update BEFORE UPDATE OR DELETE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_immutable();

-- The only sanctioned write path: posts a balanced set of entries or nothing.
-- entries: jsonb array of {ledger_account_id, asset_id, amount}
CREATE OR REPLACE FUNCTION ledger_post(p_idempotency_key text, p_kind text, p_reference_type text, p_reference_id uuid, p_entries jsonb, p_description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_tx uuid; v_unbalanced int;
BEGIN
  SELECT id INTO v_tx FROM ledger_transaction WHERE idempotency_key = p_idempotency_key;
  IF v_tx IS NOT NULL THEN RETURN v_tx; END IF;
  SELECT count(*) INTO v_unbalanced FROM (
    SELECT (e->>'asset_id')::uuid AS asset_id, sum((e->>'amount')::numeric) AS s
    FROM jsonb_array_elements(p_entries) e GROUP BY 1 HAVING sum((e->>'amount')::numeric) <> 0
  ) u;
  IF v_unbalanced > 0 THEN RAISE EXCEPTION 'ledger_post: entries do not balance per asset'; END IF;
  INSERT INTO ledger_transaction (idempotency_key, kind, reference_type, reference_id, description)
    VALUES (p_idempotency_key, p_kind, p_reference_type, p_reference_id, p_description) RETURNING id INTO v_tx;
  INSERT INTO ledger_entry (ledger_transaction_id, ledger_account_id, asset_id, amount)
    SELECT v_tx, (e->>'ledger_account_id')::uuid, (e->>'asset_id')::uuid, (e->>'amount')::numeric
    FROM jsonb_array_elements(p_entries) e;
  RETURN v_tx;
END $$;

-- Materialised balances; rebuilt from ledger_entry by the reconciliation job, never written by hand.
CREATE TABLE balance_projection (
  ledger_account_id uuid PRIMARY KEY REFERENCES ledger_account(id),
  balance           numeric(78,0) NOT NULL DEFAULT 0,
  as_of_entry_id    uuid REFERENCES ledger_entry(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- intent -> quote -> route -> execution -> settlement
CREATE TABLE intent (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id       text NOT NULL UNIQUE,           -- int_… (packages/types ids.ts)
  account_id      uuid NOT NULL REFERENCES account(id),
  idempotency_key text NOT NULL UNIQUE,
  action          text NOT NULL CHECK (action IN ('settle','transfer','swap','bridge','onramp','offramp')),
  body            jsonb NOT NULL,                 -- validated against @settlement/types IntentSchema
  status          text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','AUTHORIZED','QUOTED','POLICY_CHECKED','ROUTE_LOCKED','EXECUTING','SETTLED','PROVEN','RECONCILED','FAILED_AUTHORIZATION','FAILED_QUOTE','FAILED_POLICY','FAILED_EXECUTION','EXPIRED','CANCELLED')),
  failure_code    text,
  deadline        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intent_account_status_idx ON intent (account_id, status);

CREATE TABLE quote (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id     text NOT NULL UNIQUE,             -- q_…
  intent_id     uuid NOT NULL REFERENCES intent(id),
  body          jsonb NOT NULL,                   -- @settlement/types QuoteSchema
  execution_score numeric,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES quote(id),
  legs        jsonb NOT NULL,                     -- [{venue, shareBps, chainId}]
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE execution (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id   text NOT NULL UNIQUE,               -- exe_…
  intent_id   uuid NOT NULL REFERENCES intent(id),
  route_id    uuid NOT NULL REFERENCES route(id),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','confirmed','failed','retrying')),
  attempt     integer NOT NULL DEFAULT 1,
  error       jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE settlement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id       text NOT NULL UNIQUE,           -- stl_…
  intent_id       uuid NOT NULL REFERENCES intent(id),
  execution_id    uuid REFERENCES execution(id),
  kind            text NOT NULL CHECK (kind IN ('transfer','dvp','pvp','escrow','batch','scheduled')),
  receipt         jsonb,                          -- @settlement/types SettlementReceiptSchema, once complete
  soft_final_at   timestamptz,
  l1_final_at     timestamptz,
  reconciled_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Product-level transaction (what the activity feed shows); links the flow to ledger and chain evidence.
CREATE TABLE transaction (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES account(id),
  intent_id             uuid REFERENCES intent(id),
  settlement_id         uuid REFERENCES settlement(id),
  ledger_transaction_id uuid REFERENCES ledger_transaction(id),
  chain_transaction_id  uuid REFERENCES chain_transaction(id),
  kind                  text NOT NULL,
  status                text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transaction_account_idx ON transaction (account_id, created_at DESC);

-- ---------------------------------------------------------------- liquidity
CREATE TABLE liquidity_pool (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id    bigint NOT NULL,
  address     bytea NOT NULL CHECK (octet_length(address) = 20),
  kind        text NOT NULL CHECK (kind IN ('stableswap','concentrated','rfq')),
  asset0_id   uuid NOT NULL REFERENCES asset(id),
  asset1_id   uuid NOT NULL REFERENCES asset(id),
  fee_bps     integer NOT NULL CHECK (fee_bps BETWEEN 0 AND 10000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, address)
);

CREATE TABLE liquidity_position (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id     uuid NOT NULL REFERENCES liquidity_pool(id),
  account_id  uuid NOT NULL REFERENCES account(id),
  token_id    numeric(78,0),                      -- NFT position id for concentrated pools
  lower_tick  integer,
  upper_tick  integer,
  liquidity   numeric(78,0) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rfq_quote (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maker_account_id uuid NOT NULL REFERENCES account(id),
  intent_id     uuid REFERENCES intent(id),
  asset_in_id   uuid NOT NULL REFERENCES asset(id),
  asset_out_id  uuid NOT NULL REFERENCES asset(id),
  amount_in     numeric(78,0) NOT NULL,
  amount_out    numeric(78,0) NOT NULL,
  signature     bytea NOT NULL,
  nonce         numeric(78,0) NOT NULL,
  expires_at    timestamptz NOT NULL,
  filled_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (maker_account_id, nonce)
);

-- ---------------------------------------------------------------- counterparties & fiat
CREATE TABLE counterparty (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES account(id),       -- who registered it
  counterparty_account_id uuid REFERENCES account(id),          -- when the counterparty is on the network
  label             text NOT NULL,
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, label)
);

-- Bank beneficiaries live at the provider; we keep the reference and a display mask only.
CREATE TABLE beneficiary (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES account(id),
  provider              text NOT NULL,
  provider_external_account_id text NOT NULL,
  currency              char(3) NOT NULL,
  display_mask          text NOT NULL,            -- e.g. "DE** **** 1234"
  approved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_external_account_id)
);

CREATE TABLE provider_customer (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES account(id),
  provider              text NOT NULL,
  provider_customer_id  text NOT NULL,
  onboarding_state      text NOT NULL CHECK (onboarding_state IN ('not_started','pending','approved','rejected','review')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_customer_id),
  UNIQUE (account_id, provider)
);

CREATE TABLE fiat_transfer (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES account(id),
  intent_id             uuid REFERENCES intent(id),
  provider_customer_id  uuid NOT NULL REFERENCES provider_customer(id),
  beneficiary_id        uuid REFERENCES beneficiary(id),
  direction             text NOT NULL CHECK (direction IN ('on_ramp','off_ramp')),
  provider_transfer_id  text,
  idempotency_key       text NOT NULL UNIQUE,
  fiat_currency         char(3) NOT NULL,
  fiat_amount           numeric(20,2) NOT NULL,
  asset_id              uuid NOT NULL REFERENCES asset(id),
  asset_amount          numeric(78,0),
  state                 text NOT NULL DEFAULT 'awaiting_funds' CHECK (state IN ('awaiting_funds','funds_received','in_review','payment_submitted','payment_processed','returned','refunded','failed','cancelled')),
  last_event_id         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fiat_transfer_provider_idx ON fiat_transfer (provider_transfer_id) WHERE provider_transfer_id IS NOT NULL;

-- ---------------------------------------------------------------- compliance (state only; documents stay with the provider)
CREATE TABLE compliance_state (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text NOT NULL CHECK (subject_type IN ('user','institution','account')),
  subject_id    uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('kyc','kyb','sanctions','risk_tier','jurisdiction')),
  state         text NOT NULL,
  provider      text,
  provider_ref  text,
  reviewed_by   uuid REFERENCES "user"(id),
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, kind)
);

-- ---------------------------------------------------------------- platform
CREATE TABLE webhook_endpoint (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(id),
  url         text NOT NULL,
  secret_hash bytea NOT NULL,
  events      text[] NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_delivery (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id   uuid NOT NULL REFERENCES webhook_endpoint(id),
  event_type    text NOT NULL,
  event_id      text NOT NULL,
  payload       jsonb NOT NULL,
  attempt       integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','dead')),
  response_code integer,
  next_retry_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, event_id)
);

CREATE TABLE approval (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id     uuid NOT NULL REFERENCES intent(id),
  policy_id     uuid NOT NULL REFERENCES policy(id),
  required      integer NOT NULL CHECK (required >= 1),
  approver_ids  uuid[] NOT NULL DEFAULT '{}',
  rejected_by   uuid REFERENCES "user"(id),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit trail. No trigger-level immutability here so retention jobs can prune by policy.
CREATE TABLE audit_event (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_type    text NOT NULL CHECK (actor_type IN ('user','api_key','system','agent')),
  actor_id      uuid,
  account_id    uuid REFERENCES account(id),
  action        text NOT NULL,
  target_type   text,
  target_id     uuid,
  request_id    text,
  details       jsonb
);
CREATE INDEX audit_event_account_idx ON audit_event (account_id, occurred_at DESC);

CREATE TABLE reconciliation_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('ledger','chain','fiat','cctp','gateway')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','clean','breaks','failed')),
  matched       integer NOT NULL DEFAULT 0,
  breaks        jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- updated_at triggers
DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['user','institution','account','policy','wallet','chain_transaction','intent','settlement','transaction','liquidity_position','provider_customer','fiat_transfer','compliance_state','webhook_delivery'])
  LOOP EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;

INSERT INTO role (name, description) VALUES
  ('owner','Full control including governance of the account'),
  ('administrator','Manage members, policies and API keys'),
  ('trader','Create swap and settlement intents within policy'),
  ('treasury_operator','Fiat and treasury movements within policy'),
  ('approver','Approve intents above policy thresholds'),
  ('compliance_reviewer','Review compliance state and holds'),
  ('auditor','Read-only access to everything'),
  ('api_service','Service-account role for API keys'),
  ('settlement_agent','Execute pre-approved settlement instructions');

COMMIT;
