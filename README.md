# Volary (VS Code)

Connects [Volary](https://volary.ai) to GitHub Copilot's agent mode: injects
Volary memory at session start, exposes Volary tools to Copilot over MCP, and
ships transcripts back to Volary when a session ends.

## What it does

On activation, once you've provided an agent URL and token, the extension:

1. Registers a Volary MCP server with Copilot (`${agentUrl}/v0/mcp`, authed
   with your agent token), so Copilot can call Volary tools directly.
2. Writes `~/.copilot/hooks/volary.json` with two hooks:
   - **SessionStart** — POSTs the event to `${agentUrl}/copilot/session-start`;
     the response is injected into the Copilot conversation as additional
     context (your Volary memory for the current repo/session).
   - **Stop** — uploads the Copilot transcript to `${agentUrl}/copilot/stop`
     so Volary can learn from the session.
3. Drops the small Stop helper scripts in `~/.volary/scripts/`.

Credentials are stored in VS Code's `SecretStorage` (token) and `globalState`
(agent URL). They can also be seeded from the `VOLARY_TOKEN` and
`VOLARY_AGENT_URL` environment variables on first launch.

## Getting started

1. Install the extension.
2. Run **Volary: Connect** from the command palette and paste your agent URL
   (e.g. `https://api.volary.ai/v0/orgs/<org>/agents/<agent>`) and token from
   [app.volary.ai](https://app.volary.ai).
3. Start a Copilot agent session — memory and MCP tools are wired up
   automatically.

## Commands

- **Volary: Connect** — prompts for agent URL + token and installs everything.
- **Volary: Set Agent Token** — update the token only.
- **Volary: Set Agent URL** — update the URL only.
- **Volary: Reinstall Copilot Hook** — re-writes the hook config and scripts
  (useful after upgrades).
- **Volary: Disconnect / Uninstall Hook** — removes the hook file, helper
  scripts, and stored credentials.
