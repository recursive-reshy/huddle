import re
from enum import StrEnum

from pydantic import BaseModel

from agents.contract.outputs import ChatReplyOutput, DraftArtifactOutput
from agents.roles.registry import RegistryEntry

SECTION_CHECK_PATTERN = re.compile( r"section\s+(\S+)\s+(contains|not_contains|equals):\s*(.*)" )
PLAIN_CHECK_PATTERN = re.compile( r"(\w+):\s*(.*)" )

class CheckName( StrEnum ):
    MAX_WORDS = "max_words"
    MAX_QUESTIONS = "max_questions"
    CONTAINS = "contains"
    NOT_CONTAINS = "not_contains"
    SECTION_CONTAINS = "section_contains"
    SECTION_NOT_CONTAINS = "section_not_contains"
    SECTION_EQUALS = "section_equals"
    CALLS = "calls"

class CheckOutcome( StrEnum ):
    PASSED = "passed"
    FAILED = "failed"

class Check( BaseModel ):
    name: CheckName
    argument: str
    section_key: str | None = None

class CheckResult( BaseModel ):
    check: Check
    outcome: CheckOutcome
    reason: str

def parse_check( text: str, entry: RegistryEntry ) -> Check:
    is_chat = entry.output_type is ChatReplyOutput

    section_match = SECTION_CHECK_PATTERN.fullmatch( text )
    if section_match is not None:
        section_key, operator, argument = section_match.groups()
        if is_chat:
            raise ValueError( f"section checks apply only to draft kinds: {text}" )
        if section_key not in ( entry.section_keys or () ):
            raise ValueError( f"unknown section key {section_key!r} in: {text}" )
        if argument == "":
            raise ValueError( f"missing text in: {text}" )

        return Check( name = CheckName( f"section_{operator}" ), argument = argument, section_key = section_key )

    plain_match = PLAIN_CHECK_PATTERN.fullmatch( text )
    if plain_match is None or plain_match.group( 1 ) not in CheckName.__members__.values():
        raise ValueError( f"unknown check: {text}" )

    name = CheckName( plain_match.group( 1 ) )
    argument = plain_match.group( 2 )
    if name in ( CheckName.SECTION_CONTAINS, CheckName.SECTION_NOT_CONTAINS, CheckName.SECTION_EQUALS ):
        raise ValueError( f"unknown check: {text}" )
    if name == CheckName.MAX_QUESTIONS and not is_chat:
        raise ValueError( f"max_questions applies only to chat kinds: {text}" )
    if name in ( CheckName.MAX_WORDS, CheckName.MAX_QUESTIONS, CheckName.CALLS ) and not argument.isdecimal():
        raise ValueError( f"{name} needs a whole number: {text}" )
    if argument == "":
        raise ValueError( f"missing text in: {text}" )

    return Check( name = name, argument = argument )

def evaluate_check( check: Check, output: ChatReplyOutput | DraftArtifactOutput, calls: int ) -> CheckResult:
    if isinstance( output, ChatReplyOutput ):
        texts = [ output.content ]
    else:
        texts = [ section.content for section in output.draft ]

    if check.name == CheckName.CALLS:
        expected_calls = int( check.argument )
        is_match = calls == expected_calls
        return CheckResult(
            check = check,
            outcome = CheckOutcome.PASSED if is_match else CheckOutcome.FAILED,
            reason = f"calls: {calls} {'==' if is_match else '!='} {expected_calls}"
        )

    if check.name == CheckName.MAX_WORDS:
        limit = int( check.argument )
        word_count = sum( len( text.split() ) for text in texts )
        is_within = word_count <= limit
        return CheckResult(
            check = check,
            outcome = CheckOutcome.PASSED if is_within else CheckOutcome.FAILED,
            reason = f"max_words: {word_count} {'<=' if is_within else '>'} {limit}"
        )

    if check.name == CheckName.MAX_QUESTIONS:
        if not isinstance( output, ChatReplyOutput ):
            raise ValueError( "max_questions can only be evaluated on a chat reply" )

        limit = int( check.argument )
        question_count = output.content.count( "?" )
        is_within = question_count <= limit
        return CheckResult(
            check = check,
            outcome = CheckOutcome.PASSED if is_within else CheckOutcome.FAILED,
            reason = f"max_questions: {question_count} {'<=' if is_within else '>'} {limit}"
        )

    if check.name in ( CheckName.CONTAINS, CheckName.NOT_CONTAINS ):
        is_found = any( check.argument.lower() in text.lower() for text in texts )
        is_pass = is_found if check.name == CheckName.CONTAINS else not is_found
        return CheckResult(
            check = check,
            outcome = CheckOutcome.PASSED if is_pass else CheckOutcome.FAILED,
            reason = f"{check.name}: {check.argument!r} {'found' if is_found else 'not found'}"
        )

    if not isinstance( output, DraftArtifactOutput ) or check.section_key is None:
        raise ValueError( f"{check.name} can only be evaluated on a draft section" )

    label = f"section {check.section_key} {check.name.removeprefix( 'section_' )}"
    contents = { section.section_key: section.content for section in output.draft }
    if check.section_key not in contents:
        return CheckResult( check = check, outcome = CheckOutcome.FAILED, reason = f"{label}: section is missing from the draft" )

    content = contents[ check.section_key ]
    if check.name == CheckName.SECTION_EQUALS:
        is_equal = content.strip() == check.argument
        return CheckResult(
            check = check,
            outcome = CheckOutcome.PASSED if is_equal else CheckOutcome.FAILED,
            reason = (
                f"{label}: content matches"
                if is_equal
                else f"{label}: content differs from the expected text ({len( content.strip() )} characters vs {len( check.argument )}, case-sensitive)"
            )
        )

    is_found = check.argument.lower() in content.lower()
    is_pass = is_found if check.name == CheckName.SECTION_CONTAINS else not is_found
    return CheckResult(
        check = check,
        outcome = CheckOutcome.PASSED if is_pass else CheckOutcome.FAILED,
        reason = f"{label}: {check.argument!r} {'found' if is_found else 'not found'}"
    )
