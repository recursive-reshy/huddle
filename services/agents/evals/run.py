import argparse
import asyncio
import sys
import tomllib
from collections.abc import Coroutine
from datetime import datetime
from pathlib import Path
from statistics import median
from time import monotonic

import httpx2
from anthropic import AsyncAnthropic
from pydantic import BaseModel, ValidationError

from agents.config import Settings
from agents.contract.context import ProjectRef, StepContext, Task, TaskMode
from agents.contract.lines import DeltaLine, ErrorLine, ResultLine, UsageLine
from agents.contract.outputs import ChatReplyOutput, Output, ReviewOutput
from agents.contract.request import StepRequest
from agents.main import stream_step
from agents.roles.registry import registry
from agents.runtime.prompts import load_prompt
from evals.cases import SERVICE_DIR, Case, CaseParseError, find_case_paths, parse_case
from evals.checks import CheckOutcome, CheckResult, evaluate_check

TOKENS_PER_PRICE_UNIT = 1_000_000
# US-5: a chat reply must start streaming within 10 seconds
FIRST_TEXT_LIMIT_SECONDS = 10

class ModelPrices( BaseModel ):
    input: float
    output: float
    cache_read: float
    cache_write: float

class Spending( BaseModel ):
    total_cost: float = 0
    is_stopped: bool = False

class RunResult( BaseModel ):
    case_number: int
    stage_number: int
    repeat_number: int
    is_skipped: bool = False
    error: str | None = None
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    first_text_seconds: float | None = None
    total_seconds: float | None = None
    output: Output | None = None
    check_results: list[ CheckResult ] = []

class EvalRun( BaseModel ):
    started_at: datetime
    agent: str
    kind: str
    model: str
    prompt_hash: str
    repeats: int
    max_cost: float
    cases: list[ Case ]
    results: list[ RunResult ]
    total_cost: float
    is_budget_stopped: bool

def render_output( output: Output ) -> str:
    if isinstance( output, ChatReplyOutput ):
        return output.content

    if isinstance( output, ReviewOutput ):
        if not output.questions:
            return f"{output.notes}\n\nNo questions."

        numbered_questions = "\n".join(
            f"{number}. {question.question}" for number, question in enumerate( output.questions, start = 1 )
        )

        return f"{output.notes}\n\n{numbered_questions}"

    return "\n\n".join( f"### {section.title}\n{section.content}" for section in output.draft )

def render_report( eval_run: EvalRun ) -> str:
    totals = {
        "input": sum( result.input_tokens for result in eval_run.results ),
        "output": sum( result.output_tokens for result in eval_run.results ),
        "cache read": sum( result.cache_read_tokens for result in eval_run.results ),
        "cache write": sum( result.cache_write_tokens for result in eval_run.results )
    }
    pass_counts: dict[ str, list[ int ] ] = {}
    for result in eval_run.results:
        for check_result in result.check_results:
            check = check_result.check
            label = (
                f"section {check.section_key} {check.name.removeprefix( 'section_' )}: {check.argument}"
                if check.section_key is not None
                else f"{check.name}: {check.argument}"
            )
            counts = pass_counts.setdefault( label, [ 0, 0 ] )
            counts[ 1 ] += 1
            if check_result.outcome == CheckOutcome.PASSED:
                counts[ 0 ] += 1

    failure_counts: dict[ str, int ] = {}
    for result in eval_run.results:
        if result.error is not None:
            error_code = result.error.partition( ":" )[ 0 ]
            failure_counts[ error_code ] = failure_counts.get( error_code, 0 ) + 1

    timing_rows: list[ str ] = []
    for case in eval_run.cases:
        for stage in case.stages:
            stage_results = [
                result
                for result in eval_run.results
                if ( result.case_number, result.stage_number ) == ( case.number, stage.number )
            ]
            first_text_values = [
                result.first_text_seconds for result in stage_results if result.first_text_seconds is not None
            ]
            total_values = [ result.total_seconds for result in stage_results if result.total_seconds is not None ]
            if not total_values:
                continue

            first_text_median = f"{median( first_text_values ):.1f}" if first_text_values else "—"
            first_text_max = f"{max( first_text_values ):.1f}" if first_text_values else "—"
            if first_text_values and max( first_text_values ) > FIRST_TEXT_LIMIT_SECONDS:
                first_text_max += " ⚠"

            timing_rows.append(
                f"| {case.number:02d} | {stage.number} | {first_text_median} | {first_text_max} "
                f"| {median( total_values ):.1f} | {max( total_values ):.1f} |"
            )

    skipped_count = sum( 1 for result in eval_run.results if result.is_skipped )
    budget_stop = (
        f"yes (limit ${eval_run.max_cost:.2f} reached, {skipped_count} of {len( eval_run.results )} runs not started)"
        if eval_run.is_budget_stopped
        else "no"
    )

    lines = [
        f"# Eval report: {eval_run.agent}/{eval_run.kind}",
        "",
        f"- Date: {eval_run.started_at:%Y-%m-%d %H:%M:%S}",
        f"- Model: {eval_run.model}",
        f"- Prompt hash: {eval_run.prompt_hash}",
        f"- Repeats: {eval_run.repeats}",
        f"- Calls: {sum( result.calls for result in eval_run.results )}",
        f"- Tokens: {', '.join( f'{name} {count}' for name, count in totals.items() )}",
        f"- Estimated cost: ${eval_run.total_cost:.4f}",
        f"- Budget stop: {budget_stop}",
        "",
        "| Check | Passed | Rate |",
        "| --- | --- | --- |"
    ]
    lines.extend(
        f"| {label} | {counts[ 0 ]}/{counts[ 1 ]} | {counts[ 0 ] * 100 // counts[ 1 ]}% |"
        for label, counts in pass_counts.items()
    )

    if timing_rows:
        lines.extend(
            [
                "",
                "Timing per stage (seconds):",
                "",
                "| Case | Stage | First text median | First text max | Total median | Total max |",
                "| --- | --- | --- | --- | --- | --- |",
                *timing_rows
            ]
        )

    if failure_counts:
        lines.extend( [ "", "Failed runs by error code:", "", "| Failed runs |", "| --- |" ] )
        lines.extend( f"| {error_code}: {count} |" for error_code, count in failure_counts.items() )

    manual_cases = [ case for case in eval_run.cases if case.manual_reason is not None ]
    if manual_cases:
        lines.extend( [ "", "## Manual cases (not run)", "" ] )
        lines.extend( f"- Case {case.number:02d}: {case.title} — {' '.join( ( case.manual_reason or '' ).split() )}" for case in manual_cases )

    for case in eval_run.cases:
        if case.manual_reason is not None:
            continue

        lines.extend( [ "", f"## Case {case.number:02d}: {case.title}" ] )
        for stage in case.stages:
            lines.extend( [ "", f"Stage {stage.number}", "", "Pass:" ] )
            lines.extend( f"- {criterion}" for criterion in stage.pass_criteria )
            if stage.fail_criteria:
                lines.extend( [ "", "Fail:" ] )
                lines.extend( f"- {criterion}" for criterion in stage.fail_criteria )

            for result in eval_run.results:
                if ( result.case_number, result.stage_number ) != ( case.number, stage.number ):
                    continue

                if result.is_skipped:
                    lines.extend( [ "", f"**Repeat {result.repeat_number}** — not run: budget stop" ] )
                    continue

                timing = ""
                if result.first_text_seconds is not None:
                    timing += f", first_text_seconds: {result.first_text_seconds:.1f}"
                if result.total_seconds is not None:
                    timing += f", total_seconds: {result.total_seconds:.1f}"

                lines.extend(
                    [
                        "",
                        (
                            f"**Repeat {result.repeat_number}** — calls: {result.calls}, tokens: "
                            f"input {result.input_tokens}, output {result.output_tokens}, "
                            f"cache read {result.cache_read_tokens}, cache write {result.cache_write_tokens}"
                            f"{timing}"
                        ),
                        ""
                    ]
                )
                if result.error is not None:
                    lines.append( f"FAILED: {result.error}" )
                    continue

                if result.output is not None:
                    lines.extend( [ render_output( result.output ), "" ] )

                lines.extend(
                    f"- {'✓' if check_result.outcome == CheckOutcome.PASSED else '✗'} {check_result.reason}"
                    for check_result in result.check_results
                )

    return "\n".join( lines ) + "\n"

async def run_all(
    cases: list[ Case ],
    arguments: argparse.Namespace,
    settings: Settings,
    prices: ModelPrices,
    client: AsyncAnthropic
) -> tuple[ list[ RunResult ], Spending ]:
    spending = Spending()
    semaphore = asyncio.Semaphore( arguments.concurrency )

    async def execute( case: Case, stage_index: int, repeat_number: int, job_id: int ) -> RunResult:
        stage = case.stages[ stage_index ]
        async with semaphore:
            result = RunResult( case_number = case.number, stage_number = stage.number, repeat_number = repeat_number )
            if spending.total_cost >= arguments.max_cost:
                spending.is_stopped = True
                result.is_skipped = True
                return result

            step_request = StepRequest(
                job_id = job_id,
                attempt = 1,
                kind = case.kind,
                agent = case.agent,
                model = arguments.model,
                context = StepContext(
                    project = ProjectRef( id = "eval", name = f"Eval case {case.number:02d}" ),
                    artifacts = stage.artifacts,
                    decisions = [],
                    draft = [],
                    questions = [],
                    messages = stage.messages,
                    task = Task( notes = "", mode = TaskMode.NORMAL, may_ask = False )
                )
            )
            step_started_at = monotonic()
            async for line in stream_step( step_request, settings, client, case.first_tool_error ):
                if isinstance( line, DeltaLine ) and result.first_text_seconds is None:
                    result.first_text_seconds = monotonic() - step_started_at
                elif isinstance( line, UsageLine ):
                    result.calls += 1
                    result.input_tokens += line.input_tokens
                    result.output_tokens += line.output_tokens
                    result.cache_read_tokens += line.cache_read_tokens
                    result.cache_write_tokens += line.cache_write_tokens
                    spending.total_cost += (
                        line.input_tokens * prices.input
                        + line.output_tokens * prices.output
                        + line.cache_read_tokens * prices.cache_read
                        + line.cache_write_tokens * prices.cache_write
                    ) / TOKENS_PER_PRICE_UNIT
                elif isinstance( line, ResultLine ):
                    result.output = line.output
                    result.total_seconds = monotonic() - step_started_at
                elif isinstance( line, ErrorLine ):
                    result.error = f"{line.code}: {line.message}"
                    result.total_seconds = monotonic() - step_started_at

            if result.output is not None and result.error is None:
                result.check_results = [ evaluate_check( check, result.output, result.calls ) for check in stage.checks ]

            return result

    job_id = 0
    executions: list[ Coroutine[ object, object, RunResult ] ] = []
    for case in cases:
        for stage_index in range( len( case.stages ) ):
            for repeat_number in range( 1, arguments.repeats + 1 ):
                job_id += 1
                executions.append( execute( case, stage_index, repeat_number, job_id ) )

    return list( await asyncio.gather( *executions ) ), spending

def main( argv: list[ str ], service_dir: Path = SERVICE_DIR, http_client: httpx2.AsyncClient | None = None ) -> int:
    parser = argparse.ArgumentParser( prog = "python -m evals.run" )
    parser.add_argument( "target", help = "<agent>/<kind>" )
    parser.add_argument( "--model", required = True )
    parser.add_argument( "--case", type = int, nargs = "+", action = "extend", default = [] )
    parser.add_argument( "--repeats", type = int, default = 3 )
    parser.add_argument( "--max-cost", type = float, default = 2.00 )
    parser.add_argument( "--concurrency", type = int, default = 4 )

    try:
        arguments = parser.parse_args( argv )
    except SystemExit as exit_signal:
        return 0 if exit_signal.code == 0 else 3

    if arguments.repeats < 1 or arguments.concurrency < 1 or arguments.max_cost <= 0:
        print( "--repeats, --concurrency and --max-cost must be positive", file = sys.stderr )
        return 3

    agent, _, kind = arguments.target.partition( "/" )
    if ( agent, kind ) not in registry:
        print( f"No registry entry for {arguments.target!r}, expected <agent>/<kind>", file = sys.stderr )
        return 3

    cases: list[ Case ] = []
    parse_errors: list[ str ] = []
    for case_path in find_case_paths( service_dir / "evals" / "cases" / agent / kind ):
        if arguments.case and int( case_path.name.split( "-" )[ 0 ] ) not in arguments.case:
            continue

        try:
            cases.append( parse_case( case_path, service_dir ) )
        except CaseParseError as exception:
            parse_errors.append( str( exception ) )

    if parse_errors:
        print( "\n".join( parse_errors ), file = sys.stderr )
        return 3

    if not cases:
        print( f"No cases selected for {arguments.target!r}", file = sys.stderr )
        return 3

    prices_path = service_dir / "evals" / "prices.toml"
    raw_prices = tomllib.loads( prices_path.read_text() ) if prices_path.is_file() else {}
    try:
        prices = ModelPrices.model_validate( raw_prices.get( "models", {} ).get( arguments.model ) )
    except ValidationError:
        print( f"{prices_path} has no complete price entry for model {arguments.model!r}", file = sys.stderr )
        return 3

    try:
        settings = Settings()
    except ValidationError:
        print( "ANTHROPIC_API_KEY must be set", file = sys.stderr )
        return 3

    if settings.is_fake or settings.anthropic_api_key is None:
        print( "Evals call the real API: AGENTS_FAKE must not be set", file = sys.stderr )
        return 3

    try:
        prompt_hash = load_prompt( settings.prompts_dir, agent, kind ).hash
    except ( OSError, ValueError ) as exception:
        print( f"Cannot load the prompt for {arguments.target!r}: {exception}", file = sys.stderr )
        return 3

    client = AsyncAnthropic(
        api_key = settings.anthropic_api_key.get_secret_value(),
        max_retries = settings.anthropic_max_retries,
        http_client = http_client
    )
    started_at = datetime.now()
    results, spending = asyncio.run( run_all( cases, arguments, settings, prices, client ) )

    report_path = service_dir / "evals" / "reports" / f"{started_at:%Y%m%d-%H%M%S}-{agent}-{kind}.md"
    report_path.parent.mkdir( parents = True, exist_ok = True )
    report_path.write_text(
        render_report(
            EvalRun(
                started_at = started_at,
                agent = agent,
                kind = kind,
                model = arguments.model,
                prompt_hash = prompt_hash,
                repeats = arguments.repeats,
                max_cost = arguments.max_cost,
                cases = cases,
                results = results,
                total_cost = spending.total_cost,
                is_budget_stopped = spending.is_stopped
            )
        )
    )
    print( f"Report: {report_path}" )

    if spending.is_stopped:
        return 2

    has_failed_run = any( result.error is not None for result in results )
    has_failed_check = any(
        check_result.outcome == CheckOutcome.FAILED
        for result in results
        for check_result in result.check_results
    )
    if has_failed_run or has_failed_check:
        return 1

    return 0

if __name__ == "__main__":
    raise SystemExit( main( sys.argv[ 1: ] ) )
