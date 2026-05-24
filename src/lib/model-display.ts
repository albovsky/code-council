import { uiLineageLabel } from "@/lib/lineage-maps";

const KNOWN_MODEL_NAMES: Record<string, string> = {
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "kimi-k2.6": "Kimi K2.6",
  "glm-5.1": "GLM-5.1",
  "qwen3.6-plus": "Qwen3.6 Plus",
  "minimax-m2.7": "MiniMax M2.7",
  "gpt-5.5": "Codex 5.5",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
};

const PROVIDER_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "codex-cli": "Codex CLI",
  "antigravity-cli": "Antigravity CLI",
  "kimi-cli": "Kimi CLI",
  "opencode-cli": "OpenCode",
  "grok-cli": "Grok",
  openrouter: "OpenRouter",
};

export interface ModelLogo {
  src?: string;
  label: string;
  className: string;
  imageClassName?: string;
}

export function displayModelName(modelId: string): string {
  const cleaned = modelId
    .replace(/^opencode-go\//, "")
    .replace(/^openrouter:/, "");
  const bare = cleaned.includes("/") ? cleaned.split("/").at(-1) ?? cleaned : cleaned;
  const known = KNOWN_MODEL_NAMES[bare.toLowerCase()];
  if (known) return known;

  return bare
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (/^(gpt|glm|api|ai)$/i.test(part)) return part.toUpperCase();
      if (/^v\d+$/i.test(part)) return part.toUpperCase();
      if (/^k\d+(?:\.\d+)?$/i.test(part)) return part.toUpperCase();
      if (/^m\d+(?:\.\d+)?$/i.test(part)) return part.toUpperCase();
      if (lower === "deepseek") return "DeepSeek";
      if (lower === "minimax") return "MiniMax";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function providerLabelForVoice(voice: {
  model_id: string;
  provider: string;
}): string {
  if (voice.model_id.startsWith("opencode-go/")) return "OpenCode Go";
  return PROVIDER_LABELS[voice.provider] || voice.provider;
}

export function providerDisplayLabel(
  provider: string | undefined,
  fallbackLineage?: string,
): string {
  if (provider === "opencode-cli") return "OpenCode Go";
  if (provider === "codex-cli") return "Codex CLI";
  if (provider === "antigravity-cli") return "Antigravity CLI";
  if (provider?.endsWith("-cli") && fallbackLineage) {
    return uiLineageLabel(fallbackLineage);
  }
  if (provider) return PROVIDER_LABELS[provider] || uiLineageLabel(provider) || provider;
  return fallbackLineage ? uiLineageLabel(fallbackLineage) : "";
}

export function providerLineageKey(provider: string | undefined): string {
  if (provider === "opencode-cli") return "opencode";
  if (provider === "codex-cli") return "codex";
  if (provider === "antigravity-cli") return "antigravity";
  return provider ?? "";
}

export function displayTier(tier: string): string {
  return tier.replace("_PLUS", "+").replace("_MINUS", "-");
}

export function modelLogoForVoice(voice: {
  model_id: string;
  provider: string;
  vendor_family?: string | null;
}): ModelLogo {
  const modelId = voice.model_id.toLowerCase();
  const family = voice.vendor_family?.toLowerCase() ?? "";
  const baseClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900 p-1.5 shadow-sm shadow-black/20";

  const lobeIcon = (filename: string) =>
    `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${filename}.svg`;

  if (modelId.includes("gpt") || family === "openai" || voice.provider === "codex-cli") {
    return {
      src: lobeIcon("openai"),
      label: "OpenAI",
      className: `${baseClass} border-orange-300/30`,
      imageClassName: "h-full w-full object-contain invert",
    };
  }
  if (modelId.includes("deepseek") || family === "deepseek") {
    return {
      src: lobeIcon("deepseek-color"),
      label: "DeepSeek",
      className: `${baseClass} border-cyan-300/30`,
    };
  }
  if (modelId.includes("kimi") || family === "moonshot") {
    return {
      src: lobeIcon("kimi-color"),
      label: "Kimi",
      className: `${baseClass} border-violet-300/30`,
    };
  }
  if (modelId.includes("glm") || family === "zai") {
    return {
      src: lobeIcon("zhipu-color"),
      label: "Zhipu",
      className: `${baseClass} border-sky-300/30`,
    };
  }
  if (modelId.includes("qwen") || family === "qwen") {
    return {
      src: lobeIcon("qwen-color"),
      label: "Qwen",
      className: `${baseClass} border-indigo-300/30`,
    };
  }
  if (modelId.includes("minimax") || family === "minimax") {
    return {
      src: lobeIcon("minimax-color"),
      label: "MiniMax",
      className: `${baseClass} border-rose-300/30`,
    };
  }
  if (modelId.includes("gemini") || family === "google" || voice.provider === "google") {
    return {
      src: lobeIcon("gemini-color"),
      label: "Gemini",
      className: `${baseClass} border-blue-300/30`,
    };
  }

  return {
    label: displayModelName(voice.model_id)
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 3)
      .toUpperCase(),
    className:
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300/20 bg-muted text-[10px] font-bold tracking-tight text-muted-foreground shadow-sm",
  };
}
