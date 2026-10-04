# Alexa+ track technical path: MCP / Agent Skills / simulated experience (KEY=mcp, PREFIX=MCP)

Researched 2026-10-03 (Asia/Kolkata). All `retrieved_at` = 2026-10-03. Page dates are taken from the pages themselves ("undated" if none).

**Retrieval note.** The shared Firecrawl account was rate-limited (HTTP 429) for most of the session. Pages were fetched with the Firecrawl CLI when a slot was free. Otherwise I used WebFetch (last resort) or the npm/PyPI registry CLIs. WebFetch output is a model summary that includes short quotes, so I treat its exact wording as **medium confidence** unless a Firecrawl copy confirms it. Every source below lists its method and saved file.

---

## TL;DR: what matters for the plan

1. **The MCP spec has moved on.** As of 2026-10-03 the **current** MCP protocol version is **2026-07-28**, not 2025-11-25 ([versioning page](https://modelcontextprotocol.io/specification/versioning); the 2025-11-25 changelog banner says "You are viewing an older version"). 2026-07-28 breaks compatibility: it is stateless, drops the `initialize` handshake and `Mcp-Session-Id`, removes the GET/SSE resumability, replaces server-initiated elicitation with Multi Round-Trip Requests, and moves tasks into an extension. The hackathon rules ask for "2025-11-25 (or a later version, once confirmed)", and Amazon's own Alexa+ MCP Toolkit docs say "Alexa+ for Builders supports the 2025-11-25 version". **Recommendation (inference):** target **2025-11-25 Streamable HTTP** as the primary contract. You can also serve 2026-07-28 for free, because the v2 SDKs are dual-era. Show `MCP-Protocol-Version: 2025-11-25` explicitly in the demo.
2. **Gating is confirmed by Amazon's own docs.** "At this time, Category SDK and MCP Toolkit are available to select partners only" ([Alexa+ docs home](https://developer.amazon.com/docs/alexaplus/add-ons/home.html), last updated Jul 10 2026). The MCP Toolkit is also "available in the United States". Entrants cannot deploy to real Alexa+ (`alexa-ai deploy` is part of the gated CLI), so the valid paths are a self-hosted MCP server, an Agent Skill, or a simulated Alexa+ experience.
3. **Amazon's public docs describe how the real Alexa+ MCP client behaves, so a simulator can be faithful.** The docs show:
   - Alexa+ acts as the MCP client over Streamable HTTP.
   - The tool result format is `structuredContent` + `content` + `_meta.ui.resourceUri` (MCP Apps).
   - There are display modes (inline / fullscreen / hydrated / voice-only) and native components (List, Carousel, Card, Map).
   - Elicitation is supported, and the session is derived from conversation history.

   Mirroring these lets an entrant build a credible simulated Alexa+ host without claiming a live integration.
4. **MCP Apps is the official UI layer and Alexa+ supports it.** The toolkit overview says "Alexa+ also supports the MCP Apps extension", including a webview for rich visuals. MCP Apps (spec 2026-01-26, Stable; `@modelcontextprotocol/ext-apps` 2.0.3) also renders in Claude, ChatGPT, VS Code Copilot, M365 Copilot, Goose, Postman and MCPJam. The rules list MCP Apps as a "Creative" signal.
5. **A plain MCP wrapper is commodity.** ChatGPT (Apps SDK on MCP), the Gemini Interactions API (remote MCP, Streamable HTTP only), the OpenAI Agents API, Claude, VS Code and others all consume MCP. The rules explicitly call a "basic MCP wrapper around an existing API" **Obvious**. Differentiation has to come from orchestration, cross-session state, MCP Apps UI, purchasing/confirmation flows, and Agent Skills.

---

## 1. Hackathon Alexa+ requirements (official saved pages)

- Rules: "A working Agent Skill or a self-hosted MCP server, implementing MCP spec version 2025-11-25 (or a later version, once confirmed) over Streamable HTTP. Alternatively, entrants may submit a simulated Alexa+ experience…" The simulated path is "exempt from the runtime-technology-hook requirement"; the "repository must still include the simulation's source code, and the demo video must clearly show the simulated experience." — [rules](https://amazonappdev2026.devpost.com/rules) (`.firecrawl/amazonappdev2026.devpost.com-rules.md` L343). A second rules line (L298) phrases it as "minimum acceptable version is 2025-11-25". **High confidence.**
- Creativity guidance: "Obvious: single-turn Q&A bot, basic MCP wrapper around an existing API. Creative: agentic workflow that orchestrates across services autonomously, context-aware add-on that maintains state across sessions, purchasing capabilities, media support (cards, carousels, etc), MCP Apps, Agent Skills." — rules L443. **High.**
- FAQ: gated tools (Category SDK, MCP Toolkit, CLI, Web Simulator) "are in preview and available to select partners only - there is currently no way for hackathon participants to apply for or gain access… build a self-hosted MCP server (or Agent Skill)… and demo it via your own web-based simulator or front end." — [FAQ](https://amazonappdev2026.devpost.com/details/faqs) (`.firecrawl/amazonappdev2026.devpost.com-details-faqs.md` L204-206). **High.**
- FAQ: "A locally runnable public repo plus your demo video is enough… hosting isn't required." (L275). **High.**
- Resources page: "Build a working MCP… on the open standards for Agent Skills and Streamable HTTP transports. You can simulate an Alexa+ experience using your preferred agentic tools via a web app." It links "Build with Agent Skills" → `apps.extensions.modelcontextprotocol.io/api/#build-with-agent-skills` (the MCP Apps skills) and the 2025-11-25 Streamable HTTP section (`.firecrawl/technical-resources.md` L262-268). **High.** The "Agent Skill" link points at the MCP Apps scaffolding skills, which hints at what organisers mean by "Agent Skill". This is an inference.

## 2. What Amazon's (gated) Alexa+ MCP Toolkit docs reveal (publicly readable docs)

| Fact | Source / date | Confidence |
|---|---|---|
| "**Important:** At this time, Category SDK and MCP Toolkit are available to select partners only." Category SDK covers restaurant reservations, food ordering, ride booking, home services, local booking and ticketing. MCP Toolkit is for services outside those categories. | [Alexa+ Developer Docs Home](https://developer.amazon.com/docs/alexaplus/add-ons/home.html), last updated Jul 10, 2026 (Firecrawl) | High |
| "The MCP Toolkit is available in the United States." "Alexa+ acts as the MCP client. You return standard MCP responses, and Alexa+ handles natural language understanding, response generation, and user interface (UI) rendering." "Alexa+ for Builders supports the 2025-11-25 version of the MCP specification." | [MCP Toolkit Overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html), last updated Aug 03, 2026 (Firecrawl) | High |
| "Alexa+ also supports the MCP Apps extension… You can onboard your existing MCP Apps and use a webview provided by Alexa+ to deliver rich visuals." The MCP server exposes "tools, resources, and prompts over streamable HTTP". Deployment uses "the add-on Agent Skill (agentic onboarding experience) or directly with the Alexa AI CLI" and `alexa-ai deploy`. | same | High |
| Lifecycle: Alexa+ "registers all the tools and resources" at deploy. The sample `initialize` uses `"protocolVersion": "2025-03-26"`, `clientInfo` "Alexa+ MCP Client", and capability `roots.listChanged`. The tool result sample has `structuredContent`, `content` (serialized JSON text), and `_meta.ui.resourceUri: "ui://hotel-search"` with `invoking`/`invoked` strings. "the session is based on the customer's previous conversations with Alexa+ rather than an explicit identifier". Elicitation: Alexa+ first gathers context and then "uses the existing elicitation framework through the MCP protocol". With no `resourceUri`, Alexa+ "uses the data-only flow". | [Client and App Lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html), last updated Jul 10, 2026 (Firecrawl) | High (verbatim); contradiction noted below |
| Display modes: Inline (default), Fullscreen, Hydrated ("Alexa renders that data through its native interface" when there is no UI payload), and Voice-only on screenless devices. Unsupported modes fall back to text. | [Display Modes](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-display-modes.html), Jul 21, 2026 (WebFetch) | Medium |
| Components: List, Carousel, Card ("A single entity presented with an image and optional action buttons"), Map. Patterns: confirmations, email confirmations, Alexa notifications, follow-up questions. There is an "Alexa+ checkout page" caption and "When your add-on completes a transaction, such as a booking, send a confirmation email." | [Components and Patterns](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-components-and-patterns.html), Aug 03, 2026 (WebFetch) | Medium |
| Surfaces: voice-only Echo, Echo Show, Alexa app, alexa.com, Fire TV. "MCP responses may include a visual and/or a spoken reply." Developers do not script Alexa's speech. | [Design guide](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-design-guide.html), Jul 21, 2026 (WebFetch) | Medium |
| Testing: standard MCP Inspector (`tools/list`), a local inspector readiness report, a Web Simulator with simulated device screens, and routing to a physical device. "You must deploy your add-on before you can test it." | [Test MCP add-ons](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-test-add-ons.html), Jul 10, 2026 (WebFetch) | Medium |
| Supported Capabilities page lists only Authentication ("OAuth 2.1", service- and user-level) and Account Linking. | [Supported capabilities](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-supported-capabilities.html), Jul 10, 2026 (WebFetch) | Medium |

**Implication (inference):** the Amazon docs give enough detail to build a credible "Alexa+-style host simulator":
- an MCP client that connects over Streamable HTTP;
- a voice/text front end;
- rendering of `structuredContent` as Card/List/Carousel ("hydrated");
- rendering of `ui://` resources in a sandboxed iframe ("inline/fullscreen");
- a voice-only mode;
- elicitation prompts;
- transaction confirmations.

The demo must label this clearly as a **simulation**.

## 3. MCP spec versions: 2025-11-25 vs current 2026-07-28 (decision-critical)

- **Current version:** "The **current** protocol version is **2026-07-28**." Revisions are marked Draft / Current / Final. "Clients and servers **MAY** support multiple protocol versions simultaneously." — [versioning](https://modelcontextprotocol.io/specification/versioning) (WebFetch, undated). The 2025-11-25 changelog page shows the banner "You are viewing an older version (2025-11-25)… View the latest version (2026-07-28)" (Firecrawl). **High.**
- **2026-07-28 major changes** ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), Firecrawl):
  - "Remove protocol-level sessions and the `Mcp-Session-Id` header" (SEP-2567).
  - "Make MCP stateless: remove the `initialize`/`notifications/initialized` handshake". Version and capabilities now travel in `_meta`.
  - `server/discover` is now a mandatory RPC.
  - The GET endpoint is replaced by `subscriptions/listen`.
  - `ping` and `logging/setLevel` are removed.
  - Tasks move into the `io.modelcontextprotocol/tasks` extension.
  - The MRTR `input_required` pattern replaces server-initiated `elicitation/create` and `sampling/createMessage`.
  - A `resultType` field is required on results.
  - SSE resumability (`Last-Event-ID`) is removed.
  - Minor: `Mcp-Method`/`Mcp-Name` headers are required; `ttlMs`/`cacheScope` are added on list results; OpenTelemetry `traceparent` is propagated in `_meta`.
  - Deprecated: Roots, Sampling, Logging, HTTP+SSE transport, and Dynamic Client Registration (in favour of Client ID Metadata Documents). **High.**
- **Interop:** 2025-11-25 and earlier are "Legacy" (handshake-based) and 2026-07-28 is "Modern". A "Dual-era" server "MAY serve both eras concurrently on the same endpoint". The compatibility matrix says Legacy client → Modern-only server "Fails", and Legacy client → Dual-era server "Works". — [2026-07-28 versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) (Firecrawl). **High.**
- **2025-11-25 key changes** ([changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog), Firecrawl):
  - OIDC discovery and icons for tools/resources/prompts.
  - Incremental scope consent via `WWW-Authenticate`.
  - Tool-name guidance.
  - Titled, untitled and multi-select enums in elicitation.
  - **URL-mode elicitation**.
  - Tool calling inside sampling.
  - OAuth Client ID Metadata Documents.
  - **experimental tasks**.
  - 403 for invalid Origin.
  - Input validation errors returned as tool execution errors.
  - SSE polling and resumption via GET.
  - JSON Schema 2020-12 as the default dialect.

  **High.**
- **Implication (inference):** a "2026-07-28-only" server would *fail* against a 2025-11-25 client, and per the docs that includes Alexa+ for Builders. Target 2025-11-25, ideally dual-era. Do not build only to 2026-07-28 semantics.

## 4. Streamable HTTP requirements, 2025-11-25 (decision-critical checklist)

Source: [2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) (`.firecrawl/technical-mcp-transports.md`, pre-saved Firecrawl copy). **High.**
- "The server **MUST** provide a single HTTP endpoint path… that supports both POST and GET methods" (e.g. `https://example.com/mcp`).
- Security: "Servers **MUST** validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks". If the Origin is invalid, return 403. When running locally, servers SHOULD bind to 127.0.0.1 rather than 0.0.0.0, and SHOULD authenticate all connections.
- Every client message is a new POST. `Accept` must list `application/json` and `text/event-stream`. Notifications and responses get **202 Accepted** with no body.
- Sessions: the server MAY assign `MCP-Session-Id` at initialization. The ID should be visible ASCII and cryptographically secure. Clients MUST echo it. A request without a session ID may get 400; a terminated session returns 404. Clients may send DELETE to end a session.
- "the client **MUST** include the `MCP-Protocol-Version: <protocol-version>` HTTP header on all subsequent requests". If the header is missing, the server SHOULD assume `2025-03-26`. An unsupported version gets 400.
- Resumability (optional): SSE event IDs plus `Last-Event-ID`; "Resumption is always via HTTP GET with `Last-Event-ID`."
- Backwards compatibility with HTTP+SSE (2024-11-05) is optional.
- 2026-07-28 keeps the single endpoint (POST only) and the same Origin/403/localhost rules ([2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), Firecrawl).

## 5. Authorization (2025-11-25)

Source: [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) (WebFetch; raw spec text was returned). **High.**
- "Authorization is **OPTIONAL** for MCP implementations." HTTP transports SHOULD conform; stdio SHOULD NOT and should use the environment instead.
- A protected MCP server is an OAuth 2.1 resource server. It "**MUST** implement OAuth 2.0 Protected Resource Metadata (RFC9728)", advertised through the `WWW-Authenticate` `resource_metadata` header on 401 or through `/.well-known/oauth-protected-resource`.
- Clients MUST use RFC 8707 `resource`, MUST use PKCE S256, and MUST refuse to proceed if `code_challenge_methods_supported` is absent.
- Client registration priority: pre-registration, then Client ID Metadata Documents, then DCR (MAY; backwards compatibility).
- Servers MUST validate the token audience. "MCP servers **MUST NOT** accept or transit any other tokens" and "**MUST NOT** pass through the token it received from the MCP client."
- 401 for an invalid token; 403 with `insufficient_scope` for step-up.
- Implication (inference): for a hackathon demo, run without auth on localhost, or use a simple bearer or OAuth provider (AgentCore docs show CUSTOM_JWT/Cognito/Auth0). Alexa+ itself uses OAuth 2.1 and Account Linking (gated).

## 6. Tools, structured output, annotations, elicitation, tasks (2025-11-25)

- Tool fields: `name`, `title`, `description`, `icons`, `inputSchema` (MUST be a valid JSON Schema object; 2020-12 default), optional `outputSchema`, `annotations`, and `execution.taskSupport` ("forbidden" by default, or "optional"/"required"). — [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) (WebFetch raw). **High.**
- Structured output: "a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block". If `outputSchema` is set, "Servers **MUST** provide structured results that conform to this schema". Input validation errors are returned as `isError: true` tool results so models can self-correct. **High.**
- Human in the loop: "there **SHOULD** always be a human in the loop with the ability to deny tool invocations". Servers MUST validate inputs, enforce access control, rate-limit, and sanitize outputs. **High.**
- `ToolAnnotations` (schema): `title`, `readOnlyHint` (default false), `destructiveHint` (default true; meaningful only if not read-only), `idempotentHint` (default false), `openWorldHint` (default true). "all properties in ToolAnnotations are **hints**… Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers." — [schema](https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations) (Firecrawl). **High.**
- Elicitation: form mode (flat primitives and enums) and URL mode (new in 2025-11-25). "Servers **MUST NOT** use form mode elicitation to request sensitive information such as passwords, API keys, access tokens, or payment credentials". Responses are accept / decline / cancel. Elicitation state "MUST NOT be associated with session IDs alone". — [elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation) (WebFetch raw). **High.** In 2025-11-25 elicitation is a server→client request, so the server needs a streaming/stateful transport. AgentCore says to use stateful mode (`stateless_http=False`) "For MCP servers that require multi-turn interactions (elicitation)" (`.firecrawl/technical-agentcore-mcp.md` L1830).
- Tasks: "experimental support for tasks… polling and deferred result retrieval" in 2025-11-25. In 2026-07-28 they moved to an official extension with a redesigned API. **High.** Implication: avoid building core features on tasks.

## 7. MCP Apps extension

- What it is: "MCP Apps let servers return interactive HTML interfaces (data visualizations, forms, dashboards) that render directly in the chat." A tool's `_meta.ui.resourceUri` points to a `ui://` resource. The host fetches the HTML and renders it in a sandboxed iframe. `_meta.ui.csp` and `_meta.ui.permissions` (mic, camera) are optional. The app talks to the host over JSON-RPC via `postMessage` (`ui/initialize`, can request `tools/call`). — [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview) (WebFetch, undated). **High** (consistent with Firecrawl API page).
- Status and packages: the spec version **2026-01-26 is "Stable"** (a draft is in development). Install with `npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/client@^2.0.0 …`, plus server, node and express `^2.0.0` for servers. Requires Node 20+. Subpackages: `ext-apps`, `ext-apps/react`, `ext-apps/app-bridge`, `ext-apps/server`. "The wire protocol is unchanged between `ext-apps` 1.x and 2.x". — [MCP Apps API docs](https://apps.extensions.modelcontextprotocol.io/api/) (Firecrawl). npm: `@modelcontextprotocol/ext-apps` latest 2.0.3 (2026-09-25); 2.0.0 published 2026-09-08; 1.0.0 published 2026-01-26. **High.**
- "Build with Agent Skills": the repo ships four Agent Skills: `create-mcp-app`, `migrate-oai-app`, `add-app-to-server`, `convert-web-app`. Install in Claude Code with `/plugin marketplace add modelcontextprotocol/ext-apps`; any agent supporting agentskills.io can use them. — same page. **High.**
- Hosts: Claude, Claude Desktop, VS Code GitHub Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam, Archestra.AI (overview). The API page badges add ChatGPT, Alpic and the mcp-use inspector. Alexa+ supports it per Amazon's toolkit overview. ChatGPT: "ChatGPT implements the open MCP Apps standard for UI returned by an MCP server" ([OpenAI docs](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt/), WebFetch). **High/Medium.**
- A reference host exists: `examples/basic-host` in the ext-apps repo (`npm start` → localhost:8080). It is useful as the base of a self-built Alexa+ simulator (inference).

## 8. Agent Skills open standard

- Format: a directory with a required `SKILL.md` (YAML frontmatter + Markdown) and optional `scripts/`, `references/`, `assets/`.
  - Frontmatter `name` is required: ≤64 chars, lowercase/digits/hyphens, and must match the directory.
  - `description` is required: ≤1024 chars, saying what the skill does and when to use it.
  - Optional fields: `license`, `compatibility` (≤500), `metadata`, `allowed-tools` (experimental).

  — [agentskills.io/specification](https://agentskills.io/specification) (WebFetch raw, undated). **High.**
- Runtime loading ("progressive disclosure"):
  - Metadata (~100 tokens) is loaded at startup for all skills.
  - The full `SKILL.md` body (<5000 tokens recommended) is loaded when the skill is activated.
  - Resources are loaded only when required.
  - Validate with `skills-ref validate ./my-skill`.

  **High.**
- Implication (inference): an Agent Skill has no runtime unless a host agent loads it, for example Claude Code, any agentskills.io-compatible agent, or your own agent harness. To satisfy the "imported and actually called… loaded agent/flow/MCP config" rule, the repo should include a runnable agent that loads the skill. A skill that orchestrates an MCP server is stronger than a skill alone. Amazon itself uses an "add-on Agent Skill (agentic onboarding experience)" for Alexa+ deployment.

## 9. Official SDKs and testing tools (decision-critical)

- **TypeScript v2**: split packages `@modelcontextprotocol/server`, `client`, `core`, plus adapters `node`, `express`, `hono`, `fastify`. Latest server/client is **2.3.0** (2026-10-02); 2.0.0 was published 2026-07-27. README: "**v2 is the stable release line**, implementing the 2026-07-28 MCP spec." A `server-legacy` package keeps the old SSE transport and `mcpAuthRouter`. — npm registry plus [npm README](https://www.npmjs.com/package/@modelcontextprotocol/server) and [GitHub releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) (Firecrawl; v2.2.0 released 28 Sep 2026). **High.**
- TS v2 legacy support: the serving guide says the handler serves "2025-era clients statelessly from the same factory by default", with a `legacy` option. Use `localhostHostValidation()` / `localhostOriginValidation()` from `@modelcontextprotocol/node` for DNS-rebinding protection. "authInfo is pass-through: the handler never reads it from headers and never verifies a token." — [TS v2 HTTP serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/http) (WebFetch summary only). **Medium.**
- **TypeScript v1** `@modelcontextprotocol/sdk` is still maintained: **1.32.0** published 2026-10-02 (npm). Its README advertises Streamable HTTP ("recommended") and stdio. The exact `LATEST_PROTOCOL_VERSION` of 1.32.0 was not verified. **Medium.**
- **Python**: PyPI `mcp` latest **2.3.0**; the 1.x line ends at 1.30.0. v2 "implements the 2026-07-28 revision, and it serves both revisions at once". "FastMCP is now MCPServer". "the same streamable_http_app()… answers a 2025-era client's initialize and a 2026-era client's requests with nothing to configure." — [py.sdk what's new](https://py.sdk.modelcontextprotocol.io/whats-new/) (WebFetch summary) plus [python-sdk README](https://github.com/modelcontextprotocol/python-sdk) (Firecrawl: `from mcp.server import MCPServer`; `mcp run server.py --transport streamable-http`). **High** for versions; **Medium** for the dual-era quote.
- **Gotcha:** AWS AgentCore's MCP guide still uses the v1 API (`FastMCP(host="0.0.0.0", stateless_http=True)`, `mcp.run(transport="streamable-http")`, served at `0.0.0.0:8000/mcp`). With `mcp` 2.x the class has been renamed. Either pin `mcp<2` when following AgentCore samples or port to `MCPServer` (`.firecrawl/technical-agentcore-mcp.md` L1826-1883). Whether a `FastMCP` alias survives in v2 is not verified. **Medium.**
- **MCP Inspector**: `@modelcontextprotocol/inspector` latest **2.9.0** (2026-09-30). It ships web, CLI and TUI modes (`npx @modelcontextprotocol/inspector [--cli|--tui]`) and stores secrets in the OS keychain. The AgentCore guide shows Inspector connecting with transport "Streamable HTTP" to `http://localhost:8000/mcp`. Amazon's Alexa+ test docs tell partners to "Use the standard MCP Inspector to verify tool schemas". **High.**

## 10. Hosting on AWS (AWS Builder mini-challenge overlap)

- AgentCore Runtime "expects MCP server containers to be available at the path `0.0.0.0:8000/mcp`". It "supports both stateless and stateful streamable-HTTP MCP servers". Stateless is recommended, and the platform adds `Mcp-Session-Id`. Use stateful mode for elicitation, sampling and progress. — [Deploy MCP servers in AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html) (pre-saved Firecrawl, undated). **High** (capability).
- Strands Agents can act as an MCP client over stdio, Streamable HTTP ("including servers behind OAuth or AWS IAM authentication") or legacy SSE, and supports elicitation callbacks. — [Strands MCP tools](https://strandsagents.com/docs/user-guide/sdk/tools/mcp-tools/) (pre-saved). **High** (capability). Strands is therefore a ready "agentic tool" for the simulated Alexa+ host.

## 11. Alexa+ native consumer capabilities, availability and pricing

- Features ([Top features](https://www.aboutamazon.com/news/devices/new-alexa-top-features), published Feb 26 2025, **updated Jul 24 2026**, read from the pre-saved search body):
  - free-form conversation;
  - memory of personal facts and document uploads;
  - calendar and email management;
  - grocery ordering, deal monitoring and purchase;
  - OpenTable, Grubhub/Uber Eats, Uber, Ticketmaster, Thumbtack, Vagaro;
  - **Routines created by voice**, including monthly, annual, weather-based and per-family-member routines with voice recognition;
  - Ring camera event summaries on Echo Show;
  - targeted announcements and Visual-ID reminders;
  - AI podcasts and images, Suno songs;
  - Kids+ guardrails ("no voice purchasing").

  This is vendor marketing: it describes the offering, not measured effectiveness.
- Architecture: "experts—groups of systems, capabilities, APIs, and instructions"; LLMs on Amazon Bedrock; agentic web navigation, for example Thumbtack. — [Introducing Alexa+](https://www.aboutamazon.com/news/devices/new-alexa-generative-artificial-intelligence), updated Jul 21 2026. That updated page no longer contains a developer-SDK section. Neither "Alexa AI Action SDK" nor "Multi-Agent SDK" appears in the saved body.
- Pricing (US): "$19.99 per month, but all Amazon Prime members get it for free". It is available to everyone in the US; the update note says it "became free for Prime members in February 2026". — Introducing Alexa+ (pre-saved) and the [US availability article](https://www.aboutamazon.com/news/devices/alexa-plus-available-free-prime-members-us), updated 09/01/26 (WebFetch).
- International: Early Access in the UK, Brazil, Mexico, Italy, Spain, Germany, Austria, France, Australia and India. India rollout began Sep 16 2026: free during Early Access, then free for Prime or INR 2,000/month. Canada is GA at CAD 27.99. — [International launch](https://www.aboutamazon.com/news/devices/alexa-plus-international-launch), updated Sep 16 2026 (pre-saved).
- Channels: Echo devices, Fire TV, the Alexa app, alexa.com and the Amazon Music app.

## 12. Rival hosts: MCP is commodity

- **ChatGPT**: the Apps SDK is "an open standard built on the Model Context Protocol" ([OpenAI, Oct 6 2025](https://openai.com/index/introducing-apps-in-chatgpt/)). App submissions opened Dec 17 2025, with "MCP connectivity details" in submissions ([OpenAI](https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/)). Developer mode with full MCP including write actions is rolling out in beta to Business, Enterprise and Edu ([Help Center](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt), "Updated: last month"). ChatGPT implements MCP Apps (developers.openai.com). The OpenAI **Agents API** (Sep 10 2026) takes `"type": "mcp"` tools with an HTTP transport. **High.**
- **Gemini**: "Interactions API supports connecting to remote MCP servers"; "Remote MCP only works with Streamable HTTP servers. SSE… not supported." — [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling#mcp), last updated 2026-09-23 (Firecrawl search scrape). **High.**
- Claude, VS Code Copilot, M365 Copilot, Goose and Postman render MCP Apps (MCP Apps overview).
- Implication: an MCP server alone is not novel. Value comes from domain logic, multi-service orchestration, state, UI and safety.

## 13. Observability and safety for MCP servers

- **OpenTelemetry**: the GenAI semantic conventions moved to `open-telemetry/semantic-conventions-genai` ([opentelemetry.io notice](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/)). The MCP conventions are **Status: Development**. Span name `{mcp.method.name} {target}`. Attributes include `mcp.method.name`, `mcp.session.id`, `mcp.protocol.version`, `mcp.resource.uri`, `gen_ai.tool.name`, `gen_ai.operation.name` (`execute_tool`) and `jsonrpc.request.id`. Trace context is propagated through `params._meta` (`traceparent`, `tracestate`, `baggage`). — [semconv-genai mcp.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md) (Firecrawl). **High.** MCP 2026-07-28 also documents `_meta` trace-context propagation (SEP-414) and recommends OpenTelemetry instead of the deprecated Logging feature.
- **AgentCore Observability**: CloudWatch-powered dashboards for session count, latency, duration, token usage and error rates. "AgentCore emits telemetry data in standardized OpenTelemetry (OTEL)-compatible format". There are built-in metrics for agents, gateway and memory, and you can instrument your own code. — [docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html) (WebFetch raw, undated). **High** (capability).
- Safety requirements to show in a demo:
  - Origin validation and localhost binding (transport);
  - no token passthrough and audience validation (auth);
  - URL-mode elicitation for credentials and payments, never form mode;
  - a human-in-the-loop confirmation for destructive or purchasing tools (`destructiveHint`);
  - input validation errors returned as `isError`.

## 14. What an entrant must NOT claim (simulated path)

Inference from the gating facts above:
- Do not claim the add-on is live on Alexa+, Echo or alexa.com, was certified, was deployed via `alexa-ai deploy`, or was tested in Amazon's Web Simulator. Those tools are partner-only.
- Do not use Amazon or Alexa branding to make a simulator look like the real product. Label it, for example, "Alexa+-style simulated host built on public MCP docs".
- Do not imply account linking, Amazon payments or checkout work through Amazon. Model them as simulated flows, for example URL-mode elicitation to a mock checkout.
- You may state accurately: "MCP server implementing spec 2025-11-25 over Streamable HTTP, compatible in principle with the Alexa+ MCP Toolkit contract documented at developer.amazon.com (2025-11-25, MCP Apps)", with a test transcript from MCP Inspector.

---

## Gaps / unverified / contradictions

1. **Contradiction in Amazon docs:** the Toolkit overview says Alexa+ for Builders supports **2025-11-25**, but the client-lifecycle sample `initialize` sends `"protocolVersion": "2025-03-26"` (both Firecrawl-verified). The real client's negotiated version is unknown. Servers should accept 2025-03-26, 2025-06-18 and 2025-11-25; SDKs normally do this.
2. **Rule ambiguity:** "2025-11-25 (or a later version, once confirmed)". 2026-07-28 is now current, but I found no organiser statement confirming it as acceptable. Ask on the Devpost forum or office hours. Until then, treat 2025-11-25 as the safe target.
3. TS SDK v2 dual-era behaviour (`legacy` option, stateless serving of 2025-era clients) comes from a WebFetch summary only. Verify by running Inspector in 2025-11-25 mode against a v2 server.
4. Whether the Python v2 package keeps a `FastMCP` import alias (needed for AgentCore samples) is not verified.
5. The exact protocol versions advertised by the TS v1 1.32.0 SDK are not verified.
6. Amazon component and display-mode details (List/Carousel/Card/Map, inline/fullscreen/hydrated) come from WebFetch summaries (medium). Exact payload formats for "hydrated" native rendering (which `structuredContent` shapes map to which component) are **not verified in reviewed docs**.
7. Whether Alexa+ supports URL-mode elicitation, tasks, sampling, or MCP Apps `ui/` host capabilities beyond rendering is not verified. The Supported Capabilities page lists only auth and account linking.
8. Alexa+ add-on purchasing: only a checkout-page caption and confirmation-email guidance were seen. A payments API for MCP add-ons is **not verified**.
9. "Alexa AI Action SDK / Multi-Agent SDK / Web Action SDK" are not mentioned in the current Introducing Alexa+ page or in the add-ons docs home. Their current status is not verified.
10. Date inconsistency: the aboutamazon carousel lists "Alexa+ now available to everyone in the US" as Sept 1, 2026, but the article itself says Prime-free since February 2026. The Sept 1 date appears to be an update date.
11. Inspector v2 README does not explicitly list transports. Streamable HTTP support is inferred from AgentCore's Inspector instructions and Amazon's test docs.
12. Non-Prime "limited free tier for basic chat" in the US comes from a WebFetch summary and was not verified verbatim.

---

## Searches run
- `firecrawl search 'Gemini API Model Context Protocol MCP support site:ai.google.dev' --limit 4 --scrape` → `.firecrawl/mcp-search-gemini-mcp.json` (useful)
- `mcp__firecrawl__firecrawl_search 'Alexa+ add-ons developer MCP toolkit preview select partners site:developer.amazon.com'` → HTTP 429, not saved (not useful)
- Pre-existing searches mined: `.firecrawl/competitor-alexa-search.json`, `.firecrawl/competitor-chatgpt-search.json`, `.firecrawl/competitor-openai-official-search.json`, `.firecrawl/competitor-gemini-search.json` (no MCP content)

## Sources read (method → saved file)
| URL | Method | Saved file |
|---|---|---|
| https://modelcontextprotocol.io/specification/2025-11-25/basic/transports | pre-saved Firecrawl | `.firecrawl/technical-mcp-transports.md` |
| https://modelcontextprotocol.io/specification/2025-11-25/changelog | Firecrawl CLI | `.firecrawl/mcp-spec-changelog-2025-11-25.md` |
| https://modelcontextprotocol.io/specification/2026-07-28/changelog | Firecrawl CLI (max-age 0) | `.firecrawl/mcp-spec-changelog-2026-07-28.md` |
| https://modelcontextprotocol.io/specification/versioning | WebFetch | `.firecrawl/mcp-spec-versioning-webfetch.md` |
| https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning | Firecrawl CLI | `.firecrawl/mcp-spec-2026-07-28-versioning.md` |
| https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http | Firecrawl CLI | `.firecrawl/mcp-spec-2026-07-28-streamable-http.md` |
| https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization | WebFetch | `.firecrawl/mcp-spec-2025-11-25-authorization-webfetch.md` |
| https://modelcontextprotocol.io/specification/2025-11-25/server/tools | WebFetch | `.firecrawl/mcp-spec-2025-11-25-tools-webfetch.md` |
| https://modelcontextprotocol.io/specification/2025-11-25/schema | Firecrawl CLI | `.firecrawl/mcp-spec-2025-11-25-schema.md` |
| https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation | WebFetch | `.firecrawl/mcp-spec-2025-11-25-elicitation-webfetch.md` |
| https://modelcontextprotocol.io/extensions/apps/overview | WebFetch | `.firecrawl/mcp-apps-overview-webfetch.md` |
| https://apps.extensions.modelcontextprotocol.io/api/ | Firecrawl CLI | `.firecrawl/mcp-apps-api.md` |
| https://agentskills.io/specification | WebFetch | `.firecrawl/mcp-agentskills-spec-webfetch.md` |
| https://github.com/modelcontextprotocol/typescript-sdk/releases | Firecrawl CLI | `.firecrawl/mcp-ts-sdk-releases.md` |
| npm READMEs (@modelcontextprotocol/server, server-legacy, sdk, inspector) | npm registry CLI | `.firecrawl/mcp-npm-server-readme.md`, `mcp-npm-server-legacy-readme.md`, `mcp-npm-sdk-v1-readme.md`, `mcp-npm-inspector-readme.md` |
| npm/PyPI version metadata | npm view / pip index | `.firecrawl/mcp-package-registry-versions.md` |
| https://ts.sdk.modelcontextprotocol.io/v2/serving/http | WebFetch | `.firecrawl/mcp-ts-sdk-v2-serving-http-webfetch.md` |
| https://github.com/modelcontextprotocol/python-sdk | Firecrawl CLI | `.firecrawl/mcp-python-sdk-readme.md` |
| https://py.sdk.modelcontextprotocol.io/whats-new/ | WebFetch | `.firecrawl/mcp-python-sdk-v2-whats-new-webfetch.md` |
| https://developer.amazon.com/docs/alexaplus/add-ons/home.html | Firecrawl CLI | `.firecrawl/mcp-alexaplus-addons-home.md` |
| https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html | Firecrawl CLI (+WebFetch) | `.firecrawl/mcp-alexaplus-mcp-toolkit-overview.md` |
| https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html | Firecrawl CLI (+WebFetch) | `.firecrawl/mcp-alexaplus-client-lifecycle.md` |
| Alexa+ supported-capabilities, design guide, display modes, components, test pages | WebFetch | `.firecrawl/mcp-alexaplus-design-pages-webfetch.md` |
| https://www.aboutamazon.com/news/devices/new-alexa-top-features | pre-saved search scrape | `.firecrawl/competitor-alexa-search.json` (web[2]) |
| https://www.aboutamazon.com/news/devices/new-alexa-generative-artificial-intelligence | pre-saved search scrape | `.firecrawl/competitor-alexa-search.json` (web[4]) |
| https://www.aboutamazon.com/news/devices/alexa-plus-international-launch | pre-saved search scrape | `.firecrawl/competitor-alexa-search.json` (web[3]) |
| https://www.aboutamazon.com/news/devices/alexa-plus-available-free-prime-members-us | WebFetch | `.firecrawl/mcp-alexaplus-us-availability-webfetch.md` |
| https://openai.com/index/introducing-apps-in-chatgpt/ ; https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/ ; https://openai.com/index/introducing-the-agents-api/ | pre-saved search scrape | `.firecrawl/competitor-openai-official-search.json` |
| https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt | pre-saved search scrape | `.firecrawl/competitor-chatgpt-search.json` (web[1]) |
| https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt/ | WebFetch | `.firecrawl/mcp-openai-mcp-apps-in-chatgpt-webfetch.md` |
| https://ai.google.dev/gemini-api/docs/function-calling | Firecrawl search --scrape | `.firecrawl/mcp-search-gemini-mcp.json` (web[2]) |
| https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/ (moved notice) | Firecrawl CLI | `.firecrawl/mcp-otel-semconv-mcp.md` |
| https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md | Firecrawl CLI | `.firecrawl/mcp-otel-genai-mcp.md` |
| https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html | WebFetch | `.firecrawl/mcp-agentcore-observability-webfetch.md` |
| https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html | pre-saved Firecrawl | `.firecrawl/technical-agentcore-mcp.md` |
| https://strandsagents.com/docs/user-guide/sdk/tools/mcp-tools/ | pre-saved Firecrawl | `.firecrawl/technical-strands-mcp.md` |
| Hackathon rules / FAQ / resources / updates / overview | pre-saved Firecrawl | `.firecrawl/amazonappdev2026.devpost.com-rules.md`, `-details-faqs.md`, `technical-resources.md`, `-updates.md`, `hackathon-overview.md` |
