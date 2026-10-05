from enum import StrEnum

class ErrorCode( StrEnum ):
    INVALID_REQUEST = "invalid_request"
    UNKNOWN_KIND = "unknown_kind"
    RATE_LIMITED = "rate_limited"
    OVERLOADED = "overloaded"
    UPSTREAM_ERROR = "upstream_error"
    UPSTREAM_REJECTED = "upstream_rejected"
    AUTH_FAILED = "auth_failed"
    EMPTY_REPLY = "empty_reply"
    TRUNCATED = "truncated"
    REFUSED = "refused"
    VALIDATION_FAILED = "validation_failed"
    INTERNAL_ERROR = "internal_error"
