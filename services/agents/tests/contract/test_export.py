from pathlib import Path

from agents.contract.export import render_schema

committed_schema_path = Path( __file__ ).parents[ 2 ] / "schema" / "step_contract.json"

def test_export_matches_committed_schema() -> None:
    assert render_schema().encode( "utf-8" ) == committed_schema_path.read_bytes(), (
        "schema/step_contract.json is out of date. "
        "Run: uv run python -m agents.contract.export"
    )
