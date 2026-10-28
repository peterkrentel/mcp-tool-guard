# Kubernetes-native agent guard — research-backed design note

## Status

Planning only. No code changes. This note records what the first version of MCPToolGuard (an MCP/JSON-RPC firewall for agents we create and issue JWTs to) taught us, what the wider field has published, and a proposed plan for a Kubernetes-native successor that guards agents we do not control. Nothing here is decided; it exists to be argued with.

Evidence labels used below: **V** = read on the source's own page; **S** = secondhand (search summary, vendor blog, press). Treat **S** items as leads to verify before relying on them. The research was a desk survey in late October 2026, not interviews or hands-on testing.

## 1. What MCPToolGuard taught us (its limits are the spec)

| Limit today | Consequence |
|---|---|
| Sees only MCP traffic | Agents that call APIs or run shell commands directly are invisible |
| Agents must be created by us and carry a JWT we issue | Cannot guard an agent someone else deployed |
| Every harness needs its own setup (`.mcp.json`, helper script) | Does not scale across Claude Code, Codex, Cursor, OpenCode, custom code |
| An agent that ignores the proxy is unguarded | Enforcement depends on cooperation |
| Identity tied to one global IdP setting (Auth0 or Entra) | Agent identity should come from the platform, humans from the IdP |
| Approvals and audit live on separate screens | Needs one queue that any enforcement point can feed |

## 2. Problem statement

AI agents increasingly run as ordinary workloads on Kubernetes, built on many harnesses and frameworks, often by teams that never registered them with any security tool. We want to identify those workloads from the cluster itself, force their outbound actions through a point we control, and decide each action on the fly: pre-approved by policy, held for a human, or blocked. Every decision leaves one correlated record. Success: an agent we did not configure runs in a cluster, attempts a destructive action, and is held for approval and traced end to end, with no change to the agent.

## 3. What the field has published

### Consensus recipe
Isolate the agent (gVisor, Kata, Firecracker), default-deny egress, keep credentials outside the sandbox and inject them at a proxy, log everything.
- Anthropic's deployment guide describes the proxy-outside-the-boundary credential pattern, and names Envoy `credential_injector`, mitmproxy, Squid and LiteLLM as ways to build it. **V** https://code.claude.com/docs/en/agent-sdk/secure-deployment
- NVIDIA OpenShell: sandbox with declarative policy, credential placeholders resolved only at approved endpoints, hot-reloadable network policy; policy changes that add risky access wait for human review. **V** https://github.com/NVIDIA/OpenShell
- Agent Substrate: Kubernetes CRDs, SPIFFE identity, default-deny network, an egress gateway that injects credentials, described as a replaceable policy point. No approval workflow or audit trail described. **V** https://github.com/agent-substrate/substrate
- Sandbox vendors (E2B, Daytona, Cloudflare Sandbox) inject secrets at the egress proxy. **V** https://e2b.dev/ , https://www.daytona.io/ , https://developers.cloudflare.com/sandbox/

### Acknowledged weaknesses
- Hostname-only filtering can be evaded (domain fronting); Claude Code's sandbox proxy does not inspect TLS by default. **V** (Anthropic guide above)
- OpenAI's Codex command proxy does not filter MCP or connector traffic, and its safety monitoring is asynchronous. **V** https://learn.chatgpt.com/docs/agent-approvals-security
- Approval fatigue: Anthropic reports users accept 93% of permission prompts, and its auto-approval classifier misses about 17% of real overeager actions. **V** https://www.anthropic.com/engineering/claude-code-auto-mode
- Monitoring that depends on model reasoning is reported to be weakening. **S** https://www.lesswrong.com/posts/E4Jpmo3igPnGnXtL4/an-overview-of-frontier-ai-company-monitoring-practices-in
- Strict per-call policy cuts attacks sharply (one paper: 39.9% to 1.0% attack success) but an independent reproduction found utility roughly halved. **S** https://arxiv.org/pdf/2504.11703 , https://arxiv.org/html/2606.26479v1

### Incident evidence
- Hugging Face, July 2026: two code-execution paths in dataset processing led to credential theft and lateral movement; detection came from anomaly detection over security telemetry, and recovery relied on a full action log analyzed with an open-weight model. **V** https://postmortem.io/incidents/huggingface--2026-07-16--security-incident-disclosure/ . Attribution of the attacking agent is reported inconsistently across sources; treat it as unsettled.
- Containment failures in public reports were misconfigured isolation, not exotic exploits. **S** (same LessWrong overview)

### Mechanics we can reuse
- **mitmproxy with human approval already exists in public:** `lima-mitm-proxy-sandbox` queues every request for an operator to allow or deny (one request, a host, or a path prefix), and states that domain fronting is not prevented. **V** https://github.com/OAuthBringer/lima-mitm-proxy-sandbox . A practitioner write-up forces agents through mitmproxy with placeholder keys swapped for real ones and a per-run token. **V** https://simedw.com/2026/06/05/proxy-agents/ . Reported pain: clients hanging on proxy preflight or upstream drops, QUIC/HTTP3 needing UDP blocked to force fallback, pinned clients failing.
- **Envoy's external authorization is built for fast decisions:** default 200 ms timeout, fails closed on error; it is not designed for minute-long human holds. **V** https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_authz/v3/ext_authz.proto . Our inference: hold requests in our own guard, with the proxy asking it for allow, hold or deny.
- **Injection and its bypasses:** mutating webhooks add sidecars only at pod creation; running pods stay unguarded until recreated; failing closed can block pod creation when the webhook is down. **V** https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/ , https://istio.io/latest/docs/setup/additional-setup/sidecar-injection/
- **NetworkPolicy does nothing without a CNI that enforces it.** **V** https://kubernetes.io/docs/concepts/services-networking/network-policies/
- **CA trust in pods:** trust-manager publishes a bundle but does not modify pods; injecting it needs a webhook or policy engine; per-runtime variables differ (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, Java truststores). **S** https://kaidalov.com/posts/2025/10/kubernetes-trust-manager/ , https://kubernetes.recipes/recipes/security/custom-ca-kubernetes/
- Tetragon (eBPF) can block in the kernel; Falco detects and alerts. **V** https://tetragon.io/docs/overview/ , https://github.com/falcosecurity/falco

### Who handles agents the operator does not control
- Detection only: CrowdStrike (endpoint discovery of shadow AI and agents), Sysdig (detects new AI coding agents via eBPF), ARMO (workload discovery by GPU requests and MCP fingerprints). **S** vendor pages
- Microsoft (October 2026, announced): discovery of agent types on employee machines, Entra Agent ID extended to unknown agents, risk scoring with tiered responses up to holding actions for approval. Third-party and pre-existing agents are noted as not retroactively covered. **S** https://siliconangle.com/2026/10/19/microsoft-targets-the-agentic-insider-with-new-controls-for-rogue-ai-agents/
- Kubernetes-native projects assume declared agents: Substrate, agent-sandbox (**V** https://github.com/kubernetes-sigs/agent-sandbox), kagent (**V** https://github.com/kagent-dev/kagent), Red Hat's Rossoctl (opt-in registration, **V** https://developers.redhat.com/articles/2026/10/06/rossoctl-for-agent-discoverability-security-and-observability-on-kubernetes).
- Human approval in the path appears in Preloop, Solo.io (**S**) and Codex; most gateways and sandboxes do not describe it.

### Standards pressure
- MCP specification: token passthrough is forbidden, scope minimization with logging of elevation events by correlation id, egress proxies against SSRF. **V** https://modelcontextprotocol.io/specification/draft/basic/security_best_practices
- Open gaps named by standards bodies: agent identity, delegation, per-action logging (NIST NCCoE concept paper, **S**). EU AI Act Article 12 (event logs) and Article 14 (human override). **S**
- OpenTelemetry GenAI tool-call span conventions are still in development; any trace schema we pick may change. **S** https://github.com/open-telemetry/semantic-conventions/blob/v1.41.0/docs/gen-ai/gen-ai-spans.md

## 4. Where the open space may be (hypothesis, not a finding)

1. Enforcement, not only detection, for agents nobody declared, on Kubernetes.
2. Per-call human approval in the enforcement path, independent of harness.
3. One correlated record from the agent's request to the decision to the result, bound to a human and a task.
4. A generic way to judge what an encrypted API call does without hand-written rules per API.

Caveats: funded vendors (Microsoft, CrowdStrike, Solo.io, others) are moving toward this space, our search was a desk survey with limited primary sources, and "not found" does not mean "does not exist".

## 5. Proposed architecture

Reuse what exists; build the decision and approval layer.

1. **Identify:** declared (label, namespace, service account) plus observed (workloads that call known LLM endpoints or emit MCP-shaped traffic). Start in observe-only mode and report.
2. **Intercept:** a custom resource (for example an agent-guard policy) reconciled by a controller; a mutating admission webhook injects the proxy configuration and CA trust at pod creation; a validating webhook rejects opt-outs; NetworkPolicy (with an enforcing CNI) makes the proxy the only way out. Because injection only covers new pods, add a periodic check for pods that predate the webhook.
3. **Understand:** mitmproxy (or a comparable TLS-terminating proxy) for allowlisted hosts only, so method and path are visible; host-level control elsewhere.
4. **Decide:** the proxy asks MCPToolGuard's decision service for allow, hold or deny. The existing policy engine, approval queue and three-layer audit carry over. Hold requests live in the guard, not in the proxy.
5. **Attribute:** each action carries a task id and the human or agent identity it acts for, in the same trace format the guard already emits.

## 6. The four tracks and what each one measures

| Track | Question | Measure (first version) |
|---|---|---|
| Recognition | Can we tell an agent from an ordinary service by observation? | Precision and recall on labeled pods across several harnesses (for example Claude Code, Codex, a small framework script) |
| Meaning | Can generic rules flag destructive calls across APIs without per-API parsers? | Catch rate and false-block rate on a labeled set of calls, plus public MCP attack suites (MCPSecBench, MCPTox, AgentDefense-Bench) |
| Approvals | Can tiering and context reduce rubber-stamping? | Share of calls held vs. share a human actually needed to see, from replayed action logs |
| Attribution | Does every action trace to a human and a task? | Fraction of actions in a run with a complete chain |

## 7. Test bench

A small scored test bench (not an agent harness) built first, so each track has a number from the start: a handful of labeled cases per track, replayable, with results written to a file each run. It also gives us the "caught X of Y" statements a write-up needs.

## 8. Build order

1. **Thin end-to-end slice** in a kind cluster: label-based identification, a mitmproxy exit, the guard deciding allow, hold or deny, one trace. Plus the test bench skeleton.
2. **Recognition** in observe-only mode.
3. **Meaning** against the labeled set and public suites.
4. **Approvals and attribution.**
After step 1 the middle tracks are independent and can run in parallel.

## 9. Risks and open questions

- **Credential-path security:** a leaked CA key lets an attacker impersonate sites to every agent. Needs a protected key and a narrow blast radius before anything beyond a lab.
- **TLS interception limits:** pinned clients, QUIC, clients that hang on proxy preflight, non-HTTP protocols; default-deny egress remains necessary.
- **Webhook availability:** failure policy trades unguarded pods against blocked pod creation.
- **Utility cost:** strict policy can reduce task completion.
- **Standards churn:** OpenTelemetry tool-call spans are not stable.
- **Competition:** the space is crowded and moving; value may lie in the research results and the approval and attribution layer rather than the plumbing.
- **Unverified:** most vendor claims here are secondhand; primary documentation for Okta, Entra, Solo.io, CrowdStrike, Sysdig and Cisco was not read.

## 10. Out of scope for this note

Replacing the existing MCP guard, a commercial go-to-market plan, a custom hypervisor, and treating TLS inspection as the answer to every problem.
