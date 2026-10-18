#!/usr/bin/env python3
"""Verifica la coherencia de la base documental de TAG TRACE.

Comprueba frontmatter obligatorio, unicidad de identificadores, enlaces internos vivos,
la validez de docs/project_state.json contra su esquema, que las tablas Markdown estén bien
formadas, que el estado de cada ADR en docs/DECISIONS.md coincida con su frontmatter, que
ninguna pregunta esté a la vez abierta y cerrada en docs/OPEN_QUESTIONS.md y que package.json y
package-lock.json repitan la versión del CHANGELOG.md. No necesita dependencias externas.
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
FENCE_RE = re.compile(r"^\s*(```|~~~)")
SEPARATOR_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
OQ_ROW_RE = re.compile(r"^\|\s*(OQ-[A-Z]?\d+)\s*\|")
# La misma expresión con la que vite.config.ts saca la versión del producto.
CHANGELOG_VERSION_RE = re.compile(r"^## \[(\d+\.\d+\.\d+)\]", re.MULTILINE)

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


def markdown_files() -> list[pathlib.Path]:
    return [
        path
        for path in sorted(ROOT.rglob("*.md"))
        if ".git" not in path.parts and "node_modules" not in path.parts
    ]


def check_links() -> None:
    for path in markdown_files():
        for target in LINK_RE.findall(path.read_text(encoding="utf-8")):
            target = target.split("#", 1)[0].strip()
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            if not (path.parent / target).exists():
                fail(path, f"enlace roto: {target}")


def table_cells(row: str) -> int:
    """Celdas de una fila: barras sin escapar y fuera de `código`, sin las de los extremos."""
    cells, in_code, escaped = 1, False, False
    body = row.strip()
    body = body[1:] if body.startswith("|") else body
    body = body[:-1] if body.endswith("|") and not body.endswith("\\|") else body
    for char in body:
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "`":
            in_code = not in_code
        elif char == "|" and not in_code:
            cells += 1
    return cells


def check_tables() -> None:
    """Cada bloque de filas `|…|` empieza por cabecera y fila separadora; nada de filas sueltas.

    Una línea en blanco o un párrafo antes de una fila cierran la tabla anterior: lo que sigue se
    pinta como texto con barras. Fila es una línea que empieza y acaba en `|` (todas las tablas del
    repositorio se escriben así; un párrafo que empieza por «|x|» no es una fila). Se ignora lo que
    va dentro de bloques de código.
    """

    def is_row(text: str) -> bool:
        return text.strip().startswith("|") and text.strip().endswith("|") and not FENCE_RE.match(text)

    for path in markdown_files():
        lines = path.read_text(encoding="utf-8").split("\n")
        in_fence = False
        index = 0
        while index < len(lines):
            line = lines[index]
            if FENCE_RE.match(line):
                in_fence = not in_fence
                index += 1
                continue
            if in_fence or not is_row(line):
                index += 1
                continue
            start = index
            while index < len(lines) and is_row(lines[index]):
                index += 1
            block = lines[start:index]
            where = f"línea {start + 1}"
            if len(block) == 1 and not SEPARATOR_RE.match(block[0]):
                fail(path, f"{where}: fila de tabla suelta, sin cabecera ni separador (¿una línea en blanco la separa de su tabla?)")
                continue
            if SEPARATOR_RE.match(block[0]):
                fail(path, f"{where}: tabla que empieza por la fila separadora, sin cabecera")
                continue
            if len(block) < 2 or not SEPARATOR_RE.match(block[1]):
                fail(path, f"{where}: tabla sin fila separadora `|---|` tras su primera fila (falta el separador, o una línea en blanco o un párrafo separa estas filas de su tabla)")
                continue
            if table_cells(block[0]) != table_cells(block[1]):
                fail(path, f"{where}: la cabecera tiene {table_cells(block[0])} columnas y el separador {table_cells(block[1])}")
            for offset, row in enumerate(block[2:], start=start + 3):
                if SEPARATOR_RE.match(row):
                    fail(path, f"línea {offset}: fila separadora en medio de la tabla")


def check_adr_index() -> None:
    """El estado de cada ADR en el índice coincide con el `status` de su frontmatter."""
    index_path = ROOT / "docs" / "DECISIONS.md"
    listed: set[str] = set()
    for number, line in enumerate(index_path.read_text(encoding="utf-8").split("\n"), start=1):
        match = re.match(r"^\|\s*\[ADR-\d+\]\(([^)]+)\)\s*\|", line)
        if not match:
            continue
        target = index_path.parent / match.group(1)
        listed.add(target.name)
        if not target.exists():
            continue  # check_links ya lo dice
        indexed = line.rstrip().rstrip("|").rsplit("|", 1)[-1].strip()
        meta = frontmatter(target.read_text(encoding="utf-8")) or {}
        status = meta.get("status", "")
        if indexed.lower() != status.lower():
            fail(index_path, f"línea {number}: {target.name} figura como «{indexed}» y su frontmatter dice «{status}»")
    for adr in sorted((ROOT / "docs" / "decisions").glob("ADR-*.md")):
        if adr.name not in listed:
            fail(index_path, f"{adr.name} no tiene fila en el índice")


def check_open_questions() -> None:
    """Ningún OQ-xxx tiene fila en una sección abierta y en «Preguntas cerradas» a la vez."""
    path = ROOT / "docs" / "OPEN_QUESTIONS.md"
    open_rows: dict[str, int] = {}
    closed_rows: dict[str, int] = {}
    section = ""
    for number, line in enumerate(path.read_text(encoding="utf-8").split("\n"), start=1):
        if line.startswith("## "):
            section = line[3:].strip().lower()
            continue
        match = OQ_ROW_RE.match(line)
        if not match:
            continue
        target = closed_rows if section.startswith("preguntas cerradas") else open_rows
        target.setdefault(match.group(1), number)
    for oq in sorted(set(open_rows) & set(closed_rows)):
        fail(path, f"{oq} tiene fila abierta (línea {open_rows[oq]}) y cerrada (línea {closed_rows[oq]})")


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


def check_package_version() -> None:
    """La versión del producto sale del CHANGELOG.md; package.json y su lock solo la repiten."""
    changelog = ROOT / "CHANGELOG.md"
    match = CHANGELOG_VERSION_RE.search(changelog.read_text(encoding="utf-8"))
    if not match:
        fail(changelog, "no tiene ninguna entrada '## [X.Y.Z]'")
        return
    expected = match.group(1)
    for name in ("package.json", "package-lock.json"):
        path = ROOT / name
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{name}: no se pudo leer ({exc})")
            continue
        found = [data.get("version")]
        if name == "package-lock.json":
            found.append(data.get("packages", {}).get("", {}).get("version"))
        wrong = [version for version in found if version != expected]
        if wrong:
            fail(path, f"version {wrong[0]} no coincide con la del CHANGELOG.md ({expected}); "
                       f"npm version {expected} --no-git-tag-version")


def main() -> int:
    check_documents()
    check_links()
    check_tables()
    check_adr_index()
    check_open_questions()
    check_state()
    check_package_version()
    if errors:
        print("Verificación documental fallida:\n")
        for line in errors:
            print(f"  - {line}")
        return 1
    print("Verificación documental correcta.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
