import pytest

from agents.contract.outputs import ChatReplyOutput, DraftArtifactOutput, DraftSection, ReviewOutput, ReviewQuestion
from agents.roles.registry import RegistryEntry, registry
from evals.checks import CheckOutcome, evaluate_check, parse_check

CHAT_ENTRY = registry[ ( "pm", "pm_discovery_reply" ) ]
DRAFT_ENTRY = registry[ ( "pm", "pm_draft_brief" ) ]

def chat( text: str ) -> ChatReplyOutput:
    return ChatReplyOutput( output_type = "chat_reply", content = text )

def draft( contents: dict[ str, str ] ) -> DraftArtifactOutput:
    return DraftArtifactOutput(
        output_type = "draft_artifact",
        draft = [ DraftSection( section_key = key, title = key.title(), content = content ) for key, content in contents.items() ]
    )

def run_chat( check_text: str, reply: str, calls: int = 1 ) -> tuple[ CheckOutcome, str ]:
    result = evaluate_check( parse_check( check_text, CHAT_ENTRY ), chat( reply ), calls )

    return result.outcome, result.reason

def run_draft( check_text: str, contents: dict[ str, str ], calls: int = 1 ) -> tuple[ CheckOutcome, str ]:
    result = evaluate_check( parse_check( check_text, DRAFT_ENTRY ), draft( contents ), calls )

    return result.outcome, result.reason

def test_chat_checks_pass_and_fail_with_reasons_and_ignore_case() -> None:
    long_reply = " ".join( [ "word" ] * 214 )

    assert run_chat( "max_words: 200", long_reply ) == ( CheckOutcome.FAILED, "max_words: 214 > 200" )
    assert run_chat( "max_words: 214", long_reply ) == ( CheckOutcome.PASSED, "max_words: 214 <= 214" )
    assert run_chat( "max_questions: 1", "Why? Who?" ) == ( CheckOutcome.FAILED, "max_questions: 2 > 1" )
    assert run_chat( "max_questions: 2", "Why? Who?" ) == ( CheckOutcome.PASSED, "max_questions: 2 <= 2" )
    assert run_chat( "contains: INVOICES", "Tell me about your invoices." ) == ( CheckOutcome.PASSED, "contains: 'INVOICES' found" )
    assert run_chat( "contains: budget", "Tell me about your invoices." ) == ( CheckOutcome.FAILED, "contains: 'budget' not found" )
    assert run_chat( "not_contains: Budget", "What is the budget?" ) == ( CheckOutcome.FAILED, "not_contains: 'Budget' found" )
    assert run_chat( "not_contains: React", "Tell me more." ) == ( CheckOutcome.PASSED, "not_contains: 'React' not found" )

def test_draft_checks_pass_and_fail_with_reasons() -> None:
    contents = { "summary": "A tool for invoices.", "scope_later": "Reports and exports.", "goals": "  Ship it  " }

    assert run_draft( "section summary contains: INVOICES", contents ) == ( CheckOutcome.PASSED, "section summary contains: 'INVOICES' found" )
    assert run_draft( "section summary contains: reports", contents ) == ( CheckOutcome.FAILED, "section summary contains: 'reports' not found" )
    assert run_draft( "section scope_later not_contains: invoices", contents ) == (
        CheckOutcome.PASSED,
        "section scope_later not_contains: 'invoices' not found"
    )
    assert run_draft( "section scope_later not_contains: EXPORTS", contents ) == (
        CheckOutcome.FAILED,
        "section scope_later not_contains: 'EXPORTS' found"
    )
    assert run_draft( "section goals equals: Ship it", contents ) == ( CheckOutcome.PASSED, "section goals equals: content matches" )
    assert run_draft( "section goals equals: ship it", contents ) == (
        CheckOutcome.FAILED,
        "section goals equals: content differs from the expected text (7 characters vs 7, case-sensitive)"
    )
    assert run_draft( "section problem contains: x", contents ) == (
        CheckOutcome.FAILED,
        "section problem contains: section is missing from the draft"
    )
    assert run_draft( "contains: exports", contents ) == ( CheckOutcome.PASSED, "contains: 'exports' found" )
    assert run_draft( "not_contains: exports", contents ) == ( CheckOutcome.FAILED, "not_contains: 'exports' found" )
    assert run_draft( "max_words: 10", contents ) == ( CheckOutcome.PASSED, "max_words: 9 <= 10" )
    assert run_draft( "max_words: 8", contents ) == ( CheckOutcome.FAILED, "max_words: 9 > 8" )

def test_calls_check_compares_the_number_of_claude_calls() -> None:
    assert run_chat( "calls: 2", "Hello.", calls = 1 ) == ( CheckOutcome.FAILED, "calls: 1 != 2" )
    assert run_chat( "calls: 2", "Hello.", calls = 2 ) == ( CheckOutcome.PASSED, "calls: 2 == 2" )

REVIEW_ENTRY = registry[ ( "sa", "sa_review_brief" ) ]

def review( notes: str, questions: list[ str ] ) -> ReviewOutput:
    return ReviewOutput(
        output_type = "review",
        notes = notes,
        questions = [ ReviewQuestion( question = question ) for question in questions ]
    )

def run_review( check_text: str, output: ReviewOutput ) -> tuple[ CheckOutcome, str ]:
    result = evaluate_check( parse_check( check_text, REVIEW_ENTRY ), output, 1 )

    return result.outcome, result.reason

def test_review_notes_checks_pass_and_fail_with_reasons_and_ignore_case() -> None:
    output = review( "Nothing blocks the PRD. Hosting waits for the TRD.", [] )

    assert run_review( "notes contains: HOSTING", output ) == ( CheckOutcome.PASSED, "notes contains: 'HOSTING' found" )
    assert run_review( "notes contains: payments", output ) == ( CheckOutcome.FAILED, "notes contains: 'payments' not found" )
    assert run_review( "notes not_contains: mysql", output ) == ( CheckOutcome.PASSED, "notes not_contains: 'mysql' not found" )
    assert run_review( "notes not_contains: prd", output ) == ( CheckOutcome.FAILED, "notes not_contains: 'prd' found" )

def test_review_notes_checks_do_not_look_at_question_text() -> None:
    output = review( "Clear.", [ "Which payments provider?" ] )

    assert run_review( "notes contains: payments", output )[ 0 ] == CheckOutcome.FAILED
    assert run_review( "notes not_contains: payments", output )[ 0 ] == CheckOutcome.PASSED

def test_review_question_count_checks_pass_and_fail_with_reasons() -> None:
    three = review( "Notes.", [ "One?", "Two?", "Three?" ] )

    assert run_review( "questions max: 3", three ) == ( CheckOutcome.PASSED, "questions max: 3 <= 3" )
    assert run_review( "questions max: 0", three ) == ( CheckOutcome.FAILED, "questions max: 3 > 0" )
    assert run_review( "questions min: 3", three ) == ( CheckOutcome.PASSED, "questions min: 3 >= 3" )
    assert run_review( "questions min: 4", three ) == ( CheckOutcome.FAILED, "questions min: 3 < 4" )

def test_review_question_text_checks_pass_and_fail_with_reasons_and_ignore_case() -> None:
    output = review( "Notes with budget.", [ "What is the monthly BUDGET?", "How much downtime is fine?" ] )

    assert run_review( "any question contains: budget", output ) == (
        CheckOutcome.PASSED,
        "any question contains: 'budget' found"
    )
    assert run_review( "any question contains: hosting", output ) == (
        CheckOutcome.FAILED,
        "any question contains: 'hosting' not found"
    )
    assert run_review( "no question contains: hosting", output ) == (
        CheckOutcome.PASSED,
        "no question contains: 'hosting' not found"
    )
    assert run_review( "no question contains: downtime", output ) == (
        CheckOutcome.FAILED,
        "no question contains: 'downtime' found"
    )

def test_question_text_checks_look_at_questions_only_and_an_empty_list_has_none() -> None:
    output = review( "Mentions budget in the notes.", [] )

    assert run_review( "any question contains: budget", output )[ 0 ] == CheckOutcome.FAILED
    assert run_review( "no question contains: budget", output )[ 0 ] == CheckOutcome.PASSED

@pytest.mark.parametrize(
    "check_text",
    [
        "notes contains: x",
        "notes not_contains: x",
        "questions max: 3",
        "questions min: 1",
        "any question contains: x",
        "no question contains: x"
    ]
)
@pytest.mark.parametrize( "entry", [ CHAT_ENTRY, DRAFT_ENTRY ] )
def test_review_checks_on_a_non_review_kind_are_a_parse_error( check_text: str, entry: RegistryEntry ) -> None:
    with pytest.raises( ValueError, match = "review" ):
        parse_check( check_text, entry )

@pytest.mark.parametrize(
    ( "check_text", "expected_message" ),
    [
        ( "questions max: many", "whole number" ),
        ( "questions min: ", "whole number" ),
        ( "notes contains: ", "missing text" ),
        ( "any question contains:", "missing text" )
    ]
)
def test_review_checks_with_a_bad_argument_are_a_parse_error( check_text: str, expected_message: str ) -> None:
    with pytest.raises( ValueError, match = expected_message ):
        parse_check( check_text, REVIEW_ENTRY )
