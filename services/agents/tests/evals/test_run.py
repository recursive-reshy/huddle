import json
import re
from collections.abc import AsyncIterator, Callable
from datetime import datetime
from pathlib import Path

import httpx2
import pytest
from anthropic import AsyncAnthropic

from agents.config import Settings
from agents.contract.lines import StepLine
from agents.contract.outputs import ReviewOutput
from agents.contract.request import StepRequest
from agents.main import stream_step
from agents.roles.sections import BRIEF_SECTION_KEYS
from evals.cases import Case, Stage
from evals.run import EvalRun, RunResult, main, render_output, render_report

PRICES_TEXT = (
    "[models.\"test-model\"]\n"
    "input = 3.0\n"
    "output = 15.0\n"
    "cache_read = 0.3\n"
    "cache_write = 3.75\n"
    "\n"
    "[models.\"blank-model\"]\n"
    "input = \"\"\n"
    "output = \"\"\n"
    "cache_read = \"\"\n"
    "cache_write = \"\"\n"
)

DISCOVERY_CASE_TEXT = (
    "# Case 01: first message\n"
    "\n"
    "## Input\n"
    "H: I want a tool.\n"
    "\n"
    "## Pass\n"
    "- One question.\n"
    "\n"
    "## Fail\n"
    "- A solution is proposed.\n"
    "\n"
    "## Checks\n"
    "- max_words: 50\n"
    "- contains: problem\n"
)

DRAFT_CASE_TEXT = (
    "# Case 02: draft\n"
    "\n"
    "## Input\n"
    "H: Invoices take me a week.\n"
    "\n"
    "## Pass\n"
    "- A brief.\n"
    "\n"
    "## Checks\n"
    "- section problem contains: invoices\n"
)

def sse_event( name: str, data: dict[ str, object ] ) -> str:
    return f"event: {name}\ndata: {json.dumps( data )}\n\n"

def message_start_event( input_tokens: int, cache_read_tokens: int, cache_write_tokens: int ) -> str:
    return sse_event(
        "message_start",
        {
            "type": "message_start",
            "message": {
                "id": "msg_test_01",
                "type": "message",
                "role": "assistant",
                "model": "test-model-20260930",
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {
                    "input_tokens": input_tokens,
                    "cache_creation_input_tokens": cache_write_tokens,
                    "cache_read_input_tokens": cache_read_tokens,
                    "output_tokens": 1
                }
            }
        }
    )

def message_end_events( stop_reason: str, output_tokens: int ) -> str:
    return sse_event(
        "message_delta",
        {
            "type": "message_delta",
            "delta": { "stop_reason": stop_reason, "stop_sequence": None },
            "usage": { "output_tokens": output_tokens }
        }
    ) + sse_event( "message_stop", { "type": "message_stop" } )

def chat_body(
    text: str,
    input_tokens: int = 100,
    output_tokens: int = 20,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0
) -> str:
    return (
        message_start_event( input_tokens, cache_read_tokens, cache_write_tokens )
        + sse_event(
            "content_block_start",
            { "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }
        )
        + sse_event(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": text }
            }
        )
        + sse_event( "content_block_stop", { "type": "content_block_stop", "index": 0 } )
        + message_end_events( "end_turn", output_tokens )
    )

def draft_body(
    problem_content: str = "Invoices take a week.",
    input_tokens: int = 300,
    output_tokens: int = 900,
    tool_use_id: str = "toolu_01"
) -> str:
    tool_input = {
        "draft": [
            {
                "section_key": section_key,
                "title": section_key.title(),
                "content": problem_content if section_key == "problem" else f"Content for {section_key}"
            }
            for section_key in BRIEF_SECTION_KEYS
        ]
    }

    return (
        message_start_event( input_tokens, 0, 0 )
        + sse_event(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "tool_use", "id": tool_use_id, "name": "submit_draft", "input": {} }
            }
        )
        + sse_event(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "input_json_delta", "partial_json": json.dumps( tool_input ) }
            }
        )
        + sse_event( "content_block_stop", { "type": "content_block_stop", "index": 0 } )
        + message_end_events( "tool_use", output_tokens )
    )

REVIEW_CASE_TEXT = (
    "# Case 01: review\n"
    "\n"
    "## Input\n"
    "H: The brief is approved.\n"
    "\n"
    "## Pass\n"
    "- Asks about offline use.\n"
    "\n"
    "## Checks\n"
    "- contains: offline\n"
)

def review_body( notes: str, questions: list[ str ] ) -> str:
    tool_input = { "notes": notes, "questions": [ { "question": question } for question in questions ] }

    return (
        message_start_event( 300, 0, 0 )
        + sse_event(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "tool_use", "id": "toolu_01", "name": "submit_review", "input": {} }
            }
        )
        + sse_event(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "input_json_delta", "partial_json": json.dumps( tool_input ) }
            }
        )
        + sse_event( "content_block_stop", { "type": "content_block_stop", "index": 0 } )
        + message_end_events( "tool_use", 400 )
    )

class Harness:
    def __init__( self, service_dir: Path, recorded_requests: list[ httpx2.Request ] ) -> None:
        self.service_dir = service_dir
        self.recorded_requests = recorded_requests
        self.step_requests: list[ StepRequest ] = []
        self.responder: Callable[ [ int ], httpx2.Response ] = lambda _: httpx2.Response( 500 )

    def respond_with( self, bodies: list[ str ] ) -> None:
        self.responder = lambda index: httpx2.Response(
            200,
            headers = { "content-type": "text/event-stream" },
            content = bodies[ min( index, len( bodies ) - 1 ) ].encode()
        )

    def run( self, argv: list[ str ] ) -> int:
        def respond( request: httpx2.Request ) -> httpx2.Response:
            self.recorded_requests.append( request )

            return self.responder( len( self.recorded_requests ) - 1 )

        return main(
            argv,
            self.service_dir,
            httpx2.AsyncClient( transport = httpx2.MockTransport( respond ) )
        )

    def read_report( self ) -> str:
        report_paths = list( ( self.service_dir / "evals" / "reports" ).glob( "*.md" ) )
        assert len( report_paths ) == 1

        return report_paths[ 0 ].read_text()

@pytest.fixture
def harness( monkeypatch: pytest.MonkeyPatch, tmp_path: Path ) -> Harness:
    monkeypatch.setenv( "ANTHROPIC_API_KEY", "sk-test-secret" )
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )
    ( tmp_path / "evals" / "reports" ).mkdir( parents = True )
    ( tmp_path / "evals" / "prices.toml" ).write_text( PRICES_TEXT )
    new_harness = Harness( tmp_path, [] )

    async def recording_stream_step(
        step_request: StepRequest,
        settings: Settings,
        client: AsyncAnthropic | None,
        first_tool_error: str | None = None
    ) -> AsyncIterator[ StepLine ]:
        new_harness.step_requests.append( step_request )
        async for line in stream_step( step_request, settings, client, first_tool_error ):
            yield line

    monkeypatch.setattr( "evals.run.stream_step", recording_stream_step )

    return new_harness

def write_case( harness: Harness, name: str, text: str, kind: str = "pm_discovery_reply" ) -> None:
    folder = harness.service_dir / "evals" / "cases" / "pm" / kind
    folder.mkdir( parents = True, exist_ok = True )
    ( folder / name ).write_text( text )

@pytest.mark.parametrize(
    ( "scenario", "argv", "case_text" ),
    [
        ( "missing model", [ "pm/pm_discovery_reply" ], DISCOVERY_CASE_TEXT ),
        ( "model without prices", [ "pm/pm_discovery_reply", "--model", "other-model" ], DISCOVERY_CASE_TEXT ),
        ( "model with blank prices", [ "pm/pm_discovery_reply", "--model", "blank-model" ], DISCOVERY_CASE_TEXT ),
        ( "parse error", [ "pm/pm_discovery_reply", "--model", "test-model" ], "# Case 01: broken\n\n## Nonsense\n" ),
        ( "missing api key", [ "pm/pm_discovery_reply", "--model", "test-model" ], DISCOVERY_CASE_TEXT ),
        ( "fake mode", [ "pm/pm_discovery_reply", "--model", "test-model" ], DISCOVERY_CASE_TEXT ),
        ( "no matching case", [ "pm/pm_discovery_reply", "--model", "test-model", "--case", "99" ], DISCOVERY_CASE_TEXT ),
        ( "zero concurrency", [ "pm/pm_discovery_reply", "--model", "test-model", "--concurrency", "0" ], DISCOVERY_CASE_TEXT ),
        ( "zero repeats", [ "pm/pm_discovery_reply", "--model", "test-model", "--repeats", "0" ], DISCOVERY_CASE_TEXT ),
        ( "unknown kind", [ "pm/nope", "--model", "test-model" ], DISCOVERY_CASE_TEXT )
    ]
)
def test_setup_failures_exit_3_and_make_no_requests(
    harness: Harness,
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
    argv: list[ str ],
    case_text: str
) -> None:
    if scenario == "missing api key":
        monkeypatch.delenv( "ANTHROPIC_API_KEY" )

    if scenario == "fake mode":
        monkeypatch.setenv( "AGENTS_FAKE", "1" )

    write_case( harness, "01-first.md", case_text )
    harness.respond_with( [ chat_body( "What problem?" ) ] )

    exit_code = harness.run( argv )

    assert exit_code == 3
    assert harness.recorded_requests == []

def test_two_repeats_send_two_requests_and_the_report_has_outputs_checks_tokens_and_cost( harness: Harness ) -> None:
    write_case( harness, "01-first.md", DISCOVERY_CASE_TEXT )
    harness.respond_with(
        [
            chat_body( "What problem does it solve?", input_tokens = 1000, output_tokens = 200, cache_read_tokens = 500, cache_write_tokens = 100 ),
            chat_body( "Who has this problem, and why now?", input_tokens = 1000, output_tokens = 200, cache_read_tokens = 500, cache_write_tokens = 100 )
        ]
    )

    exit_code = harness.run( [ "pm/pm_discovery_reply", "--model", "test-model", "--repeats", "2", "--concurrency", "1" ] )

    assert len( harness.recorded_requests ) == 2
    assert len( harness.step_requests ) == 2
    for step_request in harness.step_requests:
        assert ( step_request.kind, step_request.agent, step_request.model ) == ( "pm_discovery_reply", "pm", "test-model" )
        assert step_request.job_id >= 1
        assert step_request.attempt == 1
        assert step_request.context.project.id == "eval"
        assert step_request.context.project.name == "Eval case 01"
        assert [ ( message.author, message.content ) for message in step_request.context.messages ] == [ ( "human", "I want a tool." ) ]
        assert step_request.context.task.may_ask is False
        assert step_request.context.task.mode == "normal"
        assert step_request.context.task.notes == ""
        assert step_request.context.artifacts == step_request.context.decisions == []
        assert step_request.context.draft == step_request.context.questions == []

    sent = json.loads( harness.recorded_requests[ 0 ].content )
    assert sent[ "model" ] == "test-model"

    report = harness.read_report()
    assert exit_code == 0
    assert "What problem does it solve?" in report
    assert "Who has this problem, and why now?" in report
    assert "- Model: test-model" in report
    assert "- Repeats: 2" in report
    assert "- Calls: 2" in report
    assert "- Tokens: input 2000, output 400, cache read 1000, cache write 200" in report
    assert "- Estimated cost: $0.0131" in report
    assert "- Budget stop: no" in report
    assert re.search( r"- Prompt hash: [0-9a-f]{64}", report )
    assert "| max_words: 50 | 2/2 | 100% |" in report
    assert "| contains: problem | 2/2 | 100% |" in report
    assert "✓ max_words: 5 <= 50" in report
    assert "✓ max_words: 7 <= 50" in report
    assert "✓ contains: 'problem' found" in report
    assert "One question." in report
    assert "A solution is proposed." in report
    assert "tokens: input 1000, output 200, cache read 500, cache write 100" in report

def test_failed_section_check_exits_1_and_the_report_shows_the_reason( harness: Harness ) -> None:
    write_case( harness, "02-draft.md", DRAFT_CASE_TEXT, kind = "pm_draft_brief" )
    harness.respond_with( [ draft_body( problem_content = "Things are slow." ) ] )

    exit_code = harness.run( [ "pm/pm_draft_brief", "--model", "test-model", "--repeats", "1" ] )

    report = harness.read_report()
    assert exit_code == 1
    assert "✗ section problem contains: 'invoices' not found" in report
    assert "| section problem contains: invoices | 0/1 | 0% |" in report
    assert "### Problem\nThings are slow." in report
    assert "### Summary\nContent for summary" in report

def test_first_tool_error_is_sent_back_as_the_error_result_and_the_retry_counts_two_calls( harness: Harness ) -> None:
    write_case(
        harness,
        "09-retry.md",
        DRAFT_CASE_TEXT.replace( "## Checks\n", "## Inject\n- first_tool_error: Missing section_key: scope_later\n\n## Checks\n- calls: 2\n" ),
        kind = "pm_draft_brief"
    )
    harness.respond_with( [ draft_body( tool_use_id = "toolu_first" ), draft_body( tool_use_id = "toolu_second" ) ] )

    exit_code = harness.run( [ "pm/pm_draft_brief", "--model", "test-model", "--repeats", "1" ] )

    assert len( harness.recorded_requests ) == 2
    second_messages = json.loads( harness.recorded_requests[ 1 ].content )[ "messages" ]
    assert second_messages[ -2 ][ "role" ] == "assistant"
    assert second_messages[ -2 ][ "content" ][ 0 ][ "id" ] == "toolu_first"
    last_block = second_messages[ -1 ][ "content" ][ 0 ]
    assert second_messages[ -1 ][ "role" ] == "user"
    assert last_block[ "type" ] == "tool_result"
    assert last_block[ "tool_use_id" ] == "toolu_first"
    assert last_block[ "is_error" ] is True
    assert "Missing section_key: scope_later" in last_block[ "content" ]
    report = harness.read_report()
    assert "✓ calls: 2 == 2" in report
    assert "| calls: 2 | 1/1 | 100% |" in report
    assert exit_code == 0

def test_budget_stop_starts_no_new_runs_reports_it_and_exits_2( harness: Harness ) -> None:
    write_case( harness, "01-first.md", DISCOVERY_CASE_TEXT )
    harness.respond_with( [ chat_body( "What problem does it solve?", input_tokens = 1_000_000 ) ] )

    exit_code = harness.run(
        [ "pm/pm_discovery_reply", "--model", "test-model", "--repeats", "5", "--concurrency", "1", "--max-cost", "0.50" ]
    )

    report = harness.read_report()
    assert exit_code == 2
    assert len( harness.recorded_requests ) == 1
    assert "- Budget stop: yes (limit $0.50 reached, 4 of 5 runs not started)" in report
    assert "- Calls: 1" in report
    assert report.count( "not run: budget stop" ) == 4
    assert "| max_words: 50 | 1/1 | 100% |" in report

def test_upstream_rejection_fails_the_run_without_evaluating_checks_and_exits_1( harness: Harness ) -> None:
    write_case( harness, "01-first.md", DISCOVERY_CASE_TEXT )
    harness.responder = lambda _: httpx2.Response(
        400,
        json = { "type": "error", "error": { "type": "invalid_request_error", "message": "max_tokens is too large" } }
    )

    exit_code = harness.run( [ "pm/pm_discovery_reply", "--model", "test-model", "--repeats", "1" ] )

    report = harness.read_report()
    assert exit_code == 1
    assert len( harness.recorded_requests ) == 1
    assert "FAILED: upstream_rejected: Anthropic returned HTTP 400: invalid_request_error: max_tokens is too large" in report
    assert "✓" not in report
    assert "✗" not in report
    assert "| max_words: 50 |" not in report

def test_manual_cases_are_listed_with_their_reason_and_never_run( harness: Harness ) -> None:
    write_case( harness, "01-first.md", DISCOVERY_CASE_TEXT )
    write_case(
        harness,
        "10-replay.md",
        "# Case 10: replay\n\n## Manual\nMulti-turn replay, run by hand.\n\n## Input\nProse, not messages.\n\n## Pass (per reply)\n- Anything.\n"
    )
    harness.respond_with( [ chat_body( "What problem does it solve?" ) ] )

    exit_code = harness.run( [ "pm/pm_discovery_reply", "--model", "test-model", "--repeats", "1" ] )

    report = harness.read_report()
    assert exit_code == 0
    assert len( harness.recorded_requests ) == 1
    assert "## Manual cases (not run)" in report
    assert "- Case 10: replay — Multi-turn replay, run by hand." in report
    assert "## Case 10" not in report

def test_review_run_writes_a_report_with_notes_and_numbered_questions_and_a_contains_check_on_question_text_passes(
    harness: Harness
) -> None:
    review_folder = harness.service_dir / "evals" / "cases" / "sa" / "sa_review_brief"
    review_folder.mkdir( parents = True )
    ( review_folder / "01-review.md" ).write_text( REVIEW_CASE_TEXT )
    harness.respond_with(
        [
            review_body(
                "The brief is thin on scope.",
                [ "Which workflows must work offline?", "How many people use it at once?" ]
            )
        ]
    )

    exit_code = harness.run( [ "sa/sa_review_brief", "--model", "test-model", "--repeats", "1" ] )

    report = harness.read_report()
    assert exit_code == 0
    assert "The brief is thin on scope.\n\n1. Which workflows must work offline?\n2. How many people use it at once?" in report
    assert "✓ contains: 'offline' found" in report
    assert "| contains: offline | 1/1 | 100% |" in report
    assert render_output( ReviewOutput( output_type = "review", notes = "All clear.", questions = [] ) ) == (
        "All clear.\n\nNo questions."
    )

def make_clock( readings: list[ float ] ) -> Callable[ [], float ]:
    remaining = list( readings )

    def clock() -> float:
        if len( remaining ) > 1:
            return remaining.pop( 0 )

        return remaining[ 0 ]

    return clock

def test_chat_run_reports_first_text_and_total_seconds_and_a_draft_run_only_total_seconds(
    harness: Harness,
    monkeypatch: pytest.MonkeyPatch
) -> None:
    write_case( harness, "01-first.md", DISCOVERY_CASE_TEXT )
    harness.respond_with( [ chat_body( "What problem does it solve?" ) ] )
    monkeypatch.setattr( "evals.run.monotonic", make_clock( [ 100.0, 103.0, 108.0 ] ) )

    harness.run( [ "pm/pm_discovery_reply", "--model", "test-model", "--repeats", "1" ] )

    chat_report = harness.read_report()
    assert "first_text_seconds: 3.0" in chat_report
    assert "total_seconds: 8.0" in chat_report
    assert "⚠" not in chat_report

def test_draft_run_reports_only_total_seconds( harness: Harness, monkeypatch: pytest.MonkeyPatch ) -> None:
    write_case( harness, "02-draft.md", DRAFT_CASE_TEXT, kind = "pm_draft_brief" )
    harness.respond_with( [ draft_body() ] )
    monkeypatch.setattr( "evals.run.monotonic", make_clock( [ 100.0, 108.0 ] ) )

    harness.run( [ "pm/pm_draft_brief", "--model", "test-model", "--repeats", "1" ] )

    report = harness.read_report()
    assert "total_seconds: 8.0" in report
    assert "first_text_seconds" not in report

def test_stage_whose_slowest_first_text_is_over_10_seconds_is_marked_in_the_header(
    harness: Harness,
    monkeypatch: pytest.MonkeyPatch
) -> None:
    write_case( harness, "01-first.md", DISCOVERY_CASE_TEXT )
    harness.respond_with( [ chat_body( "What problem does it solve?" ) ] )
    monkeypatch.setattr( "evals.run.monotonic", make_clock( [ 0.0, 12.0, 13.0, 20.0, 23.0, 28.0 ] ) )

    harness.run( [ "pm/pm_discovery_reply", "--model", "test-model", "--repeats", "2", "--concurrency", "1" ] )

    report = harness.read_report()
    header = report.split( "## Case 01" )[ 0 ]
    assert "| 01 | 1 | 7.5 | 12.0 ⚠ | 10.5 | 13.0 |" in header
    assert "first_text_seconds: 12.0" in report
    assert "first_text_seconds: 3.0" in report

def make_eval_run( error_codes: list[ str | None ] ) -> EvalRun:
    case = Case(
        path = Path( "01-case.md" ),
        agent = "pm",
        kind = "pm_draft_brief",
        number = 1,
        title = "case",
        stages = [ Stage( number = 1, messages = [], pass_criteria = [], fail_criteria = [], checks = [] ) ]
    )

    return EvalRun(
        started_at = datetime( 2026, 10, 12, 9, 0, 0 ),
        agent = "pm",
        kind = "pm_draft_brief",
        model = "test-model",
        prompt_hash = "0" * 64,
        repeats = len( error_codes ),
        max_cost = 2.0,
        cases = [ case ],
        results = [
            RunResult(
                case_number = 1,
                stage_number = 1,
                repeat_number = number,
                error = None if code is None else f"{code}: something went wrong"
            )
            for number, code in enumerate( error_codes, start = 1 )
        ],
        total_cost = 0.0,
        is_budget_stopped = False
    )

def test_header_counts_failed_runs_by_error_code_and_has_no_table_when_nothing_failed() -> None:
    failing_report = render_report( make_eval_run( [ "truncated", "validation_failed", "truncated", None ] ) )
    clean_report = render_report( make_eval_run( [ None, None ] ) )

    assert "| truncated: 2 |" in failing_report
    assert "| validation_failed: 1 |" in failing_report
    assert "Failed runs" in failing_report
    assert "Failed runs" not in clean_report

def test_review_case_with_an_approved_brief_sends_it_in_the_source_turn_and_reports_the_review_checks(
    harness: Harness
) -> None:
    review_folder = harness.service_dir / "evals" / "cases" / "sa" / "sa_review_brief"
    review_folder.mkdir( parents = True )
    ( review_folder / "01-brief.md" ).write_text(
        "# Case 01: brief\n"
        "\n"
        "## Approved brief\n"
        "### summary: Summary\n"
        "A salon booking tool.\n"
        "\n"
        "### goals: Goals\n"
        "No double bookings.\n"
        "\n"
        "## Pass\n"
        "- Asks about offline use.\n"
        "\n"
        "## Checks\n"
        "- questions min: 1\n"
        "- any question contains: offline\n"
        "- notes not_contains: MySQL\n"
    )
    harness.respond_with( [ review_body( "Thin on scope.", [ "Which workflows must work offline?" ] ) ] )

    exit_code = harness.run( [ "sa/sa_review_brief", "--model", "test-model", "--repeats", "1" ] )

    sent = json.loads( harness.recorded_requests[ 0 ].content )
    source_text = sent[ "messages" ][ 0 ][ "content" ][ 0 ][ "text" ]
    assert source_text.startswith( "<approved_artifacts>\n" )
    assert "A salon booking tool." in source_text
    assert "No double bookings." in source_text
    report = harness.read_report()
    assert exit_code == 0
    assert "✓ questions min: 1 >= 1" in report
    assert "✓ any question contains: 'offline' found" in report
    assert "✓ notes not_contains: 'MySQL' not found" in report
    assert "| questions min: 1 | 1/1 | 100% |" in report
