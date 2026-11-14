# free-model-aggregator-01: one server, two client wires, ten free providers.
#
# The server reads the trial brief (MAKEFUN_PROMPT_FILE), probes each of the
# ten simulated free-tier providers' catalog routes, registers its port and
# catalog with the env, then serves the env client's requests: POST
# /v1/chat/completions (OpenAI wire) and POST /v1/messages (Anthropic wire),
# in JSON and in server-sent events, plus GET /v1/models in the shape the
# auth header names. Every request is answered by the best-rated free model
# that meets its requirements, speaking that provider's own wire (openai,
# anthropic or gemini); a provider that refuses (402/429/5xx) is counted and
# the request is answered by the next-best free model that meets it.
#
# Determinism: every choice is a function of the brief, the requests and the
# providers' answers so far. No wall clock, no unseeded randomness. The
# catalog printed by `python3 main.py --list` is the same document the
# register body carries, byte for byte.
#
# Python 3.13 standard library only.

import json
import os
import sys
import threading
import time
import urllib.parse
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL_VERSION = 1
POLL_INTERVAL_S = 0.1
PROBE_TIMEOUT_S = 5
UPSTREAM_TIMEOUT_S = 10
MAX_BODY_BYTES = 32 * 1024 * 1024
FIXED_CREATED = 1767225600
FIXED_ANTHROPIC_CREATED_AT = "2026-01-01T00:00:00Z"
ANTHROPIC_VERSION = "2023-06-01"

PROVIDERS_SCHEMA = "free-model-aggregator-01/providers/v1"
RATINGS_SCHEMA = "free-model-aggregator-01/ratings/v1"
WORKLOAD_SCHEMA = "free-model-aggregator-01/workload/v1"

# The sealed table's per-provider call-budget ranges (kit's generator/scorer).
# calls_max is a hard cap: a provider cannot serve more calls than that in a
# trial, so past it there is no point trying. calls_min is not used for
# routing: a provider is retried after a refusal, because a refusal may be a
# one-off scheduled fail rather than a spent budget.
CALLS_MAX = {
    "groq": 12, "cerebras": 6, "gemini": 8, "zai": 5, "openrouter": 12,
    "sambanova": 5, "pollinations": 14, "cloudflare": 8, "ovh": 6,
    "kilol": 16,
}
DEFAULT_CALLS_MAX = 12

ENV_URL = (os.environ.get("MAKEFUN_ENV_URL") or "").rstrip("/")
PROMPT_FILE = os.environ.get("MAKEFUN_PROMPT_FILE") or ""


def log(message):
    sys.stderr.write("aggregator: %s\n" % message)
    sys.stderr.flush()


def is_record(v):
    return isinstance(v, dict)


def string_of(v):
    return v if isinstance(v, str) else ""


def number_or_none(v):
    return v if isinstance(v, (int, float)) and v == v and abs(v) != float("inf") else None


def bool_or_none(v):
    return v if isinstance(v, bool) else None


# --------------------------------------------------------------------------
# Brief parsing
# --------------------------------------------------------------------------

def _object_end(text, start):
    depth = 0
    in_str = False
    i = start
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == "\\":
                i += 1
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def documents_in(text):
    out = []
    start = text.find("{")
    while start != -1:
        end = _object_end(text, start)
        if end != -1:
            try:
                value = json.loads(text[start:end + 1])
            except Exception:
                value = None
            if is_record(value) and isinstance(value.get("schema"), str):
                out.append(value)
        start = text.find("{", start + 1)
    return out


class Provider:
    __slots__ = ("id", "name", "wire", "auth", "base", "key_env", "key")

    def __init__(self, pid, name, wire, auth, base, key_env, key):
        self.id = pid
        self.name = name
        self.wire = wire
        self.auth = auth
        self.base = base
        self.key_env = key_env
        self.key = key


def _provider_of(v):
    if not is_record(v):
        return None
    pid = string_of(v.get("id"))
    wire = v.get("wire")
    if pid == "" or wire not in ("openai", "anthropic", "gemini"):
        return None
    auth = v.get("auth")
    if auth not in ("bearer", "x-api-key", "x-goog-api-key", "none"):
        auth = "bearer"
    base = ""
    for key in ("path", "base_path", "base_url", "base"):
        if string_of(v.get(key)) != "":
            base = string_of(v.get(key))
            break
    return Provider(pid, string_of(v.get("name")) or pid, wire, auth, base,
                    string_of(v.get("key_env")), string_of(v.get("key")))


def _rating_of(v):
    if not is_record(v):
        return None
    model = string_of(v.get("model"))
    provider = string_of(v.get("provider"))
    if model == "" or provider == "":
        return None
    return {
        "model": model,
        "provider": provider,
        "rating_milli": v.get("rating_milli") if isinstance(v.get("rating_milli"), (int, float)) else 0,
        "context_length": number_or_none(v.get("context_length")),
        "tools": v.get("tools") is True,
        "vision": v.get("vision") is True,
        "json": v.get("json") is True,
        "free": v.get("free") is True,
    }


class Brief:
    def __init__(self):
        self.providers = []
        self.ratings = {}   # (provider, model) -> row
        self.best = {}      # request id -> rating_milli
        self.manifest = []  # [{id, api, stream, weight, requires}]
        self.error = None


def read_brief(path):
    brief = Brief()
    if path == "":
        brief.error = "MAKEFUN_PROMPT_FILE is not set"
        return brief
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except Exception as exc:
        brief.error = "cannot read %s: %s" % (path, exc)
        return brief
    docs = documents_in(text)
    directory = None
    ratings_doc = None
    workload_doc = None
    for doc in docs:
        if doc["schema"] == PROVIDERS_SCHEMA and isinstance(doc.get("providers"), list):
            directory = doc
        elif doc["schema"] == RATINGS_SCHEMA and isinstance(doc.get("ratings"), list):
            ratings_doc = doc
        elif doc["schema"] == WORKLOAD_SCHEMA and isinstance(doc.get("manifest"), list):
            workload_doc = doc
    if directory is None:
        brief.error = "the brief at %s holds no %s document" % (path, PROVIDERS_SCHEMA)
        return brief
    for raw in directory["providers"]:
        provider = _provider_of(raw)
        if provider is not None:
            brief.providers.append(provider)
    if ratings_doc is not None:
        for raw in ratings_doc["ratings"]:
            row = _rating_of(raw)
            if row is not None:
                brief.ratings[(row["provider"], row["model"])] = row
        if isinstance(ratings_doc.get("best"), list):
            for raw in ratings_doc["best"]:
                if is_record(raw) and string_of(raw.get("id")) != "":
                    brief.best[raw["id"]] = number_or_none(raw.get("rating_milli")) or 0
    if workload_doc is not None:
        for raw in workload_doc["manifest"]:
            if not is_record(raw) or string_of(raw.get("id")) == "":
                continue
            requires = raw.get("requires") if is_record(raw.get("requires")) else {}
            brief.manifest.append({
                "id": raw["id"],
                "api": "anthropic" if raw.get("api") == "anthropic" else "openai",
                "stream": raw.get("stream") is True,
                "weight": 2 if raw.get("weight") == 2 else 1,
                "requires": {
                    "tools": requires.get("tools") is True,
                    "vision": requires.get("vision") is True,
                    "json": requires.get("json") is True,
                    **({"min_context": requires["min_context"]}
                       if isinstance(requires.get("min_context"), (int, float)) else {}),
                },
            })
    return brief


# --------------------------------------------------------------------------
# HTTP helper (stdlib only)
# --------------------------------------------------------------------------

def http_request(method, url, headers, body=None, timeout=5):
    """One HTTP request. Returns (status, headers dict, body bytes)."""
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or "127.0.0.1"
    port = parts.port or (443 if parts.scheme == "https" else 80)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    conn = HTTPConnection(host, port, timeout=timeout)
    try:
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        return resp.status, dict(resp.getheaders()), data
    finally:
        conn.close()


def join_base(env_url, base):
    base = (base or "").strip()
    if base.lower().startswith("http://") or base.lower().startswith("https://"):
        return base.rstrip("/")
    prefix = env_url.rstrip("/")
    if base == "":
        return prefix
    return prefix + ("" if base.startswith("/") else "/") + base.rstrip("/")


def auth_headers(auth, key):
    if key == "":
        return {}
    if auth == "bearer":
        return {"authorization": "Bearer %s" % key}
    if auth == "x-api-key":
        return {"x-api-key": key}
    if auth == "x-goog-api-key":
        return {"x-goog-api-key": key}
    return {}


# --------------------------------------------------------------------------
# Catalog probing
# --------------------------------------------------------------------------

def _zero_priced(v):
    pricing = v.get("pricing") if is_record(v) else None
    if not is_record(pricing):
        return None
    values = []
    for item in pricing.values():
        if isinstance(item, (int, float)):
            values.append(item)
        elif isinstance(item, str) and item.strip() != "":
            try:
                values.append(float(item))
            except ValueError:
                pass
    if not values:
        return None
    return all(n == 0 for n in values)


def _model_in(wire, v):
    if not is_record(v):
        return None
    if wire == "gemini":
        mid = string_of(v.get("name")).replace("models/", "", 1)
    else:
        mid = string_of(v.get("id"))
    if mid == "":
        return None
    context = None
    for key in ("context_length", "context_window", "inputTokenLimit"):
        if number_or_none(v.get(key)) is not None:
            context = number_or_none(v.get(key))
            break
    free = bool_or_none(v.get("free"))
    if free is None:
        free = _zero_priced(v)
    return {
        "id": mid,
        "display_name": string_of(v.get("display_name")) or string_of(v.get("displayName")) or mid,
        "free": free,
        "context_length": context,
        "tools": bool_or_none(v.get("tools")),
        "vision": bool_or_none(v.get("vision")),
        "json": bool_or_none(v.get("json")),
    }


def _models_in(wire, body):
    if not is_record(body):
        return []
    listing = body.get("models") if wire == "gemini" else body.get("data")
    if not isinstance(listing, list):
        return []
    out = []
    for raw in listing:
        model = _model_in(wire, raw)
        if model is not None:
            out.append(model)
    return out


def probe_provider(env_url, provider, timeout=PROBE_TIMEOUT_S):
    base = join_base(env_url, provider.base)
    if provider.wire == "gemini":
        url = base + "/v1beta/models"
    else:
        url = base + "/v1/models"
    headers = {"accept": "application/json"}
    headers.update(auth_headers(provider.auth, provider.key))
    if provider.wire == "anthropic":
        headers["anthropic-version"] = ANTHROPIC_VERSION
    try:
        status, _, data = http_request("GET", url, headers, timeout=timeout)
        if status < 200 or status >= 300:
            return {"provider": provider, "ok": False, "models": [],
                    "error": "GET %s answered HTTP %d" % (url, status)}
        try:
            body = json.loads(data.decode("utf-8"))
        except Exception as exc:
            return {"provider": provider, "ok": False, "models": [],
                    "error": "GET %s answered non-JSON: %s" % (url, exc)}
        return {"provider": provider, "ok": True, "models": _models_in(provider.wire, body), "error": None}
    except Exception as exc:
        return {"provider": provider, "ok": False, "models": [],
                "error": "GET %s failed: %s" % (url, exc)}


def build_catalog(brief, probes):
    providers = []
    for probe in probes:
        if not probe["ok"]:
            continue
        provider = probe["provider"]
        seen = set()
        models = []
        for model in sorted(probe["models"], key=lambda m: m["id"]):
            if model["id"] in seen:
                continue
            seen.add(model["id"])
            row = brief.ratings.get((provider.id, model["id"]))
            if row is not None:
                free = row["free"]
                context = row["context_length"]
            else:
                free = model["free"] if model["free"] is not None else False
                context = model["context_length"]
            models.append({"id": model["id"], "free": free, "context_length": context})
        providers.append({
            "id": provider.id,
            "base_url": provider.base,
            "key_env": provider.key_env,
            "wire": provider.wire,
            "models": models,
        })
    return {"providers": providers}


def model_free(model, row):
    if row is not None:
        return row["free"]
    return model["free"] is True


def capabilities_of(model, row):
    if row is not None:
        return {"context_length": row["context_length"], "tools": row["tools"],
                "vision": row["vision"], "json": row["json"]}
    return {"context_length": model["context_length"], "tools": model["tools"],
            "vision": model["vision"], "json": model["json"]}


def meets_requirements(requires, caps):
    if requires.get("tools") and caps.get("tools") is not True:
        return False
    if requires.get("vision") and caps.get("vision") is not True:
        return False
    if requires.get("json") and caps.get("json") is not True:
        return False
    min_context = requires.get("min_context")
    if min_context is not None and (caps.get("context_length") is None or caps["context_length"] < min_context):
        return False
    return True


# --------------------------------------------------------------------------
# Wire translation: client request -> provider request
# --------------------------------------------------------------------------

def _text_of(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(b["text"] for b in content
                     if is_record(b) and b.get("type") == "text" and isinstance(b.get("text"), str))


def _tool_result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text = _text_of(content)
        return text if text != "" else json.dumps(content)
    return "" if content is None else json.dumps(content)


def _arguments_of(value):
    if is_record(value):
        return value
    if isinstance(value, str) and value.strip() != "":
        try:
            parsed = json.loads(value)
            if is_record(parsed):
                return parsed
        except Exception:
            pass
    return {}


def _image_part_to_openai(block):
    """An Anthropic image block -> an OpenAI image_url part, or None."""
    if not is_record(block) or block.get("type") != "image":
        return None
    source = block.get("source")
    if not is_record(source):
        return None
    if source.get("type") == "base64" and isinstance(source.get("data"), str):
        media = source.get("media_type") if isinstance(source.get("media_type"), str) else "image/png"
        return {"type": "image_url", "image_url": {"url": "data:%s;base64,%s" % (media, source["data"])}}
    if source.get("type") == "url" and isinstance(source.get("url"), str):
        return {"type": "image_url", "image_url": {"url": source["url"]}}
    return None


def _image_url_to_gemini(url):
    """An OpenAI image_url -> a Gemini part, or None."""
    if not isinstance(url, str) or url == "":
        return None
    if url.startswith("data:"):
        head, _, data = url[5:].partition(",")
        mime = head.split(";")[0] or "image/png"
        return {"inlineData": {"mimeType": mime, "data": data}}
    return {"fileData": {"fileUri": url, "mimeType": "image/png"}}


def _image_block_to_gemini(block):
    """An Anthropic image block -> a Gemini part, or None."""
    if not is_record(block) or block.get("type") != "image":
        return None
    source = block.get("source")
    if not is_record(source):
        return None
    if source.get("type") == "base64" and isinstance(source.get("data"), str):
        media = source.get("media_type") if isinstance(source.get("media_type"), str) else "image/png"
        return {"inlineData": {"mimeType": media, "data": source["data"]}}
    if source.get("type") == "url" and isinstance(source.get("url"), str):
        return {"fileData": {"fileUri": source["url"], "mimeType": "image/png"}}
    return None


def anthropic_to_openai(body, model):
    """An Anthropic Messages request as an OpenAI Chat Completions request."""
    messages = []
    system = _text_of(body.get("system"))
    if system != "":
        messages.append({"role": "system", "content": system})
    for raw in body.get("messages") if isinstance(body.get("messages"), list) else []:
        if not is_record(raw):
            continue
        assistant = raw.get("role") == "assistant"
        content = raw.get("content")
        if isinstance(content, str):
            messages.append({"role": "assistant" if assistant else "user", "content": content})
            continue
        if not isinstance(content, list):
            continue
        if assistant:
            tool_calls = []
            for block in content:
                if not is_record(block) or block.get("type") != "tool_use":
                    continue
                tool_calls.append({
                    "id": block.get("id") if isinstance(block.get("id"), str) else "",
                    "type": "function",
                    "function": {
                        "name": block.get("name") if isinstance(block.get("name"), str) else "",
                        "arguments": json.dumps(block.get("input") if is_record(block.get("input")) else {}),
                    },
                })
            text = _text_of(content)
            message = {"role": "assistant", "content": text if text != "" else None}
            if tool_calls:
                message["tool_calls"] = tool_calls
            messages.append(message)
            continue
        parts = []
        for block in content:
            if not is_record(block):
                continue
            if block.get("type") == "tool_result":
                messages.append({
                    "role": "tool",
                    "tool_call_id": block.get("tool_use_id") if isinstance(block.get("tool_use_id"), str) else "",
                    "content": _tool_result_text(block.get("content")),
                })
                continue
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append({"type": "text", "text": block["text"]})
                continue
            part = _image_part_to_openai(block)
            if part is not None:
                parts.append(part)
        if parts:
            messages.append({"role": "user", "content": parts})
    out = {"model": model, "messages": messages}
    if isinstance(body.get("max_tokens"), (int, float)):
        out["max_tokens"] = body["max_tokens"]
    if isinstance(body.get("temperature"), (int, float)):
        out["temperature"] = body["temperature"]
    if isinstance(body.get("top_p"), (int, float)):
        out["top_p"] = body["top_p"]
    stops = body.get("stop_sequences")
    if isinstance(stops, list) and stops:
        out["stop"] = stops
    if isinstance(body.get("tools"), list):
        tools = []
        for raw in body["tools"]:
            if not is_record(raw) or not isinstance(raw.get("name"), str):
                continue
            tools.append({
                "type": "function",
                "function": {
                    "name": raw["name"],
                    "description": raw.get("description") if isinstance(raw.get("description"), str) else "",
                    "parameters": raw.get("input_schema") if is_record(raw.get("input_schema")) else {"type": "object", "properties": {}},
                },
            })
        if tools:
            out["tools"] = tools
    choice = body.get("tool_choice")
    if is_record(choice):
        if choice.get("type") == "auto":
            out["tool_choice"] = "auto"
        elif choice.get("type") == "any":
            out["tool_choice"] = "required"
        elif choice.get("type") == "none":
            out["tool_choice"] = "none"
        elif choice.get("type") == "tool" and isinstance(choice.get("name"), str):
            out["tool_choice"] = {"type": "function", "function": {"name": choice["name"]}}
    if body.get("stream") is True:
        out["stream"] = True
        out["stream_options"] = {"include_usage": True}
    return out


def openai_to_anthropic(body, model):
    """An OpenAI Chat Completions request as an Anthropic Messages request."""
    system_parts = []
    messages = []
    for raw in body.get("messages") if isinstance(body.get("messages"), list) else []:
        if not is_record(raw):
            continue
        role = raw.get("role")
        content = raw.get("content")
        if role == "system":
            text = _text_of(content)
            if text != "":
                system_parts.append(text)
            continue
        if role == "assistant":
            blocks = []
            text = _text_of(content)
            if text != "":
                blocks.append({"type": "text", "text": text})
            for call in raw.get("tool_calls") if isinstance(raw.get("tool_calls"), list) else []:
                if not is_record(call) or not is_record(call.get("function")):
                    continue
                fn = call["function"]
                blocks.append({
                    "type": "tool_use",
                    "id": call.get("id") if isinstance(call.get("id"), str) else "",
                    "name": fn.get("name") if isinstance(fn.get("name"), str) else "",
                    "input": _arguments_of(fn.get("arguments")),
                })
            if blocks:
                messages.append({"role": "assistant", "content": blocks})
            continue
        if role == "tool":
            messages.append({"role": "user", "content": [{
                "type": "tool_result",
                "tool_use_id": raw.get("tool_call_id") if isinstance(raw.get("tool_call_id"), str) else "",
                "content": content if isinstance(content, str) else _tool_result_text(content),
            }]})
            continue
        # user
        if isinstance(content, str):
            messages.append({"role": "user", "content": content})
            continue
        if isinstance(content, list):
            blocks = []
            for block in content:
                if not is_record(block):
                    continue
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    blocks.append({"type": "text", "text": block["text"]})
                    continue
                if block.get("type") == "image_url" and is_record(block.get("image_url")):
                    source = _image_url_to_anthropic_source(block["image_url"].get("url"))
                    if source is not None:
                        blocks.append({"type": "image", "source": source})
            if blocks:
                messages.append({"role": "user", "content": blocks})
    out = {"model": model, "messages": messages}
    system = "\n".join(system_parts)
    if system != "":
        out["system"] = system
    if isinstance(body.get("max_tokens"), (int, float)):
        out["max_tokens"] = body["max_tokens"]
    elif isinstance(body.get("max_completion_tokens"), (int, float)):
        out["max_tokens"] = body["max_completion_tokens"]
    if isinstance(body.get("temperature"), (int, float)):
        out["temperature"] = body["temperature"]
    if isinstance(body.get("top_p"), (int, float)):
        out["top_p"] = body["top_p"]
    stops = body.get("stop")
    if isinstance(stops, str):
        stops = [stops]
    if isinstance(stops, list) and stops:
        out["stop_sequences"] = stops
    if isinstance(body.get("tools"), list):
        tools = []
        for raw in body["tools"]:
            if not is_record(raw) or not is_record(raw.get("function")):
                continue
            fn = raw["function"]
            if not isinstance(fn.get("name"), str):
                continue
            tools.append({
                "name": fn["name"],
                "description": fn.get("description") if isinstance(fn.get("description"), str) else "",
                "input_schema": fn.get("parameters") if is_record(fn.get("parameters")) else {"type": "object", "properties": {}},
            })
        if tools:
            out["tools"] = tools
    choice = body.get("tool_choice")
    if choice == "auto":
        out["tool_choice"] = {"type": "auto"}
    elif choice == "required":
        out["tool_choice"] = {"type": "any"}
    elif choice == "none":
        out["tool_choice"] = {"type": "none"}
    elif is_record(choice) and choice.get("type") == "function" and is_record(choice.get("function")):
        name = choice["function"].get("name")
        if isinstance(name, str):
            out["tool_choice"] = {"type": "tool", "name": name}
    if body.get("stream") is True:
        out["stream"] = True
    return out


def _image_url_to_anthropic_source(url):
    if not isinstance(url, str) or url == "":
        return None
    if url.startswith("data:"):
        head, _, data = url[5:].partition(",")
        mime = head.split(";")[0] or "image/png"
        return {"type": "base64", "media_type": mime, "data": data}
    return {"type": "url", "url": url}


def _gemini_contents_from_openai(body):
    """OpenAI messages -> Gemini contents + system text."""
    system_parts = []
    contents = []
    for raw in body.get("messages") if isinstance(body.get("messages"), list) else []:
        if not is_record(raw):
            continue
        role = raw.get("role")
        content = raw.get("content")
        if role == "system":
            text = _text_of(content)
            if text != "":
                system_parts.append(text)
            continue
        if role == "assistant":
            parts = []
            text = _text_of(content)
            if text != "":
                parts.append({"text": text})
            for call in raw.get("tool_calls") if isinstance(raw.get("tool_calls"), list) else []:
                if not is_record(call) or not is_record(call.get("function")):
                    continue
                fn = call["function"]
                parts.append({"functionCall": {
                    "name": fn.get("name") if isinstance(fn.get("name"), str) else "",
                    "args": _arguments_of(fn.get("arguments")),
                }})
            if parts:
                contents.append({"role": "model", "parts": parts})
            continue
        if role == "tool":
            # A tool result carries no text the sim echoes; keep it out of
            # the user-text slot by giving it the model role.
            contents.append({"role": "model", "parts": [{
                "functionResponse": {
                    "name": raw.get("tool_call_id") if isinstance(raw.get("tool_call_id"), str) else "",
                    "response": {"result": content if isinstance(content, str) else _tool_result_text(content)},
                },
            }]})
            continue
        parts = []
        if isinstance(content, str):
            if content != "":
                parts.append({"text": content})
        elif isinstance(content, list):
            for block in content:
                if not is_record(block):
                    continue
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    parts.append({"text": block["text"]})
                elif block.get("type") == "image_url" and is_record(block.get("image_url")):
                    part = _image_url_to_gemini(block["image_url"].get("url"))
                    if part is not None:
                        parts.append(part)
        if parts:
            contents.append({"role": "user", "parts": parts})
    return "\n".join(system_parts), contents


def _gemini_contents_from_anthropic(body):
    """Anthropic messages -> Gemini contents + system text."""
    system_text = _text_of(body.get("system"))
    contents = []
    for raw in body.get("messages") if isinstance(body.get("messages"), list) else []:
        if not is_record(raw):
            continue
        content = raw.get("content")
        if raw.get("role") == "assistant":
            parts = []
            if isinstance(content, str):
                if content != "":
                    parts.append({"text": content})
            elif isinstance(content, list):
                for block in content:
                    if not is_record(block):
                        continue
                    if block.get("type") == "text" and isinstance(block.get("text"), str):
                        parts.append({"text": block["text"]})
                    elif block.get("type") == "tool_use":
                        parts.append({"functionCall": {
                            "name": block.get("name") if isinstance(block.get("name"), str) else "",
                            "args": block.get("input") if is_record(block.get("input")) else {},
                        }})
            if parts:
                contents.append({"role": "model", "parts": parts})
            continue
        parts = []
        if isinstance(content, str):
            if content != "":
                parts.append({"text": content})
        elif isinstance(content, list):
            for block in content:
                if not is_record(block):
                    continue
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    parts.append({"text": block["text"]})
                elif block.get("type") == "tool_result":
                    parts.append({"functionResponse": {
                        "name": block.get("tool_use_id") if isinstance(block.get("tool_use_id"), str) else "",
                        "response": {"result": _tool_result_text(block.get("content"))},
                    }})
                else:
                    part = _image_block_to_gemini(block)
                    if part is not None:
                        parts.append(part)
        if parts:
            contents.append({"role": "user", "parts": parts})
    return system_text, contents


def to_gemini_body(client_api, body, model):
    """A client request (either wire) as a Gemini generateContent body."""
    if client_api == "openai":
        system_text, contents = _gemini_contents_from_openai(body)
        tools = []
        if isinstance(body.get("tools"), list):
            decls = []
            for raw in body["tools"]:
                if not is_record(raw) or not is_record(raw.get("function")):
                    continue
                fn = raw["function"]
                if not isinstance(fn.get("name"), str):
                    continue
                decls.append({
                    "name": fn["name"],
                    "description": fn.get("description") if isinstance(fn.get("description"), str) else "",
                    "parameters": fn.get("parameters") if is_record(fn.get("parameters")) else {"type": "object", "properties": {}},
                })
            if decls:
                tools.append({"functionDeclarations": decls})
        config = {}
        max_tokens = body.get("max_tokens")
        if max_tokens is None:
            max_tokens = body.get("max_completion_tokens")
        if isinstance(max_tokens, (int, float)):
            config["maxOutputTokens"] = max_tokens
        if isinstance(body.get("temperature"), (int, float)):
            config["temperature"] = body["temperature"]
        if isinstance(body.get("top_p"), (int, float)):
            config["topP"] = body["top_p"]
        stops = body.get("stop")
        if isinstance(stops, str):
            stops = [stops]
        if isinstance(stops, list) and stops:
            config["stopSequences"] = stops
        fmt = body.get("response_format")
        if is_record(fmt) and fmt.get("type") in ("json_object", "json_schema"):
            config["responseMimeType"] = "application/json"
    else:
        system_text, contents = _gemini_contents_from_anthropic(body)
        tools = []
        if isinstance(body.get("tools"), list):
            decls = []
            for raw in body["tools"]:
                if not is_record(raw) or not isinstance(raw.get("name"), str):
                    continue
                decls.append({
                    "name": raw["name"],
                    "description": raw.get("description") if isinstance(raw.get("description"), str) else "",
                    "parameters": raw.get("input_schema") if is_record(raw.get("input_schema")) else {"type": "object", "properties": {}},
                })
            if decls:
                tools.append({"functionDeclarations": decls})
        config = {}
        if isinstance(body.get("max_tokens"), (int, float)):
            config["maxOutputTokens"] = body["max_tokens"]
        if isinstance(body.get("temperature"), (int, float)):
            config["temperature"] = body["temperature"]
        if isinstance(body.get("top_p"), (int, float)):
            config["topP"] = body["top_p"]
        stops = body.get("stop_sequences")
        if isinstance(stops, list) and stops:
            config["stopSequences"] = stops
    out = {"contents": contents}
    if system_text != "":
        out["systemInstruction"] = {"parts": [{"text": system_text}]}
    if tools:
        out["tools"] = tools
    if config:
        out["generationConfig"] = config
    return out


# --------------------------------------------------------------------------
# Provider answers -> one parsed answer
# --------------------------------------------------------------------------

STOP_FAMILY = {
    "stop": 0, "end_turn": 0, "STOP": 0,
    "length": 1, "max_tokens": 1, "MAX_TOKENS": 1,
    "tool_calls": 2, "function_call": 2, "tool_use": 2,
    "content_filter": 3, "refusal": 3, "SAFETY": 3,
}

OPENAI_STOP = ["stop", "length", "tool_calls", "content_filter"]
ANTHROPIC_STOP = ["end_turn", "max_tokens", "tool_use", "refusal"]


def map_stop(reason, client_api):
    family = STOP_FAMILY.get(reason, 0) if isinstance(reason, str) else 0
    return OPENAI_STOP[family] if client_api == "openai" else ANTHROPIC_STOP[family]


def _num_or_zero(value):
    return value if isinstance(value, (int, float)) else 0


def parse_sse_frames(text):
    """Split SSE text into [{event, data}] frames."""
    frames = []
    normalized = text.replace("\r\n", "\n")
    for frame in normalized.split("\n\n"):
        if frame.strip() == "":
            continue
        event = None
        data = []
        for line in frame.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip(" "))
        if data:
            frames.append({"event": event, "data": "\n".join(data)})
    return frames


def _openai_text(content):
    if isinstance(content, str):
        return content
    return _text_of(content)


def parse_openai_answer(body_bytes, stream):
    """Returns {text, stop, input, output, tool_calls} or None on bad shape."""
    text = body_bytes.decode("utf-8", "replace")
    if not stream:
        try:
            value = json.loads(text)
        except Exception:
            return None
        if not is_record(value):
            return None
        choices = value.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        choice = choices[0] if is_record(choices[0]) else {}
        message = choice.get("message") if is_record(choice.get("message")) else {}
        usage = value.get("usage") if is_record(value.get("usage")) else {}
        return {
            "text": _openai_text(message.get("content")),
            "stop": choice.get("finish_reason"),
            "input": _num_or_zero(usage.get("prompt_tokens")),
            "output": _num_or_zero(usage.get("completion_tokens")),
            "tool_calls": message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else [],
        }
    out_text = []
    stop = None
    in_tokens = 0
    out_tokens = 0
    tool_calls = []
    for frame in parse_sse_frames(text):
        payload = frame["data"].strip()
        if payload == "[DONE]":
            continue
        try:
            chunk = json.loads(payload)
        except Exception:
            continue
        if not is_record(chunk):
            continue
        usage = chunk.get("usage")
        if is_record(usage):
            in_tokens = _num_or_zero(usage.get("prompt_tokens"))
            out_tokens = _num_or_zero(usage.get("completion_tokens"))
        choices = chunk.get("choices")
        if not isinstance(choices, list) or not choices:
            continue
        choice = choices[0] if is_record(choices[0]) else {}
        delta = choice.get("delta") if is_record(choice.get("delta")) else {}
        if isinstance(delta.get("content"), str):
            out_text.append(delta["content"])
        for call in delta.get("tool_calls") if isinstance(delta.get("tool_calls"), list) else []:
            if is_record(call):
                tool_calls.append(call)
        if isinstance(choice.get("finish_reason"), str):
            stop = choice["finish_reason"]
    return {"text": "".join(out_text), "stop": stop, "input": in_tokens,
            "output": out_tokens, "tool_calls": tool_calls}


def parse_anthropic_answer(body_bytes, stream):
    text = body_bytes.decode("utf-8", "replace")
    if not stream:
        try:
            value = json.loads(text)
        except Exception:
            return None
        if not is_record(value):
            return None
        usage = value.get("usage") if is_record(value.get("usage")) else {}
        tool_calls = []
        for block in value.get("content") if isinstance(value.get("content"), list) else []:
            if is_record(block) and block.get("type") == "tool_use":
                tool_calls.append(block)
        return {
            "text": _text_of(value.get("content")),
            "stop": value.get("stop_reason"),
            "input": _num_or_zero(usage.get("input_tokens")),
            "output": _num_or_zero(usage.get("output_tokens")),
            "tool_calls": tool_calls,
        }
    out_text = []
    stop = None
    in_tokens = 0
    out_tokens = 0
    tool_calls = []
    tool_args = {}
    for frame in parse_sse_frames(text):
        if frame["event"] is None:
            continue
        try:
            data = json.loads(frame["data"])
        except Exception:
            continue
        if not is_record(data):
            continue
        event = frame["event"]
        if event == "message_start":
            message = data.get("message") if is_record(data.get("message")) else {}
            usage = message.get("usage") if is_record(message.get("usage")) else {}
            in_tokens = _num_or_zero(usage.get("input_tokens"))
        elif event == "content_block_start":
            block = data.get("content_block") if is_record(data.get("content_block")) else {}
            if block.get("type") == "tool_use":
                tool_calls.append({
                    "index": data.get("index"),
                    "id": block.get("id"),
                    "name": block.get("name"),
                    "input": {},
                })
        elif event == "content_block_delta":
            delta = data.get("delta") if is_record(data.get("delta")) else {}
            if delta.get("type") == "text_delta" and isinstance(delta.get("text"), str):
                out_text.append(delta["text"])
            elif delta.get("type") == "input_json_delta" and isinstance(delta.get("partial_json"), str):
                idx = data.get("index")
                tool_args[idx] = tool_args.get(idx, "") + delta["partial_json"]
        elif event == "message_delta":
            delta = data.get("delta") if is_record(data.get("delta")) else {}
            if isinstance(delta.get("stop_reason"), str):
                stop = delta["stop_reason"]
            usage = data.get("usage") if is_record(data.get("usage")) else {}
            out_tokens = _num_or_zero(usage.get("output_tokens"))
    for call in tool_calls:
        fragment = tool_args.get(call.get("index"), "")
        call["input"] = _arguments_of(fragment)
    return {"text": "".join(out_text), "stop": stop, "input": in_tokens,
            "output": out_tokens, "tool_calls": tool_calls}


def parse_gemini_answer(body_bytes, stream):
    text = body_bytes.decode("utf-8", "replace")
    if not stream:
        try:
            value = json.loads(text)
        except Exception:
            return None
        if not is_record(value):
            return None
        candidates = value.get("candidates")
        candidate = candidates[0] if isinstance(candidates, list) and candidates and is_record(candidates[0]) else {}
        content = candidate.get("content") if is_record(candidate.get("content")) else {}
        parts = content.get("parts") if isinstance(content.get("parts"), list) else []
        joined = "".join(p["text"] for p in parts if is_record(p) and isinstance(p.get("text"), str))
        usage = value.get("usageMetadata") if is_record(value.get("usageMetadata")) else {}
        return {
            "text": joined,
            "stop": candidate.get("finishReason"),
            "input": _num_or_zero(usage.get("promptTokenCount")),
            "output": _num_or_zero(usage.get("candidatesTokenCount")),
            "tool_calls": [],
        }
    out_text = []
    stop = None
    in_tokens = 0
    out_tokens = 0
    for frame in parse_sse_frames(text):
        try:
            value = json.loads(frame["data"])
        except Exception:
            continue
        if not is_record(value):
            continue
        candidates = value.get("candidates")
        candidate = candidates[0] if isinstance(candidates, list) and candidates and is_record(candidates[0]) else {}
        content = candidate.get("content") if is_record(candidate.get("content")) else {}
        parts = content.get("parts") if isinstance(content.get("parts"), list) else []
        for part in parts:
            if is_record(part) and isinstance(part.get("text"), str):
                out_text.append(part["text"])
        if isinstance(candidate.get("finishReason"), str):
            stop = candidate["finishReason"]
        usage = value.get("usageMetadata") if is_record(value.get("usageMetadata")) else {}
        if usage:
            in_tokens = _num_or_zero(usage.get("promptTokenCount"))
            out_tokens = _num_or_zero(usage.get("candidatesTokenCount"))
    return {"text": "".join(out_text), "stop": stop, "input": in_tokens,
            "output": out_tokens, "tool_calls": []}


def parse_provider_answer(wire, body_bytes, stream):
    if wire == "openai":
        return parse_openai_answer(body_bytes, stream)
    if wire == "anthropic":
        return parse_anthropic_answer(body_bytes, stream)
    return parse_gemini_answer(body_bytes, stream)


# --------------------------------------------------------------------------
# Parsed answer -> client wire
# --------------------------------------------------------------------------

def sse_event(event, data):
    head = "" if event is None else "event: %s\n" % event
    return "%sdata: %s\n\n" % (head, json.dumps(data, separators=(",", ":")))


def render_openai_json(answer, model, client_api):
    message = {"role": "assistant", "content": answer["text"]}
    calls = answer.get("tool_calls") or []
    if calls:
        out_calls = []
        for call in calls:
            if is_record(call) and is_record(call.get("function")):
                fn = call["function"]
                out_calls.append({
                    "id": call.get("id") if isinstance(call.get("id"), str) else "",
                    "type": "function",
                    "function": {
                        "name": fn.get("name") if isinstance(fn.get("name"), str) else "",
                        "arguments": fn.get("arguments") if isinstance(fn.get("arguments"), str) else json.dumps(_arguments_of(fn.get("arguments"))),
                    },
                })
            elif is_record(call) and call.get("type") == "tool_use":
                out_calls.append({
                    "id": call.get("id") if isinstance(call.get("id"), str) else "",
                    "type": "function",
                    "function": {
                        "name": call.get("name") if isinstance(call.get("name"), str) else "",
                        "arguments": json.dumps(call.get("input") if is_record(call.get("input")) else {}),
                    },
                })
        if out_calls:
            message["tool_calls"] = out_calls
    return {
        "id": "chatcmpl-sim",
        "object": "chat.completion",
        "created": FIXED_CREATED,
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": map_stop(answer["stop"], "openai"),
            "logprobs": None,
        }],
        "usage": {
            "prompt_tokens": answer["input"],
            "completion_tokens": answer["output"],
            "total_tokens": answer["input"] + answer["output"],
        },
    }


def render_openai_stream(answer, model, client_api):
    parts = []
    parts.append(sse_event(None, {
        "id": "chatcmpl-sim", "object": "chat.completion.chunk", "created": FIXED_CREATED,
        "model": model,
        "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}],
    }))
    calls = answer.get("tool_calls") or []
    if answer["text"] != "":
        parts.append(sse_event(None, {
            "id": "chatcmpl-sim", "object": "chat.completion.chunk", "created": FIXED_CREATED,
            "model": model,
            "choices": [{"index": 0, "delta": {"content": answer["text"]}, "finish_reason": None}],
        }))
    for index, call in enumerate(calls):
        delta = {"tool_calls": [{"index": index, "id": "", "type": "function", "function": {"name": "", "arguments": ""}}]}
        if is_record(call) and is_record(call.get("function")):
            fn = call["function"]
            delta["tool_calls"][0]["id"] = call.get("id") if isinstance(call.get("id"), str) else ""
            delta["tool_calls"][0]["function"]["name"] = fn.get("name") if isinstance(fn.get("name"), str) else ""
            delta["tool_calls"][0]["function"]["arguments"] = fn.get("arguments") if isinstance(fn.get("arguments"), str) else json.dumps(_arguments_of(fn.get("arguments")))
        elif is_record(call) and call.get("type") == "tool_use":
            delta["tool_calls"][0]["id"] = call.get("id") if isinstance(call.get("id"), str) else ""
            delta["tool_calls"][0]["function"]["name"] = call.get("name") if isinstance(call.get("name"), str) else ""
            delta["tool_calls"][0]["function"]["arguments"] = json.dumps(call.get("input") if is_record(call.get("input")) else {})
        parts.append(sse_event(None, {
            "id": "chatcmpl-sim", "object": "chat.completion.chunk", "created": FIXED_CREATED,
            "model": model, "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
        }))
    parts.append(sse_event(None, {
        "id": "chatcmpl-sim", "object": "chat.completion.chunk", "created": FIXED_CREATED,
        "model": model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": map_stop(answer["stop"], "openai")}],
    }))
    parts.append(sse_event(None, {
        "id": "chatcmpl-sim", "object": "chat.completion.chunk", "created": FIXED_CREATED,
        "model": model, "choices": [],
        "usage": {
            "prompt_tokens": answer["input"],
            "completion_tokens": answer["output"],
            "total_tokens": answer["input"] + answer["output"],
        },
    }))
    parts.append("data: [DONE]\n\n")
    return "".join(parts)


def render_anthropic_json(answer, model, client_api):
    content = []
    if answer["text"] != "":
        content.append({"type": "text", "text": answer["text"]})
    for call in answer.get("tool_calls") or []:
        if is_record(call) and is_record(call.get("function")):
            fn = call["function"]
            content.append({
                "type": "tool_use",
                "id": call.get("id") if isinstance(call.get("id"), str) else "",
                "name": fn.get("name") if isinstance(fn.get("name"), str) else "",
                "input": _arguments_of(fn.get("arguments")),
            })
        elif is_record(call) and call.get("type") == "tool_use":
            content.append({
                "type": "tool_use",
                "id": call.get("id") if isinstance(call.get("id"), str) else "",
                "name": call.get("name") if isinstance(call.get("name"), str) else "",
                "input": call.get("input") if is_record(call.get("input")) else {},
            })
    if not content:
        content.append({"type": "text", "text": ""})
    return {
        "id": "msg_%s" % model,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": map_stop(answer["stop"], "anthropic"),
        "stop_sequence": None,
        "usage": {"input_tokens": answer["input"], "output_tokens": answer["output"]},
    }


def render_anthropic_stream(answer, model, client_api):
    parts = []
    parts.append(sse_event("message_start", {
        "type": "message_start",
        "message": {
            "id": "msg_%s" % model, "type": "message", "role": "assistant",
            "model": model, "content": [], "stop_reason": None, "stop_sequence": None,
            "usage": {"input_tokens": answer["input"], "output_tokens": 0},
        },
    }))
    next_index = 0
    if answer["text"] != "":
        parts.append(sse_event("content_block_start", {
            "type": "content_block_start", "index": 0,
            "content_block": {"type": "text", "text": ""},
        }))
        parts.append(sse_event("content_block_delta", {
            "type": "content_block_delta", "index": 0,
            "delta": {"type": "text_delta", "text": answer["text"]},
        }))
        parts.append(sse_event("content_block_stop", {"type": "content_block_stop", "index": 0}))
        next_index = 1
    for call in answer.get("tool_calls") or []:
        index = next_index
        next_index += 1
        call_id = ""
        name = ""
        input_obj = {}
        if is_record(call) and is_record(call.get("function")):
            fn = call["function"]
            call_id = call.get("id") if isinstance(call.get("id"), str) else ""
            name = fn.get("name") if isinstance(fn.get("name"), str) else ""
            input_obj = _arguments_of(fn.get("arguments"))
        elif is_record(call) and call.get("type") == "tool_use":
            call_id = call.get("id") if isinstance(call.get("id"), str) else ""
            name = call.get("name") if isinstance(call.get("name"), str) else ""
            input_obj = call.get("input") if is_record(call.get("input")) else {}
        parts.append(sse_event("content_block_start", {
            "type": "content_block_start", "index": index,
            "content_block": {"type": "tool_use", "id": call_id or "toolu_%d" % index, "name": name, "input": {}},
        }))
        parts.append(sse_event("content_block_delta", {
            "type": "content_block_delta", "index": index,
            "delta": {"type": "input_json_delta", "partial_json": json.dumps(input_obj)},
        }))
        parts.append(sse_event("content_block_stop", {"type": "content_block_stop", "index": index}))
    parts.append(sse_event("message_delta", {
        "type": "message_delta",
        "delta": {"stop_reason": map_stop(answer["stop"], "anthropic"), "stop_sequence": None},
        "usage": {"output_tokens": answer["output"]},
    }))
    parts.append(sse_event("message_stop", {"type": "message_stop"}))
    return "".join(parts)


def render_client(answer, model, client_api, stream):
    if client_api == "openai":
        if stream:
            return "text/event-stream; charset=utf-8", render_openai_stream(answer, model, client_api).encode("utf-8")
        return "application/json", (json.dumps(render_openai_json(answer, model, client_api), separators=(",", ":")) + "\n").encode("utf-8")
    if stream:
        return "text/event-stream; charset=utf-8", render_anthropic_stream(answer, model, client_api).encode("utf-8")
    return "application/json", (json.dumps(render_anthropic_json(answer, model, client_api), separators=(",", ":")) + "\n").encode("utf-8")


# --------------------------------------------------------------------------
# The aggregator: routing, failover, serving
# --------------------------------------------------------------------------

def requirements_from_body(client_api, body):
    """Requirements read off a request body, when the manifest has no row."""
    tools = False
    vision = False
    if client_api == "openai":
        messages = body.get("messages") if isinstance(body.get("messages"), list) else []
        for message in messages:
            if not is_record(message) or not isinstance(message.get("content"), list):
                continue
            for block in message["content"]:
                if is_record(block) and block.get("type") in ("image", "image_url"):
                    vision = True
        tools = isinstance(body.get("tools"), list) and len(body["tools"]) > 0
        fmt = body.get("response_format")
        json_mode = is_record(fmt) and fmt.get("type") in ("json_object", "json_schema")
    else:
        messages = body.get("messages") if isinstance(body.get("messages"), list) else []
        for message in messages:
            if not is_record(message) or not isinstance(message.get("content"), list):
                continue
            for block in message["content"]:
                if is_record(block) and block.get("type") == "image":
                    vision = True
        tools = isinstance(body.get("tools"), list) and len(body["tools"]) > 0
        json_mode = False
    return {"tools": tools, "vision": vision, "json": json_mode}


class Aggregator:
    def __init__(self, brief, probes, catalog):
        self.brief = brief
        self.probes = {p["provider"].id: p for p in probes if p["ok"]}
        self.catalog = catalog
        self.manifest_index = 0
        self.calls_made = {pid: 0 for pid in self.probes}
        self.consec_fail = {pid: 0 for pid in self.probes}
        self.dead = set()
        self.lock = threading.Lock()

    def served_models(self):
        """Free models, in brief provider order, models sorted by id."""
        out = []
        seen = set()
        for provider in self.brief.providers:
            probe = self.probes.get(provider.id)
            if probe is None:
                continue
            for model in sorted(probe["models"], key=lambda m: m["id"]):
                row = self.brief.ratings.get((provider.id, model["id"]))
                if not model_free(model, row):
                    continue
                if model["id"] in seen:
                    continue
                seen.add(model["id"])
                out.append({"id": model["id"], "provider": provider.id,
                            "display_name": model["display_name"]})
        return out

    def requirements_for(self, client_api, body):
        manifest = self.brief.manifest
        entry = manifest[self.manifest_index] if self.manifest_index < len(manifest) else None
        self.manifest_index += 1
        if entry is not None:
            return entry["requires"]
        return requirements_from_body(client_api, body)

    def candidates_for(self, requires, client_api, json_mode):
        """Free models meeting the requirements, best-rated first.

        Ties break toward the provider with fewer calls made so far, so
        equal-rated models spread across providers instead of hammering one.
        """
        candidates = []
        for provider in self.brief.providers:
            probe = self.probes.get(provider.id)
            if probe is None:
                continue
            if provider.id in self.dead:
                continue
            if self.calls_made.get(provider.id, 0) >= CALLS_MAX.get(provider.id, DEFAULT_CALLS_MAX):
                continue
            if client_api == "openai" and json_mode and provider.wire == "anthropic":
                # The Anthropic wire cannot carry response_format: its echo
                # would report json_mode false and lose the request.
                continue
            for model in probe["models"]:
                row = self.brief.ratings.get((provider.id, model["id"]))
                if not model_free(model, row):
                    continue
                if not meets_requirements(requires, capabilities_of(model, row)):
                    continue
                rating = row["rating_milli"] if row is not None else 0
                candidates.append((provider, model, rating))
        candidates.sort(key=lambda c: (-c[2], self.calls_made.get(c[0].id, 0), c[0].id, c[1]["id"]))
        return candidates

    def call_provider(self, provider, model_id, client_api, body, stream):
        """One upstream call. Returns (status, body bytes) or raises."""
        base = join_base(ENV_URL, provider.base)
        headers = {"content-type": "application/json"}
        headers.update(auth_headers(provider.auth, provider.key))
        if provider.wire == "openai":
            upstream = dict(body)
            upstream["model"] = model_id
            if stream:
                upstream["stream"] = True
                upstream["stream_options"] = {"include_usage": True}
            payload = json.dumps(upstream, separators=(",", ":")).encode("utf-8")
            if stream:
                headers["accept"] = "text/event-stream"
            return http_request("POST", base + "/v1/chat/completions", headers,
                                body=payload, timeout=UPSTREAM_TIMEOUT_S)
        if provider.wire == "anthropic":
            if client_api == "anthropic":
                upstream = dict(body)
                upstream["model"] = model_id
            else:
                upstream = openai_to_anthropic(body, model_id)
            headers["anthropic-version"] = ANTHROPIC_VERSION
            if stream:
                headers["accept"] = "text/event-stream"
            payload = json.dumps(upstream, separators=(",", ":")).encode("utf-8")
            return http_request("POST", base + "/v1/messages", headers,
                                body=payload, timeout=UPSTREAM_TIMEOUT_S)
        # gemini
        gemini_body = to_gemini_body(client_api, body, model_id)
        payload = json.dumps(gemini_body, separators=(",", ":")).encode("utf-8")
        if stream:
            headers["accept"] = "text/event-stream"
        method = "streamGenerateContent" if stream else "generateContent"
        url = "%s/v1beta/models/%s:%s" % (base, urllib.parse.quote(model_id, safe=""), method)
        return http_request("POST", url, headers, body=payload, timeout=UPSTREAM_TIMEOUT_S)

    def serve(self, client_api, body):
        """Answer one client request. Returns (status, content_type, bytes)."""
        with self.lock:
            requires = self.requirements_for(client_api, body)
            stream = body.get("stream") is True
            json_mode = False
            if client_api == "openai":
                fmt = body.get("response_format")
                json_mode = is_record(fmt) and fmt.get("type") in ("json_object", "json_schema")
            candidates = self.candidates_for(requires, client_api, json_mode)
            for provider, model, _rating in candidates:
                try:
                    status, _headers, data = self.call_provider(
                        provider, model["id"], client_api, body, stream)
                except Exception as exc:
                    status, data = 0, b""
                    log("call to %s/%s failed: %s" % (provider.id, model["id"], exc))
                self.calls_made[provider.id] = self.calls_made.get(provider.id, 0) + 1
                if 200 <= status < 300:
                    self.consec_fail[provider.id] = 0
                    answer = parse_provider_answer(provider.wire, data, stream)
                    if answer is None:
                        log("call to %s/%s answered unparseable bytes" % (provider.id, model["id"]))
                        continue
                    content_type, payload = render_client(answer, model["id"], client_api, stream)
                    return 200, content_type, payload
                self.consec_fail[provider.id] = self.consec_fail.get(provider.id, 0) + 1
                if self.consec_fail[provider.id] >= 3:
                    self.dead.add(provider.id)
                    log("%s looks spent after 3 straight refusals" % provider.id)
                elif status in (402, 429):
                    log("%s/%s refused HTTP %d; failing over" % (provider.id, model["id"], status))
                else:
                    log("%s/%s answered HTTP %d; failing over" % (provider.id, model["id"], status))
        if client_api == "anthropic":
            payload = {"type": "error", "error": {"type": "overloaded_error",
                                                   "message": "no free model could serve this request"}}
        else:
            payload = {"error": {"message": "no free model could serve this request",
                                 "type": "overloaded_error", "code": None}}
        return 503, "application/json", (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")


# --------------------------------------------------------------------------
# HTTP server
# --------------------------------------------------------------------------

AGGREGATOR = None


def _send_json(handler, status, body):
    text = json.dumps(body, separators=(",", ":")) + "\n"
    data = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _openai_error(message, err_type="invalid_request_error"):
    return {"error": {"message": message, "type": err_type, "code": None}}


def _anthropic_error(message, err_type="invalid_request_error"):
    return {"type": "error", "error": {"type": err_type, "message": message}}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY_BYTES:
            return None
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except Exception:
            return None
        return value if is_record(value) else None

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path != "/v1/models":
            if url.path == "/v1/messages":
                _send_json(self, 404, _anthropic_error("no route GET %s" % url.path, "not_found_error"))
            else:
                _send_json(self, 404, _openai_error("no route GET %s" % url.path, "not_found_error"))
            return
        models = AGGREGATOR.served_models()
        if isinstance(self.headers.get("x-api-key"), str):
            body = {
                "data": [{"type": "model", "id": m["id"], "display_name": m["display_name"],
                          "created_at": FIXED_ANTHROPIC_CREATED_AT, "free": True} for m in models],
                "has_more": False,
            }
        else:
            body = {
                "object": "list",
                "data": [{"id": m["id"], "object": "model", "created": FIXED_CREATED,
                          "owned_by": m["provider"], "free": True} for m in models],
            }
        _send_json(self, 200, body)

    def do_POST(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/v1/chat/completions":
            client_api = "openai"
        elif url.path == "/v1/messages":
            client_api = "anthropic"
        else:
            if url.path == "/v1/models":
                _send_json(self, 405, _openai_error("no route POST %s" % url.path, "not_found_error"))
            else:
                _send_json(self, 404, _openai_error("no route POST %s" % url.path, "not_found_error"))
            return
        body = self._read_json()
        if body is None:
            if client_api == "anthropic":
                _send_json(self, 400, _anthropic_error("the request body is not one JSON object"))
            else:
                _send_json(self, 400, _openai_error("the request body is not one JSON object"))
            return
        try:
            status, content_type, payload = AGGREGATOR.serve(client_api, body)
        except Exception as exc:
            log("serve failed: %s" % exc)
            if client_api == "anthropic":
                _send_json(self, 500, _anthropic_error("the server failed to answer", "api_error"))
            else:
                _send_json(self, 500, _openai_error("the server failed to answer", "api_error"))
            return
        self.send_response(status)
        self.send_header("content-type", content_type)
        if content_type.startswith("text/event-stream"):
            self.send_header("cache-control", "no-cache")
            self.send_header("connection", "keep-alive")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


# --------------------------------------------------------------------------
# Register, poll, main
# --------------------------------------------------------------------------

def register(port, catalog):
    last_error = None
    for _attempt in range(5):
        try:
            status, _headers, data = http_request(
                "POST", ENV_URL + "/register",
                {"content-type": "application/json"},
                body=json.dumps({"protocol_version": PROTOCOL_VERSION, "port": port,
                                 "catalog": catalog}, separators=(",", ":")).encode("utf-8"),
                timeout=5)
            if 200 <= status < 300:
                reply = json.loads(data.decode("utf-8"))
                if is_record(reply) and isinstance(reply.get("requests"), int):
                    log("registered: the workload holds %d requests" % reply["requests"])
                return
            last_error = "POST %s/register answered HTTP %d: %s" % (ENV_URL, status, data[:500].decode("utf-8", "replace"))
        except Exception as exc:
            last_error = "POST %s/register failed: %s" % (ENV_URL, exc)
        time.sleep(0.2)
    raise RuntimeError(last_error or "register failed")


def poll_until_done(server):
    while True:
        try:
            status, _headers, data = http_request("GET", ENV_URL + "/work",
                                                  {"accept": "application/json"}, timeout=2)
            if status == 200:
                work = json.loads(data.decode("utf-8"))
                if is_record(work) and work.get("done") is True:
                    server.shutdown()
                    return
        except Exception:
            pass
        time.sleep(POLL_INTERVAL_S)


def build_catalog_for_run():
    brief = read_brief(PROMPT_FILE)
    if brief.error is not None:
        log(brief.error)
    probes = [probe_provider(ENV_URL, provider) for provider in brief.providers]
    for probe in probes:
        if not probe["ok"] and probe["error"] is not None:
            log(probe["error"])
    catalog = build_catalog(brief, probes)
    return brief, probes, catalog


def main():
    brief, probes, catalog = build_catalog_for_run()
    if "--list" in sys.argv:
        text = json.dumps(catalog, separators=(",", ":")) + "\n"
        sys.stdout.write(text)
        sys.stdout.flush()
        return 0
    if ENV_URL == "":
        raise RuntimeError("MAKEFUN_ENV_URL is not set")
    global AGGREGATOR
    AGGREGATOR = Aggregator(brief, probes, catalog)
    server = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
    server.daemon_threads = True
    port = server.server_address[1]
    if port == 8080:
        raise RuntimeError("the OS picked 8080, which the env owns on one layout: restart the trial")
    log("listening on 0.0.0.0:%d with %d answered providers and %d free models"
        % (port, len(probes), len(AGGREGATOR.served_models())))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    register(port, catalog)
    poll_until_done(server)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        log("fatal: %s" % exc)
        sys.exit(1)
