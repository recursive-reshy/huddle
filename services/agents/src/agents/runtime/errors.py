import httpx2
from anthropic import APIError, APIStatusError

from agents.contract.errors import ErrorCode
from agents.contract.lines import ErrorLine

def map_exception( exception: Exception ) -> ErrorLine:
    if isinstance( exception, APIStatusError ):
        status = exception.status_code

        if status == 429:
            code, retryable = ErrorCode.RATE_LIMITED, True
        elif status == 529:
            code, retryable = ErrorCode.OVERLOADED, True
        elif status >= 500:
            code, retryable = ErrorCode.UPSTREAM_ERROR, True
        elif status in ( 400, 404, 413, 422 ):
            code, retryable = ErrorCode.UPSTREAM_REJECTED, False
        elif status in ( 401, 403 ):
            code, retryable = ErrorCode.AUTH_FAILED, False
        else:
            code, retryable = ErrorCode.INTERNAL_ERROR, False

        return ErrorLine(
            type = "error",
            code = code,
            message = f"Anthropic returned HTTP {status}",
            retryable = retryable
        )

    if isinstance( exception, ( APIError, httpx2.TransportError ) ):
        return ErrorLine(
            type = "error",
            code = ErrorCode.UPSTREAM_ERROR,
            message = f"Connection to Anthropic failed ({type( exception ).__name__})",
            retryable = True
        )

    return ErrorLine(
        type = "error",
        code = ErrorCode.INTERNAL_ERROR,
        message = f"Unexpected error in the agent service ({type( exception ).__name__})",
        retryable = False
    )
