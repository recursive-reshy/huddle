import pytest
from pydantic import TypeAdapter, ValidationError

from agents.contract.errors import ErrorCode
from agents.contract.lines import DeltaLine, ErrorLine, ResultLine, StepLine, UsageLine
from agents.contract.outputs import ChatReplyOutput

prompt_hash = "a" * 64

@pytest.mark.parametrize(
    "line",
    [
        DeltaLine( type = "delta", text = "Hello" ),
        UsageLine(
            type = "usage",
            model = "claude-sonnet-5-5",
            input_tokens = 10,
            output_tokens = 20,
            cache_read_tokens = 30,
            cache_write_tokens = 40
        ),
        ResultLine(
            type = "result",
            prompt_hash = prompt_hash,
            output = ChatReplyOutput( output_type = "chat_reply", content = "Hi there" )
        ),
        ErrorLine(
            type = "error",
            code = ErrorCode.UNKNOWN_KIND,
            message = "No such kind",
            retryable = False
        )
    ]
)
def test_line_round_trips_through_json( line: StepLine ) -> None:
    adapter: TypeAdapter[ StepLine ] = TypeAdapter( StepLine )

    parsed = adapter.validate_json( adapter.dump_json( line ) )

    assert type( parsed ) is type( line )
    assert parsed == line

@pytest.mark.parametrize( "field", [ "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens" ] )
def test_usage_line_with_negative_token_count_raises( field: str ) -> None:
    payload: dict[ str, object ] = {
        "type": "usage",
        "model": "claude-sonnet-5-5",
        "input_tokens": 1,
        "output_tokens": 1,
        "cache_read_tokens": 1,
        "cache_write_tokens": 1
    }

    with pytest.raises( ValidationError ):
        UsageLine.model_validate( { **payload, field: -1 } )

def test_result_line_parses_chat_reply_output() -> None:
    line = ResultLine.model_validate(
        {
            "type": "result",
            "prompt_hash": prompt_hash,
            "output": { "output_type": "chat_reply", "content": "Hi there" }
        }
    )

    assert isinstance( line.output, ChatReplyOutput )
    assert line.output.content == "Hi there"

@pytest.mark.parametrize(
    "bad_hash",
    [ "a" * 63, "a" * 65, "A" * 64, "g" * 64, "" ]
)
def test_result_line_with_malformed_prompt_hash_raises( bad_hash: str ) -> None:
    with pytest.raises( ValidationError ):
        ResultLine.model_validate(
            {
                "type": "result",
                "prompt_hash": bad_hash,
                "output": { "output_type": "chat_reply", "content": "Hi there" }
            }
        )

def test_result_line_with_unknown_output_type_raises() -> None:
    with pytest.raises( ValidationError ):
        ResultLine.model_validate(
            {
                "type": "result",
                "prompt_hash": prompt_hash,
                "output": { "output_type": "haiku", "content": "Hi there" }
            }
        )

@pytest.mark.parametrize(
    "payload",
    [
        { "type": "error", "code": "made_up", "message": "Nope", "retryable": False },
        { "type": "error", "code": "unknown_kind", "message": "Nope" }
    ]
)
def test_error_line_with_unknown_code_or_missing_retryable_raises( payload: dict[ str, object ] ) -> None:
    with pytest.raises( ValidationError ):
        ErrorLine.model_validate( payload )

@pytest.mark.parametrize(
    "payload",
    [
        { "type": "delta", "text": "" },
        { "type": "result", "prompt_hash": prompt_hash, "output": { "output_type": "chat_reply", "content": "" } }
    ]
)
def test_empty_text_raises( payload: dict[ str, object ] ) -> None:
    with pytest.raises( ValidationError ):
        TypeAdapter( StepLine ).validate_python( payload )

@pytest.mark.parametrize(
    "payload",
    [
        { "type": "delta", "text": "Hello", "unexpected": True },
        {
            "type": "usage",
            "model": "claude-sonnet-5-5",
            "input_tokens": 1,
            "output_tokens": 1,
            "cache_read_tokens": 1,
            "cache_write_tokens": 1,
            "unexpected": True
        },
        {
            "type": "result",
            "prompt_hash": prompt_hash,
            "output": { "output_type": "chat_reply", "content": "Hi" },
            "unexpected": True
        },
        {
            "type": "result",
            "prompt_hash": prompt_hash,
            "output": { "output_type": "chat_reply", "content": "Hi", "unexpected": True }
        },
        { "type": "error", "code": "unknown_kind", "message": "Nope", "retryable": False, "unexpected": True }
    ]
)
def test_extra_field_raises( payload: dict[ str, object ] ) -> None:
    with pytest.raises( ValidationError ):
        TypeAdapter( StepLine ).validate_python( payload )
