from typing import Any, cast

import pytest

from agents.contract.context import (
    ArtifactKind,
    Decision,
    MessageKind,
    ProjectRef,
    Question,
    QuestionStatus,
    Section,
    StepContext,
    Task,
    TaskMode,
    ThreadMessage
)
from agents.runtime.context import (
    EARLIER_MESSAGES_NOTICE,
    TurnsOutcome,
    TurnsResult,
    build_source_turn,
    build_system,
    build_turns
)

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

def make_context(
    artifacts: list[ Section ] | None = None,
    decisions: list[ Decision ] | None = None,
    draft: list[ Section ] | None = None,
    questions: list[ Question ] | None = None,
    messages: list[ ThreadMessage ] | None = None,
    notes: str = ""
) -> StepContext:
    return StepContext(
        project = ProjectRef( id = "p-1", name = "Habit Tracker" ),
        artifacts = artifacts or [],
        decisions = decisions or [],
        draft = draft or [],
        questions = questions or [],
        messages = messages or [],
        task = Task( notes = notes, mode = TaskMode.NORMAL, may_ask = False )
    )

def source_blocks( result: TurnsResult ) -> list[ dict[ str, Any ] ]:
    return cast( list[ dict[ str, Any ] ], result.turns[ 0 ][ "content" ] )

def block_texts( result: TurnsResult ) -> list[ str ]:
    return [ block[ "text" ] for block in source_blocks( result ) ]

def test_context_with_only_messages_builds_one_user_turn_with_one_messages_block() -> None:
    result = build_source_turn(
        make_context( messages = [ make_message( "human", "First" ), make_message( "pm", "Second" ) ] )
    )

    assert result.outcome == TurnsOutcome.BUILT
    assert result.reason is None
    assert result.turns == [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "<messages>\n"
                        "<message author=\"human\" kind=\"chat\">\nFirst\n</message>\n\n"
                        "<message author=\"pm\" kind=\"chat\">\nSecond\n</message>\n"
                        "</messages>"
                    )
                }
            ]
        }
    ]
    assert "cache_control" not in str( result.turns )

def make_section( section_key: str, kind: ArtifactKind = ArtifactKind.BRIEF, version: int = 1 ) -> Section:
    return Section(
        artifact_id = "a-1",
        version = version,
        kind = kind,
        section_key = section_key,
        title = f"Title {section_key}",
        content = f"Content {section_key}"
    )

def make_decision( id: str ) -> Decision:
    return Decision( id = id, title = f"Title {id}", decision = f"Decision {id}", rationale = f"Rationale {id}" )

cache_marker = { "type": "ephemeral" }

def test_artifacts_and_decisions_form_the_first_block_with_cache_control_and_the_last_block_has_none() -> None:
    result = build_source_turn(
        make_context(
            artifacts = [ make_section( "goals" ), make_section( "scope", kind = ArtifactKind.PRD, version = 2 ) ],
            decisions = [ make_decision( "d-1" ) ],
            messages = [ make_message( "human", "Hi" ) ]
        )
    )

    blocks = source_blocks( result )
    assert len( blocks ) == 2
    assert blocks[ 0 ][ "cache_control" ] == cache_marker
    assert "cache_control" not in blocks[ 1 ]
    assert blocks[ 0 ][ "text" ] == (
        "<approved_artifacts>\n"
        "<section artifact=\"brief\" key=\"goals\" version=\"1\">\n# Title goals\nContent goals\n</section>\n\n"
        "<section artifact=\"prd\" key=\"scope\" version=\"2\">\n# Title scope\nContent scope\n</section>\n"
        "</approved_artifacts>\n\n"
        "<decisions>\n"
        "<decision id=\"d-1\">\nTitle d-1\nDecision: Decision d-1\nRationale: Rationale d-1\n</decision>\n"
        "</decisions>"
    )

def test_artifacts_without_decisions_make_a_stable_block_with_no_decisions_tag() -> None:
    result = build_source_turn(
        make_context( artifacts = [ make_section( "goals" ) ], messages = [ make_message( "human", "Hi" ) ] )
    )

    blocks = source_blocks( result )
    assert blocks[ 0 ][ "cache_control" ] == cache_marker
    assert blocks[ 0 ][ "text" ].startswith( "<approved_artifacts>\n" )
    assert blocks[ 0 ][ "text" ].endswith( "</approved_artifacts>" )
    assert "<decisions>" not in blocks[ 0 ][ "text" ]

def test_draft_block_with_cache_control_sits_between_the_stable_and_volatile_blocks() -> None:
    result = build_source_turn(
        make_context(
            artifacts = [ make_section( "goals" ) ],
            decisions = [ make_decision( "d-1" ) ],
            draft = [ make_section( "scope", kind = ArtifactKind.PRD ) ],
            messages = [ make_message( "human", "Hi" ) ]
        )
    )

    blocks = source_blocks( result )
    assert len( blocks ) == 3
    assert blocks[ 0 ][ "text" ].startswith( "<approved_artifacts>" )
    assert blocks[ 1 ][ "text" ] == (
        "<draft>\n"
        "<section artifact=\"prd\" key=\"scope\" version=\"1\">\n# Title scope\nContent scope\n</section>\n"
        "</draft>"
    )
    assert blocks[ 1 ][ "cache_control" ] == cache_marker
    assert blocks[ 2 ][ "text" ].startswith( "<messages>" )
    assert str( result.turns ).count( "cache_control" ) == 2

def make_question( id: str, status: QuestionStatus, answer: str | None, answered_by: str | None ) -> Question:
    return Question(
        id = id,
        thread_id = "t-1",
        round = 1,
        from_agent = "sa",
        to_agent = "pm",
        question = f"Question {id}?",
        status = status,
        answer = answer,
        answered_by = answered_by
    )

def test_questions_show_an_answer_line_only_when_answered_and_notes_appear_when_not_empty() -> None:
    result = build_source_turn(
        make_context(
            questions = [
                make_question( "q-1", QuestionStatus.ANSWERED, "Yes", "pm" ),
                make_question( "q-2", QuestionStatus.OPEN, None, None )
            ],
            messages = [ make_message( "human", "Hi" ) ],
            notes = "Keep it short"
        )
    )

    assert block_texts( result ) == [
        "<questions>\n"
        "<question id=\"q-1\" round=\"1\" from=\"sa\" to=\"pm\" status=\"answered\">\nQ: Question q-1?\nA (pm): Yes\n</question>\n\n"
        "<question id=\"q-2\" round=\"1\" from=\"sa\" to=\"pm\" status=\"open\">\nQ: Question q-2?\n</question>\n"
        "</questions>\n\n"
        "<messages>\n<message author=\"human\" kind=\"chat\">\nHi\n</message>\n</messages>\n\n"
        "<notes>\nKeep it short\n</notes>"
    ]

def test_empty_notes_produce_no_notes_tag() -> None:
    result = build_source_turn( make_context( messages = [ make_message( "human", "Hi" ) ], notes = "" ) )

    assert "<notes>" not in block_texts( result )[ 0 ]

def test_context_with_no_questions_messages_or_notes_fails_with_a_reason() -> None:
    result = build_source_turn( make_context( artifacts = [ make_section( "goals" ) ], notes = "" ) )

    assert result.outcome == TurnsOutcome.FAILED
    assert result.turns == []
    assert result.reason is not None
    assert "nothing to draft from" in result.reason.lower()

def test_message_content_appears_byte_for_byte_inside_its_message_element() -> None:
    content = "# Heading\n\n- **bold** item\n```py\nx = 1\n```\n\nNaresh’s café — “quotes”"

    result = build_source_turn( make_context( messages = [ make_message( "human", content ) ] ) )

    expected_element = f"<message author=\"human\" kind=\"chat\">\n{content}\n</message>"
    assert expected_element.encode() in block_texts( result )[ 0 ].encode()
