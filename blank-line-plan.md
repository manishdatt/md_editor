# Plan: Replace `&nbsp;` Blank-Line Hack with CSS-Driven Spacing (Markdown → PDF)

## Goal
Remove `&nbsp;`-based blank lines from markdown sources and achieve consistent,
intentional vertical spacing in the generated PDF by controlling spacing through CSS
(the preview's styling) instead of filler characters.

## Engine (confirmed)
There are **two** PDF paths in this app; the markdown one is what matters here:

- **Markdown docs → `exportPdf()`** (`app/components/editor/EditorWorkspace.client.vue:378`):
  uses **`html2pdf.js`** (html2canvas + jsPDF). It rasterizes `previewRef` — the live
  preview `<div class="preview-content prose prose-neutral ...">` (L1328) — into a PDF.
  ⇒ **PDF spacing is whatever the on-screen `prose` preview shows.** No engine-level
  stylesheet injection is needed; we style the preview.
- **Typst-format docs → `exportTypstPdf()`** (L429): posts to `/api/export/pdf` →
  `pdf-service` (Go) which runs `typst compile`. Spacing there is governed by a Typst
  template, not CSS. (Out of scope for the markdown `&nbsp;` issue, noted for completeness.)

## Why
- `&nbsp;` inserts an invisible glyph purely to force a line — pollutes the markdown
  source, is semantically wrong, and renders inconsistently.
- The preview uses Tailwind Typography (`prose`), which already gives block spacing for
  real blank lines (each blank line = a `<p>` with `prose` margins). `&nbsp;` was likely
  added only to get *extra* gap beyond what `prose` provides — that should be CSS, not chars.
- The editor already serializes hard breaks as `<br>` (correct for in-paragraph breaks),
  so only the *block-gap* problem needs fixing.

## Approach
Control vertical rhythm via the preview's `prose` CSS; keep markdown clean.

### Steps
1. **Inventory `&nbsp;` usage**
   - Grep the markdown corpus for `&nbsp;` to separate blank-line filler from genuine
     non-breaking spaces.

2. **Tune the preview's `prose` spacing** (this is what the PDF rasterizes)
   - In the project's Tailwind/CSS layer, adjust `prose` block spacing, e.g.:
     ```css
     .preview-content.prose { line-height: 1.6; }
     .preview-content.prose p { margin-top: 0.75em; margin-bottom: 0.75em; }
     .preview-content.prose h1, .preview-content.prose h2 { margin-top: 1.25em; }
     ```
   - This makes real blank lines produce even, intentional spacing in the PDF.

3. **Replace `&nbsp;` blank lines**
   - Delete `&nbsp;` lines used only as blank lines; let real blank lines + `prose` margins
     do the work.
   - Where a *specific* larger gap is required, use a spacer element that renders in the
     preview (and is therefore rasterized):
     ```html
     <div class="spacer"></div>
     ```
     ```css
     .preview-content .spacer { height: 1em; }
     ```

4. **Keep `<br>` for line breaks**
   - Already the editor default for hard breaks — no change needed.
   - Use `<br>` only inside a paragraph; never stack it for block spacing.

5. **No engine wiring needed**
   - Because `html2pdf.js` rasterizes `previewRef`, the styling applied to
     `.preview-content.prose` (steps 2–3) is exactly what ends up in the PDF. There is no
     `--css` / external stylesheet step as with Pandoc/WeasyPrint.

6. **Verify**
   - In the editor, click **Export PDF** on a representative doc (e.g. `PWA`).
   - Confirm: no `&nbsp;` in source, blank lines produce even spacing, headings have
     correct top margin, intentional gaps use `.spacer`, and `<br>` still breaks lines.

## Acceptable Alternatives (if more control is wanted later)
- Customize `html2pdf().set({ ... })` options (e.g. `pagebreak: { mode: ['css', 'legacy'] }`)
  and add `page-break-before/after` utility classes in the preview CSS for section breaks.
- For typst-format docs, adjust the Typst template in `pdf-service/` instead.

## Acceptance Criteria
- [ ] No `&nbsp;` remains in markdown sources except genuine non-breaking spaces.
- [ ] Vertical spacing is consistent and defined in `.preview-content.prose` CSS.
- [ ] Generated PDF (via `exportPdf`) spacing matches the intended design.
- [ ] `<br>` still works for in-paragraph breaks.
- [ ] Alignment directive `<!-- alignment: {"N":"center"} -->` unaffected.
