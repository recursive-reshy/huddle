from pathlib import Path

from agents.roles.sections import BRIEF_SECTION_KEYS
from agents.runtime.prompts import load_prompt

def test_brief_prompt_body_lists_every_brief_section_key_in_order() -> None:
    prompts_directory = Path( __file__ ).parents[ 2 ] / "prompts"

    prompt = load_prompt( prompts_directory, "pm", "pm_draft_brief" )

    assert len( BRIEF_SECTION_KEYS ) == 14
    positions = [ prompt.body.find( f". {section_key}: " ) for section_key in BRIEF_SECTION_KEYS ]
    assert all( position != -1 for position in positions )
    assert positions == sorted( positions )
