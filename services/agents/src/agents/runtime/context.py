from enum import StrEnum
from typing import Literal

from anthropic.types import MessageParam, TextBlockParam
from pydantic import BaseModel, SkipValidation

from agents.contract.context import ProjectRef, ThreadMessage

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
