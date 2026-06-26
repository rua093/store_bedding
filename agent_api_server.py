#!/usr/bin/env python3
"""
Local file API server for AI coding agents.

Run this file from the project root. All file operations are locked to that
directory and its children. The server intentionally does not expose a shell,
process execution API, or generic HTTP proxy API.
"""

from __future__ import annotations

import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


HOST = "127.0.0.1"
ROOT = Path.cwd().resolve()
CONFIG_PATH = ROOT / "agent_api_config.json"
STATE_DIR = ROOT / ".agent-api"
AUDIT_LOG = STATE_DIR / "audit.log"
TRASH_DIR = STATE_DIR / "trash"

DEFAULT_CONFIG: dict[str, Any] = {
    "port": 8765,
    "allowDelete": True,
    "allowGit": True,
    "requireAuth": True,
    "tokenHeader": "X-Agent-Token",
    "enableCloudflareTunnel": True,
    "cloudflaredCommand": "cloudflared",
    "deleteMode": "trash",
    "maxBodyMb": 25,
    "maxReadBytes": 10 * 1024 * 1024,
    "maxSearchResults": 500,
    "excludeDirs": [
        ".agent-api",
        "AGENTS.md",
        "agent_api_server.py",
        "agent_api_config.json",
        "openapi.json",
        ".git",
        "node_modules",
        "__pycache__",
        ".venv",
        "venv",
        "dist",
        "build",
    ],
    "denyWriteGlobs": [
        "AGENTS.md",
        "agent_api_server.py",
        "agent_api_config.json",
        "openapi.json",
        ".env",
        ".env.*",
        "*.pem",
        "*.key",
        "id_rsa",
        "id_rsa.pub",
        ".agent-api/*",
    ],
}


def load_config() -> dict[str, Any]:
    config = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            user_config = json.load(handle)
        if not isinstance(user_config, dict):
            raise RuntimeError("agent_api_config.json must contain a JSON object")
        config.update(user_config)
    env_port = os.environ.get("AGENT_API_PORT")
    if env_port:
        config["port"] = int(env_port)
    env_tunnel = os.environ.get("AGENT_API_ENABLE_CLOUDFLARE")
    if env_tunnel is not None:
        config["enableCloudflareTunnel"] = env_tunnel.lower() in {"1", "true", "yes", "on"}
    env_auth = os.environ.get("AGENT_API_REQUIRE_AUTH")
    if env_auth is not None:
        config["requireAuth"] = env_auth.lower() in {"1", "true", "yes", "on"}
    return config


CONFIG = load_config()
PORT = int(CONFIG["port"])
MAX_BODY_BYTES = int(CONFIG["maxBodyMb"]) * 1024 * 1024
MAX_READ_BYTES = int(CONFIG["maxReadBytes"])
TOKEN_HEADER = str(CONFIG["tokenHeader"])
SESSION_TOKEN = os.environ.get("AGENT_API_TOKEN") or secrets.token_urlsafe(32)
CLOUDFLARE_URL: str | None = None
CLOUDFLARED_PROCESS: subprocess.Popen[str] | None = None


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def token_is_valid(handler: BaseHTTPRequestHandler) -> bool:
    if not bool(CONFIG["requireAuth"]):
        return True
    header_token = handler.headers.get(TOKEN_HEADER, "")
    auth_header = handler.headers.get("Authorization", "")
    bearer_prefix = "Bearer "
    bearer_token = auth_header[len(bearer_prefix) :] if auth_header.startswith(bearer_prefix) else ""
    return secrets.compare_digest(header_token, SESSION_TOKEN) or secrets.compare_digest(bearer_token, SESSION_TOKEN)


def ensure_inside_root(path_value: str, *, must_exist: bool = False) -> Path:
    if not isinstance(path_value, str) or not path_value.strip():
        raise ApiError(400, "path must be a non-empty string")

    raw = Path(path_value)
    if raw.is_absolute():
        raise ApiError(400, "absolute paths are not allowed")

    candidate = ROOT / raw
    try:
        resolved = candidate.resolve(strict=must_exist)
    except FileNotFoundError:
        if must_exist:
            raise ApiError(404, "path does not exist")
        resolved = candidate.resolve(strict=False)

    try:
        resolved.relative_to(ROOT)
    except ValueError:
        raise ApiError(403, "path escapes the server root")

    return resolved


def rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def path_matches_any(path: Path, patterns: list[str]) -> bool:
    relative = rel(path)
    name = path.name
    return any(fnmatch.fnmatch(relative, pattern) or fnmatch.fnmatch(name, pattern) for pattern in patterns)


def ensure_write_allowed(path: Path) -> None:
    if path_matches_any(path, list(CONFIG["denyWriteGlobs"])):
        raise ApiError(403, f"writes are denied for {rel(path)}")


def ensure_delete_allowed(path: Path) -> None:
    if not bool(CONFIG["allowDelete"]):
        raise ApiError(403, "delete is disabled by configuration")
    if path == ROOT:
        raise ApiError(403, "cannot delete the server root")
    if rel(path).startswith(".agent-api/") or rel(path) == ".agent-api":
        raise ApiError(403, "cannot delete internal .agent-api state")
    if path_matches_any(path, list(CONFIG["denyWriteGlobs"])):
        raise ApiError(403, f"delete is denied for {rel(path)}")


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length > MAX_BODY_BYTES:
        raise ApiError(413, "request body is too large")
    if length == 0:
        return {}
    try:
        data = json.loads(handler.rfile.read(length).decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError(400, f"invalid JSON: {exc.msg}")
    if not isinstance(data, dict):
        raise ApiError(400, "JSON body must be an object")
    return data


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_expected_sha(path: Path, expected: Any) -> None:
    if expected is None:
        return
    if not path.exists() or not path.is_file():
        raise ApiError(409, "expectedSha256 was provided but target file does not exist")
    actual = file_sha256(path)
    if actual != expected:
        raise ApiError(409, "file changed since it was read; expectedSha256 does not match")


def file_info(path: Path, *, include_hash: bool = False) -> dict[str, Any]:
    stat = path.stat()
    info = {
        "path": rel(path),
        "name": path.name,
        "type": "directory" if path.is_dir() else "file",
        "size": stat.st_size,
        "modified": stat.st_mtime,
    }
    if include_hash and path.is_file():
        info["sha256"] = file_sha256(path)
    return info


def should_exclude(path: Path, excludes: set[str]) -> bool:
    try:
        relative_path = path.relative_to(ROOT)
        relative = relative_path.as_posix()
        return any(
            part in excludes
            for part in relative_path.parts
        ) or any(
            fnmatch.fnmatch(relative, pattern) or fnmatch.fnmatch(path.name, pattern)
            for pattern in excludes
        )
    except ValueError:
        return True


def audit(action: str, detail: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    event = {
        "time": dt.datetime.now(dt.timezone.utc).isoformat(),
        "action": action,
        "detail": detail,
    }
    with AUDIT_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")


def start_cloudflare_tunnel() -> None:
    global CLOUDFLARED_PROCESS
    if not bool(CONFIG["enableCloudflareTunnel"]):
        print("Cloudflare tunnel: disabled by config")
        return

    command = str(CONFIG["cloudflaredCommand"])
    executable = shutil.which(command)
    if not executable:
        print("Cloudflare tunnel: cloudflared was not found on PATH")
        print("Install cloudflared, or set enableCloudflareTunnel=false in agent_api_config.json")
        return

    target = f"http://{HOST}:{PORT}"
    args = [executable, "tunnel", "--url", target]
    try:
        CLOUDFLARED_PROCESS = subprocess.Popen(
            args,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
        )
    except OSError as exc:
        print(f"Cloudflare tunnel: failed to start cloudflared: {exc}")
        return

    print("Cloudflare tunnel: starting...")
    print("Cloudflare tunnel: waiting for public URL from cloudflared")

    def consume(stream: Any) -> None:
        global CLOUDFLARE_URL
        if stream is None:
            return
        for line in stream:
            text = line.rstrip()
            match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", text)
            if match and CLOUDFLARE_URL is None:
                CLOUDFLARE_URL = match.group(0)
                print("")
                print("=== AGENT API PUBLIC ACCESS ===")
                print(f"Public URL: {CLOUDFLARE_URL}")
                print(f"Token: {SESSION_TOKEN}")
                print(f"Header: {TOKEN_HEADER}: {SESSION_TOKEN}")
                print("Give the Public URL, Token, and AGENTS.md to the AI chat.")
                print("For Custom GPT Actions, set openapi.json servers[0].url to this Public URL.")
                print("================================")
                print("")
            if "trycloudflare.com" in text or "error" in text.lower() or "failed" in text.lower():
                print(f"cloudflared: {text}")

    threading.Thread(target=consume, args=(CLOUDFLARED_PROCESS.stdout,), daemon=True).start()
    threading.Thread(target=consume, args=(CLOUDFLARED_PROCESS.stderr,), daemon=True).start()


def unique_trash_path(original: Path) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = TRASH_DIR / stamp / rel(original)
    if not base.exists():
        return base
    suffix = 1
    while True:
        candidate = base.with_name(f"{base.name}.{suffix}")
        if not candidate.exists():
            return candidate
        suffix += 1


def decode_text(path: Path, encoding: str) -> str:
    size = path.stat().st_size
    if size > MAX_READ_BYTES:
        raise ApiError(413, f"file is larger than maxReadBytes ({MAX_READ_BYTES})")
    return path.read_text(encoding=encoding)


def line_range(content: str, start_line: int, end_line: int) -> dict[str, Any]:
    if start_line < 1:
        raise ApiError(400, "startLine must be >= 1")
    if end_line < start_line:
        raise ApiError(400, "endLine must be >= startLine")
    lines = content.splitlines()
    selected = lines[start_line - 1 : end_line]
    return {
        "startLine": start_line,
        "endLine": min(end_line, len(lines)),
        "totalLines": len(lines),
        "content": "\n".join(selected) + ("\n" if selected else ""),
    }


def normalize_patterns(value: Any, fallback: list[str]) -> list[str]:
    if value is None:
        return fallback
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    raise ApiError(400, "glob/include/exclude values must be strings or arrays of strings")


def included_by_patterns(path: Path, includes: list[str], excludes: list[str]) -> bool:
    relative = rel(path)
    included = any(fnmatch.fnmatch(relative, pattern) or fnmatch.fnmatch(path.name, pattern) for pattern in includes)
    excluded = any(fnmatch.fnmatch(relative, pattern) or fnmatch.fnmatch(path.name, pattern) for pattern in excludes)
    return included and not excluded


def run_git(args: list[str]) -> dict[str, Any]:
    if not bool(CONFIG["allowGit"]):
        raise ApiError(403, "git endpoints are disabled by configuration")
    if not (ROOT / ".git").exists():
        raise ApiError(409, "server root is not a git repository")
    completed = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=10,
        shell=False,
    )
    return {
        "command": ["git", *args],
        "exitCode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def manifest() -> dict[str, Any]:
    return {
        "ok": True,
        "name": "Agent API Server",
        "version": "2.0",
        "root": str(ROOT),
        "host": HOST,
        "port": PORT,
        "publicUrl": CLOUDFLARE_URL,
        "auth": {
            "required": bool(CONFIG["requireAuth"]),
            "header": TOKEN_HEADER,
            "authorizationBearerSupported": True,
        },
        "safety": {
            "localOnly": True,
            "rootLocked": True,
            "absolutePathsAllowed": False,
            "shellExecution": False,
            "processExecution": False,
            "httpProxy": False,
            "authentication": bool(CONFIG["requireAuth"]),
        },
        "config": {
            "allowDelete": CONFIG["allowDelete"],
            "allowGit": CONFIG["allowGit"],
            "enableCloudflareTunnel": CONFIG["enableCloudflareTunnel"],
            "deleteMode": CONFIG["deleteMode"],
            "denyWriteGlobs": CONFIG["denyWriteGlobs"],
            "excludeDirs": CONFIG["excludeDirs"],
            "maxBodyMb": CONFIG["maxBodyMb"],
            "maxReadBytes": CONFIG["maxReadBytes"],
            "maxSearchResults": CONFIG["maxSearchResults"],
        },
        "endpoints": {
            "GET": ["/health", "/root", "/manifest", "/files/list"],
            "POST": [
                "/files/read",
                "/files/read_range",
                "/files/write",
                "/files/replace",
                "/files/delete",
                "/files/mkdir",
                "/files/stat",
                "/files/search",
                "/git/status",
                "/git/diff",
            ],
        },
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "AgentApiServer/2.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", f"Content-Type, {TOKEN_HEADER}, Authorization")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def reply(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, exc: Exception) -> None:
        if isinstance(exc, ApiError):
            self.reply(exc.status, {"ok": False, "error": exc.message})
        else:
            self.reply(500, {"ok": False, "error": str(exc)})

    def do_GET(self) -> None:
        try:
            if not token_is_valid(self):
                raise ApiError(401, f"missing or invalid token; send header {TOKEN_HEADER}")
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)

            if parsed.path == "/health":
                self.reply(200, {"ok": True, "root": str(ROOT), "time": time.time()})
                return

            if parsed.path == "/root":
                self.reply(200, {"ok": True, "root": str(ROOT)})
                return

            if parsed.path == "/manifest":
                self.reply(200, manifest())
                return

            if parsed.path == "/files/list":
                base = ensure_inside_root(query.get("path", ["."])[0], must_exist=True)
                if not base.is_dir():
                    raise ApiError(400, "path must be a directory")
                recursive = query.get("recursive", ["false"])[0].lower() == "true"
                excludes = set(CONFIG["excludeDirs"])
                for item in query.get("exclude", []):
                    excludes.update(part for part in item.split(",") if part)

                paths = base.rglob("*") if recursive else base.iterdir()
                items = [file_info(p) for p in sorted(paths) if not should_exclude(p, excludes)]
                self.reply(200, {"ok": True, "items": items})
                return

            raise ApiError(404, "unknown endpoint")
        except Exception as exc:
            self.fail(exc)

    def do_POST(self) -> None:
        try:
            if not token_is_valid(self):
                raise ApiError(401, f"missing or invalid token; send header {TOKEN_HEADER}")
            parsed = urlparse(self.path)
            body = read_json(self)

            if parsed.path == "/files/read":
                path = ensure_inside_root(body.get("path", ""), must_exist=True)
                if not path.is_file():
                    raise ApiError(400, "path must be a file")
                encoding = body.get("encoding", "utf-8")
                content = decode_text(path, encoding)
                self.reply(200, {"ok": True, "path": rel(path), "sha256": file_sha256(path), "content": content})
                return

            if parsed.path == "/files/read_range":
                path = ensure_inside_root(body.get("path", ""), must_exist=True)
                if not path.is_file():
                    raise ApiError(400, "path must be a file")
                encoding = body.get("encoding", "utf-8")
                content = decode_text(path, encoding)
                selected = line_range(content, int(body.get("startLine", 1)), int(body.get("endLine", 200)))
                selected.update({"ok": True, "path": rel(path), "sha256": file_sha256(path)})
                self.reply(200, selected)
                return

            if parsed.path == "/files/write":
                path = ensure_inside_root(body.get("path", ""), must_exist=False)
                ensure_write_allowed(path)
                if path.exists() and path.is_dir():
                    raise ApiError(400, "cannot write content to a directory")
                content = body.get("content")
                if not isinstance(content, str):
                    raise ApiError(400, "content must be a string")
                encoding = body.get("encoding", "utf-8")
                dry_run = bool(body.get("dryRun", False))
                create_dirs = bool(body.get("createDirs", True))
                assert_expected_sha(path, body.get("expectedSha256"))
                new_sha = sha256_bytes(content.encode(encoding))
                if dry_run:
                    audit("write.dryRun", {"path": rel(path), "newSha256": new_sha})
                    self.reply(200, {"ok": True, "dryRun": True, "path": rel(path), "newSha256": new_sha})
                    return
                if create_dirs:
                    path.parent.mkdir(parents=True, exist_ok=True)
                elif not path.parent.exists():
                    raise ApiError(404, "parent directory does not exist")
                path.write_text(content, encoding=encoding, newline="")
                audit("write", {"path": rel(path), "sha256": file_sha256(path), "size": path.stat().st_size})
                self.reply(200, {"ok": True, "file": file_info(path, include_hash=True)})
                return

            if parsed.path == "/files/replace":
                path = ensure_inside_root(body.get("path", ""), must_exist=True)
                ensure_write_allowed(path)
                if not path.is_file():
                    raise ApiError(400, "path must be a file")
                old = body.get("old")
                new = body.get("new")
                if not isinstance(old, str) or old == "":
                    raise ApiError(400, "old must be a non-empty string")
                if not isinstance(new, str):
                    raise ApiError(400, "new must be a string")
                encoding = body.get("encoding", "utf-8")
                dry_run = bool(body.get("dryRun", False))
                allow_multiple = bool(body.get("allowMultiple", False))
                assert_expected_sha(path, body.get("expectedSha256"))
                content = decode_text(path, encoding)
                count = content.count(old)
                if count == 0:
                    raise ApiError(409, "old text was not found")
                if count > 1 and not allow_multiple:
                    raise ApiError(409, "old text appears multiple times; set allowMultiple=true to replace all")
                updated = content.replace(old, new)
                new_sha = sha256_bytes(updated.encode(encoding))
                result = {"ok": True, "path": rel(path), "replacements": count, "newSha256": new_sha}
                if dry_run:
                    audit("replace.dryRun", result)
                    result["dryRun"] = True
                    self.reply(200, result)
                    return
                path.write_text(updated, encoding=encoding, newline="")
                audit("replace", result)
                self.reply(200, {"ok": True, "file": file_info(path, include_hash=True), "replacements": count})
                return

            if parsed.path == "/files/delete":
                path = ensure_inside_root(body.get("path", ""), must_exist=True)
                ensure_delete_allowed(path)
                recursive = bool(body.get("recursive", False))
                permanent = bool(body.get("permanent", CONFIG["deleteMode"] == "permanent"))
                dry_run = bool(body.get("dryRun", False))
                destination = None if permanent else unique_trash_path(path)
                result = {
                    "ok": True,
                    "path": rel(path),
                    "permanent": permanent,
                    "dryRun": dry_run,
                    "trashPath": rel(destination) if destination else None,
                }
                if dry_run:
                    audit("delete.dryRun", result)
                    self.reply(200, result)
                    return
                if permanent:
                    if path.is_dir():
                        if recursive:
                            shutil.rmtree(path)
                        else:
                            path.rmdir()
                    else:
                        path.unlink()
                else:
                    assert destination is not None
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(path), str(destination))
                audit("delete", result)
                self.reply(200, result)
                return

            if parsed.path == "/files/mkdir":
                path = ensure_inside_root(body.get("path", ""), must_exist=False)
                ensure_write_allowed(path)
                dry_run = bool(body.get("dryRun", False))
                if dry_run:
                    audit("mkdir.dryRun", {"path": rel(path)})
                    self.reply(200, {"ok": True, "dryRun": True, "path": rel(path)})
                    return
                path.mkdir(parents=bool(body.get("parents", True)), exist_ok=bool(body.get("existOk", True)))
                audit("mkdir", {"path": rel(path)})
                self.reply(200, {"ok": True, "directory": file_info(path)})
                return

            if parsed.path == "/files/stat":
                path = ensure_inside_root(body.get("path", ""), must_exist=True)
                self.reply(200, {"ok": True, "item": file_info(path, include_hash=bool(body.get("sha256", True)))})
                return

            if parsed.path == "/files/search":
                pattern = body.get("pattern")
                if not isinstance(pattern, str) or not pattern:
                    raise ApiError(400, "pattern must be a non-empty string")
                base = ensure_inside_root(body.get("path", "."), must_exist=True)
                if not base.is_dir():
                    raise ApiError(400, "path must be a directory")
                legacy_glob = body.get("glob")
                includes = normalize_patterns(body.get("include", legacy_glob), ["*"])
                excludes = normalize_patterns(body.get("exclude"), [])
                max_results = min(int(body.get("maxResults", 200)), int(CONFIG["maxSearchResults"]))
                case_sensitive = bool(body.get("caseSensitive", False))
                use_regex = bool(body.get("regex", False))
                flags = 0 if case_sensitive else re.IGNORECASE
                matcher = re.compile(pattern, flags) if use_regex else None
                needle = pattern if case_sensitive else pattern.lower()
                excluded_dirs = set(CONFIG["excludeDirs"])
                results: list[dict[str, Any]] = []

                for p in base.rglob("*"):
                    if len(results) >= max_results:
                        break
                    if should_exclude(p, excluded_dirs) or not p.is_file():
                        continue
                    if not included_by_patterns(p, includes, excludes):
                        continue
                    try:
                        for index, line in enumerate(p.read_text(encoding="utf-8").splitlines(), start=1):
                            matched = bool(matcher.search(line)) if matcher else needle in (line if case_sensitive else line.lower())
                            if matched:
                                results.append({"path": rel(p), "line": index, "text": line})
                                if len(results) >= max_results:
                                    break
                    except UnicodeDecodeError:
                        continue
                self.reply(200, {"ok": True, "results": results, "truncated": len(results) >= max_results})
                return

            if parsed.path == "/git/status":
                self.reply(200, {"ok": True, "result": run_git(["status", "--short"])})
                return

            if parsed.path == "/git/diff":
                args = ["diff"]
                path_value = body.get("path")
                if path_value:
                    path = ensure_inside_root(path_value, must_exist=False)
                    args.extend(["--", rel(path)])
                self.reply(200, {"ok": True, "result": run_git(args)})
                return

            raise ApiError(404, "unknown endpoint")
        except Exception as exc:
            self.fail(exc)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Agent API server root: {ROOT}")
    print(f"Listening on http://{HOST}:{PORT}")
    print("")
    print("=== AGENT API LOCAL ACCESS ===")
    print(f"Local URL: http://{HOST}:{PORT}")
    print(f"Token: {SESSION_TOKEN}")
    print(f"Header: {TOKEN_HEADER}: {SESSION_TOKEN}")
    print("================================")
    print("")
    print("No shell/process execution endpoint is exposed.")
    print("No generic HTTP proxy endpoint is exposed.")
    start_cloudflare_tunnel()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Agent API server...")
    finally:
        server.server_close()
        if CLOUDFLARED_PROCESS and CLOUDFLARED_PROCESS.poll() is None:
            CLOUDFLARED_PROCESS.terminate()
            try:
                CLOUDFLARED_PROCESS.wait(timeout=5)
            except subprocess.TimeoutExpired:
                CLOUDFLARED_PROCESS.kill()
        sys.exit(0)


if __name__ == "__main__":
    main()
