from collections.abc import AsyncIterator

from anthropic import AsyncAnthropic
from anthropic.types import MessageParam, TextBlockParam
from pydantic import BaseModel, ValidationError

from agents.contract.lines import StepLine
from agents.contract.outputs import MAX_REVIEW_QUESTIONS, ReviewOutput, ReviewQuestion
from agents.runtime.draft import ToolSpec, ToolValidation, stream_tool_call
from agents.runtime.prompts import Prompt

MISSING_REVIEW_CALL_NOTICE = "Call submit_review with the notes and the questions. Reply with the tool call only."

class ReviewToolInput( BaseModel ):
    notes: str
    questions: list[ ReviewQuestion ]

def validate_review( tool_input: object ) -> ToolValidation:
    try:
        parsed = ReviewToolInput.model_validate( tool_input )
    except ValidationError as exception:
        return ToolValidation(
            errors = [
                f"invalid review at {'.'.join( str( part ) for part in error[ 'loc' ] )}: {error[ 'msg' ]}"
                for error in exception.errors()
            ]
        )

    errors: list[ str ] = []
    if parsed.notes.strip() == "":
        errors.append( "notes is empty" )

    if len( parsed.questions ) > MAX_REVIEW_QUESTIONS:
        errors.append( f"too many questions: {len( parsed.questions )} > {MAX_REVIEW_QUESTIONS}" )

    for index, question in enumerate( parsed.questions ):
        if question.question.strip() == "":
            errors.append( f"questions[{index}].question is empty" )

    if errors:
        return ToolValidation( errors = errors )

    return ToolValidation(
        output = ReviewOutput( output_type = "review", notes = parsed.notes, questions = parsed.questions )
    )

async def stream_review(
    client: AsyncAnthropic,
    model: str,
    prompt: Prompt,
    system: list[ TextBlockParam ],
    turns: list[ MessageParam ],
    heartbeat_seconds: float,
    first_tool_error: str | None = None
) -> AsyncIterator[ StepLine ]:
    spec = ToolSpec(
        name = "submit_review",
        description = "Submit the review notes and the questions for the PM.",
        input_schema = ReviewToolInput.model_json_schema(),
        action = "review",
        missing_tool_notice = MISSING_REVIEW_CALL_NOTICE,
        validate_input = validate_review
    )

    async for line in stream_tool_call(
        client,
        model,
        prompt,
        system,
        turns,
        spec,
        heartbeat_seconds,
        first_tool_error
    ):
        yield line
