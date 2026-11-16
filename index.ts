/**
 * pi-idlecompact
 *
 * Auto-compacts a Pi session after 30 minutes idle (if context is at least 200K),
 * and also when a turn ends above 500K for large-window models, or 256K for
 * GPT / Codex models with a 272K window.
 *
 * Env:
 *   PI_IDLE_COMPACT=off
 *   PI_IDLE_COMPACT_MIN_TOKENS=<tokens>     (default 200000)
 *   PI_IDLE_COMPACT_IDLE_MINUTES=<minutes>  (default 30)
 */


import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_MIN_TOKENS = 200_000;
const DEFAULT_IDLE_MINUTES = 30;
const TICK_MS = 60 * 1000;
const POST_COMPACT_QUIET_MS = 10 * 60 * 1000;
const GENERAL_COMPACT_AT = 500_000;
const GPT_272K_COMPACT_AT = 256_000;
const GPT_272K_WINDOW_MIN = 256_000;
const GPT_272K_WINDOW_MAX = 272_000;

function envNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isGptFamily(ctx: ExtensionContext): boolean {
	const model = ctx.model;
	if (!model) return false;
	const key = `${model.provider}/${model.id}`.toLowerCase();
	return /(?:^|\/)(gpt-|openai|openai-|codex)/.test(key) || key.includes("openai-codex");
}

/** 到这个 token 数就该压；返回 null 表示交给 Pi 自带的窗口余量判断。 */
function sizeThreshold(ctx: ExtensionContext): number | null {
	const window = ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	if (isGptFamily(ctx) && window > GPT_272K_WINDOW_MIN && window <= GPT_272K_WINDOW_MAX) {
		return GPT_272K_COMPACT_AT;
	}
	if (window > GENERAL_COMPACT_AT) return GENERAL_COMPACT_AT;
	return null;
}

export default function idleCompact(pi: ExtensionAPI): void {
	if (process.env.PI_IDLE_COMPACT === "off") return;

	const minTokens = envNumber("PI_IDLE_COMPACT_MIN_TOKENS", DEFAULT_MIN_TOKENS);
	const idleMs = envNumber("PI_IDLE_COMPACT_IDLE_MINUTES", DEFAULT_IDLE_MINUTES) * 60 * 1000;

	let lastActivity = Date.now();
	let quietUntil = 0;
	let compacting = false;

	const touch = (): void => {
		lastActivity = Date.now();
	};

	const compactionEnabled = (): boolean => pi.getSettings()?.compaction?.enabled ?? true;

	const startCompact = (ctx: ExtensionContext, reason: string, tokens: number): void => {
		compacting = true;
		ctx.compact({
			customInstructions:
				"这是一次自动压缩。请保住可继续工作的状态——" +
				"当前任务目标、已确认的决定、改过哪些文件、下一步要做什么、以及未解决的问题；" +
				"可以丢掉中间过程的试错细节。",
			onComplete: () => {
				compacting = false;
				quietUntil = Date.now() + POST_COMPACT_QUIET_MS;
				if (ctx.hasUI) {
					ctx.ui.notify(
						`${reason}（${Math.round(tokens / 1000)}K tokens）`,
						"info",
					);
				}
			},
			onError: () => {
				compacting = false;
				quietUntil = Date.now() + POST_COMPACT_QUIET_MS;
			},
		});
	};

	const canCompact = (ctx: ExtensionContext): boolean => {
		if (Date.now() < quietUntil) return false;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return false;
		if (compacting) return false;
		if (!compactionEnabled()) return false;
		return true;
	};

	const maybeSizeCompact = (ctx: ExtensionContext): void => {
		if (!canCompact(ctx)) return;
		const threshold = sizeThreshold(ctx);
		if (threshold === null) return;
		const tokens = ctx.getContextUsage()?.tokens ?? null;
		if (tokens === null || tokens < threshold) return;
		startCompact(ctx, `Auto-compacted at ${Math.round(threshold / 1000)}K`, tokens);
	};

	const maybeIdleCompact = (ctx: ExtensionContext): void => {
		const now = Date.now();
		if (now - lastActivity < idleMs) return;
		if (!canCompact(ctx)) return;
		const tokens = ctx.getContextUsage()?.tokens ?? null;
		if (tokens === null || tokens < minTokens) return;
		const idleMinutes = Math.round((now - lastActivity) / 60000);
		startCompact(ctx, `Compacted while idle，空闲 ${idleMinutes} 分钟`, tokens);
	};

	pi.on("ui_prompt_end", touch);
	pi.on("agent_end", touch);
	pi.on("turn_start", touch);

	pi.on("session_before_compact", () => {
		compacting = true;
	});
	pi.on("session_compact", () => {
		compacting = false;
		quietUntil = Date.now() + POST_COMPACT_QUIET_MS;
	});
	pi.on("session_compact_failed", () => {
		compacting = false;
		quietUntil = Date.now() + POST_COMPACT_QUIET_MS;
	});

	let currentCtx: ExtensionContext | undefined;
	const remember = (_event: unknown, ctx: ExtensionContext): void => {
		currentCtx = ctx;
	};
	pi.on("session_start", remember);
	pi.on("turn_start", remember);
	pi.on("ui_prompt_end", remember);
	pi.on("agent_end", remember);
	pi.on("agent_settled", (_event, ctx) => {
		currentCtx = ctx;
		touch();
		maybeSizeCompact(ctx);
	});

	let timer: ReturnType<typeof setInterval> | undefined;
	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		if (ctx.mode === "print") return;
		timer = setInterval(() => {
			if (!currentCtx) return;
			try {
				maybeIdleCompact(currentCtx);
			} catch {
				// 上下文对象失效时不打断会话，下一拍再试。
			}
		}, TICK_MS);
		timer.unref?.();
	});

	pi.on("session_shutdown", () => {
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		currentCtx = undefined;
		lastActivity = Date.now();
	});
}
