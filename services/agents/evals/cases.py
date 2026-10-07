import re
from pathlib import Path

from pydantic import BaseModel

from agents.contract.context import MessageKind, ThreadMessage
from agents.roles.registry import RegistryEntry, registry
from evals.checks import Check, parse_check

TITLE_PATTERN = re.compile( r"# Case (\d+): (.+)" )
HEADING_PATTERN = re.compile( r"##\s+(.+?)\s*" )
SINGLE_STAGE_PATTERN = re.compile( r"(input|pass|fail|checks)" )
MULTI_STAGE_PATTERN = re.compile( r"stage (\d+) (input|pass|fail|checks)" )
MESSAGE_PATTERN = re.compile( r"(?:\d+\.\s+)?(H|PM):(.*)" )
STAGE_INCLUDE_PATTERN = re.compile( r"stage (\d+)" )
INJECT_PATTERN = re.compile( r"- first_tool_error:(.*)" )
CASE_FILE_PATTERN = re.compile( r"\d+-.+\.md" )
SERVICE_DIR = Path( __file__ ).parents[ 1 ]

class CaseParseError( Exception ):
    pass

class SourceLine( BaseModel ):
    number: int
    text: str

class CaseSection( BaseModel ):
    key: str
    line: int
    lines: list[ SourceLine ]

class Stage( BaseModel ):
    number: int
    messages: list[ ThreadMessage ]
    pass_criteria: list[ str ]
    fail_criteria: list[ str ]
    checks: list[ Check ]

class Case( BaseModel ):
    path: Path
    agent: str
    kind: str
    number: int
    title: str
    stages: list[ Stage ]
    first_tool_error: str | None = None
    manual_reason: str | None = None

def find_case_paths( folder: Path ) -> list[ Path ]:
    return sorted( path for path in folder.rglob( "*.md" ) if CASE_FILE_PATTERN.fullmatch( path.name ) )

def split_sections( lines: list[ str ] ) -> list[ CaseSection ]:
    sections: list[ CaseSection ] = []
    for line_number, text in enumerate( lines, start = 1 ):
        heading_match = HEADING_PATTERN.fullmatch( text )
        if heading_match is not None:
            key = " ".join( heading_match.group( 1 ).lower().split() )
            sections.append( CaseSection( key = key, line = line_number, lines = [] ) )
            continue
        if sections:
            sections[ -1 ].lines.append( SourceLine( number = line_number, text = text ) )

    return sections

def read_input(
    path: Path,
    section: CaseSection,
    stage_inputs: dict[ int, CaseSection ],
    stage_chain: tuple[ int, ... ],
    file_chain: tuple[ Path, ... ],
    service_dir: Path
) -> list[ ThreadMessage ]:
    included_messages: list[ ThreadMessage ] = []
    authors: list[ str ] = []
    start_lines: list[ int ] = []
    bodies: list[ list[ str ] ] = []

    for source_line in section.lines:
        message_match = MESSAGE_PATTERN.fullmatch( source_line.text )
        if message_match is not None:
            authors.append( "human" if message_match.group( 1 ) == "H" else "pm" )
            start_lines.append( source_line.number )
            bodies.append( [ message_match.group( 2 ) ] )
            continue

        if source_line.text.startswith( "Includes:" ):
            where = f"{path}:{source_line.number}"
            if authors:
                raise CaseParseError( f"{where}: Includes must come before the first message" )

            include_text = source_line.text.removeprefix( "Includes:" ).strip()
            stage_match = STAGE_INCLUDE_PATTERN.fullmatch( include_text )
            if stage_match is not None:
                stage_number = int( stage_match.group( 1 ) )
                if stage_number in stage_chain:
                    stage_names = " -> ".join( f"stage {number}" for number in ( *stage_chain, stage_number ) )
                    raise CaseParseError( f"{where}: include cycle: {stage_names}" )
                if stage_number not in stage_inputs:
                    raise CaseParseError( f"{where}: Includes: stage {stage_number}, but {path.name} has no stage {stage_number} input" )

                included_messages.extend(
                    read_input( path, stage_inputs[ stage_number ], stage_inputs, ( *stage_chain, stage_number ), file_chain, service_dir )
                )
                continue

            is_service_path = "/" in include_text
            if not include_text.endswith( ".md" ) or ( not is_service_path and Path( include_text ).name != include_text ):
                raise CaseParseError(
                    f"{where}: Includes needs 'stage N', a .md file in the same folder, "
                    f"or a .md path from the service folder, got {include_text!r}"
                )

            target = ( service_dir if is_service_path else path.parent ) / include_text
            if target.resolve() in file_chain:
                file_names = " -> ".join( file.name for file in ( *file_chain, target.resolve() ) )
                raise CaseParseError( f"{where}: include cycle: {file_names} ({path} includes {target})" )
            if not target.is_file():
                raise CaseParseError( f"{where}: {path} includes {target}, which does not exist" )

            target_sections = split_sections( target.read_text().splitlines() )
            target_input = next( ( target_section for target_section in target_sections if target_section.key == "input" ), None )
            if target_input is None:
                raise CaseParseError( f"{where}: {path} includes {target}, which has no single-stage ## Input" )

            included_messages.extend( read_input( target, target_input, {}, (), ( *file_chain, target.resolve() ), service_dir ) )
            continue

        if bodies:
            bodies[ -1 ].append( source_line.text )
            continue

        if source_line.text.strip() != "":
            raise CaseParseError( f"{path}:{source_line.number}: text before the first message" )

    messages: list[ ThreadMessage ] = []
    for author, start_line, body in zip( authors, start_lines, bodies ):
        content = "\n".join( body ).strip()
        if content == "":
            raise CaseParseError( f"{path}:{start_line}: empty message" )

        messages.append( ThreadMessage( author = author, kind = MessageKind.CHAT, content = content ) )

    if not included_messages and not messages:
        raise CaseParseError( f"{path}:{section.line}: input has no messages" )

    return [ *included_messages, *messages ]

def read_criteria( section: CaseSection ) -> list[ str ]:
    criteria: list[ str ] = []
    for source_line in section.lines:
        text = source_line.text.strip()
        if text == "":
            continue
        if text.startswith( "- " ):
            criteria.append( text.removeprefix( "- " ).strip() )
            continue
        if criteria:
            criteria[ -1 ] = f"{criteria[ -1 ]} {text}"
            continue

        criteria.append( text )

    return criteria

def read_checks( path: Path, section: CaseSection, entry: RegistryEntry ) -> list[ Check ]:
    checks: list[ Check ] = []
    for source_line in section.lines:
        text = source_line.text.strip()
        if text == "":
            continue
        if not text.startswith( "- " ):
            raise CaseParseError( f"{path}:{source_line.number}: a check is a bullet line starting with '- '" )

        try:
            checks.append( parse_check( text.removeprefix( "- " ).strip(), entry ) )
        except ValueError as exception:
            raise CaseParseError( f"{path}:{source_line.number}: {exception}" ) from exception

    return checks

def parse_case( path: Path, service_dir: Path = SERVICE_DIR ) -> Case:
    agent = path.parent.parent.name
    kind = path.parent.name
    entry = registry.get( ( agent, kind ) )
    if entry is None:
        raise CaseParseError( f"{path}:1: no registry entry for agent {agent!r} and kind {kind!r}" )

    lines = path.read_text().splitlines()
    title_match = TITLE_PATTERN.fullmatch( lines[ 0 ].strip() ) if lines else None
    if title_match is None:
        raise CaseParseError( f"{path}:1: the first line must be '# Case NN: <title>'" )

    sections = split_sections( lines )
    manual_section = next( ( section for section in sections if section.key == "manual" ), None )
    if manual_section is not None:
        return Case(
            path = path,
            agent = agent,
            kind = kind,
            number = int( title_match.group( 1 ) ),
            title = title_match.group( 2 ),
            stages = [],
            manual_reason = "\n".join( source_line.text for source_line in manual_section.lines ).strip()
        )

    stage_sections: dict[ int, dict[ str, CaseSection ] ] = {}
    inject_sections: list[ CaseSection ] = []
    has_single_stage = False
    has_multi_stage = False
    for section in sections:
        single_match = SINGLE_STAGE_PATTERN.fullmatch( section.key )
        multi_match = MULTI_STAGE_PATTERN.fullmatch( section.key )
        if section.key == "inject":
            inject_sections.append( section )
            continue
        if single_match is not None:
            stage_number, part = 1, single_match.group( 1 )
            has_single_stage = True
        elif multi_match is not None:
            stage_number, part = int( multi_match.group( 1 ) ), multi_match.group( 2 )
            has_multi_stage = True
        else:
            raise CaseParseError( f"{path}:{section.line}: unknown section '## {section.key}'" )

        if part in stage_sections.get( stage_number, {} ):
            raise CaseParseError( f"{path}:{section.line}: duplicate section '## {section.key}'" )

        stage_sections.setdefault( stage_number, {} )[ part ] = section

    if has_single_stage and has_multi_stage:
        raise CaseParseError( f"{path}:{sections[ 0 ].line}: a case is either single-stage or multi-stage, not both" )
    if not stage_sections:
        raise CaseParseError( f"{path}:1: no ## Input section" )
    if sorted( stage_sections ) != list( range( 1, len( stage_sections ) + 1 ) ):
        raise CaseParseError( f"{path}:{sections[ 0 ].line}: stages must be numbered 1 to {len( stage_sections )} with no gaps" )
    if len( inject_sections ) > 1:
        raise CaseParseError( f"{path}:{inject_sections[ 1 ].line}: duplicate section '## inject'" )

    first_tool_error: str | None = None
    if inject_sections:
        for source_line in inject_sections[ 0 ].lines:
            if source_line.text.strip() == "":
                continue

            inject_match = INJECT_PATTERN.fullmatch( source_line.text.strip() )
            if inject_match is None or inject_match.group( 1 ).strip() == "":
                raise CaseParseError( f"{path}:{source_line.number}: expected '- first_tool_error: <text>'" )

            first_tool_error = inject_match.group( 1 ).strip()

    readme_checks: list[ Check ] = []
    readme = path.parent / "README.md"
    if readme.is_file():
        for readme_section in split_sections( readme.read_text().splitlines() ):
            if readme_section.key == "checks":
                readme_checks.extend( read_checks( readme, readme_section, entry ) )

    stage_inputs = { number: parts[ "input" ] for number, parts in stage_sections.items() if "input" in parts }
    stages: list[ Stage ] = []
    for stage_number, parts in sorted( stage_sections.items() ):
        first_line = min( part.line for part in parts.values() )
        for required_part in ( "input", "pass" ):
            if required_part not in parts:
                raise CaseParseError( f"{path}:{first_line}: stage {stage_number} has no {required_part} section" )

        messages = read_input( path, parts[ "input" ], stage_inputs, ( stage_number, ), ( path.resolve(), ), service_dir )
        own_checks = read_checks( path, parts[ "checks" ], entry ) if "checks" in parts else []
        stages.append(
            Stage(
                number = stage_number,
                messages = messages,
                pass_criteria = read_criteria( parts[ "pass" ] ),
                fail_criteria = read_criteria( parts[ "fail" ] ) if "fail" in parts else [],
                checks = [ *readme_checks, *own_checks ]
            )
        )

    return Case(
        path = path,
        agent = agent,
        kind = kind,
        number = int( title_match.group( 1 ) ),
        title = title_match.group( 2 ),
        stages = stages,
        first_tool_error = first_tool_error
    )
