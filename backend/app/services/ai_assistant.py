import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.error import URLError
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from app.models.schemas import (
    AiModelSummary,
    AiProviderConfigStatus,
    AiProviderConfigUpdate,
    AiProviderSummary,
    AiProviderTestResult,
)


@dataclass(frozen=True)
class ProviderDefinition:
    provider: str
    label: str
    requires_api_key: bool = False
    supports_base_url: bool = False
    local: bool = False
    default_base_url: str = ""


class AiProvider(Protocol):
    def list_models(self) -> list[AiModelSummary]:
        raise NotImplementedError

    def health_check(self) -> AiProviderTestResult:
        raise NotImplementedError

    def complete(self, messages: list[dict[str, str]], options: dict[str, object]) -> str:
        raise NotImplementedError


PROVIDERS: dict[str, ProviderDefinition] = {
    "openai": ProviderDefinition(
        provider="openai",
        label="OpenAI",
        requires_api_key=True,
    ),
    "anthropic": ProviderDefinition(
        provider="anthropic",
        label="Anthropic Claude",
        requires_api_key=True,
    ),
    "ollama": ProviderDefinition(
        provider="ollama",
        label="Ollama",
        supports_base_url=True,
        local=True,
        default_base_url="http://host.docker.internal:11434",
    ),
    "openai_compatible": ProviderDefinition(
        provider="openai_compatible",
        label="OpenAI-compatible API",
        requires_api_key=True,
        supports_base_url=True,
    ),
}


class AiAssistantService:
    def __init__(self, workspace_root: Path | None) -> None:
        self.workspace_root = workspace_root.resolve() if workspace_root else None
        self.config_path = (
            self.workspace_root / ".annotation-workbench.ai.local.json"
            if self.workspace_root
            else Path(".annotation-workbench.ai.local.json").resolve()
        )

    def config_status(self) -> AiProviderConfigStatus:
        config, source = self._effective_config()
        provider_id = self._clean_string(config.get("provider"))
        provider = PROVIDERS.get(provider_id)
        model = self._clean_string(config.get("model"))
        base_url = self._clean_string(config.get("base_url"))
        if not base_url and provider:
            base_url = provider.default_base_url
        api_key = self._clean_string(config.get("api_key")) or self._clean_string(
            os.environ.get("ANNOTATION_AI_API_KEY")
        )
        enabled = self._clean_bool(config.get("enabled"))
        temperature = self._clean_float(config.get("temperature"), default=0.2)
        max_output_tokens = self._clean_int(config.get("max_output_tokens"), default=1200)
        configuration_required = (
            self._configuration_required(
                provider=provider,
                model=model,
                base_url=base_url,
                api_key=api_key,
            )
            if enabled
            else []
        )

        return AiProviderConfigStatus(
            enabled=enabled,
            configured=enabled and provider is not None and not configuration_required,
            provider=provider.provider if provider else provider_id,
            provider_label=provider.label if provider else "",
            model=model,
            base_url=base_url,
            api_key_configured=bool(api_key),
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            source=source,
            available_providers=self.available_providers(),
            configuration_required=configuration_required,
        )

    def update_config(self, payload: AiProviderConfigUpdate) -> AiProviderConfigStatus:
        current = self._read_local_config()
        updates = payload.model_dump(exclude_unset=True)

        for key in ("enabled", "provider", "model", "base_url", "temperature", "max_output_tokens"):
            if key in updates:
                current[key] = updates[key]

        if payload.clear_api_key:
            current.pop("api_key", None)
        elif payload.api_key is not None:
            current["api_key"] = payload.api_key

        provider = self._clean_string(current.get("provider"))
        if provider and provider not in PROVIDERS:
            raise ValueError(f"Unsupported AI provider: {provider}")

        self._write_local_config(current)
        return self.config_status()

    def test_config(self) -> AiProviderTestResult:
        status = self.config_status()
        if not status.enabled:
            return AiProviderTestResult(
                ok=False,
                status="disabled",
                message="AI Assistant is disabled.",
                config=status,
            )
        if not status.configured:
            missing = ", ".join(status.configuration_required) or "provider configuration"
            return AiProviderTestResult(
                ok=False,
                status="not_configured",
                message=f"AI Assistant needs {missing}.",
                config=status,
            )
        if status.provider == "ollama":
            try:
                models = self._ollama_models(status.base_url)
            except ValueError as exc:
                return AiProviderTestResult(
                    ok=False,
                    status="provider_unavailable",
                    message=str(exc),
                    config=status,
                )
            model_names = {model.id for model in models}
            if status.model not in model_names:
                return AiProviderTestResult(
                    ok=False,
                    status="model_not_found",
                    message=f"Ollama is reachable, but model '{status.model}' was not listed.",
                    config=status,
                )
            return AiProviderTestResult(
                ok=True,
                status="connected",
                message=f"Ollama is ready with {status.model}.",
                config=status,
            )
        try:
            response = self._litellm_completion(
                status,
                [
                    {
                        "role": "user",
                        "content": "Reply with exactly: Annotation AI test OK",
                    }
                ],
                max_tokens=24,
            )
        except ValueError as exc:
            return AiProviderTestResult(
                ok=False,
                status="provider_error",
                message=str(exc),
                config=status,
            )
        return AiProviderTestResult(
            ok=True,
            status="connected",
            message=f"{status.provider_label or status.provider} responded successfully with {status.model}.",
            config=status,
        )

    def list_models(self) -> list[AiModelSummary]:
        status = self.config_status()
        if status.provider == "ollama" and status.enabled:
            return self._ollama_models(status.base_url)
        return []

    def complete(self, messages: list[dict[str, str]]) -> str:
        status = self.config_status()
        if not status.configured:
            missing = ", ".join(status.configuration_required) or "AI Assistant configuration"
            raise ValueError(f"AI Assistant needs {missing}.")
        return self._litellm_completion(status, messages)

    def available_providers(self) -> list[AiProviderSummary]:
        return [
            AiProviderSummary(
                provider=provider.provider,
                label=provider.label,
                requires_api_key=provider.requires_api_key,
                supports_base_url=provider.supports_base_url,
                local=provider.local,
            )
            for provider in PROVIDERS.values()
        ]

    def _effective_config(self) -> tuple[dict[str, object], str]:
        config = self._read_local_config()
        source = "local_file" if config else "default"
        env_config = self._read_env_config()
        if env_config:
            config.update(env_config)
            source = "environment"
        return config, source

    def _read_env_config(self) -> dict[str, object]:
        mapping = {
            "enabled": "ANNOTATION_AI_ENABLED",
            "provider": "ANNOTATION_AI_PROVIDER",
            "model": "ANNOTATION_AI_MODEL",
            "base_url": "ANNOTATION_AI_BASE_URL",
            "temperature": "ANNOTATION_AI_TEMPERATURE",
            "max_output_tokens": "ANNOTATION_AI_MAX_OUTPUT_TOKENS",
        }
        config: dict[str, object] = {}
        for key, env_name in mapping.items():
            value = os.environ.get(env_name)
            if value is not None:
                config[key] = value
        api_key = os.environ.get("ANNOTATION_AI_API_KEY")
        if api_key:
            config["api_key"] = api_key
        return config

    def _read_local_config(self) -> dict[str, object]:
        if not self.config_path.exists():
            return {}
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write_local_config(self, config: dict[str, object]) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    def _ollama_models(self, base_url: str) -> list[AiModelSummary]:
        url = f"{base_url.rstrip('/')}/api/tags"
        try:
            request = UrlRequest(url, headers={"Accept": "application/json"})
            with urlopen(request, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (OSError, URLError, json.JSONDecodeError) as exc:
            raise ValueError("Ollama is not reachable at the configured base URL.") from exc

        models = data.get("models", [])
        if not isinstance(models, list):
            return []

        results: list[AiModelSummary] = []
        for model in models:
            if not isinstance(model, dict):
                continue
            name = self._clean_string(model.get("name") or model.get("model"))
            if name:
                results.append(AiModelSummary(id=name, label=name, provider="ollama"))
        return results

    def _litellm_completion(
        self,
        status: AiProviderConfigStatus,
        messages: list[dict[str, str]],
        max_tokens: int | None = None,
    ) -> str:
        try:
            from litellm import completion
        except ImportError as exc:
            raise ValueError("LiteLLM is not installed in the backend image.") from exc

        kwargs: dict[str, object] = {
            "model": self._litellm_model_name(status.provider, status.model),
            "messages": messages,
            "temperature": status.temperature,
            "max_tokens": max_tokens or status.max_output_tokens,
        }
        api_key = self._api_key()
        if api_key:
            kwargs["api_key"] = api_key
        if status.base_url and status.provider in {"ollama", "openai_compatible"}:
            kwargs["api_base"] = status.base_url

        try:
            response = completion(**kwargs)
        except Exception as exc:
            raise ValueError(f"AI provider call failed: {exc}") from exc

        choices = getattr(response, "choices", None) or response.get("choices", [])
        if not choices:
            raise ValueError("AI provider returned no choices.")
        message = getattr(choices[0], "message", None) or choices[0].get("message", {})
        content = getattr(message, "content", None) or message.get("content")
        text = self._clean_string(content)
        if not text:
            raise ValueError("AI provider returned an empty response.")
        return text

    def _api_key(self) -> str:
        config = self._read_local_config()
        return self._clean_string(config.get("api_key")) or self._clean_string(os.environ.get("ANNOTATION_AI_API_KEY"))

    @staticmethod
    def _litellm_model_name(provider: str, model: str) -> str:
        if "/" in model:
            return model
        if provider == "ollama":
            return f"ollama_chat/{model}"
        if provider == "openai":
            return f"openai/{model}"
        if provider == "anthropic":
            return f"anthropic/{model}"
        if provider == "openai_compatible":
            return f"openai/{model}"
        return model

    @staticmethod
    def _configuration_required(
        provider: ProviderDefinition | None,
        model: str,
        base_url: str,
        api_key: str,
    ) -> list[str]:
        missing: list[str] = []
        if provider is None:
            missing.append("provider")
            return missing
        if not model:
            missing.append("model")
        if provider.requires_api_key and not api_key:
            missing.append("api_key")
        if provider.supports_base_url and provider.provider == "openai_compatible" and not base_url:
            missing.append("base_url")
        return missing

    @staticmethod
    def _clean_string(value: object) -> str:
        return value.strip() if isinstance(value, str) else ""

    @staticmethod
    def _clean_bool(value: object) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return False

    @staticmethod
    def _clean_float(value: object, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _clean_int(value: object, default: int) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default
