from agents.contract.outputs import ChatReplyOutput, DraftArtifactOutput, DraftSection
from agents.roles.registry import registry
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
