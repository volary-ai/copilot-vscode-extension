# Volary (VS Code)

Installs a [Volary](https://volary.ai) agent plugin into GitHub Copilot: memory
at session start, Volary MCP tools during the session, and transcript upload
when the session ends.

## What it does

On activation, once you've provided an agent URL and token, the extension:

1. Renders a Copilot agent plugin into VS Code's per-extension storage at
   `<globalStorage>/volary/` containing:
   - `plugin.json` — the manifest
   - `hooks.json` — `SessionStart` (memory injection) and `Stop` (transcript
     upload) hooks
   - `.mcp.json` — the Volary HTTP MCP server with your auth header
   - `scripts/copilot-stop.*` — helpers invoked by the Stop hook
2. Registers that directory in the user-level `chat.pluginLocations` setting
   so Copilot discovers it. The plugin then shows up in the Extensions view
   under the `@agentPlugins` filter, and under Chat → Plugins.

Credentials are stored in VS Code's `SecretStorage` (token) and `globalState`
(agent URL). They can also be seeded from the `VOLARY_TOKEN` and
`VOLARY_AGENT_URL` environment variables on first launch.

## Getting started

1. Install the extension.
2. Run **Volary: Connect** from the command palette and paste your agent URL
   (e.g. `https://api.volary.ai/v0/orgs/<org>/agents/<agent>`) and token from
   [app.volary.ai](https://app.volary.ai).
3. Start a Copilot agent session — memory, MCP tools, and transcript upload
   are wired up automatically. If it doesn't pick up immediately, reload the
   window.

## Commands

- **Volary: Connect** — prompts for agent URL + token and installs the plugin.
- **Volary: Set Agent Token** — update the token only.
- **Volary: Set Agent URL** — update the URL only.
- **Volary: Reinstall Plugin** — re-renders the plugin directory (useful after
  upgrades).
- **Volary: Disconnect / Uninstall Plugin** — removes the plugin directory,
  unregisters it from `chat.pluginLocations`, and clears stored credentials.
- **Volary: Show Logs** — opens the Volary output channel for troubleshooting.

## Copilot CLI

This extension manages the VS Code side. The plugin directory it renders
(`<globalStorage>/volary/`) is a stand-alone Copilot agent plugin — the same
shape you can ship to CLI users. Point the CLI at the rendered directory (or
clone it) once CLI plugin support is available.
