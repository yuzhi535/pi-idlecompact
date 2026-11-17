# pi-idlecompact

A [Pi](https://pi.dev) extension that compacts a session for you, so long chats cost less when you come back.

It does two things:

- **Idle compact.** If a session sits idle for 30 minutes and the context is at least 200K tokens, it runs Pi's normal `/compact`. This is the same idea as Claude Code's idle compaction, with a shorter wait (Claude Code defaults to about 54 minutes).
- **Size compact.** When a turn finishes, it also compacts early:
  - large-window models (over 500K, such as 1M-context Gemini or DeepSeek) at **500K**
  - GPT / Codex models with a **272K** window at **256K**

Sessions below 200K are left alone while idle, so a short chat does not pay for a summary.

## Install

```bash
pi install git:github.com/yuzhi535/pi-idlecompact
```

Then `/reload` or restart Pi. Once the package is on npm, this will also work:

```bash
pi install npm:@yuzhi535/pi-idlecompact
```

Requires Pi 1.5 or newer.

## Settings

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PI_IDLE_COMPACT` | on | Set to `off` to disable this extension |
| `PI_IDLE_COMPACT_IDLE_MINUTES` | `30` | Minutes of idle time before compacting |
| `PI_IDLE_COMPACT_MIN_TOKENS` | `200000` | Minimum context size for idle compact |

The size thresholds (500K / 256K) are built into the extension. For Pi's own built-in autocompact to use the same cutoffs *before* the next prompt, you can also set `compaction.modelOverrides` in `settings.json`. Example for a 1M-window model, where `reserveTokens` is `contextWindow - 500000`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000,
    "modelOverrides": {
      "vercel-ai-gateway/google/gemini-4-hydrogen": {
        "reserveTokens": 500000
      }
    }
  }
}
```

For a 272K-window GPT / Codex model, use `reserveTokens` of `16000` so compact starts at 256K.

## License

MIT
