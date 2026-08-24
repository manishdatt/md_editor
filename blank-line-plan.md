# Robust Markdown Blank-Line Handling Plan

## Goal

Make blank-line behavior deterministic across the editor, preview, save/reopen,
refresh, public share links, uploaded Markdown files, and PDF export.

The same document should render with the same vertical spacing regardless of
whether it is newly typed, saved, reopened, refreshed, shared, or exported.

## Current Problem

Blank-line meaning is currently represented by several overlapping systems:

- TipTap serializes empty paragraphs as `&nbsp;` marker lines.
- Loading expands blank-line runs before parsing them.
- Preview rendering converts blank-line runs into injected `<br>` elements.
- Preview spacing also depends on CSS paragraph margins.
- Shared links independently normalize `&nbsp;` markers.
- Uploaded Markdown can save the original file content instead of the final
  normalized editor content.
- Preview rendering is asynchronous, so an older render can finish after a
  newer edit and replace the current preview.

These transformations are individually understandable, but their combination
causes spacing to change after save/reopen or refresh and makes the behavior
difficult to reproduce.

## Recommended Design

Use one canonical document representation and one rendering pipeline.

### 1. Establish a canonical Markdown storage format

Persist authored Markdown directly, including its newline structure. Do not use
`&nbsp;` as an internal empty-paragraph protocol.

Normalize only line endings at the document boundary:

```text
CRLF -> LF
```

Do not normalize or rewrite blank-line runs during ordinary preview rendering.

### 2. Remove repeated blank-line transformations

Replace or remove the blank-line conversion logic in:

- `app/utils/markdownAlignment.ts`
  - `expandBlankRunsForParse`
- `app/composables/useMarkdownRenderer.client.ts`
  - `canonicalizeStoredMarkers`
  - `blankLinesToSpacers`

Blank lines should be parsed once by the Markdown renderer and should not be
rewritten during save, reload, or preview generation.

### 3. Migrate legacy `&nbsp;` content once

Existing documents may contain `&nbsp;` marker lines from the current storage
format. Add a one-time migration at the load/save boundary that:

- Detects marker lines outside fenced code blocks.
- Converts legacy marker runs into the canonical newline representation.
- Leaves code fences and legitimate non-breaking spaces untouched.
- Does not run again during preview rendering.

The migration should be idempotent: applying it twice must produce the same
result as applying it once.

### 4. Represent intentional extra spacing explicitly

Normal Markdown blank lines should provide normal block separation. If the
application needs more space than normal Markdown provides, use an explicit,
supported spacer representation instead of stacking empty lines or inserting
invisible characters.

For example:

```html
<div class="markdown-spacer"></div>
```

The editor, preview, public share page, and PDF output must all understand this
representation consistently.

### 5. Separate normal spacing from explicit spacing

Define normal paragraph, list, heading, and code-block spacing in CSS. Define
the explicit spacer independently:

```css
.preview-content .markdown-spacer {
  height: 1em;
  line-height: 0;
}
```

Do not use CSS margins to compensate for parser-generated spacing differences.

### 6. Centralize document-boundary processing

Create one helper responsible for content entering or leaving the editor. It
should handle:

- Line-ending normalization.
- Alignment marker extraction and restoration.
- One-time migration of legacy `&nbsp;` markers.
- Canonical content comparison before saving.

The renderer should receive canonical Markdown and should not mutate persisted
content.

### 7. Fix upload/save consistency

In `EditorWorkspace.client.vue`, the Markdown upload flow should save the final
content produced by the editor (`markdown.value`) rather than the raw uploaded
file content. This prevents the database from receiving a different format
than the content displayed in the editor.

Programmatic content loading, file import, document switching, and mode changes
must continue to be protected from triggering an automatic save.

### 8. Make preview rendering race-safe

Add a render revision or request token to `refreshPreview()`:

1. Increment the revision for every requested render.
2. Capture the revision before awaiting the renderer.
3. Apply the generated HTML only if its revision is still current.

This prevents a slow render from an older document state from overwriting a
newer preview after rapid edits or refreshes.

### 9. Use the same renderer for all surfaces

The editor preview and public share page should use the same canonical Markdown
conversion pipeline. The public page should not perform separate blank-line
normalization.

The Markdown PDF path uses `html2pdf.js` to rasterize the live preview, so PDF
spacing will match the preview once the preview output is stable. The separate
Typst PDF path is unaffected by this Markdown-specific plan.

## Files to Change

- `app/utils/markdownAlignment.ts`
  - Add canonical boundary processing and one-time legacy migration.
  - Remove repeated blank-run expansion from normal load behavior.

- `app/composables/useMarkdownRenderer.client.ts`
  - Remove preview-time blank-line rewriting.
  - Keep rendering pure and canonical-input-only.

- `app/components/editor/EditorWorkspace.client.vue`
  - Use the canonical load/save helpers.
  - Save normalized uploaded content.
  - Add race protection to `refreshPreview()`.

- `app/assets/css/tailwind.css`
  - Define stable normal block spacing.
  - Define explicit spacer styling.

- `app/components/public/SharedDocPreview.client.vue`
  - Use the same canonical content/rendering path.
  - Remove any independent spacing normalization if introduced there.

## Verification Plan

Add tests or a repeatable manual test matrix covering:

- No blank lines.
- One blank line between paragraphs.
- Multiple blank lines between paragraphs.
- Leading blank lines.
- Trailing blank lines.
- Blank lines around headings.
- Blank lines between list items.
- Empty lines inside fenced code blocks.
- Markdown containing legitimate non-breaking spaces.
- Legacy documents containing `&nbsp;` marker lines.
- Alignment markers combined with blank lines.
- Uploaded Markdown files.
- Rapid typing followed by refresh.
- Save, close, reopen, and refresh cycles.
- Public share-link rendering.
- Markdown PDF export.

For every case, verify that:

1. The editor content remains unchanged after save and reload.
2. The preview spacing remains unchanged after refresh.
3. The share page matches the editor preview.
4. The PDF matches the preview.
5. Repeating the full cycle does not add or remove spaces.

## Acceptance Criteria

- Blank-line spacing is stable across repeated save/reopen/refresh cycles.
- No new `&nbsp;` marker lines are generated for ordinary blank lines.
- Legacy `&nbsp;` content is migrated safely and only once.
- Preview rendering never mutates persisted Markdown.
- Upload, editor, share page, and PDF use the same spacing semantics.
- Older preview renders cannot overwrite newer content.
- Explicit extra spacing has a documented, deterministic representation.
- Fenced code, lists, headings, alignment, and legitimate non-breaking spaces are
  unaffected.

## Implementation Order

1. Add canonical boundary normalization and legacy migration.
2. Add round-trip tests for the conversion helpers.
3. Update editor load/save/upload paths.
4. Remove preview-time blank-line rewriting.
5. Add preview render race protection.
6. Standardize preview/share CSS and explicit spacer rendering.
7. Validate PDF output against the final preview.
