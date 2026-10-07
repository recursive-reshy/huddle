# Fixture: Huddle PM discovery chat

Source: the "MT PM" chat (turns 0 to 10 of 82). This is the discovery part only. Turn 11 onwards is scope and architecture work, with pasted SA responses, so it is left out.

`H:` is Naresh (author `human`). `PM:` is the PM (author `pm`). kind `chat`.

Used by:
- `evals/cases/pm/pm_discovery_reply/10-huddle-replay.md` (the `H:` turns only, replayed in order)
- `evals/cases/pm/pm_draft_brief/01-huddle-replay.md` (the whole thread, both sides)

Note: the first `H:` message is a role-setup instruction, not a discovery answer. In the app the role prompt does that job, so trim it if it gets in the way of the replay.

Everything above the `## Input` heading is ignored by the eval harness.

## Input
H: Think of yourself as the person engaging with a client (product manager or business analyst). 
First, understand my needs by asking targeted questions. 

Second, once the problem is clear, map out the scope, high-level architecture/technical constraints, and success metrics. 
For the second point make sure, you get me to direct questions to this projects architect. I will be the interface to help you guys have your discussion.

Third, and only then, synthesize this into the final deliverables (PRD, User Stories, and a phased rollout plan)

Ask me questions one or two at a time to narrow down the scope, rather than overwhelming me with a massive questionnaire.

PM: Sounds good. I'll work in three phases: discovery with you, then scope and architecture (where I'll draft questions for you to take to the architect and relay back), then the PRD, user stories, and rollout plan.

To start with the basics:

1. **What's the problem you're trying to solve, and who has it?** Describe it in plain terms, e.g. "site managers lose track of X" or "our clients can't do Y without calling us."
2. **What triggered this now?** A client request, an internal pain point, a market opportunity, or something else?

H: 1. I use claude chats to act my "team". Like I have a chat for a PM, SA, DBA, etc. It becomes hard to manage the communication between the chats.
2. It was more of a pain point, the back and forth of me pasting in responses

PM: So you're the human message bus between specialist chats, copying outputs from one role to another, which is slow and makes it easy to lose context. (Fittingly, you'll be doing exactly that between me and the architect.)

Two questions to sharpen this:

1. **How much do you want to stay in the loop?** Picture a handoff, like the PM finishing a spec that the SA needs to review. Should the roles talk to each other automatically while you watch and step in when needed? Should nothing move between roles until you approve it? Or something in between, like automatic for routine handoffs and approval for decisions?

2. **Who will use this?** Just you for your own projects, or do you see other people (teammates, clients, other solo developers) using it too? That answer changes things like accounts, hosting, and how polished it needs to be.

H: 1. I think at a major handoff i want to be in the loop. but after that if the sa (or any other actor) needs clarifying questions the that will be back and forth between the agents
2. Just for myself

PM: That's a clear model: you approve major handoffs, and the agents resolve clarifications among themselves. We'll need to define what counts as a "major handoff," and whether you can see the agent-to-agent clarifications as they happen or just a summary afterward. I'll come back to that.

Next two questions:

1. **What does a typical run look like today?** Walk me through the roles in order and what each one hands to the next. For example: PM writes a PRD, the SA produces an architecture doc, the DBA designs a schema, and so on. Is it mostly a fixed pipeline, or does the order change per project?

2. **Where do you want this to run?** Options include staying inside claude.ai and just making the handoffs smoother, building your own small app on the Claude API (which means paying per use rather than through your subscription), or running it from a terminal or IDE setup like Claude Code. Do you have a preference, or a budget ceiling that rules any of these out?

H: 1. take you for example, you talk to me until you understand the requirements. now youll need to hand of these requirements to the SA before you can create your PRD. That handoff I would need to vet
2. I would like to build the agentic software. cause I am learning how to build agents =)

PM: That example helps, and it reframes the flow. Handoffs aren't only "finished artifact goes downstream." Here the PM hands a draft requirements brief to the SA before the PRD exists, you vet that handoff, and then the SA and PM can go back and forth on clarifications until the SA returns something the PM needs to finish the PRD. So the core pattern is: **agent drafts → you approve the handoff → agents clarify with each other → result flows back**.

And since learning agent-building is a goal in itself, that shapes how we scope it. Two questions on that:

1. **How close to the metal do you want to build?** You could use the raw Claude API and write the orchestration loop, tool calls, and state handling yourself, which teaches the most but means more plumbing. Or you could use a framework like the Claude Agent SDK that handles the loop so you focus on roles and handoffs. Related: should this build on your agentic-patterns repo, since orchestrator-workers and similar patterns seem directly relevant here?

2. **How do you want to interact with it?** A web UI where you see each agent's thread, a CLI, or something else? And during agent-to-agent clarifications, do you want to watch the exchange live, or just get a summary when they're done?

H: 1. Lets try to stay agnostic, this sounds technical, lets leave this to the SA
2. Web ui

PM: Fair call. I'll put framework choice, and whether to reuse your patterns repo, on the list for the SA.

Two more questions, and then I think we're ready for scope:

1. **During agent-to-agent clarifications, what do you want to see in the web UI?** You didn't pick one earlier. Options: a live feed where you can jump in mid-conversation, a summary once they've settled things, or both (summary by default, full transcript on demand).

2. **What does success look like for the first version?** For example: "I can run one project from requirements to PRD without copy-pasting once," or "the PM, SA and DBA roles work end to end." Also, which roles must be in v1, and which can wait?

H: 1. probably the summary, I think a summary once done
2. I can run one project from requirements to PRD, TRD, without copy-pasting once,
