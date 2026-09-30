from pathlib import Path
from typing import Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings( BaseSettings ):
    model_config = SettingsConfigDict(
        env_file = ".env",
        env_file_encoding = "utf-8",
        extra = "ignore"
    )

    anthropic_api_key: SecretStr | None = None
    prompts_dir: Path = Path( __file__ ).parents[ 2 ] / "prompts"
    is_fake: bool = Field( default = False, validation_alias = "AGENTS_FAKE" )

    @model_validator( mode = "after" )
    def require_api_key_unless_fake( self ) -> Self:
        if self.anthropic_api_key is None and not self.is_fake:
            raise ValueError( "ANTHROPIC_API_KEY is required unless AGENTS_FAKE is set" )

        return self
