import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

service_directory = Path( __file__ ).parents[ 2 ]
image_tag = "myteam-agents:test"
build_command = [ "docker", "build", "--platform", "linux/amd64" ]

pytestmark = pytest.mark.docker

valid_request: dict[ str, object ] = {
    "job_id": 7,
    "attempt": 1,
    "kind": "pm_discovery_reply",
    "agent": "pm",
    "model": "claude-sonnet-5-5",
    "context": {
        "project": { "id": "p-1", "name": "My Team" },
        "artifacts": [],
        "decisions": [],
        "draft": [],
        "questions": [],
        "messages": [],
        "task": { "notes": "hello", "mode": "normal" }
    }
}

def run_docker( arguments: list[ str ], timeout: int = 60 ) -> subprocess.CompletedProcess[ str ]:
    return subprocess.run(
        [ "docker", *arguments ],
        capture_output = True,
        text = True,
        timeout = timeout,
        check = False
    )

def find_base_url( container_id: str ) -> str:
    published = run_docker( [ "port", container_id, "8000/tcp" ] )

    assert published.returncode == 0, published.stderr

    return f"http://{published.stdout.splitlines()[ 0 ].strip()}"

def wait_for_healthz( base_url: str, timeout_seconds: int ) -> int:
    deadline = time.monotonic() + timeout_seconds
    last_error = ""

    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen( f"{base_url}/healthz", timeout = 3 ) as response:
                return response.status
        except ( urllib.error.URLError, ConnectionError, TimeoutError ) as exception:
            last_error = str( exception )
            time.sleep( 1 )

    pytest.fail( f"/healthz never answered within {timeout_seconds} s: {last_error}" )

@pytest.fixture( scope = "session" )
def build_result() -> subprocess.CompletedProcess[ str ]:
    return subprocess.run(
        [ *build_command, "--tag", image_tag, str( service_directory ) ],
        capture_output = True,
        text = True,
        timeout = 900,
        check = False
    )

@pytest.fixture( scope = "session" )
def image( build_result: subprocess.CompletedProcess[ str ] ) -> str:
    assert build_result.returncode == 0, build_result.stderr[ -2000: ]

    return image_tag

@pytest.fixture
def start_container( image: str ) -> Iterator[ Callable[ [ dict[ str, str ] ], str ] ]:
    container_ids: list[ str ] = []

    def start( environment: dict[ str, str ] ) -> str:
        arguments = [ "run", "--detach", "--platform", "linux/amd64", "--publish", "127.0.0.1::8000" ]

        for name, value in environment.items():
            arguments.extend( [ "--env", f"{name}={value}" ] )

        started = run_docker( [ *arguments, image ] )

        assert started.returncode == 0, started.stderr
        container_id = started.stdout.strip()
        container_ids.append( container_id )

        return container_id

    yield start

    for container_id in container_ids:
        run_docker( [ "rm", "--force", container_id ] )

def test_image_builds_for_linux_amd64( build_result: subprocess.CompletedProcess[ str ] ) -> None:
    assert build_result.returncode == 0, build_result.stderr[ -2000: ]

def test_build_fails_when_lockfile_is_out_of_date( tmp_path: Path ) -> None:
    context = tmp_path / "context"
    shutil.copytree(
        service_directory,
        context,
        ignore = shutil.ignore_patterns( ".venv", "__pycache__", ".pytest_cache", ".ruff_cache", ".env*" )
    )
    pyproject = context / "pyproject.toml"
    pyproject.write_text(
        pyproject.read_text().replace( '"fastapi>=0.141.1",', '"fastapi>=0.141.1",\n    "httpx>=0.28.1",' )
    )

    build = subprocess.run(
        [ *build_command, "--tag", "myteam-agents:stale-lock", str( context ) ],
        capture_output = True,
        text = True,
        timeout = 900,
        check = False
    )

    assert build.returncode != 0
    assert "lock" in build.stderr.lower()

def test_container_does_not_run_as_root( image: str ) -> None:
    user = run_docker( [ "run", "--rm", "--platform", "linux/amd64", "--entrypoint", "id", image, "-u" ] )

    assert user.returncode == 0, user.stderr
    assert user.stdout.strip() != "0"

def test_fake_mode_container_answers_healthz_and_becomes_healthy(
    start_container: Callable[ [ dict[ str, str ] ], str ]
) -> None:
    container_id = start_container( { "AGENTS_FAKE": "1" } )

    status = wait_for_healthz( find_base_url( container_id ), 30 )

    assert status == 200

    deadline = time.monotonic() + 60
    health = ""

    while time.monotonic() < deadline:
        inspected = run_docker( [ "inspect", "--format", "{{.State.Health.Status}}", container_id ] )
        health = inspected.stdout.strip()

        if health == "healthy":
            break

        time.sleep( 2 )

    assert health == "healthy"

def test_fake_mode_container_streams_fixture_lines(
    start_container: Callable[ [ dict[ str, str ] ], str ]
) -> None:
    container_id = start_container( { "AGENTS_FAKE": "1" } )
    base_url = find_base_url( container_id )
    wait_for_healthz( base_url, 30 )

    request = urllib.request.Request(
        f"{base_url}/v1/steps",
        data = json.dumps( valid_request ).encode(),
        headers = { "Content-Type": "application/json" }
    )
    with urllib.request.urlopen( request, timeout = 30 ) as response:
        lines = [ json.loads( line ) for line in response.read().decode().splitlines() ]

    line_types = [ line[ "type" ] for line in lines ]

    assert line_types[ -2: ] == [ "usage", "result" ]
    assert len( line_types ) > 2
    assert set( line_types[ :-2 ] ) == { "delta" }

def test_container_without_api_key_or_fake_mode_exits_non_zero(
    start_container: Callable[ [ dict[ str, str ] ], str ]
) -> None:
    container_id = start_container( {} )

    waited = run_docker( [ "wait", container_id ], timeout = 15 )

    assert waited.returncode == 0, waited.stderr
    assert waited.stdout.strip() != "0"

def test_container_with_dummy_api_key_passes_startup_check(
    start_container: Callable[ [ dict[ str, str ] ], str ]
) -> None:
    container_id = start_container( { "ANTHROPIC_API_KEY": "sk-test-dummy" } )

    status = wait_for_healthz( find_base_url( container_id ), 30 )

    assert status == 200

def test_image_holds_no_key_and_no_test_or_env_files( image: str ) -> None:
    inspected = run_docker( [ "image", "inspect", "--format", "{{json .Config.Env}}", image ] )

    assert inspected.returncode == 0, inspected.stderr
    environment: list[ str ] = json.loads( inspected.stdout )

    assert not [ entry for entry in environment if entry.startswith( "ANTHROPIC_API_KEY" ) ]

    listing = run_docker(
        [
            "run", "--rm", "--platform", "linux/amd64", "--entrypoint", "sh", image, "-c",
            "ls -A /app; find /app -name '.env*' -o -name tests -o -name evals"
        ]
    )

    assert listing.returncode == 0, listing.stderr
    found = listing.stdout.split()

    assert "tests" not in found
    assert "evals" not in found
    assert not [ entry for entry in found if entry.startswith( ( ".env", "/app" ) ) ]
