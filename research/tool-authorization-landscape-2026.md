# Tool-Call Authorization in Agentic AI: Where the Enforcement Actually Lives

## Problem Statement

As AI agents grow more autonomous and capable of calling arbitrary tools—file systems, APIs, MCP servers, cloud resources—the security question becomes unavoidable: who decides *which* agent (or human, via an agent) gets to call *which* tool, and where is that decision actually enforced? The conventional wisdom, "put authorization at the API layer," breaks down when agents sit in browsers, on laptops, in containers, or across hybrid deployments. This landscape research maps where different communities think authorization *should* live, and exposes a gap between what AI gateway products market and what they actually enforce.

---

## 1. The Model Context Protocol (MCP) Authorization Spec

MCP is positioned as "a USB-C port for AI applications"—a standardized way for AI clients (Claude, ChatGPT, IDEs) to connect to external systems like databases, tools, and workflows. However, **MCP's authorization layer is narrower than many assume**.

### What MCP Actually Specifies

[The MCP specification](https://modelcontextprotocol.io/docs) is an open-source standard focused on *connection-level authentication* between client and server, not fine-grained per-tool authorization. MCP clients and servers can negotiate capabilities and protocols (sampling, prompting, tool definitions), but the spec itself does not define how to enforce "this user/agent can call Tool A but not Tool B." That boundary is explicitly left to the application layer.

MCP's architecture assumes either (a) the client fully trusts the server it connects to, or (b) a proxy sits between them to add enforcement. This is a critical design insight: **MCP treats authorization as an out-of-spec problem**.

### Known Gaps

[MCP Tool ACLs developed by Kong](https://konghq.com/blog/product-releases/mcp-tool-acls-ai-gateway) highlight the gap—Kong's product announcement explicitly frames per-tool filtering as a "powerful feature" because MCP doesn't provide it natively. The specification does not include scopes, per-tool claims, or any mechanism to say "this JWT is valid for connecting to MCP, but only for calling read-only tools." Organizations adding that layer must build it themselves (as MCPToolGuard does) or buy it from a vendor.

---

## 2. OWASP Agentic AI & LLM Security Guidance

### The LLM Top 10 (2025) and the Agentic Applications Framework (2026)

[OWASP published its Top 10 for LLM Applications (v2.0) in November 2024](https://genai.owasp.org/llm-top-10/), and in 2025–2026 released a *separate* [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) that layers agent-specific risks on top of the LLM list. Both frameworks treat authorization as foundational.

**Excessive Agency (LLM06 and Agent-specific expansion)** is the closest anchor for tool-call authorization risk. OWASP breaks it into three root causes:
- **Excessive functionality**: agents can reach tools beyond their assigned task scope.
- **Excessive permissions**: tools operate with broader privileges than necessary.
- **Excessive autonomy**: high-impact actions proceed without human in the loop.

### The Enforcement Principle: Intersection, Not Union

[According to OWASP's agentic framework guidance](https://auth0.com/blog/owasp-top-10-agentic-applications-lessons/), the control point is the **per-request scope check**. A gateway must intersect three permission sets:
1. The upstream user's policy (who initiated the request).
2. The agent's declared scope (what it's licensed to do).
3. The specific tool's access requirements.

The effective permission is the **intersection**—the minimum of all three. This is fail-closed: if any layer says no, the call is denied. Static, pre-assignment-time authorization is insufficient; continuous runtime decisions are required.

---

## 3. The Competitive Landscape: AI Gateway Products

The market for "AI gateways" has exploded, but marketing claims often conflate **cost observability / rate limiting** with **authorization enforcement**. Here's what the leaders actually do:

### Cloudflare AI Gateway

[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) excels at spend control and provider-agnostic routing but lacks fine-grained per-tool authorization. You can scope spend limits to dimensions like model, provider, or custom metadata (user, team, application), but [API token scoping remains gateway-wide](https://community.cloudflare.com/t/scope-api-tokens-to-a-specific-ai-gateway-matching-the-per-bucket-scoping-r2-alrea/930329)—any token with AI Gateway Run permission can invoke every gateway in your account. A feature request for per-resource scoping (like R2's per-bucket model) remains pending.

**Bottom line**: routing and observability, not authorization.

### Kong AI Gateway

Kong is the outlier in this landscape. [Kong AI Gateway 3.13 introduced MCP Tool ACLs](https://konghq.com/blog/product-releases/mcp-tool-acls-ai-gateway), which enable fine-grained per-tool authorization at the gateway layer. [Kong 3.14 extended this with OAuth2 scope-based tool filtering](https://konghq.com/blog/product-releases/kong-ai-gateway-3-14), allowing you to restrict tool access using scopes from the incoming JWT token—without requiring static consumer group management.

This is the rare exception: a gateway vendor that actually addresses the OWASP "intersection" principle.

**Bottom line**: Kong solves it; others mostly don't.

### Portkey

[Portkey's gateway](https://portkey.ai/features/ai-gateway/) routes MCP servers and tools through a centralized control plane. [It logs every tool call with full context (caller, parameters, response, latency)](https://portkey.ai/blog/llm-access-control-in-multi-provider-environments/) and enforces access control to determine which teams and users can reach which servers and tools. Policies for model access, budgets, and guardrails are applied consistently, but the docs emphasize observability and revocation rather than runtime scope intersection.

**Bottom line**: observability and coarse-grained access (team/user level), not fine-grained per-scope authorization.

### LiteLLM Proxy

[LiteLLM offers a Tool Permission Guardrail](https://docs.litellm.ai/docs/proxy/guardrails/tool_permission) with regex-based allow/deny rules for tool names and [fine-grained MCP server and parameter access control](https://docs.litellm.ai/docs/mcp_control). It's a developer-friendly, self-hostable alternative to commercial gateways, with the advantage of being open-source and deployable on any infrastructure.

**Bottom line**: fine-grained rules, but requires manual regex configuration; less integrated than Kong's scope-based model.

### Market Gap

Most "AI gateways" (Cloudflare, Portkey, enterprise observability platforms) treat authorization as a secondary concern—they focus on cost, routing, and audit trails. Kong and LiteLLM are exceptions because they actually gate tool invocation. Even then, none of them implement the OWASP intersection principle out of the box; the burden is on the deployer to model "least privilege" correctly.

---

## 4. Enterprise Reference Material

### NIST AI Risk Management Framework (AI RMF)

[The NIST AI RMF Agentic Profile](https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/) extends NIST AI RMF 1.0 with agent-specific concepts. A critical addition is **runtime authorization**: the continuous decision at the moment of action about what an agent is allowed to do—controlling access to tools, credentials, APIs, data, and downstream systems.

[Runtime authorization is framed as one of the most practical ways to implement the framework's core principle](https://kontext.security/content/nist-ai-rmf-runtime-authorization): "AI risk must be governed, mapped, measured, and managed throughout the system lifecycle." For agents, that means not once per agent creation, but every time it makes a call.

NIST also emphasizes that agents should be treated as autonomous workloads with their own identity, permissions, and blast radius—not as transparent proxies for a human user. This has upstream consequences for how IAM systems are structured.

### Auth0 / Okta Guidance

[Okta announced Auth for GenAI as a platform feature in 2025](https://www.okta.com/newsroom/press-releases/auth0-platform-innovation/), recognizing that developers need native, built-in identity controls for agents. The framework includes:
- **Agent authentication**: agents must confirm user identity before acting.
- **[Fine-grained authorization for RAG](https://auth0.com/blog/securing-amazon-bedrock-agents-with-auth0-genai-guide/)**: agents retrieve only documents the user has access to, with policies that update in real time.
- **Identity-based API access**: agents call downstream APIs using the logged-in user's token, not static credentials, ensuring accountability.

The implication is that agent security is not separate from user identity—the agent inherits and enforces the user's scope.

### Microsoft and Google Cloud Guidance

[Microsoft recommends that each agent operate under a distinct agent identity](https://www.microsoft.com/en-us/security/blog/2026/07/16/least-privilege-for-ai-agents-identity-access-and-tool-binding/), with a named owner, explicit purpose, and task-based roles scoped to specific resources. All of this applies to both cloud and on-premises agents.

[Google Cloud goes further, introducing Agent Identity as a first-class principal type](https://cloud.google.com/blog/products/identity-security/introducing-agent-gateway-isv-ecosystem-for-security-and-governance/), distinct from human identities or service accounts. [Agent Gateway provides runtime identity and real-time, fine-grained authorization to agent and tool traffic](https://medium.com/google-cloud/securing-ai-agents-with-mcp-authorization-5cd8a552c45b), verifying every request based on user, agent, context, and policy rather than static credentials.

### The Consensus

Across NIST, Auth0/Okta, Microsoft, and Google, the consensus is:
1. Agents need their own identity (not just a user proxy).
2. Authorization must be **runtime**, not static.
3. The intersection principle applies: effective permission = min(user scope, agent scope, tool requirements).
4. Audit and traceability are non-negotiable.

---

## Implications for Deployment Topologies

### Local/Laptop MCP Client
On a single developer's machine running Claude Code + MCP servers, authorization is often implicit (you trust yourself). **But**: if the MCP server itself holds sensitive data or APIs, the server should validate that the client is you, not just any process. MCP auth at connection level is appropriate here.

### Browser-Based Agent
A browser agent talking to a shared MCP server or a cloud API must enforce per-request authorization. The browser client can do a pre-check (as MCPToolGuard's client-side guard does), but [that is observability, not enforcement](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/). **The real gate must be at the proxy or server**—MCP servers should validate JWTs and scopes; proxies should enforce intersection logic.

### Enterprise Backend Agent
Enterprise agents calling internal and external tools simultaneously must operate under their own agent identity, with scopes issued by the IdP (Auth0, Okta, Entra). The agent gateway (Kong, Portkey, or custom) enforces scope intersection at runtime. This is the model Microsoft and Google recommend.

### Managed/Hosted Agent (e.g., AWS Bedrock, OpenAI)
You delegate authorization to the cloud provider. [Auth0 integration with Bedrock](https://auth0.com/blog/securing-amazon-bedrock-agents-with-auth0-genai-guide/) shows how to thread the user's identity through the managed agent. The provider's control plane enforces scope intersection.

---

## Avenues for Deeper Research

1. **MCP Authorization Extension Proposal**: Is there a draft for standardized, scope-based tool filtering in MCP itself? Who is driving that conversation (Kong, Anthropic, OpenAI)?

2. **Runtime Authorization Performance**: How do Cloudflare Workers, Vercel Edge Functions, and traditional API gateways handle the latency of continuous scope checking? Any published benchmarks?

3. **Agent Identity Standards**: SPIFFE (used by Google Cloud), Entra Agent ID (Microsoft), and NIST profiles are emerging. Which will dominate enterprise? Any interop initiatives?

4. **Audit Trail Correlation**: All four layers (user → agent → gateway → tool) need a single trace ID. How are vendors handling this? Is there an open standard (OpenTelemetry, etc.)?

5. **Privilege Escalation via Tool Composition**: If Agent A can call Tool B, and Tool B can call Tool C, does the scope intersection hold transitively? This is understudied.

6. **Ephemeral vs. Long-Lived Agent Tokens**: OWASP recommends JIT (just-in-time) tokens for agents. Is there a pattern for this in production, or is it still mostly aspirational?
