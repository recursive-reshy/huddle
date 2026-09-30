import pytest

from agents.contract.context import MessageKind, ProjectRef, ThreadMessage
from agents.runtime.context import EARLIER_MESSAGES_NOTICE, TurnsOutcome, build_system, build_turns

def make_message( author: str, content: str ) -> ThreadMessage:
    return ThreadMessage( author = author, kind = MessageKind.CHAT, content = content )

def test_opening_agent_message_gets_the_earlier_messages_notice() -> None:
    result = build_turns( [ make_message( "pm", "Welcome" ), make_message( "human", "Hi" ) ] )

    assert result.reason is None
    assert result.turns == [
        { "role": "user", "content": [ { "type": "text", "text": EARLIER_MESSAGES_NOTICE } ] },
        { "role": "assistant", "content": [ { "type": "text", "text": "Welcome" } ] },
        {
            "role": "user",
            "content": [ { "type": "text", "text": "Hi", "cache_control": { "type": "ephemeral" } } ]
        }
    ]

def test_consecutive_agent_messages_merge_into_one_turn() -> None:
    result = build_turns(
        [
            make_message( "human", "Hi" ),
            make_message( "pm", "First" ),
            make_message( "pm", "Second" ),
            make_message( "human", "Thanks" )
        ]
    )

    assert result.turns == [
        { "role": "user", "content": [ { "type": "text", "text": "Hi" } ] },
        { "role": "assistant", "content": [ { "type": "text", "text": "First\n\nSecond" } ] },
        {
            "role": "user",
            "content": [ { "type": "text", "text": "Thanks", "cache_control": { "type": "ephemeral" } } ]
        }
    ]

def test_checkpoint_summary_is_kept_word_for_word_and_nothing_is_duplicated() -> None:
    summary = (
        "Checkpoint summary: Naresh wants a habit tracker for teams.  Open points: pricing,\n"
        "  onboarding flow, and whether to support offline use. Decided: web first."
    )
    messages = [
        ThreadMessage( author = "pm", kind = MessageKind.SUMMARY, content = summary ),
        make_message( "human", "Let's talk pricing" ),
        make_message( "pm", "Free tier plus paid?" ),
        make_message( "human", "Yes" )
    ]

    result = build_turns( messages )

    assert result.turns[ 0 ] == { "role": "user", "content": [ { "type": "text", "text": EARLIER_MESSAGES_NOTICE } ] }
    assert result.turns[ 1 ] == { "role": "assistant", "content": [ { "type": "text", "text": summary } ] }
    serialized = str( result.turns )
    for message in messages:
        assert serialized.count( repr( message.content )[ 1: -1 ] ) == 1

@pytest.mark.parametrize(
    ( "messages", "expected_reason" ),
    [
        ( [ make_message( "human", "Hi" ), make_message( "pm", "Hello" ) ], "assistant" ),
        ( [], "no turns" )
    ]
)
def test_window_that_does_not_end_on_a_user_turn_fails_with_a_reason(
    messages: list[ ThreadMessage ],
    expected_reason: str
) -> None:
    result = build_turns( messages )

    assert result.outcome == TurnsOutcome.FAILED
    assert result.turns == []
    assert result.reason is not None
    assert expected_reason in result.reason

def test_consecutive_human_messages_merge_into_one_user_turn() -> None:
    result = build_turns(
        [
            make_message( "human", "One" ),
            make_message( "human", "Two" ),
            make_message( "pm", "Reply" ),
            make_message( "human", "Three" )
        ]
    )

    assert [ turn[ "role" ] for turn in result.turns ] == [ "user", "assistant", "user" ]
    assert result.turns[ 0 ] == { "role": "user", "content": [ { "type": "text", "text": "One\n\nTwo" } ] }

def test_sa_author_maps_to_assistant() -> None:
    result = build_turns( [ make_message( "human", "Hi" ), make_message( "sa", "Hello" ), make_message( "human", "Ok" ) ] )

    assert result.turns[ 1 ] == { "role": "assistant", "content": [ { "type": "text", "text": "Hello" } ] }

@pytest.mark.parametrize(
    "messages",
    [
        [ make_message( "human", "Hi" ) ],
        [ make_message( "pm", "Hello" ), make_message( "human", "Hi" ) ],
        [ make_message( "human", "A" ), make_message( "sa", "B" ), make_message( "human", "C" ), make_message( "human", "D" ) ]
    ]
)
def test_exactly_one_cache_control_sits_on_the_last_block_of_the_last_turn( messages: list[ ThreadMessage ] ) -> None:
    result = build_turns( messages )

    cache_marker = "'cache_control': {'type': 'ephemeral'}"
    assert str( result.turns ).count( "cache_control" ) == 1
    assert str( result.turns[ -1 ] ).endswith( f"{cache_marker}}}]}}" )

def test_system_blocks_carry_the_prompt_verbatim_and_the_project_name_without_cache_control() -> None:
    prompt_text = "\n\n  # Role\n\nYou are the **PM**.  \n- Be brief\n\n\t "

    blocks = build_system( prompt_text, ProjectRef( id = "p-1", name = "Habit Tracker" ) )

    assert blocks == [
        { "type": "text", "text": prompt_text },
        { "type": "text", "text": "Project: Habit Tracker" }
    ]
    assert blocks[ 0 ][ "text" ].encode() == prompt_text.encode()
    assert all( "cache_control" not in block for block in blocks )
