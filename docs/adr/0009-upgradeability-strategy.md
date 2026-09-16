# ADR-0009: Upgradeability strategy

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 16, 30, 38.9

## Context
Section 30 requires an explicit upgrade policy: security council multisig, timelocked non-emergency upgrades, narrow emergency path, immutable core where practical.

## Decision (leaning)
Settlement primitives (DvP/PvP/escrow) and pool contracts are **immutable**; only the registry/router layer is upgradeable behind a transparent proxy owned by a timelock (48 h) controlled by the security council multisig. Emergency pause is a separate, narrower role. Each upgrade ships a Foundry storage-layout check in CI.
