# MCPToolGuard

> A browser-native firewall for AI agent tool calls. 
> JWT scope enforcement, audit logging, and telemetry — 
> no cloud required, no data leaves your perimeter.


## Status
🚧 Under active development — follow along as it's built

MCPToolGuard — Project Brief for Cursor
I am building MCPToolGuard — a browser-native, cloud-agnostic security layer for MCP (Model Context Protocol) tool calls. Think of it as a firewall for AI agents.
What it is
A lightweight gateway that sits between an AI agent and any MCP server. It enforces JWT scopes, logs every tool call, and blocks unauthorized access — all without any cloud dependency, without any vendor lock-in, and without data ever leaving the user's infrastructure.
The unique angle
Everything runs in the browser:

WebLLM runs the LLM locally — no API key, no external AI calls
Agent loop reasons client side
Gateway enforces JWT scopes client side
Telemetry and audit logs stay local or go to an endpoint the user controls
Connects to any MCP server anywhere

Nobody has built this combination. Existing gateways are all server side, cloud dependent, or require significant platform engineering. This runs in a browser tab.
The architecture
Browser:
├── WebLLM              ← local LLM, no API key required
├── Agent loop          ← reasoning happens client side
├── MCPToolGuard layer  ← JWT validation + scope enforcement
│    ├── validate JWT signature
│    ├── check token expiry
│    ├── read scopes from token
│    ├── match against tool config
│    ├── allow or deny
│    └── log every decision
└── MCP client          ← calls any MCP server

Connects to:
├── Local MCP servers   ← built during development
├── Vercel MCP servers  ← deployed test servers
└── Any external MCP    ← Slack, GitHub, Notion etc
How authorization works
The JWT IS the authorization. No separate IAM system needed. The identity provider issues a scoped JWT. The gateway validates and enforces it. Stateless. No external calls. Works with any OAuth 2.1 compliant identity provider — Azure AD, Okta, Ping, Keycloak, anything.
Request arrives with JWT
     ↓
Validate signature
     ↓
Check expiry
     ↓
Read scopes from token
     ↓
Match against tool config
     ↓
Allow or deny
     ↓
Log decision with full context
Tool level config
yamlservers:
  flight:
    url: https://flight-mcp.vercel.app
    tools:
      search_flights:
        required_scope: flights:read
      create_booking:
        required_scope: flights:write
      cancel_booking:
        required_scope: flights:delete
        alert: true
        log_level: verbose

  slack:
    url: https://mcp.slack.com
    tools:
      read_channel:
        required_scope: slack:read
      send_message:
        required_scope: slack:write

  github:
    url: https://mcp.github.com
    tools:
      read_repo:
        required_scope: github:read
      push_code:
        required_scope: github:write
        alert: true
Security layers
Layer 1 — Transport:      HTTPS minimum, mTLS optional
Layer 2 — Identity:       JWT bearer token
Layer 3 — Authorization:  JWT scopes per tool
Layer 4 — Audit:          structured log of every call
Layer 5 — Alerts:         configurable per tool
What it is NOT

Not a SaaS product
Not cloud dependent
Not tied to AWS, Azure, or GCP
Not a replacement for your identity provider
Not another platform — one focused thing that does one thing well

Demo server — Flight MCP
Built using FastMCP Python on Vercel. Used as the primary test server during development. Tools include search_flights, get_flight_details, create_booking, get_booking, cancel_booking, modify_booking, check_in, select_seats, add_baggage, track_flight.
The demo shows:
Without MCPToolGuard:
└── any caller can cancel any booking
└── no audit trail
└── no visibility

With MCPToolGuard:
└── read only token can search but not book
└── booking token can create but not cancel
└── cancel requires elevated scope
└── everything logged
└── dashboard shows every call
Tech stack
Browser client:   HTML + vanilla JS or lightweight React
WebLLM:           @mlc-ai/web-llm
MCP client:       browser compatible MCP client
Gateway layer:    pure JS JWT validation (no vendor SDK)
Config:           YAML or JSON
Logging:          structured JSON, stays local
Flight server:    Python + FastMCP on Vercel
Language:         TypeScript preferred for browser code
Repo structure
mcp-tool-guard/
├── gateway/              ← core JWT enforcement logic
│   ├── guard.ts
│   └── config.yaml
├── ui/                   ← browser client
│   ├── index.html
│   └── agent.ts
├── servers/
│   └── flight/           ← test MCP server
│       └── server.py
├── docs/
│   └── CONCEPT.md
├── LICENSE               ← MIT
└── README.md
Current status
Learning FastMCP via training course. Flight MCP server is the first build. MCPToolGuard gateway wraps it as the second build. WebLLM UI connects everything as the third build.
What I need help with in Cursor
Start with the flight MCP server:

FastMCP Python server
All flight tools with proper typed parameters and descriptive docstrings
Mock data so it runs standalone without a real flight API
Deployable to Vercel via HTTP transport

Then build the gateway layer:

Pure JWT validation in TypeScript
YAML config for tool level scope enforcement
Structured JSON logging of every tool call
No external dependencies beyond standard JWT library

Then the browser UI:

WebLLM loaded locally
Simple chat interface
Agent loop that calls MCP tools
MCPToolGuard enforcing scopes on every call
Basic dashboard showing tool call log

Core principle throughout
No cloud dependency. No data leaving the browser except to MCP servers the user explicitly configured. No vendor lock-in. Works anywhere. Private by default.
