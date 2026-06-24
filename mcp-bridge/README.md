# eterna-mcp-bridge

MCP server that connects AI agents to the [Eterna](https://eterna.ai) browser extension. Supports **multiple simultaneous clients** (Cursor, Claude Code, VS Code Copilot, etc.) via StreamableHTTP.

## How it works

```
Cursor        ──HTTP POST /mcp──┐
Claude Code   ──HTTP POST /mcp──┤── eterna-mcp-server ──WebSocket──▶ Eterna Chrome Extension
VS Code       ──HTTP POST /mcp──┘
```

The server runs on `localhost:9223` and provides:

- **`/mcp`** — StreamableHTTP endpoint for MCP clients
- **`/extension`** — WebSocket endpoint for the Eterna Chrome extension
- **`/health`** — Health check endpoint

## Quick start

### 1. Start the server

```bash
npx eterna-mcp-server
```

The server stays running and handles all AI agent connections.

### 2. Configure your AI agent

**Cursor** (`.cursor/mcp.json` or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "eterna-browser": {
      "url": "http://localhost:9223/mcp"
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add --transport http eterna-browser http://localhost:9223/mcp
```

**VS Code Copilot** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "eterna-browser": {
      "url": "http://localhost:9223/mcp"
    }
  }
}
```

### 3. Connect Eterna extension

1. Open Chrome → Eterna extension → Options page
2. Set WebSocket URL to `ws://localhost:9223/extension`
3. Click **Connect**

Your AI agents can now control the browser through Eterna — all simultaneously.

## Options

```
npx eterna-mcp-server [--port <port>] [--host <host>]
```

| Option            | Default     | Description                                                 |
| ----------------- | ----------- | ----------------------------------------------------------- |
| `--port <port>`   | `9223`      | Server port                                                 |
| `--host <host>`   | `127.0.0.1` | Bind address (`0.0.0.0` to allow remote/Docker connections) |
| `--help`, `-h`    |             | Show help message                                           |
| `--version`, `-v` |             | Show version                                                |

---

## Stdio Bridge (backward compatibility)

For MCP clients that only support stdio transport, a thin bridge is included:

```json
{
  "mcpServers": {
    "eterna-browser": {
      "command": "npx",
      "args": ["-y", "eterna-mcp-bridge"]
    }
  }
}
```

The stdio bridge forwards tool calls to the HTTP server at `http://localhost:9223/mcp`. The server must be running separately.

---

## Eterna CLI

Command-line tool for controlling the browser directly from the terminal.

### Usage

```bash
eterna-cli <tool_name> [--param value ...]
eterna-cli --list                              # List all tools
eterna-cli --help <tool_name>                  # Show tool parameters
eterna-cli --json '{"name":"...","arguments":{...}}'  # Raw JSON
```

### Examples

```bash
eterna-cli get_all_tabs
eterna-cli create_new_tab --url https://example.com
eterna-cli search_elements --tabId 123 --query "button*"
eterna-cli click --tabId 123 --uid btn-42
eterna-cli capture_screenshot
```

### Environment Variables

| Variable                | Default                     | Description            |
| ----------------------- | --------------------------- | ---------------------- |
| `ETERNA_SERVER_URL`      | `http://localhost:9223/mcp` | HTTP server URL        |
| `ETERNA_WS_URL`          | `ws://localhost:9223/cli`   | WebSocket fallback URL |
| `ETERNA_CONNECT_TIMEOUT` | `60000`                     | Max ms to wait         |

---

## Docker Image

```bash
docker pull butterman2/eterna-browser:latest
docker run -d --name eterna --shm-size=2g \
  -p 9223:9223 -p 5900:5900 -p 6080:6080 \
  butterman2/eterna-browser:latest
```

| Port | Service                |
| ---- | ---------------------- |
| 9223 | MCP Server (HTTP + WS) |
| 5900 | VNC                    |
| 6080 | noVNC (web-based)      |

## Migration from v2.x

v3.0 replaces the daemon+proxy architecture with a single HTTP server:

| v2.x (daemon)                               | v3.0 (HTTP server)                                    |
| ------------------------------------------- | ----------------------------------------------------- |
| `npx eterna-mcp-bridge` (stdio per IDE)      | `npx eterna-mcp-server` (one server)                   |
| Each IDE spawns its own bridge process      | All IDEs connect to one HTTP endpoint                 |
| Daemon with PID files, idle timeout         | Standard HTTP server, no background process           |
| Extension connects to `ws://localhost:9223` | Extension connects to `ws://localhost:9223/extension` |

**Breaking change**: The Eterna extension WebSocket URL changed from `ws://localhost:9223` to `ws://localhost:9223/extension`. Update the URL in Eterna extension Options.

## Requirements

- Node.js >= 18
- Eterna Chrome extension installed (not needed for Docker image)

## License

MIT
