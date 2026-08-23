<!--meta
{ "title": "Syntax Highlighting", "description": "Hand-written, zero-dependency highlighters for Python, Robot Framework, Makefile, shell and Java.", "assumes": ["Docs/features/markdown"], "next": [] }
-->

# Syntax Highlighting

Fenced code blocks are highlighted by WebDocs itself. There is no highlight.js,
no Prism, and no network call — each supported language has a small,
purpose-built tokenizer written from scratch. Tag a fence with a
language and the matching tokenizer colours it:

    ```python
    def hello(): ...
    ```

## How it works

Highlighting is a **decoration** stage that runs late in the per-document
pipeline, after the Markdown has already been parsed and sanitized:

- **Post-sanitize.** The sanitizer runs first and strips any styling or scripting
  from the source. Highlighting only ever adds spans to text the sanitizer has
  already cleared, so a code sample can never smuggle markup onto the page.
- **Per-language tokenizers.** Each language is a self-contained scanner that
  walks the code once and emits typed tokens — keyword, string, comment, number,
  operator, and so on. There is no shared mega-grammar; adding a language means
  adding a tokenizer, not editing the others.
- **Theme-aware.** Tokens are coloured with CSS custom-property tokens, not fixed
  hex values, so the same highlighted block reads correctly in both the light and
  dark themes. See [theming](Docs/design/theming) for the token system.

A fence with **no language tag** is left completely untouched — plain, monospaced
code, safe by default. A fence tagged with an **unknown or unsupported** language
still gets a generic fallback pass that highlights comments, strings and numbers
(but not keywords, builtins or operators). Either way no content is lost. The five
languages below each ship with a dedicated highlighter.

## Python

```python
from dataclasses import dataclass, field


@dataclass
class Heading:
    """A single document heading with its computed section number."""

    level: int
    text: str
    number: tuple[int, ...] = field(default_factory=tuple)

    @property
    def label(self) -> str:
        return ".".join(str(n) for n in self.number)


def number_headings(headings: list[Heading]) -> list[Heading]:
    counters = [0] * 6
    for h in headings:
        counters[h.level - 1] += 1
        for deeper in range(h.level, 6):
            counters[deeper] = 0
        h.number = tuple(c for c in counters[: h.level] if c)
    return headings


if __name__ == "__main__":
    doc = [Heading(1, "Overview"), Heading(2, "Goals"), Heading(2, "Non-goals")]
    for h in number_headings(doc):
        print(f"{h.label:<6} {h.text}")
```

## Robot Framework

```robotframework
*** Settings ***
Library           Browser
Suite Setup       Open Browser To Docs
Suite Teardown    Close Browser

*** Variables ***
${BASE_URL}       http://localhost:8000
${DOC_ID}         Docs/features/highlighting

*** Test Cases ***
Reader Can Deep Link To A Document
    [Documentation]    Hash routing should load the requested doc directly.
    [Tags]    navigation    smoke
    Go To             ${BASE_URL}/#/${DOC_ID}
    Wait Until Element Is Visible    css=h1
    Element Text Should Be    css=h1    Syntax Highlighting

*** Keywords ***
Open Browser To Docs
    New Browser       chromium    headless=True
    New Page          ${BASE_URL}
```

## Makefile

```makefile
PORT ?= 8000
PYTHON ?= python
DOCS := $(shell find docs -name '*.md')

.PHONY: serve test lint clean

serve:
	$(PYTHON) serve.py --port $(PORT)

test:
	$(PYTHON) -m pytest tests/ -q

lint: $(DOCS)
	@echo "Checking $(words $(DOCS)) documents..."
	$(PYTHON) tools/check_meta.py $(DOCS)

clean:
	rm -rf .pytest_cache __pycache__
```

## Shell

```bash
#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8000}"
URL="http://localhost:${PORT}/site.json"

start_server() {
  python serve.py --port "$PORT" &
  echo $!
}

pid="$(start_server)"
trap 'kill "$pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 20); do
  if curl -sf "$URL" >/dev/null; then
    echo "WebDocs is up on port ${PORT}"
    exit 0
  fi
  sleep 0.25
done

echo "server did not come up" >&2
exit 1
```

## Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

/** Minimal check that fenced code blocks are balanced in a Markdown source. */
public final class FenceLinter {

    private static final String FENCE = "```";

    public static boolean isBalanced(String markdown) {
        Deque<Integer> open = new ArrayDeque<>();
        int line = 0;
        for (String text : markdown.split("\n", -1)) {
            line++;
            if (text.stripLeading().startsWith(FENCE)) {
                if (open.isEmpty()) {
                    open.push(line);
                } else {
                    open.pop();
                }
            }
        }
        return open.isEmpty();
    }

    public static void main(String[] args) {
        String sample = "```python\nprint('hi')\n```\n";
        System.out.println("balanced? " + isBalanced(sample));
    }
}
```

Each block above was coloured by the tokenizer named in its fence. Because the
tokenizers are ordinary JavaScript with no external dependency, they load
instantly and work offline — like the rest of the rendering pipeline, which
pulls in nothing of its own either.
