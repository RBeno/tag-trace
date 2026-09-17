#!/usr/bin/env python3
"""Verifica la coherencia de la base documental de TAG TRACE.

Comprueba frontmatter obligatorio, unicidad de identificadores, enlaces internos vivos y
la validez de docs/project_state.json contra su esquema. No necesita dependencias externas.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REQUIRED_KEYS = ("document_id", "version", "status", "last_updated")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
ADR_KEYS = ("adr", "status", "date")

errors: list[str] = []


def fail(path: pathlib.Path, message: str) -> None:
    errors.append(f"{path.relative_to(ROOT)}: {message}")


def frontmatter(text: str) -> dict[str, str] | None:
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    block = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            block[key.strip()] = value.strip()
    return block


def check_documents() -> None:
    seen: dict[str, pathlib.Path] = {}
    for path in sorted(ROOT.joinpath("docs").rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        meta = frontmatter(text)
        if meta is None:
            fail(path, "falta el frontmatter delimitado por ---")
            continue

        if path.parent.name == "decisions":
            for key in ADR_KEYS:
                if key not in meta:
                    fail(path, f"la ADR no declara '{key}'")
            if "date" in meta and not DATE_RE.match(meta["date"]):
                fail(path, f"fecha no válida: {meta['date']}")
            continue

        for key in REQUIRED_KEYS:
            if key not in meta:
                fail(path, f"el frontmatter no declara '{key}'")
        if "version" in meta and not VERSION_RE.match(meta["version"]):
            fail(path, f"versión no válida: {meta['version']}")
        if "last_updated" in meta and not DATE_RE.match(meta["last_updated"]):
            fail(path, f"fecha no válida: {meta['last_updated']}")

        doc_id = meta.get("document_id")
        if doc_id:
            if doc_id in seen:
                fail(path, f"identificador duplicado {doc_id}, ya usado por {seen[doc_id].name}")
            else:
                seen[doc_id] = path


def check_links() -> None:
    for path in sorted(ROOT.rglob("*.md")):
        if ".git" in path.parts or "node_modules" in path.parts:
            continue
        for target in LINK_RE.findall(path.read_text(encoding="utf-8")):
            target = target.split("#", 1)[0].strip()
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            if not (path.parent / target).exists():
                fail(path, f"enlace roto: {target}")


def check_state() -> None:
    state_path = ROOT / "docs" / "project_state.json"
    schema_path = ROOT / "schemas" / "project-state.schema.json"
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"project_state.json: no se pudo leer ({exc})")
        return

    for key in schema["required"]:
        if key not in state:
            fail(state_path, f"falta la clave obligatoria '{key}'")
    for key in state:
        if key not in schema["properties"]:
            fail(state_path, f"clave no prevista por el esquema: '{key}'")

    if not VERSION_RE.match(str(state.get("documentationVersion", ""))):
        fail(state_path, "documentationVersion no sigue el patrón X.Y.Z")
    if not DATE_RE.match(str(state.get("lastUpdated", ""))):
        fail(state_path, "lastUpdated no sigue el patrón AAAA-MM-DD")

    # Invariantes de gobierno: F0 y una línea base candidata no autorizan programar.
    if state.get("currentPhase") == "F0" and state.get("implementationStarted") is not False:
        fail(state_path, "en F0 implementationStarted debe ser false")
    if state.get("baseline") == "candidate" and state.get("implementationStarted") is not False:
        fail(state_path, "una línea base candidata no autoriza implementationStarted: true")

    approval = state.get("nextTransition", {}).get("requiredApproval")
    if state.get("currentPhase") == "F0" and approval != "CONTINÚA FASE 1":
        fail(state_path, "la transición desde F0 exige la aprobación literal 'CONTINÚA FASE 1'")


def main() -> int:
    check_documents()
    check_links()
    check_state()
    if errors:
        print("Verificación documental fallida:\n")
        for line in errors:
            print(f"  - {line}")
        return 1
    print("Verificación documental correcta.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
