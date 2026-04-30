import {
  Plug,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  CreditCard,
  Workflow,
  Copy,
  PauseCircle,
  Clock,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AGENTS, MCP_TOOLS, BLOCKED_CHATS } from "@/lib/mock-data";

const LINEAGE_DOT: Record<string, string> = {
  codex: "bg-orange-400",
  gemini: "bg-blue-400",
  opencode: "bg-emerald-400",
  claude: "bg-violet-400",
};

export default function ConnectPage() {
  const byo = AGENTS.filter((a) => a.source === "byo");
  const credits = AGENTS.filter((a) => a.source === "credits");

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Connect
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Plug in what you have. Chorus orchestrates.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Already paying for Claude / Codex / Gemini? Just connect them — no
            credits needed. Want to try a model you don&apos;t have a sub for?
            Buy credits to route through Chorus for that one task.
          </p>
        </div>

        {/* BYO */}
        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Bring your own
            </h2>
            <span className="text-xs text-muted-foreground">
              Free — uses your existing subscriptions
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {byo.map((a) => (
              <Card
                key={a.id}
                className="flex items-center gap-3 bg-card p-4"
              >
                <span
                  className={`h-2 w-2 rounded-full ${LINEAGE_DOT[a.lineage]}`}
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold">{a.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {a.model}
                  </div>
                </div>
                {a.status === "connected" ? (
                  <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Connected
                  </Badge>
                ) : (
                  <button
                    type="button"
                    className="rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    <Plug className="mr-1 inline-block h-3 w-3" />
                    Connect
                  </button>
                )}
              </Card>
            ))}
          </div>
        </section>

        {/* Credits */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5" />
              Try via credits
            </h2>
            <span className="text-xs text-muted-foreground">
              Pay-per-use — no subscription required
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {credits.map((a) => (
              <Card
                key={a.id}
                className="flex items-center gap-3 bg-card p-4"
              >
                <span
                  className={`h-2 w-2 rounded-full ${LINEAGE_DOT[a.lineage]}`}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{a.name}</span>
                    <Badge
                      variant="outline"
                      className="border-primary/40 text-[10px] text-primary"
                    >
                      via Chorus
                    </Badge>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {a.model}
                  </div>
                </div>
                {a.status === "connected" ? (
                  <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    Available
                  </Badge>
                ) : (
                  <button
                    type="button"
                    className="rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    <AlertCircle className="mr-1 inline-block h-3 w-3" />
                    Enable
                  </button>
                )}
              </Card>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
                <CreditCard className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">
                  Credit balance: $12.40
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ≈ 47 reviews remaining at average pack size. Top up any time.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Top up
              </button>
            </div>
          </div>
        </section>

        {/* MCP — outer orchestrator */}
        <section className="mt-12">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" />
              Outer orchestrator (MCP)
            </h2>
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300"
            >
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Server running
            </Badge>
          </div>
          <p className="mb-4 max-w-2xl text-xs text-muted-foreground">
            Chorus ships an MCP server so your main Claude / Cursor / Codex
            session can spawn chats, fan out work, and wait for consensus —
            all as tool calls. One outer agent → many parallel Chorus chats.
          </p>

          {/* Endpoint */}
          <Card className="mb-4 bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                MCP endpoint
              </span>
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground transition hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
            </div>
            <code className="block rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground/90">
              http://127.0.0.1:7710/mcp
            </code>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Paste into <span className="font-mono">~/.claude/mcp.json</span>{" "}
              or Cursor&apos;s MCP settings. Daemon must be running.
            </p>
          </Card>

          {/* Tool list */}
          <div className="mb-4 space-y-2">
            {MCP_TOOLS.map((t) => (
              <div
                key={t.name}
                className="rounded-md border border-border bg-card/50 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs font-medium text-primary">
                      {t.name}
                    </code>
                    <Badge
                      variant="outline"
                      className={`border-border text-[10px] uppercase ${
                        t.status === "stable"
                          ? "text-emerald-300 border-emerald-500/30"
                          : t.status === "beta"
                            ? "text-amber-300 border-amber-500/30"
                            : "text-muted-foreground"
                      }`}
                    >
                      {t.status}
                    </Badge>
                  </div>
                  <code className="hidden truncate font-mono text-[10px] text-muted-foreground sm:block">
                    {t.signature}
                  </code>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t.description}
                </p>
                <div className="mt-1.5 flex items-baseline gap-2 font-mono text-[10px]">
                  <span className="text-muted-foreground/60">returns:</span>
                  <span className="text-foreground/70">{t.returns}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Blocked queue — proves mm.list_blocked is real */}
          <Card className="bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PauseCircle className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-medium text-foreground">
                  Awaiting your input
                </span>
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-300"
                >
                  {BLOCKED_CHATS.length} blocked
                </Badge>
              </div>
              <code className="font-mono text-[10px] text-muted-foreground">
                mm.list_blocked()
              </code>
            </div>
            <div className="space-y-2">
              {BLOCKED_CHATS.map((c) => (
                <div
                  key={c.chatId}
                  className="flex items-center gap-3 rounded-md border border-border bg-card/40 px-3 py-2"
                >
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[11px] text-foreground">
                        {c.chatId}
                      </code>
                      <Badge
                        variant="outline"
                        className={`border-border text-[10px] ${
                          c.blockedReason === "consensus_not_met"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                            : c.blockedReason === "permission_required"
                              ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                        }`}
                      >
                        {c.blockedReason.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {c.project} · {c.template} · round {c.round} · {c.agreed}/
                      {c.total} agreed
                    </div>
                  </div>
                  <a
                    href={c.deepLink}
                    className="rounded-md border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    Decide →
                  </a>
                </div>
              ))}
            </div>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
