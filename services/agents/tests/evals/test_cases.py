from pathlib import Path

import pytest

from agents.contract.context import MessageKind
from evals.cases import SERVICE_DIR, CaseParseError, find_case_paths, parse_case

def write_case( tmp_path: Path, name: str, text: str, kind: str = "pm_discovery_reply" ) -> Path:
    folder = tmp_path / "pm" / kind
    folder.mkdir( parents = True, exist_ok = True )
    path = folder / name
    path.write_text( text )

    return path

def test_single_stage_case_parses_messages_with_authors_order_and_joined_text( tmp_path: Path ) -> None:
    path = write_case(
        tmp_path,
        "01-single.md",
        "# Case 01: first message\n"
        "Some description that is ignored.\n"
        "\n"
        "## Input\n"
        "H: I want a tool.\n"
        "2. PM: What problem does it solve?\n"
        "3. H: Tracking client work,\n"
        "   mostly invoices.\n"
        "\n"
        "PM: Got it.\n"
        "\n"
        "## Pass\n"
        "- One question.\n"
        "\n"
        "## Fail\n"
        "- A solution is proposed.\n"
    )

    case = parse_case( path )

    assert ( case.number, case.title, case.agent, case.kind ) == ( 1, "first message", "pm", "pm_discovery_reply" )
    assert len( case.stages ) == 1
    messages = case.stages[ 0 ].messages
    assert [ message.author for message in messages ] == [ "human", "pm", "human", "pm" ]
    assert [ message.content for message in messages ] == [
        "I want a tool.",
        "What problem does it solve?",
        "Tracking client work,\n   mostly invoices.",
        "Got it."
    ]
    assert all( message.kind == MessageKind.CHAT for message in messages )
    assert case.stages[ 0 ].pass_criteria == [ "One question." ]
    assert case.stages[ 0 ].fail_criteria == [ "A solution is proposed." ]

def test_stage_that_includes_an_earlier_stage_starts_with_its_messages( tmp_path: Path ) -> None:
    path = write_case(
        tmp_path,
        "02-stages.md",
        "# Case 02: two stages\n"
        "\n"
        "## Stage 1 input\n"
        "H: First.\n"
        "PM: Second.\n"
        "\n"
        "## Stage 1 pass\n"
        "- Pass one.\n"
        "\n"
        "## Stage 1 fail\n"
        "- Fail one.\n"
        "\n"
        "## Stage 1 checks\n"
        "- max_words: 50\n"
        "\n"
        "## Stage 2 input\n"
        "Includes: stage 1\n"
        "H: Third.\n"
        "\n"
        "## Stage 2 pass\n"
        "- Pass two.\n"
        "\n"
        "## Stage 2 checks\n"
        "- not_contains: sorry\n"
    )

    case = parse_case( path )

    first_stage, second_stage = case.stages
    assert [ message.content for message in first_stage.messages ] == [ "First.", "Second." ]
    assert [ message.content for message in second_stage.messages ] == [ "First.", "Second.", "Third." ]
    assert ( first_stage.pass_criteria, first_stage.fail_criteria ) == ( [ "Pass one." ], [ "Fail one." ] )
    assert ( second_stage.pass_criteria, second_stage.fail_criteria ) == ( [ "Pass two." ], [] )
    assert [ check.argument for check in first_stage.checks ] == [ "50" ]
    assert [ check.argument for check in second_stage.checks ] == [ "sorry" ]

def test_file_include_puts_that_files_input_first( tmp_path: Path ) -> None:
    write_case( tmp_path, "other.md", "# Case 05: other\n\n## Input\nH: From other.\n\n## Pass\n- Fine.\n" )
    path = write_case( tmp_path, "06-includes.md", "# Case 06: includes\n\n## Input\nIncludes: other.md\nPM: Mine.\n\n## Pass\n- Fine.\n" )

    case = parse_case( path )

    assert [ message.content for message in case.stages[ 0 ].messages ] == [ "From other.", "Mine." ]

def test_missing_included_file_is_an_error_naming_both_files( tmp_path: Path ) -> None:
    path = write_case( tmp_path, "06-includes.md", "# Case 06: includes\n\n## Input\nIncludes: gone.md\nPM: Mine.\n\n## Pass\n- Fine.\n" )

    with pytest.raises( CaseParseError ) as error:
        parse_case( path )

    assert f"{path}:4" in str( error.value )
    assert "gone.md" in str( error.value )

def test_file_that_includes_itself_is_an_error_naming_both( tmp_path: Path ) -> None:
    path = write_case( tmp_path, "06-loop.md", "# Case 06: loop\n\n## Input\nIncludes: 06-loop.md\nPM: Mine.\n\n## Pass\n- Fine.\n" )

    with pytest.raises( CaseParseError ) as error:
        parse_case( path )

    assert f"{path}:4" in str( error.value )
    assert "include cycle" in str( error.value )
    assert str( error.value ).count( "06-loop.md" ) >= 2

def test_inject_section_stores_the_error_text_exactly( tmp_path: Path ) -> None:
    path = write_case(
        tmp_path,
        "09-retry.md",
        "# Case 09: retry\n"
        "\n"
        "## Input\n"
        "H: Draft it.\n"
        "\n"
        "## Inject\n"
        "- first_tool_error: Missing section_key: scope_later\n"
        "\n"
        "## Pass\n"
        "- Resends everything.\n",
        kind = "pm_draft_brief"
    )

    case = parse_case( path )

    assert case.first_tool_error == "Missing section_key: scope_later"

def test_readme_checks_come_before_the_cases_own_checks( tmp_path: Path ) -> None:
    write_case( tmp_path, "README.md", "# Evals\n\n## Pass in every case\n- Prose.\n\n## Checks\n- max_questions: 2\n- calls: 1\n" )
    path = write_case( tmp_path, "01-single.md", "# Case 01: x\n\n## Input\nH: Hi.\n\n## Pass\n- Fine.\n\n## Checks\n- contains: hello\n" )

    case = parse_case( path )

    assert [ ( check.name.value, check.argument ) for check in case.stages[ 0 ].checks ] == [
        ( "max_questions", "2" ),
        ( "calls", "1" ),
        ( "contains", "hello" )
    ]

@pytest.mark.parametrize(
    ( "kind", "check_line", "expected_message" ),
    [
        ( "pm_discovery_reply", "- max_wrods: 10", "unknown check" ),
        ( "pm_discovery_reply", "- section summary contains: x", "section checks apply only to draft kinds" ),
        ( "pm_draft_brief", "- section risks contains: x", "unknown section key 'risks'" ),
        ( "pm_draft_brief", "- max_questions: 1", "applies only to chat kinds" ),
        ( "pm_discovery_reply", "- max_words: lots", "needs a whole number" )
    ]
)
def test_invalid_check_is_a_parse_error_naming_file_and_line( tmp_path: Path, kind: str, check_line: str, expected_message: str ) -> None:
    path = write_case(
        tmp_path,
        "01-bad.md",
        f"# Case 01: bad\n\n## Input\nH: Hi.\n\n## Pass\n- Fine.\n\n## Checks\n- calls: 1\n{check_line}\n",
        kind = kind
    )

    with pytest.raises( CaseParseError ) as error:
        parse_case( path )

    assert str( error.value ).startswith( f"{path}:11: " )
    assert expected_message in str( error.value )

def test_include_with_a_slash_resolves_from_the_service_folder_and_comes_first( tmp_path: Path ) -> None:
    fixture = tmp_path / "evals" / "fixtures" / "x.md"
    fixture.parent.mkdir( parents = True )
    fixture.write_text( "# Fixture\n\nIgnored text.\n\n## Input\nH: From the fixture.\nPM: Fixture reply.\n" )
    path = write_case(
        tmp_path,
        "01-path-include.md",
        "# Case 01: path include\n"
        "\n"
        "## Input\n"
        "Includes: evals/fixtures/x.md\n"
        "H: Own message.\n"
        "\n"
        "## Pass\n"
        "- Anything.\n"
    )

    case = parse_case( path, tmp_path )

    assert [ message.content for message in case.stages[ 0 ].messages ] == [
        "From the fixture.",
        "Fixture reply.",
        "Own message."
    ]

def test_include_of_a_missing_path_names_both_files( tmp_path: Path ) -> None:
    path = write_case(
        tmp_path,
        "01-missing.md",
        "# Case 01: missing include\n\n## Input\nIncludes: evals/fixtures/nope.md\nH: Hi.\n\n## Pass\n- Anything.\n"
    )

    with pytest.raises( CaseParseError ) as exception_info:
        parse_case( path, tmp_path )

    message = str( exception_info.value )
    assert str( path ) in message
    assert str( tmp_path / "evals" / "fixtures" / "nope.md" ) in message

def test_manual_case_yields_its_reason_and_no_stages_without_validating_other_sections( tmp_path: Path ) -> None:
    path = write_case(
        tmp_path,
        "10-manual.md",
        "# Case 10: replay\n"
        "\n"
        "## Manual\n"
        "Multi-turn replay:\n"
        "each reply feeds the next turn.\n"
        "\n"
        "## Input\n"
        "The `H:` turns only, in order.\n"
        "\n"
        "## Pass (per reply)\n"
        "- One or two questions.\n"
    )

    case = parse_case( path, tmp_path )

    assert case.manual_reason == "Multi-turn replay:\neach reply feeds the next turn."
    assert case.stages == []
    assert ( case.number, case.title ) == ( 10, "replay" )

def test_every_real_case_file_parses_and_discovery_case_10_is_manual() -> None:
    case_paths = find_case_paths( SERVICE_DIR / "evals" / "cases" )

    cases = [ parse_case( case_path ) for case_path in case_paths ]

    assert len( cases ) == 28
    manual_cases = [ case for case in cases if case.manual_reason is not None ]
    assert [ ( case.kind, case.number ) for case in manual_cases ] == [ ( "pm_discovery_reply", 10 ) ]
    assert all( case.stages for case in cases if case.manual_reason is None )
