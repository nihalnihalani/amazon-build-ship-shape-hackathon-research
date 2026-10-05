# Product feedback

**PREPARED, NOT SUBMITTED.** The Official Rules (as read 2026-10-05) require product feedback for every tool, API or SDK used: what it was used for, what worked, what needs work, the onboarding experience (zero to hello world) and whether you would build again (yes or no, and why). This draft covers only tools that were **actually used** in this repository. The "would you build again" answers are opinions: they are drafted from the evidence and **marked OWNER to confirm or change**. Entries cite the friction-log id (`FRICTION_LOG.md`) or the evidence entry that shows the use.

## Tools considered and not used (no feedback is given)

| Tool | Why there is nothing to report |
|---|---|
| Vega SDK, the `vega` CLI, Vega Virtual Device, a Fire TV | Never installed or run: Rosetta 2 is absent on the build host (B-001, F-01). There is no hello-world experience to describe. |
| Amazon Devices Builder Tools MCP (`@amazon-devices/amazon-devices-buildertools-mcp`) | Read about (registry latest 1.0.15; docs page "Get Started with Amazon Devices Builder Tools for AI") and **not used**. |
| Amazon Polly | Not used. The TV plays no audio (ADR-0008). |
| Bedrock, AgentCore, Strands, Kiro | Not used. |
| Any deployed AWS service | None exists (B-003). See the AWS entry. |

## 1. Vega developer documentation (SDK 0.24 pages) and the official samples

- **Used for:** choosing and pinning the stack (RN 0.83.0, React 19.2.0, OS 1.2, Node 22, native module versions), manifest fields, accessibility properties, networking and storage behaviour. Pages were fetched on 2026-10-05; several were read through a summarising tool and are marked in `docs/SOURCES.md`. The samples `vega-tv-interfaces-sample` (pinned `7546400`) and `react-native-multi-tv-helloworld` (`4b9ebf8`) were read and used as version references; **no sample source file was copied** (F-03).
- **What worked:** the compatibility table (SDK to RN to OS) and the SDK 0.24 release notes were clear about OS 1.2 and the two runtime lines; the sample `package.json` and `.nvmrc` gave exact, consistent pins; the accessibility page lists the supported native props, which saved us from copying web ARIA; the TVFocusGuideView and SVG pages list supported elements and known issues, so the meter arc was drawn with `Path` only.
- **What needs work:** stale prerequisites (Node 18 to 20 and Java in READMEs against `engines >=22`, F-04); RN 0.83 labelled "early access" while samples default to it (F-02); the WebSocket privileges and TLS trust rules are not documented (F-05); inconsistencies between pages (SDK build, `Polyline`, async-storage versions, missing `llms.txt`, F-12); source-file headers that contradict the repository licence (F-03).
- **Onboarding (zero to hello world):** **not reached.** Reading, pinning and typechecking took the work as far as the prerequisites; the first blocking step was the SDK dependency on Rosetta 2 on macOS 27 (F-01). The troubleshooting page named the cause precisely, which helped.
- **Would you build again on it (OWNER to confirm):** draft answer: yes for the React Native for Vega route, conditionally. The documentation was enough to design and test the app without the SDK, but we cannot judge the SDK and the VVD experience fairly because neither could be installed on this Mac; the answer should be revisited after B-001 clears.

## 2. Vega npm packages (`@amazon-devices/*`) and the React Native CLI for Vega

- **Used for:** typechecking the TV app (`@amazon-devices/react-native-kepler` 4.0.1, `react-native-svg` 3.0.9000000001, `react-native-async-storage__async-storage` 2.1.9000000001 through the standard async-storage alias, `kepler-a11y-settings-interface-turbo` 1.0.0), mocked jest runs, and `react-native bundle --platform kepler` through `@amazon-devices/kepler-cli-platform` 0.22.14 (EV-0008, EV-0014, EV-0033).
- **What worked:** the packages install from the public npm registry without credentials, the types let `tsc --noEmit` reach 0 errors, and the Metro bundle for platform `kepler` builds in about 8 seconds without the SDK (F-06). `react-native start` also starts Metro without the SDK.
- **What needs work:** the SVG package imports `buffer` without declaring it (F-10); `npm audit --omit=dev` reports 70 findings that come from tooling listed as runtime dependencies (F-11); the package licence ("See license in LICENSE", Amazon's Program Materials License Agreement) is not an open-source licence, which matters for an open-source repository and should be easy to find from the docs (`docs/release/LICENSES.md`).
- **Would you build again (OWNER to confirm):** draft answer: yes. The packages were the part of the platform that could be used end to end on this host.

## 3. AWS tooling for the relay (SAM template, `cfn-lint`, SDK v3 clients, the AWS CLI)

- **AWS services used and how (the field the AWS Builder challenge asks for):** **none by a running system.** What was done: (1) wrote an AWS SAM template (`infra/template.yaml`: API Gateway WebSocket, two Lambda functions on `nodejs24.x`, DynamoDB, SQS with a dead-letter queue, S3 and CloudFront with Origin Access Control, SSM SecureString, CloudWatch alarms, SNS, Budgets) and linted it with `cfn-lint` 1.57.1 and `aws-sam-translator` 1.113.0 (exit 0); (2) wrote the relay's AWS adapter with AWS SDK v3 clients (`client-apigatewaymanagementapi`, `client-dynamodb`, `lib-dynamodb`, `client-sqs`, `client-ssm`, all 3.1146.0) and tested it against fakes and a strict in-memory DynamoDB model; (3) made one AWS CLI call, `aws sts get-caller-identity`, which showed the credentials are the account root user, so nothing was deployed (F-14, B-003).
- **What worked:** the infra tests show `cfn-lint` rejecting deliberately broken templates (a deprecated runtime and an unknown SAM property are both refused); the SAM template validated after transformation, with `nodejs24.x` accepted; the AWS Lambda runtime and API Gateway limits pages gave exact numbers (idle timeout, frame and message sizes, the authorizer running only on `$connect`).
- **What needs work:** API Gateway cannot choose a close code (F-08) and gives a Lambda no per-connection timer (F-09), which forced an SQS-based design; `cfn-lint` does not check that an SQS event source `MaximumConcurrency` is at least 2, so a test asserts it.
- **Onboarding:** authoring and linting needed no account. Deployment was not attempted.
- **Would you build again (OWNER to confirm):** draft answer: undecided for deployment, because it was never deployed. Do not present AWS use as an integration until B-003 clears and evidence exists.

## 4. Metro, Vite, Vitest, Jest, Playwright (`playwright-core` with system Chrome), axe-core

- **Used for:** the build and test chain: Vitest for packages, relay and phone; Jest for the TV; Vite for the phone page and the TV web preview; `playwright-core` driving the system Google Chrome for end-to-end, phone and accessibility checks; axe-core 4.13.0 on the web preview (EV-0019, EV-0022, EV-0038, EV-0039).
- **What worked:** driving system Chrome with `playwright-core` needed no browser download; `routeWebSocket` made a scripted phone and a fault-injecting proxy straightforward; running the accessibility gate against a web preview found five real defects (A11Y-01 to A11Y-05) that jest could not see.
- **What needs work:** headless Chrome's `getUserMedia` behaviour was not stable between runs on the same build (F-07); Vite's dev server initially failed on React Native Flow sources (F-16); `npm ls` fails on a standalone project with `file:` links, so the SBOM needs `--ignore-npm-errors` (F-15).
- **Would you build again (OWNER to confirm):** draft answer: yes.

## 5. Claude Code (the development environment: Claude Opus 5.5 lead, Claude Sonnet 5.5 teammates)

- **Used for:** building the whole repository with a lead and named teammates in separate git worktrees (EV-0005, EV-0006, EV-0010 and the later model-resolution entries).
- **What worked:** each teammate resolved to the exact model identifier requested; separate worktrees with explicit path ownership let several owners work in parallel; independent QA and security teammates authored the review suites (163 tests, 59 accessibility checks) and found defects the implementers had not.
- **What needs work (from EV-0006):** the agent tool schema says the team-name parameter is deprecated and ignored ("the session has a single implicit team") and exposes no team-creation tool, and teammate state does not survive the end of a session, so durable state had to live in repository files (`.build/`). Claude Code 2.1.284 was recorded for the lead (self-reported by the runtime context).
- **Would you build again (OWNER to confirm):** draft answer: yes, with durable repository state and explicit ownership rules.

## 6. Hackathon pages (Devpost Rules, FAQ, Dates, Resources)

- **Used for:** the binding dates, judge-access obligations, video and track requirements and the feedback and friction-log rules (`docs/SOURCES.md` section 1).
- **What worked:** the Rules page states the deadline, the video length and the Fire TV simulator allowance unambiguously, and the FAQ confirms the emulator and private-repository route.
- **What needs work:** the Dates tab disagrees with the Rules about when judging starts (F-13); the Rules page carries no version or date, so a change cannot be detected without re-reading it.
- **Would you build again (OWNER to confirm):** n/a.
