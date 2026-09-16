# docs/architecture

| document | role |
|---|---|
| `USDC_Lineth_Institutional_Settlement_Master_Blueprint.md` | the end-state blueprint (product, protocol, infrastructure, phases). Source of truth for *what* is being built. |
| `../adr/` | architecture decision records. Source of truth for *how*. **When an ADR and the blueprint disagree, the ADR wins** and the blueprint gets a follow-up edit. |
| `../api/conventions.md` | rules every `/v1` endpoint follows |
| `../../security/threat-model/` | threat categories, mitigations and their status |

Facts about external systems (Lineth, Circle, Arc, Bridge) were verified on 2026-09-16 and are pinned
in the relevant ADRs with URLs. Re-verify before relying on them in a later phase.
