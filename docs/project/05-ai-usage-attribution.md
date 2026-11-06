# AI Usage and Attribution

The hackathon requires AI assistance to be documented and new work to be distinguished from reused libraries. This document is that record. Items marked **owner to confirm** need the project owner's input because they cannot be known from the repository.

## Summary

CORVEN is developed by the project owner using **Claude Code** (Anthropic's coding agent, running in VS Code), directed through written requirements. The owner defines the product, scope and architecture and reviews and approves the work; the assistant implements and documents under that direction. Commits carry no co-author trailer by the owner's choice, so this document is the attribution record.

## How AI was used

| Area | AI involvement | Human role |
|---|---|---|
| Product definition, PRD, scope, architecture decisions | **Owner to confirm** whether the PRD text was drafted with AI help | Owner defined the product, priorities and decisions |
| Agent Registry, Dependency Registry, discovery prerequisites, Graph Engine (code and tests) | Implemented by Claude Code from the owner's written module specifications | Owner wrote the specifications, reviewed results, decided what to commit and merge |
| Database schema and migrations | Written by Claude Code (Drizzle schema, hand-written SQL for triggers and down scripts) | Reviewed and applied by the owner |
| Architecture model in IcePanel | Claude Code drafted the C4 model and imported it with IcePanel's plugin after the owner approved it | Owner approved the model before import |
| Landing page (`apps/landing`) | Claude Code wrote the page from the owner's brief and a design-language brief; fonts self-hosted | Owner directed and reviewed |
| Documentation (this folder) | Written by Claude Code from the actual code and the PRD | Owner reviews and corrects |
| Pull request descriptions and commit command suggestions | Drafted by Claude Code | Owner runs the commands |

Rules the assistant works under (recorded in project memory): no co-author trailer in commits, never force push, no commits or pushes without the owner's decision, honest reporting of what is built versus planned.

## What AI was **not** used for

- Deciding whether a relationship is authorized or safe, approving anything, or enforcing anything. The product forbids it (deterministic enforcement; no LLM in any decision path), and no language model is called by the code in this repository.
- Writing or storing secrets. Local database credentials are throwaway values in `docker-compose.yml`.

## Newly written work

All source under `apps/api/src`, `apps/api/test`, `apps/api/drizzle`, `apps/landing` (HTML, CSS, JS, generated SVG art) and `docs/` was written for this project during the event. The generated dotted-wave artwork (`apps/landing/assets/wave.svg`) was produced by a script written for this project.

## Reused public libraries and assets

| Item | Use | License (verify before submission) |
|---|---|---|
| Node.js, TypeScript | Runtime and language | MIT / Apache-2.0 / OpenJS |
| Fastify, `@fastify/type-provider-typebox`, TypeBox, `ajv-formats` | HTTP framework and validation | MIT |
| Drizzle ORM, Drizzle Kit | Database access and migrations | Apache-2.0 |
| `pg` (node-postgres) | PostgreSQL driver | MIT |
| Vitest, tsx, ESLint, typescript-eslint | Test, run, lint | MIT / ISC |
| PostgreSQL 17 (Docker image) | Database | PostgreSQL License |
| pnpm, Docker Compose | Tooling | MIT / Apache-2.0 |
| Inter, Source Serif 4, Geist Mono | Landing page fonts, self-hosted Latin subsets | SIL Open Font License 1.1 |
| IcePanel | Hosted architecture modelling tool and its Claude Code plugin | Commercial service; plugin license per its repository |

Planned libraries (not yet added): pg-boss, a chain library (viem or ethers), Foundry, OpenZeppelin, Next.js, React Flow, Tailwind CSS, shadcn/ui.

## Not used

- The `landing/` folder in the working tree is an offline mirror of a third-party company's website, and `designs/` holds reference images from other companies. **Neither is part of CORVEN, neither is committed, and none of their text, images, fonts, scripts or branding appears in the CORVEN landing page.** They were used only as inspiration for layout ideas.
- The landing page follows a design-language brief (spacing, type hierarchy, component shapes). It reproduces none of the reference's wordmark, copy, imagery or layout and does not imply any connection to it.

## Maintaining this document

Update it when AI is used for a new area, when a library is added, and before submission. Confirm the **owner to confirm** items and the license column against each package's actual license file.
