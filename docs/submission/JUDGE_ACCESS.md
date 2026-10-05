# Judge access: plan and authorizations

**PREPARED, NOTHING DONE.** No repository was made public, no collaborator was invited, no message was sent, no video was uploaded and nothing was submitted. Every action below that publishes, shares, sends or submits needs the owner's explicit authorization (B-005) and is **per action**: one approval does not cover the next.

Source of the obligations: Official Rules and FAQ as read on 2026-10-05 (`docs/SOURCES.md` section 1); the reviewer handles come from `research/HACKATHON_BRIEF.md` section 8 (which cites the Rules, the FAQ and the Overview): **re-verify the list on the Rules page the day you invite**.

## What the rules require (as read)

| Obligation | Detail |
|---|---|
| Repository | GitHub only. All source, assets and instructions needed to run the project, with clear setup and test instructions. **Either** public with an open-source licence file detectable in the repository's About section, **or** private and shared with `testing@devpost.com` and the named Amazon Developer Relations GitHub accounts (`chris-trag`, `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, `emersonsklar` per the brief). Invitations must be accepted and, per the FAQ, expire after 7 days. |
| Free access | The project must be available **free of charge and without restriction** for testing, evaluation and use by the sponsor, the administrator and the judges **until the Judging Period ends**: **Friday 2026-11-20 12:00 Pacific = 2026-11-21 01:30 IST**, or any later end date if the Rules are amended. |
| Private websites | Any login credentials must be in the testing instructions. |
| Judges | Not required to test; they may judge from the text, images and video alone. |
| Hardware | For software on proprietary or non-mainstream hardware the sponsor or administrator may require physical access to the hardware on request. For a Fire TV project be ready for that request (B-004: there is no physical Fire TV today). |
| Video | Public on YouTube or Vimeo, English, under three minutes, kept public through judging. |

## Today's access picture

- **No hosted component exists.** A judge can build and test everything locally from the repository (`docs/SETUP.md`, `docs/TESTING.md`). There is no website to keep alive and no credentials to hand over. If an AWS stack is later deployed for the demo (B-003), it must be kept running until 2026-11-21 01:30 IST per `docs/operations/RUNBOOK.md` section 5 (freeze after submission except owner-approved rollbacks; daily checks), and its URL and access notes added here.
- **The Fire TV part cannot be run by a judge without a Vega SDK and a VVD or Fire TV**; the repository says so plainly (`docs/LIMITATIONS.md`).

## Plan

| Step | Owner action | Authorization needed | When |
|---|---|---|---|
| 1. Decide public or private | Choose. Public needs a detectable licence file: the root `LICENSE` is MIT. The brief records DevRel guidance (forum 45418) that when AI-generated assets cannot carry the repository licence, a private repository is the recommended route; decide whether that applies to this repository. | The owner's decision | before 2026-10-21 |
| 2. Pre-publication review (below) | Read the "Before this repository becomes visible to anyone" list | Owner | before step 3 |
| 3a. Public route | Create the public GitHub repository (or change visibility), push the reviewed branch, confirm the licence is detected in the About section | **Authorization to publish** | by the internal target, 2026-10-22 20:00 IST |
| 3b. Private route | Create a private repository, push, share with `testing@devpost.com` and the named accounts | **Authorization to publish and to send invitations** (each invitation is a message sent on the owner's behalf) | invitations as close to submission as possible: they expire after 7 days and must be accepted |
| 4. Adopt the README | Decide whether to replace the root `README.md` with `docs/release/README.proposed.md` (the owner's research README and an uncommitted edit are preserved until then) | Owner's decision | before step 3 |
| 5. Tag the submitted commit | e.g. a tag naming the submission commit, so that the exact state judged is recoverable (a suggestion; the Rules as read say nothing about edits after the deadline, so re-read them) | Owner | at submission |
| 6. Upload the video | Public, English, under 3:00, captions as in `VIDEO_STORYBOARD.md`; only after the VVD demo exists (B-001) | **Authorization to upload** | before the deadline |
| 7. Submit the Devpost form | Fill the fields from `DEVPOST_DRAFT.md`; accept the terms and attestations yourself | **The owner only** (attestations are never accepted on the owner's behalf) | **deadline 2026-10-24 00:30 IST** |
| 8. Check access near submission | Open the repository in a logged-out browser (public) or confirm each invitation is pending or accepted (private); open the video in a logged-out browser | Owner | the day of submission and again on 2026-11-09 (judging starts) |
| 9. Keep it working | Do not delete, rename or make the repository private; keep the video public; renew any expired invitation; keep any hosted stack up | Owner | through **2026-11-21 01:30 IST** |
| 10. Hardware request | If the sponsor asks for physical access to the Fire TV, respond | Owner | on request |

Optional and **not requested**: the AWS promotional credit ($150 per registered individual; request by 2026-10-21 12:00 Pacific = 2026-10-22 00:30 IST). Not assumed, not submitted.

## Before this repository becomes visible to anyone (pre-publication scan done in the docs pass)

Run on the tracked files at `63af0ae` with `git grep` (excluding generated release artifacts):

| Check | Result |
|---|---|
| Secret patterns (AWS access key ids, private key blocks, `aws_secret_access_key`, Slack, GitHub and common API-key token shapes) | **None found.** |
| AWS account ids | Only `123456789012`, AWS's documented example id, in test fixtures (`services/relay/test/aws-adapter.test.ts`, `aws-handlers.test.ts`) and two research files. The evidence log redacts the real account id. |
| Personal email address | Not found in tracked files. Git author identity on all 162 commits is a GitHub no-reply address. |
| Local usernames and absolute paths | **Present in 11 tracked files owned by other roles** (counted again at `6291c90`; it was 7 before the QA, security and gate documents were merged) (the list, with line numbers, is in the next section). None is a secret; the owner should decide whether to leave them. This role's own files contain no absolute local path (checked after the follow-up pass with `grep` for the home-directory prefix, the temporary-directory prefix and the worktree directory name). |
| Development certificates and keys | `certs/` is git-ignored; `ca.key` and `server.key` are not tracked. |
| `research/` | 54 tracked files, about 82,000 lines of the owner's research, competitor notes and plans. The owner decides whether it ships. Some files cite third-party repositories and forum posts. |
| `.build/` | The internal evidence ledger and task graph; contains local paths (above) and the honest blocker list. |
| Third-party licences | `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md`, `docs/release/LICENSES.md`. The `@amazon-devices/*` packages are proprietary and not copied into the repository. |
| Trademarks | Product name "Across the Room" is not a platform mark. "Fire TV", "Vega" and "Amazon" appear descriptively. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED (noted in the notices). |

Not checked: the full git history for deleted secrets (a pattern search of history was not run), and image or binary assets (the repository tracks few; `tests/a11y/artifacts/committed/*.png` are screenshots of the web preview).

## Pre-publication cleanup list: local paths in other roles' files

Not edited by release-docs (path ownership). Each entry is a repository-relative file, the line numbers that contain the build host's home-directory path (which exposes the local username) or a temporary-directory path, and the owner of the file. Suggested cleanup in each: replace the absolute path with a repository-relative one or with a placeholder such as `<worktree>`; for the JSON probe output, regenerate it with a relative `cwd`.

| File | Lines | Content | Owner |
|---|---|---|---|
| `.build/task-graph.json` | 29, 70, 223, 259, 296, 334, 368, 466, 591 | the `cwd` of each task (the main checkout and the `contracts`, `dsp`, `phone`, `relay`, `tv` worktrees) | lead |
| `docs/evaluation/A11Y_T17_PREP.md` | 4 | worktree, branch and base line | qa |
| `docs/evaluation/QA_REVIEW_T11_T13_T14.md` | 4 | worktree, branch and base line | qa |
| `docs/evaluation/QA_REVIEW_T12_T15.md` | 165, 212 | command and scratch-directory paths | qa |
| `docs/evaluation/T18_CLEAN_BUILD.md` | 33 | the clone command and the scratch directory | qa |
| `docs/security/ADR_REVIEW.md` | 5 | worktree, branch and base line | security |
| `docs/security/PROTOCOL_PACKAGE_REVIEW.md` | 3, 355 | reviewer line and the command listing | security |
| `docs/security/T16_GATE.md` | 4 | worktree and branch line | security |
| `docs/security/probes/protocol_probe_results.json` | 3 | a temporary-directory path that contains the username | security |
| `docs/security/probes/protocol_probe_results_rev1.json` | 3 | the same, in the revision 1 record | security |
| `docs/security/probes/protocol_test_baseline_rev1.txt` | 1, 10 | the command's working directory and the test runner's root (the file was renamed from `protocol_test_baseline.txt`) | security |

The list was recounted at `6291c90` with `git ls-files | xargs grep` for the home-directory prefix, the temporary-directory prefix, the worktree directory name and the username; the username `nihalnihalani` also appears, as the git author identity, in `docs/submission/TRACK_AND_CHALLENGES.md`, which is not a path and is left.

Also for the owner to decide, not paths: `research/` (54 files) and `.build/` (the internal ledger) ship with the repository unless removed, and `tests/a11y/artifacts/` holds generated screenshots and a report.

## What needs the owner, in one list

1. Public versus private repository, and the visibility change.
2. Pushing anything anywhere.
3. Inviting the named accounts or `testing@devpost.com` (and re-inviting if invitations expire).
4. Uploading the video and choosing its platform account.
5. Submitting the Devpost form and accepting its terms.
6. Any AWS deployment, spend or credit request (B-003).
7. Supplying a Fire TV for any hardware request (B-004).
