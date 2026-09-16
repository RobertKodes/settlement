import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandLine } from "./components/CommandLine.js";
import { Palette, type PaletteItem } from "./components/Palette.js";
import { QuorumRing } from "./components/QuorumRing.js";
import { Rail } from "./components/Rail.js";
import { type RankedVenue, RouteSpectrum } from "./components/RouteSpectrum.js";
import {
  type Account,
  api,
  type IntentView,
  type Portfolio,
  type Receipt,
  RequestError,
} from "./lib/api.js";
import { hhmmss, toBase, units } from "./lib/format.js";
import { deviceKeys } from "./lib/signer.js";
import { AccountView } from "./views/Account.js";
import { ReceiptView } from "./views/Receipt.js";

type Action = "settle" | "swap" | "transfer";
type Asset = "USDC" | "EURC";

interface Draft {
  action: Action;
  asset: Asset;
  amount: string;
  toAsset: Asset;
  toAmount: string;
  counterparty: string;
}

const usdcRoute = (r: RankedVenue[] | undefined) => r ?? [];

export function App() {
  const [accounts, setAccounts] = useState(deviceKeys.list());
  const [handle, setHandle] = useState<string>(
    () => localStorage.getItem("terminal.handle") ?? deviceKeys.list()[0]?.handle ?? "",
  );
  const [account, setAccount] = useState<Account>();
  const [portfolio, setPortfolio] = useState<Portfolio>();
  const [feed, setFeed] = useState<IntentView[]>([]);
  const [selected, setSelected] = useState<IntentView>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [draft, setDraft] = useState<Draft>({
    action: "settle",
    asset: "EURC",
    amount: "1000",
    toAsset: "USDC",
    toAmount: "1050",
    counterparty: "",
  });
  const [live, setLive] = useState<IntentView>();
  const [ranked, setRanked] = useState<RankedVenue[]>([]);
  const [quorum, setQuorum] = useState<{
    sigs: number;
    sigsNeed: number;
    approvals: number;
    approvalsNeed: number;
  }>({ sigs: 0, sigsNeed: 0, approvals: 0, approvalsNeed: 0 });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; bad?: boolean }>();
  const [palette, setPalette] = useState(false);
  const [health, setHealth] = useState<{ l2?: string; l1?: string; ok: boolean }>({ ok: false });
  const [clock, setClock] = useState(new Date());
  const toastTimer = useRef<number>(0);
  const [log, setLog] = useState<Array<{ t: string; text: string; bad: boolean }>>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const say = useCallback((text: string, bad = false) => {
    setLog((l) => [{ t: new Date().toISOString(), text, bad }, ...l].slice(0, 60));
    setToast({ text, bad });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(undefined), bad ? 9000 : 4500);
  }, []);

  const refresh = useCallback(
    async (h = handle) => {
      if (!h) return;
      try {
        const [a, p, f] = await Promise.all([api.account(h), api.portfolio(h), api.intents(h)]);
        setAccount(a);
        setPortfolio(p);
        setFeed(f);
      } catch (e) {
        say((e as Error).message, true);
      }
    },
    [handle, say],
  );

  useEffect(() => {
    localStorage.setItem("terminal.handle", handle);
    void refresh(handle);
  }, [handle, refresh]);

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 1000);
    const h = window.setInterval(async () => {
      try {
        const r = await api.health();
        setHealth({
          ok: r.status === "ok",
          l1: r.chains.find((c) => c.name === "l1")?.block,
          l2: r.chains.find((c) => c.name === "l2")?.block,
        });
      } catch {
        setHealth({ ok: false });
      }
    }, 5000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(h);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // selected intent → receipt (live finality)
  useEffect(() => {
    if (!selected) {
      setReceipt(undefined);
      return;
    }
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.receipt(selected.intentId);
        if (!stop) setReceipt(r);
      } catch {
        if (!stop) setReceipt(undefined);
      }
    };
    void tick();
    const t = window.setInterval(tick, 4000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [selected]);

  /** Every command runs after the previous one finished: one chain of intents at a time, no nonce races. */
  const run = useCallback(
    (label: string, fn: () => Promise<void>) => {
      const next = queue.current.then(async () => {
        setBusy(true);
        try {
          await fn();
        } catch (e) {
          const msg = e instanceof RequestError ? e.message : (e as Error).message;
          say(`${label}: ${msg}`, true);
        } finally {
          setBusy(false);
          await refresh();
        }
      });
      queue.current = next.catch(() => undefined);
      return next;
    },
    [refresh, say],
  );

  const createAccount = useCallback(
    async (h: string, kind = "institutional") => {
      const { passkey, priv } = deviceKeys.create();
      const a = await api.createAccount(h, kind, passkey);
      deviceKeys.remember({ handle: h, priv, accountId: a.accountId, address: a.address });
      setAccounts(deviceKeys.list());
      setHandle(h);
      say(`account ${h} deployed at ${a.address}`);
    },
    [say],
  );

  /** The core: an intent runs stage by stage, and the UI shows every stage as it happens. */
  const executeDraft = useCallback(
    async (d: Draft) => {
      if (!account) throw new Error("no account selected");
      const signer = deviceKeys.signer(account.handle);
      if (!signer) throw new Error("no device key for this account in this browser");
      setRanked([]);
      setQuorum({ sigs: 0, sigsNeed: 0, approvals: 0, approvalsNeed: 0 });
      const body =
        d.action === "settle"
          ? {
              action: "settle",
              source: { asset: d.asset, amount: toBase(d.amount, 6) },
              destination: {
                asset: d.toAsset,
                recipient: d.counterparty,
                amount: toBase(d.toAmount, 6),
              },
              constraints: { requireAtomicity: true },
            }
          : d.action === "swap"
            ? {
                action: "swap",
                source: { asset: d.asset, amount: toBase(d.amount, 6) },
                destination: { asset: d.toAsset, recipient: account.handle },
                constraints: { maxSlippageBps: 50 },
              }
            : {
                action: "transfer",
                source: { asset: d.asset, amount: toBase(d.amount, 6) },
                destination: { asset: d.asset, recipient: d.counterparty },
              };
      let it = await api.createIntent(account, body);
      setLive(it);
      setSelected(it);
      it = await api.quote(it.intentId);
      setLive(it);
      setSelected(it);
      const q = it.state.quote as {
        digests: Record<string, `0x${string}`>;
        ranked?: RankedVenue[];
        parties?: { B: { handle: string } };
      };
      if (q.ranked) setRanked(q.ranked);
      if (d.action === "settle") {
        const sigB = deviceKeys.signer(d.counterparty);
        setQuorum((s) => ({ ...s, sigsNeed: 2 }));
        await api.sign(
          it.intentId,
          "A",
          signer.sign(q.digests.settlement!),
          signer.sign(q.digests.permitA!),
        );
        setQuorum((s) => ({ ...s, sigs: 1 }));
        if (!sigB)
          throw new Error(
            `counterparty ${d.counterparty} must sign from its own device; its key is not in this browser`,
          );
        await api.sign(
          it.intentId,
          "B",
          sigB.sign(q.digests.settlement!),
          sigB.sign(q.digests.permitB!),
        );
        setQuorum((s) => ({ ...s, sigs: 2 }));
        try {
          it = await api.execute(it.intentId);
        } catch (e) {
          if (e instanceof RequestError && e.err.code === "policy_denied") {
            const det = e.err.details as { required: number; approvals: string[] };
            setQuorum((s) => ({
              ...s,
              approvals: det.approvals.length,
              approvalsNeed: det.required,
            }));
            it = await api.intent(it.intentId);
            setLive(it);
            setSelected(it);
            say(
              `policy: ${det.required} approval(s) required — use "approve <name>" on a new intent before execute`,
              true,
            );
            return;
          }
          throw e;
        }
      } else {
        const permitSignature = signer.sign(q.digests.permit!);
        setQuorum({ sigs: 1, sigsNeed: 2, approvals: 0, approvalsNeed: 0 });
        const { userOpHash } = await api.authorize1(it.intentId, permitSignature);
        const signature = signer.sign(userOpHash);
        setQuorum({ sigs: 2, sigsNeed: 2, approvals: 0, approvalsNeed: 0 });
        setLive({ ...it, status: "EXECUTING" });
        it = await api.authorize2(it.intentId, permitSignature, signature);
      }
      setLive(it);
      setSelected(it);
      say(`${it.intentId} ${it.status}`);
    },
    [account, say],
  );

  const pendingApprovals = useRef<string[]>([]);

  const onCommand = useCallback(
    async (line: string) => {
      const [cmd, ...rest] = line.split(/\s+/);
      const c = (cmd ?? "").toLowerCase();
      if (c === "help") {
        say(
          "commands: account <handle> · use <handle> · fund <amt> <USDC|EURC> · send <amt> <asset> to <handle> · swap <amt> <from> to <to> · settle <amt> <asset> for <amt> <asset> with <handle> · policy <amt USDC> <n> · approve <name> · reconcile",
        );
        return;
      }
      if (c === "account")
        return run("account", () =>
          createAccount(rest[0] ?? `inst-${Date.now().toString(36)}`, rest[1] ?? "institutional"),
        );
      if (c === "use") {
        setHandle(rest[0] ?? handle);
        return;
      }
      if (c === "fund")
        return run("fund", async () => {
          await api.faucet(
            handle,
            (rest[1]?.toUpperCase() as Asset) ?? "USDC",
            toBase(rest[0] ?? "1000", 6),
          );
          say(`funded ${rest[0] ?? "1000"} ${rest[1]?.toUpperCase() ?? "USDC"}`);
        });
      if (c === "send")
        return run("send", () =>
          executeDraft({
            action: "transfer",
            asset: (rest[1]?.toUpperCase() as Asset) ?? "USDC",
            amount: rest[0] ?? "0",
            toAsset: "USDC",
            toAmount: "",
            counterparty: rest[3] ?? "",
          }),
        );
      if (c === "swap")
        return run("swap", () =>
          executeDraft({
            action: "swap",
            asset: (rest[1]?.toUpperCase() as Asset) ?? "USDC",
            amount: rest[0] ?? "0",
            toAsset: (rest[3]?.toUpperCase() as Asset) ?? "EURC",
            toAmount: "",
            counterparty: "",
          }),
        );
      if (c === "settle")
        return run("settle", () =>
          executeDraft({
            action: "settle",
            asset: (rest[1]?.toUpperCase() as Asset) ?? "EURC",
            amount: rest[0] ?? "0",
            toAsset: (rest[4]?.toUpperCase() as Asset) ?? "USDC",
            toAmount: rest[3] ?? "0",
            counterparty: rest[6] ?? "",
          }),
        );
      if (c === "policy")
        return run("policy", async () => {
          const n = Number(rest.filter((t) => /^\d+$/.test(t)).at(-1) ?? 1) || 1;
          await api.setPolicy(handle, [
            { aboveBaseUnits: toBase(rest[0] ?? "0", 6), approvals: n },
          ]);
          say(
            `policy on ${handle}: > ${rest[0]} ${rest[1]?.toUpperCase() ?? "USDC"} needs ${n} approval(s)`,
          );
        });
      if (c === "approve")
        return run("approve", async () => {
          if (!selected) throw new Error("select an intent first");
          const r = await api.approve(selected.intentId, rest[0] ?? "approver");
          say(`approvals ${r.approvals.length}/${r.required}`);
          setQuorum((s) => ({ ...s, approvals: r.approvals.length, approvalsNeed: r.required }));
        });
      if (c === "execute")
        return run("execute", async () => {
          if (!selected) throw new Error("select an intent first");
          const it = await api.execute(selected.intentId);
          setLive(it);
          setSelected(it);
          say(`${it.intentId} ${it.status}`);
        });
      if (c === "reconcile")
        return run("reconcile", async () => {
          const r = await api.reconcile(account?.accountId);
          say(
            `reconciliation ${r.runId.slice(0, 8)}: matched ${r.matched}, breaks ${r.breaks.length}`,
          );
        });
      say(`unknown command: ${c} (try help)`, true);
    },
    [account, createAccount, executeDraft, handle, run, say, selected],
  );

  const paletteItems: PaletteItem[] = useMemo(
    () => [
      {
        id: "new",
        label: "New institution account",
        hint: "account <handle>",
        run: () => void run("account", () => createAccount(`inst-${Date.now().toString(36)}`)),
      },
      {
        id: "fund",
        label: "Faucet 10,000 USDC to this account",
        hint: "devnet",
        run: () =>
          void run("fund", async () => {
            await api.faucet(handle, "USDC", toBase("10000", 6));
          }),
      },
      {
        id: "fund2",
        label: "Faucet 10,000 EURC to this account",
        hint: "devnet",
        run: () =>
          void run("fund", async () => {
            await api.faucet(handle, "EURC", toBase("10000", 6));
          }),
      },
      {
        id: "swap",
        label: "Swap 1,000 USDC → EURC (router)",
        hint: "K",
        run: () =>
          void run("swap", () =>
            executeDraft({
              action: "swap",
              asset: "USDC",
              amount: "1000",
              toAsset: "EURC",
              toAmount: "",
              counterparty: "",
            }),
          ),
      },
      {
        id: "recon",
        label: "Run reconciliation for this account",
        hint: "ledger vs chain",
        run: () =>
          void run("reconcile", async () => {
            const r = await api.reconcile(account?.accountId);
            say(`matched ${r.matched}, breaks ${r.breaks.length}`);
          }),
      },
      ...accounts.map((a) => ({
        id: `use-${a.handle}`,
        label: `Act as ${a.handle}`,
        hint: a.address.slice(0, 10),
        run: () => setHandle(a.handle),
      })),
    ],
    [account, accounts, createAccount, executeDraft, handle, run, say],
  );

  const liveStatus = live?.status;
  const policyChecks = useMemo(() => {
    const st = (live?.state ?? {}) as { required?: number; approvals?: string[] };
    const isSettle = draft.action === "settle";
    return [
      {
        ok: !!draft.counterparty || !isSettle,
        wait: false,
        text: isSettle ? `Counterparty ${draft.counterparty || "—"}` : "Counterparty: self",
      },
      {
        ok: ["USDC", "EURC"].includes(draft.asset),
        wait: false,
        text: `Asset ${draft.asset} approved`,
      },
      {
        ok: quorum.approvalsNeed === 0 ? true : quorum.approvals >= quorum.approvalsNeed,
        wait: quorum.approvalsNeed > 0 && quorum.approvals < quorum.approvalsNeed,
        text: quorum.approvalsNeed
          ? `Approvals ${quorum.approvals}/${quorum.approvalsNeed}`
          : `Limit within policy${st.required !== undefined ? ` (${st.required} required)` : ""}`,
      },
      {
        ok: quorum.sigsNeed > 0 && quorum.sigs >= quorum.sigsNeed,
        wait: quorum.sigsNeed > 0 && quorum.sigs < quorum.sigsNeed,
        text: `${quorum.sigs}/${quorum.sigsNeed || 2} signatures`,
      },
    ];
  }, [draft, live, quorum]);

  return (
    <div className="shell">
      <header className="topbar">
        <span
          className="pulse"
          style={{ background: health.ok ? "var(--accent)" : "var(--bad)" }}
        />
        <span>SETTLEMENT TERMINAL</span>
        <span className="sep" />
        <span className="dim">L2 {health.l2 ?? "—"}</span>
        <span className="dim">L1 {health.l1 ?? "—"}</span>
        <span className="sep" />
        <span className="dim">USDC-native · Lineth · proofs → Ethereum</span>
        <span style={{ marginLeft: "auto" }} className="dim">
          {clock.toLocaleTimeString("en-GB", { hour12: false })}
        </span>
        <span className="sep" />
        <span className="accent">{account?.handle ?? "no account"}</span>
      </header>

      <main className="panes">
        <section className="pane">
          <h2>Unified account</h2>
          <div className="who-row">
            <select value={handle} onChange={(e) => setHandle(e.target.value)}>
              <option value="">— select —</option>
              {accounts.map((a) => (
                <option key={a.handle} value={a.handle}>
                  {a.handle}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                void run("account", () => createAccount(`inst-${Date.now().toString(36)}`))
              }
            >
              + new
            </button>
          </div>
          <AccountView
            p={portfolio}
            onFund={(asset) =>
              void run("fund", async () => {
                await api.faucet(handle, asset, toBase("10000", 6));
                say(`faucet 10,000 ${asset}`);
              })
            }
          />
        </section>

        <section className="pane">
          <h2>Settlement</h2>
          <div className="actions">
            {(["settle", "swap", "transfer"] as Action[]).map((a) => (
              <button
                key={a}
                className={draft.action === a ? "on" : ""}
                onClick={() =>
                  setDraft({
                    ...draft,
                    action: a,
                    asset: a === "settle" ? "EURC" : "USDC",
                    toAsset: a === "transfer" ? "USDC" : a === "settle" ? "USDC" : "EURC",
                  })
                }
              >
                {a === "settle" ? "DvP settle" : a}
              </button>
            ))}
          </div>
          <div className="composer">
            <div className="side">
              <span className="who">
                {draft.action === "settle"
                  ? `${account?.handle ?? "A"} delivers`
                  : draft.action === "swap"
                    ? "sell"
                    : "send"}
              </span>
              <input
                className="big mono"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
              <select
                value={draft.asset}
                onChange={(e) => setDraft({ ...draft, asset: e.target.value as Asset })}
              >
                <option>USDC</option>
                <option>EURC</option>
              </select>
            </div>
            <div className="arrow">{draft.action === "settle" ? "⇄" : "→"}</div>
            <div className="side">
              <span className="who">
                {draft.action === "settle"
                  ? `${draft.counterparty || "B"} pays`
                  : draft.action === "swap"
                    ? "receive"
                    : "to"}
              </span>
              {draft.action === "settle" && (
                <input
                  className="big mono"
                  value={draft.toAmount}
                  onChange={(e) => setDraft({ ...draft, toAmount: e.target.value })}
                />
              )}
              {draft.action === "swap" && (
                <div className="big mono dim">
                  {ranked.length
                    ? units(ranked.find((r) => r.executable)?.amountOut ?? "0", 6, 2)
                    : "—"}
                </div>
              )}
              {draft.action === "transfer" && (
                <input
                  className="big mono"
                  placeholder="handle or 0x…"
                  value={draft.counterparty}
                  onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })}
                />
              )}
              {draft.action !== "transfer" && (
                <select
                  value={draft.toAsset}
                  onChange={(e) => setDraft({ ...draft, toAsset: e.target.value as Asset })}
                >
                  <option>USDC</option>
                  <option>EURC</option>
                </select>
              )}
              {draft.action === "settle" && (
                <input
                  placeholder="counterparty handle"
                  value={draft.counterparty}
                  onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })}
                />
              )}
            </div>
          </div>

          <Rail
            status={liveStatus}
            failed={liveStatus?.startsWith("FAILED") ? liveStatus : undefined}
          />

          <div className="section">
            <h2>Route</h2>
            {draft.action === "swap" ? (
              <RouteSpectrum
                ranked={usdcRoute(ranked)}
                chosen={ranked.find((r) => r.executable)?.venue}
                asset={draft.toAsset}
              />
            ) : draft.action === "settle" ? (
              <div className="mono dim" style={{ fontSize: 12, lineHeight: 1.9 }}>
                Delivery vs Payment · atomic execution on Lineth · ZK proof to Ethereum
                <br />
                Both legs move in one transaction or none does.
              </div>
            ) : (
              <div className="mono dim" style={{ fontSize: 12 }}>
                Direct transfer on Lineth · gas paid in USDC through the paymaster
              </div>
            )}
          </div>

          <div className="section policy">
            <div>
              <h2>Policy</h2>
              <ul>
                {policyChecks.map((c, i) => (
                  <li key={i} className={c.ok ? "ok" : c.wait ? "wait" : "no"}>
                    {c.text}
                  </li>
                ))}
              </ul>
            </div>
            <QuorumRing
              have={quorum.sigs + quorum.approvals}
              need={(quorum.sigsNeed || 2) + quorum.approvalsNeed}
              label="quorum"
            />
          </div>

          <button
            className="primary"
            style={{ width: "100%", padding: 12, fontSize: 14 }}
            disabled={busy || !account}
            onClick={() => void run(draft.action, () => executeDraft(draft))}
          >
            {busy
              ? "WORKING…"
              : draft.action === "settle"
                ? "EXECUTE SETTLEMENT"
                : draft.action === "swap"
                  ? "EXECUTE SWAP"
                  : "SEND"}
          </button>
          {live && (
            <div className="dimmer mono" style={{ fontSize: 11, marginTop: 8 }}>
              {live.intentId} · {live.status} · {hhmmss(live.updatedAt)}
            </div>
          )}
        </section>

        <section className="pane">
          <h2>Receipt</h2>
          <ReceiptView intent={selected} receipt={receipt} />
          <div className="hair" />
          <h2>Feed</h2>
          <div className="feed">
            {feed.map((f) => (
              <div
                key={f.intentId}
                className={`item ${selected?.intentId === f.intentId ? "sel" : ""}`}
                onClick={() => setSelected(f)}
              >
                <span>
                  {f.intent.action} {units(f.intent.source.amount, 6, 2)} {f.intent.source.asset}
                  {f.intent.destination.asset !== f.intent.source.asset
                    ? ` → ${f.intent.destination.asset}`
                    : ""}
                  <br />
                  <span className="t">
                    {f.intentId} · {hhmmss(f.updatedAt)}
                  </span>
                </span>
                <span className={`status ${f.status}`}>{f.status}</span>
              </div>
            ))}
            {!feed.length && <div className="empty">no intents yet</div>}
          </div>
          <div className="hair" />
          <h2>Activity</h2>
          <ul id="activity" className="activity">
            {log.map((l, i) => (
              <li key={`${l.t}-${i}`} className={l.bad ? "bad" : ""}>
                <span className="dimmer">{hhmmss(l.t).slice(0, 8)}</span> {l.text}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <CommandLine onCommand={onCommand} busy={busy} />
      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`}>{toast.text}</div>}
      {palette && <Palette items={paletteItems} onClose={() => setPalette(false)} />}
    </div>
  );
}
