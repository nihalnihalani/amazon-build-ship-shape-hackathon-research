# AWS services and pricing digest (KEY=aws, PREFIX=AWS)

Retrieved: 2026-10-03 (Asia/Kolkata). All AWS pages are official unless marked. Hackathon window: now through submission deadline Fri 2026-10-23 12:00 PDT; judging Nov 9-20 (per saved FAQ).

Method key: **CLI-scrape** = `firecrawl scrape --only-main-content --max-age 0` (body read); **CLI-scrape+wait** = same with `--wait-for 5000` (needed to render AWS price tables); **CLI-search** = `firecrawl search --json` without `--scrape` (snippets only, NOT counted as read); **CLI-search+scrape** = bodies included and read; **pre-saved** = file already in `.firecrawl/` before this task, body read.

**Big caveat on regions:** AWS pricing pages render the price tables with JavaScript region pickers. Where the tables did render, the picker showed **US East (Ohio)** as the default, not N. Virginia. Bedrock, DynamoDB, EventBridge and SQS prices below are therefore the **Ohio (us-east-2)** figures. N. Virginia (us-east-1) figures are confirmed only where a worked example on the page names N. Virginia (Lambda, CloudWatch, Transcribe). For the budget, us-east-1 = us-east-2 is a reasonable working assumption, but the reviewed pages do not confirm it.

---

## 1. Amazon Bedrock: on-demand model pricing

Source: [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/). Undated vendor pricing page. Saved to `.firecrawl/aws-bedrock-pricing.md` (CLI-scrape with `--wait-for 3000`). Region shown in the rendered picker: **US East (Ohio)**. Prices are USD per 1M tokens, Standard tier.

### Anthropic Claude (on-demand; Global cross-Region inference table)
| Model | Input | Output | Cache read | Notes |
|---|---|---|---|---|
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 | batch $0.50/$2.50 |
| Claude Sonnet 4.6 | $3.00 | $15.00 | $0.30 | Strands default model (see section 3) |
| Claude Sonnet 5.5 | $2.00 | $10.00 | $0.20 | batch N/A |
| Claude Opus 5.5 | $4.00 | $20.00 | $0.20 | batch N/A |
| Claude Opus 4.6 / 4.5 | $5.00 | $25.00 | $0.50 | |

In the "Geo and In-region" table the same models cost about 10% more: Haiku 4.5 $1.10/$5.50, Sonnet 4.6 $3.30/$16.50, Sonnet 5.5 $2.20/$11.00, Opus 5.5 $4.40/$22.00. Claude Mythos 5.1, Mythos 5 and Mythos Preview are gated ("requires approval"), so they are out of scope for us. Confidence: high for the Ohio figures; medium that us-east-1 is the same.

### Amazon Nova
| Model | Input | Output | Table |
|---|---|---|---|
| Nova Micro | $0.035 | $0.14 | Geo/in-region, Standard |
| Nova Lite | $0.06 | $0.24 | Geo/in-region, Standard |
| Nova Pro | $0.80 | $3.20 | Geo/in-region, Standard |
| Nova Premier | $2.50 | $12.50 | Geo/in-region, Standard |
| Nova 2 Lite | $0.30 | $2.50 | Global, Standard ($0.33/$2.75 geo/in-region) |
| Nova 2 Pro (Preview) | $1.25 | $10.00 | Global, Standard |
| Nova 2 Sonic (speech) | $3.00 | $12.00 | speech tokens; text $0.33/$2.75 |

The pricing page also lists Flex tier (cheaper), Priority tier (dearer) and batch inference at 50% off for select models.

**Worked budget examples** (my own arithmetic from the rates above):
- 2,000 demo calls × 2k input + 500 output tokens = 4M input + 1M output tokens. Haiku 4.5 ≈ $9.00, Sonnet 5.5 ≈ $18.00, Sonnet 4.6 ≈ $27.00, Nova Micro ≈ $0.28, Nova Lite ≈ $0.48, Nova 2 Lite ≈ $3.70.

### Model availability in ap-south-1 (Mumbai) — decision-critical
Source: [Regional availability by models](https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html). Undated docs page. Saved to `.firecrawl/aws-bedrock-models-region-compat.md` (CLI-scrape) and parsed with a script. The old URL `models-regions.html` now says the content "has moved" (`.firecrawl/aws-bedrock-models-regions.md`).

| Model | us-east-1 (in-region / geo / global) | ap-south-1 Mumbai (in-region / geo / global) |
|---|---|---|
| Claude Haiku 4.5 | Y / Y / Y | **N / Y / Y** |
| Claude Sonnet 4.6 | N / Y / Y | **N / N / Y (global only)** |
| Claude Sonnet 5.5 | N / Y / Y | **N / N / Y (global only)** |
| Claude Opus 5.5 | Y / Y / Y | **N / N / Y (global only)** |
| Claude Sonnet 5, Opus 5 | Y / Y / Y | N / Y / Y |
| Nova Micro / Lite / Pro | Y / Y / N | **N / Y / N (geo only)** |
| Nova 2 Lite | N / Y / Y | **N / N / Y (global only)** |
| Nova 2 Sonic | Y / N / N | **not listed (not available)** |

Implication: no current Claude or Nova model runs in-region in Mumbai. Calls from ap-south-1 must use a `global.` or geo inference-profile prefix, and data may leave India. The doc says geo routing keeps data inside a geography and lists "India" (IN) as one. Which geo profile applies to each Mumbai row is not stated per row. The doc also says cross-Region routing is "Priced at source Region rates; no surcharge", and that global inference is sometimes cheaper than geo. The simplest path for the hackathon is to deploy in **us-east-1 or us-west-2**. Confidence: high.

---

## 2. Amazon Bedrock AgentCore

### Components and GA
- Became **generally available on 2025-10-13**, in 9 Regions including Asia Pacific (Mumbai). Source: [What's New: AgentCore is now generally available](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available/), posted Oct 13, 2025 (`.firecrawl/aws-agentcore-ga-whatsnew.md`, CLI-scrape). The same post says Gateway "now connects to existing Model Context Protocol (MCP) servers" and turns APIs and Lambda functions into agent-compatible tools, with IAM as well as OAuth authorization. Policy in AgentCore went GA on 2026-03-03 (search snippet only, `.firecrawl/aws-search-agentcore-ga.json`; not read).
- Current component list from the [AgentCore developer guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html) navigation (pre-saved `.firecrawl/technical-agentcore-mcp.md`): harness, Runtime (microVMs and Instances), Memory, Gateway, Identity, payments, Code Interpreter, Browser, Observability, Policy, Evaluations, optimization, AWS Agent Registry, and an AgentCore MCP Server for coding assistants.
- **Region matrix** ([Supported AWS Regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html), `.firecrawl/aws-agentcore-regions.md`, undated): N. Virginia, Ohio, Oregon and **Mumbai** all support harness, Runtime microVMs, Runtime Instances, Memory, Gateway, Identity, Built-in Tools, Observability, Policy, Evaluations and optimization. Mumbai lacks payments, Agent Registry and the Web Search Tool. The Web Search Tool is available only in N. Virginia, Ireland and one APAC Region.

### MCP support (relevant to the Alexa+ self-hosted MCP path)
- **Runtime hosts MCP servers** with the **Streamable HTTP** transport, which is required. The container must listen on `0.0.0.0:8000/mcp`, and the platform requires an **ARM64** container. Stateless mode (`stateless_http=True`) is the default recommendation. The platform adds an `Mcp-Session-Id` header and uses it for microVM stickiness. Sources: [MCP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp-protocol-contract.html) (`.firecrawl/aws-agentcore-mcp-contract.md`) and [Deploy MCP servers](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html) (pre-saved).
- **Protocol versions:** the contract page names both `2025-11-25` and `2026-07-28`. For 2025-11-25 and earlier, elicitation and sampling need stateful mode (`stateless_http=False`). From 2026-07-28 they use the MRTR pattern and no longer need stateful mode. Runtime passes MCP JSON-RPC through to the container, so the spec version is set by your server SDK. This fits the hackathon's "2025-11-25+" requirement. Confidence: medium-high (the docs reference the versions but do not show an explicit support matrix).
- Inbound auth: the Runtime MCP guide scaffolds a CUSTOM_JWT authorizer with Amazon Cognito (or Auth0). The deployed endpoint is `https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT`. The deploy CLI is now `npm install -g @aws/agentcore` (`agentcore create` / `add agent --protocol MCP` / `deploy`). The GA post still points to the older "AgentCore Starter Toolkit".
- **Gateway** ([overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html), `.firecrawl/aws-agentcore-gateway.md`) "converts APIs, Lambda functions, and existing services into Model Context Protocol (MCP)-compatible tools". The guide's navigation lists MCP target types: Lambda functions, API Gateway stages, OpenAPI schemas, Smithy models, MCP server targets, integration templates, and built-in connectors (Managed Knowledge Bases, Web Search). Gateway also supports elicitation, progress notifications, logging and sampling, plus semantic tool search. It names Strands Agents, CrewAI, LangGraph and LlamaIndex as compatible frameworks.

### AgentCore pricing
Source: [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/). Undated. Saved to `.firecrawl/aws-agentcore-pricing.md`. The main price table does not name a Region; the Instances sub-table defaults to US East (N. Virginia).

| Item | Price |
|---|---|
| Runtime microVM v1 CPU / memory | $0.0895 per vCPU-hr / $0.00945 per GB-hr |
| Runtime microVM v2 (consumption) CPU / memory | $0.1276 per vCPU-hr / $0.0169 per GB-hr |
| Runtime Instances | EC2 On-Demand price + management fee (12% in the example) |
| Browser, Code Interpreter | $0.0895 per vCPU-hr, $0.00945 per GB-hr |
| Gateway | $0.005 per 1k invocations (ListTools/InvokeTool/Ping); Search API $0.025 per 1k; $0.02 per 100 tools indexed per month |
| Identity | $0.010 per 1k tokens/API keys; **free when used through Runtime or Gateway** |
| Memory, short-term | $0.25 per 1k events **through Oct 5, 2026**, then **$1.00 per GB ingested**, $0.20 per GB retrieved, $0.10 per GB-month stored (from Oct 6, 2026) |
| Memory, long-term | $0.75 per 1k records/month (built-in); $0.50 per 1k retrievals |
| Web Search | $7.00 per 1k queries |
| Policy | $0.000025 per authorization request |
| Observability | billed at CloudWatch rates |

Billing is per second with a 1-second minimum and a 128 MB memory minimum. CPU is not billed during I/O wait. The vendor's own example works out to about **$0.0067 per session** on v2. The short-term Memory pricing model changes mid-hackathon (2026-10-06).

**Free-plan caveat:** the AWS Free Tier page labels Bedrock AgentCore **"Paid plan exclusive"** (`.firecrawl/aws-free-tier.md`).

---

## 3. Strands Agents SDK
- **Python:** `strands-agents` **1.57.2**, released **Oct 1, 2026**, Apache-2.0 ([PyPI](https://pypi.org/project/strands-agents/), `.firecrawl/aws-strands-pypi.md`).
- **TypeScript:** `@strands-agents/sdk` **1.19.0**, "Published 11 days ago" (about 2026-09-22), 44 versions, Apache-2.0 ([npm](https://www.npmjs.com/package/@strands-agents/sdk), `.firecrawl/aws-strands-npm.md`).
- **Repo:** `github.com/strands-agents/sdk-python` now resolves to the **`strands-agents/harness-sdk`** monorepo, which contains harness-py, harness-ts, strands-cli and site. The last commit was Oct 2, 2026 (`.firecrawl/aws-strands-github.md`).
- **Default model:** the official docs say a basic `Agent()` uses `BedrockModel` with **Claude Sonnet 4.6** by default, in both Python and TypeScript ([Bedrock provider doc](https://strandsagents.com/docs/user-guide/sdk/model-providers/amazon-bedrock/), `.firecrawl/aws-strands-bedrock-provider.md`). Examples use `global.anthropic.claude-sonnet-5` and `AWS_REGION=us-west-2`. *Contradiction:* the PyPI README still says to enable "Claude 4 Sonnet in the us-west-2 region". Trust the docs, and set the model ID explicitly.
- **MCP client:** supports **stdio, Streamable HTTP (including OAuth and AWS IAM auth), and SSE**. `MCPClient` can be passed straight into `Agent(tools=[...])`. Elicitation is supported; progress notifications are "not yet supported in the TypeScript SDK". The SDK works with both mcp 1.x and 2.x. Sources: [MCP tools doc](https://strandsagents.com/docs/user-guide/sdk/tools/mcp-tools/) (pre-saved `.firecrawl/technical-strands-mcp.md`) and the PyPI README.
- Strands documents deployment to AgentCore Runtime in both Python and TypeScript (docs navigation).

---

## 4. Kiro and Kiro Crew (decision-critical for the AWS Builder mini-challenge)
- **What Kiro is** ([kiro.dev](https://kiro.dev/), `.firecrawl/aws-kiro-home.md`): agentic AI with an IDE (based on Code OSS), CLI, web interface, mobile app, and Kiro Crew. It does spec-driven development. Sign-in is via GitHub, Google, AWS Builder ID or IAM Identity Center. It states "You do not need an AWS account to use Kiro."
- **Kiro Crew is official and defined** ([kiro.dev/crew](https://kiro.dev/crew/), `.firecrawl/aws-kiro-crew.md`; repo [kirodotdev/KiroCrew](https://github.com/kirodotdev/kirocrew), `.firecrawl/aws-kirocrew-github.md`):
  - It is "an open source workspace for development that runs on your own machine and keeps working across sessions".
  - It has persistent memory and lessons, cron, webhook and heartbeat jobs, parallel agent orchestration, and an App SDK; Apps can register their own MCP tools.
  - You can use it from a desktop app, web dashboard, CLI, Slack, Discord or Telegram.
  - It runs on the **Kiro CLI over ACP (Agent Client Protocol)**.
  - It is licensed **Apache-2.0**.
  - **A Kiro account is required.** It is "free software, but it needs a Kiro plan to run", and model requests count against the Kiro plan.
  - Install: `curl -fsSL https://download.crew.kiro.dev/cli.sh | sh`. Last repo commit Oct 3, 2026.
  - The vendor claims "39,000+ builders in less than 6 months". This is unverifiable marketing.
  - Launch date: not verified in reviewed sources. Search snippets show a Reddit launch post and an AWS Builder Center getting-started article, neither read.
- **The hackathon rules** (pre-saved `.firecrawl/amazonappdev2026.devpost.com-rules.md`) say "Kiro Crew qualifies on its own as a development tool", with no need to also call Bedrock, AgentCore, SageMaker or Strands. The submission must still "Describe which AWS service(s) you used and how" in the Product Feedback answer. The judging guide calls a single Bedrock call plus S3 "Obvious" and a multi-service Bedrock + AgentCore + Strands pipeline "Creative".
- **Kiro pricing** ([kiro.dev/pricing](https://kiro.dev/pricing/), `.firecrawl/aws-kiro-pricing.md`, undated):

| Plan | Price | Credits |
|---|---|---|
| Free | $0 | 50 credits/month (Claude Sonnet 4.5 plus open-weight models, rate-limited) |
| Pro | $20/user/month | 1,000 |
| Pro+ | $40 | 2,000 |
| Pro Max | $100 | 5,000 |
| Power | $200 | 10,000 |

  Add-on credits cost $0.04 each. You get a $20 credit on your first upgrade (social login or Builder ID). Unused credits do not roll over. Subscriptions cover the IDE, CLI, Web, Crew and ACP IDEs. Third-party harnesses such as OpenClaw are not permitted.

---

## 5. Serverless building blocks: prices and free tiers
| Service | Price | Free allowance | Source / region | Confidence |
|---|---|---|---|---|
| **Lambda** | $0.20 per 1M requests; $0.0000166667 per GB-s (x86), $0.0000133334 per GB-s (Arm) | 1M requests + 400,000 GB-s per month | [Lambda pricing](https://aws.amazon.com/lambda/pricing/), `.firecrawl/aws-lambda-pricing.md`; tables did not render, rates come from worked examples "based on price in US East (N. Virginia)" | high |
| **API Gateway HTTP API** | $1.00 per 1M (first 300M), then $0.90 per 1M; metered in 512 KB increments. REST API $3.50 per 1M | 1M HTTP calls/month for 12 months (legacy 12-month offer wording; see Gaps) | [API GW pricing](https://aws.amazon.com/api-gateway/pricing/), `.firecrawl/aws-apigw-pricing.md`; rates from examples, region not named | medium-high |
| **DynamoDB on-demand** | $0.625 per 1M WRU, $0.125 per 1M RRU, $0.25 per GB-month (Standard) | 25 GB storage plus 25 WCU/25 RCU **provisioned** (the free tier uses provisioned capacity) | [DynamoDB on-demand](https://aws.amazon.com/dynamodb/pricing/on-demand/), `.firecrawl/aws-dynamodb-ondemand-pricing.md` (rendered); **Ohio** | high (Ohio) |
| **EventBridge** custom bus (classic) | $1.00 per 1M custom events ingested; delivery to a same-account service free; 64 KB chunks | AWS management events free; Scheduler 14M invocations/month free, then $1.00 per 1M | [EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/), `.firecrawl/aws-eventbridge-pricing.md` (rendered); **Ohio**. A new "enhanced" custom bus (launched Sept 2026) is priced per GB: $0.18/GB ingress, $0.05/GB egress | high |
| **SQS** | Standard $0.40 per 1M, FIFO $0.50 per 1M (1M–100B tier); 64 KB chunks | 1M requests/month for all customers | [SQS pricing](https://aws.amazon.com/sqs/pricing/), `.firecrawl/aws-sqs-pricing-rendered.md`; **Ohio** | high (Ohio) |
| **CloudWatch Logs** | ingestion $0.50/GB (first tier, N. Virginia example), archive $0.03/GB-month; standard alarm $0.10 per alarm metric | 5 GB logs data, 10 alarm metrics, 3 custom dashboards | [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), `.firecrawl/aws-cloudwatch-pricing.md`; examples | medium-high |
| **Cognito** (user pools) | Essentials $0.015/MAU above the free tier (example) | 10,000 MAU/month (Lite and Essentials), no expiry; 50 MAU for SAML/OIDC; none for M2M tokens | [Cognito pricing](https://aws.amazon.com/cognito/pricing/), `.firecrawl/aws-cognito-pricing.md` | high (free tier), medium (rate) |
| **Transcribe** | streaming $0.01/min, batch $0.006/min (N. Virginia worked examples) | 60 min/month for 12 months | [Transcribe pricing](https://aws.amazon.com/transcribe/pricing/), `.firecrawl/aws-transcribe-pricing.md` | medium (table not rendered) |
| **Polly** | **pending**: the scrape was rate-limited twice and abandoned | — | — | — |

---

## 6. AWS Free Tier (2026) and Promotional Credits
- **Free Tier model** ([aws.amazon.com/free](https://aws.amazon.com/free/), `.firecrawl/aws-free-tier.md`; [Free Tier docs](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html), `.firecrawl/aws-free-tier-docs.md`):
  - New accounts get **$100 in credits** at sign-up, plus **up to $100 more** for completing activities.
  - The **Free plan** lasts up to **6 months** or until credits run out, whichever comes first. It then closes, with no charges unless you upgrade.
  - The Free plan has only Always Free offers and blocks some services.
  - The Paid plan has short-term trials and pay-as-you-go pricing.
  - The API Gateway page dates this model to "Starting July 15, 2025".
- **Promotional Credits are "Not eligible" on the Free plan and "Eligible" on the Paid plan** (comparison table on aws.amazon.com/free). The hackathon $150 credit therefore needs a **Paid plan** account. **AgentCore is "Paid plan exclusive".**
- **Promotional Credit terms** ([aws.amazon.com/awscredits](https://aws.amazon.com/awscredits/), **Last Updated September 24, 2026**, `.firecrawl/aws-credits-terms.md`):
  - Credits do not apply to **AWS Marketplace**, Mechanical Turk, ineligible Support, Professional Services, Training/Certification, Route 53 domain registration, crypto mining, or upfront Savings Plans/RI fees. There is also a catch-all for "other Services as may be designated".
  - Each code can be redeemed once, on one account.
  - Credits are non-transferable and not redeemable for cash.
  - Credits expire on the date given with the code.
  - Credits are void if the account was "created... solely for the purpose of obtaining Promotional Credit".
  - A valid credit card is required.
  - Credits cannot be combined with other promotional offers unless AWS authorizes it.
- **Claude-on-Bedrock credit risk** (medium confidence):
  - AWS's [Serverless Third-Party Models](https://aws.amazon.com/legal/bedrock/third-party-models/) legal page says "Anthropic Services on Amazon Bedrock are sold by Anthropic". It also says AI21 and Qwen models are "sold by AWS" (read via CLI-search+scrape, `.firecrawl/aws-search-credits-bedrock.json`).
  - A single re:Post anecdote (about 10 months old) reports Claude Opus 4.5 billed "under AWS Marketplace" and not covered by promotional credits, while other Claude models were covered. The only answer is AI-generated.
  - Neither the hackathon rules nor the credit terms explicitly confirm whether Claude usage is offset. Nova models are first-party AWS.
  - Recommendation: default to **Nova** for credit-funded runs, and check the Bills page after first Claude usage.
- **Hackathon specifics** (pre-saved rules and FAQ):
  - $150 promotional credits per registered individual, requested by **Oct 21, 12pm PT**, "while supplies last".
  - The rules say "Additional charges... are the responsibility of the Entrant".
  - The FAQ advises tearing resources down between tests, since judging runs Nov 9-20.
  - The FAQ also notes there is no official offline Bedrock emulator.

---

## 7. Cost monitoring (official docs)
- **AWS Budgets** ([docs](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html), `.firecrawl/aws-budgets-docs.md`): monthly cost budgets can alert on **actual and forecasted** spend by email or SNS. **Budget actions** can, for example, apply an IAM policy that blocks new provisioning at a threshold. Budgets pricing was not fetched (pending).
- **Cost Anomaly Detection** ([docs](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html), `.firecrawl/aws-cost-anomaly-docs.md`):
  - Uses ML and runs about **3 times a day** on net unblended cost.
  - Uses Cost Explorer data, which has **up to a 24-hour delay**.
  - A new monitor takes 24 hours to start detecting.
  - A new service needs **10 days** of history.
  - Conclusion: too slow to be the only guardrail during a three-week hackathon.
- **CloudWatch billing alarm** ([docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html), `.firecrawl/aws-billing-alarm-docs.md`):
  - You must **enable billing alerts** first.
  - The billing metric lives in **US East (N. Virginia)** and covers worldwide charges.
  - The alarm fires only when actual charges exceed the threshold; it does not use forecasts.
  - The first 10 alarm metrics are free (CloudWatch free tier).

## 8. Firecrawl (NON-AWS; in-product use)
[firecrawl.dev/pricing](https://www.firecrawl.dev/pricing) (`.firecrawl/aws-firecrawl-pricing.md`, undated):

| Plan | Price | Credits/month | Concurrency |
|---|---|---|---|
| Free | $0 | 1,000 | 2 |
| Hobby | $16/month annual ($19 monthly) | 5,000 | 5 |
| Standard | $83/month annual | 100,000 | 25 |
| Growth | $333/month annual | 500,000 | 50 |

A scrape costs 1 credit per page. Search costs 2 credits per 10 results. JSON, Question and Highlight formats add 4 credits per page. Failed scrapes with no result are not charged.

---

## Gaps / unverified / contradictions
1. **us-east-1 vs us-east-2:** Bedrock, DynamoDB, EventBridge and SQS tables rendered with **US East (Ohio)** pre-selected. N. Virginia prices are not separately confirmed. Lambda, CloudWatch and Transcribe rates come from N. Virginia worked examples, not tables. The API Gateway example does not name its Region.
2. **Pending prices:** Amazon Polly (rate-limited), AWS Budgets pricing (not fetched), and AgentCore per-Region price variation (the table is unlabelled).
3. **Claude and promotional credits:** whether the hackathon $150 promotional credit offsets Anthropic-on-Bedrock usage is **not verified**. Evidence: "sold by Anthropic", the AWS Marketplace exclusion in the credit terms, and one re:Post anecdote. Treat it as a risk.
4. **Strands default model contradiction:** the docs say Claude Sonnet 4.6; the PyPI README says Claude 4 Sonnet (us-west-2). Set the model explicitly.
5. **AgentCore and MCP spec 2025-11-25:** the protocol contract references 2025-11-25 and 2026-07-28 behaviour, but no explicit version support matrix was found. Runtime passes messages through, so the server SDK decides the version.
6. **API Gateway free tier:** the page still describes a 1M-call, 12-month free tier. The Free Tier docs say Free-plan accounts have only "Always Free" offers active. Whether the 12-month API Gateway offer applies to post-July-2025 accounts is not verified.
7. **Kiro Crew launch date** is not verified (the official page is undated). The adoption figure (39,000+ builders) is a vendor claim.
8. **Hackathon credit form URL inconsistency** (outside this assignment, but noticed): the rules use `forms.gle/5hyhr1u6x3fuV2aW7`, the resources page uses `forms.gle/GaHFxSbBQNG9Kti6A`, and the FAQ links a docs.google.com form. Confirm on the Devpost updates page.
9. **Amazon Bedrock plan eligibility:** whether Bedrock itself is available on the Free plan is not verified; the card label was not visible. AgentCore is explicitly Paid-plan-only.
10. **EventBridge "enhanced custom event bus"** launched September 2026, per the pricing page. Only the pricing page was reviewed, not its launch announcement.

## Searches run
| Query | Saved file | Useful |
|---|---|---|
| `Amazon Bedrock AgentCore generally available` (CLI-search, snippets) | `.firecrawl/aws-search-agentcore-ga.json` | yes (led to the What's New page) |
| `"Kiro Crew"` (CLI-search, snippets) | `.firecrawl/aws-search-kiro-crew.json` | yes (led to kiro.dev/crew) |
| `AWS promotional credits Amazon Bedrock third-party models AWS Marketplace billing eligible` (CLI-search+scrape) | `.firecrawl/aws-search-credits-bedrock.json` | partly |
| `Amazon Bedrock AgentCore now generally available site:aws.amazon.com` | none (HTTP 429) | no |

## Sources read (body read; retrieved 2026-10-03)
| Source | Saved file | Method |
|---|---|---|
| https://aws.amazon.com/bedrock/pricing/ | `.firecrawl/aws-bedrock-pricing.md` | CLI-scrape, wait 3s |
| https://docs.aws.amazon.com/bedrock/latest/userguide/models-regions.html (moved notice) | `.firecrawl/aws-bedrock-models-regions.md` | CLI-scrape |
| https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html | `.firecrawl/aws-bedrock-models-region-compat.md` | CLI-scrape |
| https://aws.amazon.com/bedrock/agentcore/pricing/ | `.firecrawl/aws-agentcore-pricing.md` | CLI-scrape, wait 2s |
| https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html | `.firecrawl/aws-agentcore-regions.md` | CLI-scrape |
| https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available/ | `.firecrawl/aws-agentcore-ga-whatsnew.md` | CLI-scrape |
| https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp-protocol-contract.html | `.firecrawl/aws-agentcore-mcp-contract.md` | CLI-scrape |
| https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html | `.firecrawl/aws-agentcore-gateway.md` | CLI-scrape |
| https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html | `.firecrawl/technical-agentcore-mcp.md` | pre-saved |
| https://strandsagents.com/docs/user-guide/sdk/tools/mcp-tools/ | `.firecrawl/technical-strands-mcp.md` | pre-saved |
| https://pypi.org/project/strands-agents/ | `.firecrawl/aws-strands-pypi.md` | CLI-scrape |
| https://strandsagents.com/docs/user-guide/sdk/model-providers/amazon-bedrock/ | `.firecrawl/aws-strands-bedrock-provider.md` | CLI-scrape |
| https://www.npmjs.com/package/@strands-agents/sdk | `.firecrawl/aws-strands-npm.md` | CLI-scrape |
| https://github.com/strands-agents/sdk-python (→ harness-sdk) | `.firecrawl/aws-strands-github.md` | CLI-scrape |
| https://kiro.dev/ | `.firecrawl/aws-kiro-home.md` | CLI-scrape |
| https://kiro.dev/pricing/ | `.firecrawl/aws-kiro-pricing.md` | CLI-scrape |
| https://kiro.dev/crew/ | `.firecrawl/aws-kiro-crew.md` | CLI-scrape |
| https://github.com/kirodotdev/kirocrew | `.firecrawl/aws-kirocrew-github.md` | CLI-scrape |
| https://aws.amazon.com/lambda/pricing/ | `.firecrawl/aws-lambda-pricing.md` | CLI-scrape |
| https://aws.amazon.com/api-gateway/pricing/ | `.firecrawl/aws-apigw-pricing.md` | CLI-scrape |
| https://aws.amazon.com/dynamodb/pricing/on-demand/ | `.firecrawl/aws-dynamodb-ondemand-pricing.md` | CLI-scrape+wait |
| https://aws.amazon.com/eventbridge/pricing/ | `.firecrawl/aws-eventbridge-pricing.md` | CLI-scrape+wait |
| https://aws.amazon.com/sqs/pricing/ | `.firecrawl/aws-sqs-pricing.md` (unrendered), `.firecrawl/aws-sqs-pricing-rendered.md` | CLI-scrape, then CLI-scrape+wait |
| https://aws.amazon.com/cloudwatch/pricing/ | `.firecrawl/aws-cloudwatch-pricing.md` | CLI-scrape |
| https://aws.amazon.com/cognito/pricing/ | `.firecrawl/aws-cognito-pricing.md` | CLI-scrape |
| https://aws.amazon.com/transcribe/pricing/ | `.firecrawl/aws-transcribe-pricing.md` | CLI-scrape |
| https://aws.amazon.com/free/ | `.firecrawl/aws-free-tier.md` | CLI-scrape |
| https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html | `.firecrawl/aws-free-tier-docs.md` | CLI-scrape |
| https://aws.amazon.com/awscredits/ | `.firecrawl/aws-credits-terms.md` | CLI-scrape |
| https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html | `.firecrawl/aws-budgets-docs.md` | CLI-scrape |
| https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html | `.firecrawl/aws-cost-anomaly-docs.md` | CLI-scrape |
| https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html | `.firecrawl/aws-billing-alarm-docs.md` | CLI-scrape |
| https://aws.amazon.com/legal/bedrock/third-party-models/ | inside `.firecrawl/aws-search-credits-bedrock.json` | CLI-search+scrape |
| https://repost.aws/questions/QUrl2nATrQRWi1g2CV5ra5eA/... (community) | inside `.firecrawl/aws-search-credits-bedrock.json` | CLI-search+scrape |
| https://aws.amazon.com/blogs/startups/aws-activate-credits-now-accepted-for-third-party-models-on-amazon-bedrock/ (2024; Activate credits only, tangential) | inside `.firecrawl/aws-search-credits-bedrock.json` | CLI-search+scrape |
| https://www.firecrawl.dev/pricing (non-AWS) | `.firecrawl/aws-firecrawl-pricing.md` | CLI-scrape |
| Hackathon rules, FAQ and resources (context only) | `.firecrawl/amazonappdev2026.devpost.com-rules.md`, `-details-faqs.md`, `technical-resources.md`, `hackathon-overview.md` | pre-saved |

Not fetched or abandoned: https://aws.amazon.com/polly/pricing/ (429 twice).
