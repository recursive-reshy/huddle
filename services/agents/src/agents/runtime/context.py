from enum import StrEnum
from typing import Literal

from anthropic.types import MessageParam, TextBlockParam
from pydantic import BaseModel, SkipValidation

from agents.contract.context import ProjectRef, Section, StepContext, ThreadMessage

EARLIER_MESSAGES_NOTICE = "[Earlier messages are not shown.]"

class TurnsOutcome( StrEnum ):
    BUILT = "built"
    FAILED = "failed"

class TurnsResult( BaseModel ):
    outcome: TurnsOutcome
    turns: SkipValidation[ list[ MessageParam ] ] = []
    reason: str | None = None

def build_turns( messages: list[ ThreadMessage ] ) -> TurnsResult:
    merged: list[ tuple[ Literal[ "user", "assistant" ], str ] ] = []
    for message in messages:
        role: Literal[ "user", "assistant" ] = "user" if message.author == "human" else "assistant"
        if merged and merged[ -1 ][ 0 ] == role:
            merged[ -1 ] = ( role, f"{merged[ -1 ][ 1 ]}\n\n{message.content}" )
        else:
            merged.append( ( role, message.content ) )

    if not merged:
        return TurnsResult( outcome = TurnsOutcome.FAILED, reason = "Message window has no turns" )

    if merged[ -1 ][ 0 ] != "user":
        return TurnsResult(
            outcome = TurnsOutcome.FAILED,
            reason = f"Last turn must be user, but it is {merged[ -1 ][ 0 ]}"
        )

    if merged[ 0 ][ 0 ] == "assistant":
        merged.insert( 0, ( "user", EARLIER_MESSAGES_NOTICE ) )

    turns: list[ MessageParam ] = []
    for index, ( role, text ) in enumerate( merged ):
        block: TextBlockParam = { "type": "text", "text": text }
        if index == len( merged ) - 1:
            block[ "cache_control" ] = { "type": "ephemeral" }

        turns.append( { "role": role, "content": [ block ] } )

    return TurnsResult( outcome = TurnsOutcome.BUILT, turns = turns )

def build_system( prompt_text: str, project: ProjectRef ) -> list[ TextBlockParam ]:
    return [
        { "type": "text", "text": prompt_text },
        { "type": "text", "text": f"Project: {project.name}" }
    ]

def render_section( section: Section ) -> str:
    return (
        f"<section artifact=\"{section.kind}\" key=\"{section.section_key}\" version=\"{section.version}\">\n"
        f"# {section.title}\n{section.content}\n"
        "</section>"
    )

def build_source_turn( context: StepContext ) -> TurnsResult:
    blocks: list[ TextBlockParam ] = []

    stable_parts: list[ str ] = []
    if context.artifacts:
        section_elements = [ render_section( section ) for section in context.artifacts ]
        stable_parts.append( "<approved_artifacts>\n" + "\n\n".join( section_elements ) + "\n</approved_artifacts>" )

    if context.decisions:
        decision_elements = [
            (
                f"<decision id=\"{decision.id}\">\n"
                f"{decision.title}\nDecision: {decision.decision}\nRationale: {decision.rationale}\n"
                "</decision>"
            )
            for decision in context.decisions
        ]
        stable_parts.append( "<decisions>\n" + "\n\n".join( decision_elements ) + "\n</decisions>" )

    if stable_parts:
        blocks.append(
            { "type": "text", "text": "\n\n".join( stable_parts ), "cache_control": { "type": "ephemeral" } }
        )

    if context.draft:
        draft_elements = [ render_section( section ) for section in context.draft ]
        blocks.append(
            {
                "type": "text",
                "text": "<draft>\n" + "\n\n".join( draft_elements ) + "\n</draft>",
                "cache_control": { "type": "ephemeral" }
            }
        )

    volatile_parts: list[ str ] = []
    if context.questions:
        question_elements: list[ str ] = []
        for question in context.questions:
            question_element = (
                f"<question id=\"{question.id}\" round=\"{question.round}\" "
                f"from=\"{question.from_agent}\" to=\"{question.to_agent}\" status=\"{question.status}\">\n"
                f"Q: {question.question}\n"
            )
            if question.answer is not None:
                question_element += f"A ({question.answered_by}): {question.answer}\n"

            question_elements.append( question_element + "</question>" )

        volatile_parts.append( "<questions>\n" + "\n\n".join( question_elements ) + "\n</questions>" )

    if context.messages:
        message_elements = [
            f"<message author=\"{message.author}\" kind=\"{message.kind}\">\n{message.content}\n</message>"
            for message in context.messages
        ]
        volatile_parts.append( "<messages>\n" + "\n\n".join( message_elements ) + "\n</messages>" )

    if context.task.notes != "":
        volatile_parts.append( f"<notes>\n{context.task.notes}\n</notes>" )

    if not volatile_parts:
        return TurnsResult(
            outcome = TurnsOutcome.FAILED,
            reason = "Context has no questions, messages or notes: nothing to draft from"
        )

    blocks.append( { "type": "text", "text": "\n\n".join( volatile_parts ) } )

    return TurnsResult( outcome = TurnsOutcome.BUILT, turns = [ { "role": "user", "content": blocks } ] )
