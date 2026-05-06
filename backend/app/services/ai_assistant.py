import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.error import URLError
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from app.models.schemas import (
    AiModelSummary,
    AiProviderConfigProfile,
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
        config, source, profiles = self._effective_config()
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
            active_profile_id=self._clean_string(config.get("profile_id")),
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
            profiles=profiles,
        )

    def update_config(self, payload: AiProviderConfigUpdate) -> AiProviderConfigStatus:
        current = self._normalized_local_config()
        updates = payload.model_dump(exclude_unset=True)
        profiles = current["profiles"]
        profile_id = self._clean_string(updates.get("profile_id"))
        create_profile = bool(updates.get("create_profile"))
        selected_profile = None if create_profile else self._profile_by_id(profiles, profile_id)
        if selected_profile is None and not create_profile:
            selected_profile = (
                self._profile_by_id(profiles, self._clean_string(current.get("active_profile_id")))
                if not profile_id
                else None
            )
        if selected_profile is None:
            selected_profile = self._new_profile(updates)
            selected_profile["id"] = self._unique_profile_id(profiles, self._clean_string(selected_profile.get("id")))
            profiles.append(selected_profile)

        if "enabled" in updates:
            current["enabled"] = updates["enabled"]

        if "profile_name" in updates:
            selected_profile["name"] = self._clean_string(updates.get("profile_name")) or selected_profile["name"]

        for key in ("provider", "model", "base_url", "temperature", "max_output_tokens"):
            if key in updates:
                selected_profile[key] = updates[key]

        if payload.clear_api_key:
            selected_profile.pop("api_key", None)
        elif payload.api_key is not None:
            selected_profile["api_key"] = payload.api_key

        provider = self._clean_string(selected_profile.get("provider"))
        if provider and provider not in PROVIDERS:
            raise ValueError(f"Unsupported AI provider: {provider}")

        selected_profile["id"] = self._clean_string(selected_profile.get("id")) or self._profile_id_for(
            selected_profile
        )
        if payload.activate:
            current["active_profile_id"] = selected_profile["id"]

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
            try:
                self._litellm_completion(
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
                message=f"Ollama responded successfully with {status.model}.",
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

    def _effective_config(self) -> tuple[dict[str, object], str, list[AiProviderConfigProfile]]:
        local_config = self._normalized_local_config()
        profiles = self._profile_statuses(local_config)
        config = self._active_profile_config(local_config)
        config["enabled"] = local_config.get("enabled", False)
        source = "local_file" if profiles else "default"
        env_config = self._read_env_config()
        if env_config:
            config.update(env_config)
            source = "environment"
        return config, source, profiles

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

    def _normalized_local_config(self) -> dict[str, object]:
        raw_config = self._read_local_config()
        if isinstance(raw_config.get("profiles"), list):
            profiles = [
                self._normalize_profile(profile)
                for profile in raw_config.get("profiles", [])
                if isinstance(profile, dict)
            ]
            active_profile_id = self._clean_string(raw_config.get("active_profile_id"))
            if not active_profile_id and profiles:
                active_profile_id = self._clean_string(profiles[0].get("id"))
            return {
                "enabled": self._clean_bool(raw_config.get("enabled")),
                "active_profile_id": active_profile_id,
                "profiles": profiles,
            }

        if not raw_config:
            return {"enabled": False, "active_profile_id": "", "profiles": []}

        profile = self._normalize_profile(
            {
                "id": self._clean_string(raw_config.get("profile_id")) or "default",
                "name": self._clean_string(raw_config.get("profile_name")) or "Default",
                "provider": raw_config.get("provider", ""),
                "model": raw_config.get("model", ""),
                "base_url": raw_config.get("base_url", ""),
                "api_key": raw_config.get("api_key", ""),
                "temperature": raw_config.get("temperature", 0.2),
                "max_output_tokens": raw_config.get("max_output_tokens", 1200),
            }
        )
        return {
            "enabled": self._clean_bool(raw_config.get("enabled")),
            "active_profile_id": profile["id"],
            "profiles": [profile],
        }

    def _active_profile_config(self, local_config: dict[str, object]) -> dict[str, object]:
        profiles = local_config.get("profiles", [])
        if not isinstance(profiles, list):
            profiles = []
        active_profile_id = self._clean_string(local_config.get("active_profile_id"))
        active_profile = self._profile_by_id(profiles, active_profile_id) or (profiles[0] if profiles else {})
        config = dict(active_profile) if isinstance(active_profile, dict) else {}
        config["profile_id"] = self._clean_string(config.get("id"))
        return config

    def _profile_statuses(self, local_config: dict[str, object]) -> list[AiProviderConfigProfile]:
        profiles = local_config.get("profiles", [])
        if not isinstance(profiles, list):
            return []
        active_profile_id = self._clean_string(local_config.get("active_profile_id"))
        results: list[AiProviderConfigProfile] = []
        for profile in profiles:
            if not isinstance(profile, dict):
                continue
            provider_id = self._clean_string(profile.get("provider"))
            provider = PROVIDERS.get(provider_id)
            base_url = self._clean_string(profile.get("base_url"))
            if not base_url and provider:
                base_url = provider.default_base_url
            model = self._clean_string(profile.get("model"))
            api_key = self._clean_string(profile.get("api_key"))
            missing = self._configuration_required(provider, model, base_url, api_key)
            profile_id = self._clean_string(profile.get("id"))
            results.append(
                AiProviderConfigProfile(
                    profile_id=profile_id,
                    name=self._profile_name(profile),
                    active=profile_id == active_profile_id,
                    configured=provider is not None and not missing,
                    provider=provider.provider if provider else provider_id,
                    provider_label=provider.label if provider else "",
                    model=model,
                    base_url=base_url,
                    api_key_configured=bool(api_key),
                    temperature=self._clean_float(profile.get("temperature"), default=0.2),
                    max_output_tokens=self._clean_int(profile.get("max_output_tokens"), default=1200),
                    configuration_required=missing,
                )
            )
        return results

    def _normalize_profile(self, profile: dict[str, object]) -> dict[str, object]:
        normalized = {
            "id": self._clean_string(profile.get("id")) or self._profile_id_for(profile),
            "name": self._clean_string(profile.get("name")) or self._profile_name(profile),
            "provider": self._clean_string(profile.get("provider")),
            "model": self._clean_string(profile.get("model")),
            "base_url": self._clean_string(profile.get("base_url")),
            "temperature": self._clean_float(profile.get("temperature"), default=0.2),
            "max_output_tokens": self._clean_int(profile.get("max_output_tokens"), default=1200),
        }
        api_key = self._clean_string(profile.get("api_key"))
        if api_key:
            normalized["api_key"] = api_key
        return normalized

    def _new_profile(self, values: dict[str, object]) -> dict[str, object]:
        return self._normalize_profile(
            {
                "name": values.get("profile_name", ""),
                "provider": values.get("provider", ""),
                "model": values.get("model", ""),
                "base_url": values.get("base_url", ""),
                "temperature": values.get("temperature", 0.2),
                "max_output_tokens": values.get("max_output_tokens", 1200),
            }
        )

    def _profile_by_id(self, profiles: object, profile_id: str) -> dict[str, object] | None:
        if not profile_id or not isinstance(profiles, list):
            return None
        for profile in profiles:
            if isinstance(profile, dict) and self._clean_string(profile.get("id")) == profile_id:
                return profile
        return None

    def _profile_id_for(self, profile: dict[str, object]) -> str:
        base = "-".join(
            part
            for part in [
                self._clean_string(profile.get("provider")),
                self._clean_string(profile.get("model")),
            ]
            if part
        ) or "profile"
        slug = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")
        return slug or "profile"

    def _unique_profile_id(self, profiles: object, base_id: str) -> str:
        existing_ids = {
            self._clean_string(profile.get("id"))
            for profile in profiles
            if isinstance(profile, dict)
        } if isinstance(profiles, list) else set()
        candidate = base_id or "profile"
        suffix = 2
        while candidate in existing_ids:
            candidate = f"{base_id or 'profile'}-{suffix}"
            suffix += 1
        return candidate

    def _profile_name(self, profile: dict[str, object]) -> str:
        explicit = self._clean_string(profile.get("name"))
        if explicit:
            return explicit
        provider = PROVIDERS.get(self._clean_string(profile.get("provider")))
        provider_label = provider.label if provider else self._clean_string(profile.get("provider"))
        model = self._clean_string(profile.get("model"))
        return " · ".join(part for part in [provider_label, model] if part) or "Untitled profile"

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
        first_choice = choices[0]
        message = self._value(first_choice, "message") or {}
        text = self._extract_response_text(message) or self._clean_string(self._value(first_choice, "text"))
        if not text:
            detail = self._response_debug_excerpt(response)
            raise ValueError(
                "AI provider returned an empty response."
                + (f" Provider response excerpt: {detail}" if detail else "")
            )
        return text

    def _api_key(self) -> str:
        config, _source, _profiles = self._effective_config()
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

    @classmethod
    def _extract_response_text(cls, message: object) -> str:
        for key in ("content", "reasoning_content", "thinking", "response", "text"):
            value = cls._value(message, key)
            text = cls._text_from_value(value)
            if text:
                return text
        return ""

    @classmethod
    def _text_from_value(cls, value: object) -> str:
        if isinstance(value, list):
            return "\n".join(
                filter(
                    None,
                    [
                        cls._clean_string(item.get("text") if isinstance(item, dict) else item)
                        for item in value
                    ],
                )
            )
        if isinstance(value, dict):
            return cls._clean_string(value.get("text") or value.get("content") or value.get("response"))
        return cls._clean_string(value)

    @staticmethod
    def _value(source: object, key: str) -> object:
        if isinstance(source, dict):
            return source.get(key)
        return getattr(source, key, None)

    @staticmethod
    def _response_debug_excerpt(response: object) -> str:
        try:
            if hasattr(response, "model_dump"):
                raw = response.model_dump()
            elif isinstance(response, dict):
                raw = response
            else:
                raw = str(response)
        except Exception:
            return ""
        if isinstance(raw, str):
            text = raw
        else:
            try:
                text = json.dumps(raw, default=str)
            except TypeError:
                text = str(raw)
        return text[:500]

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
