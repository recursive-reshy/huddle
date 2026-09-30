import httpx2
import pytest
from anthropic import APIStatusError

from agents.runtime.errors import map_exception

def make_status_error( status: int ) -> APIStatusError:
    request = httpx2.Request( "POST", "https://api.anthropic.com/v1/messages" )
    response = httpx2.Response( status, request = request )

    return APIStatusError( "prompt text and sk-test-secret", response = response, body = None )

@pytest.mark.parametrize(
    ( "status", "expected_code", "expected_retryable" ),
    [
        ( 429, "rate_limited", True ),
        ( 529, "overloaded", True ),
        ( 500, "upstream_error", True ),
        ( 503, "upstream_error", True ),
        ( 400, "upstream_rejected", False ),
        ( 422, "upstream_rejected", False ),
        ( 401, "auth_failed", False ),
        ( 409, "internal_error", False )
    ]
)
def test_status_errors_map_to_code_and_retryable_with_the_status_and_no_request_content(
    status: int,
    expected_code: str,
    expected_retryable: bool
) -> None:
    error_line = map_exception( make_status_error( status ) )

    assert error_line.code == expected_code
    assert error_line.retryable is expected_retryable
    assert f"HTTP {status}" in error_line.message
    assert "prompt text" not in error_line.message
    assert "sk-test-secret" not in error_line.message

def test_unknown_exceptions_map_to_a_non_retryable_internal_error_without_their_message() -> None:
    error_line = map_exception( ValueError( "secret detail" ) )

    assert error_line.code == "internal_error"
    assert error_line.retryable is False
    assert "secret detail" not in error_line.message
