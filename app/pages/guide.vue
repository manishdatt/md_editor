<script setup lang="ts">
useSeoMeta({
  title: 'Guide',
  description: 'User guide for the Markdown editor, including Markdown syntax basics and editor workflow.',
  ogTitle: 'shbd Guide',
  ogDescription: 'User guide for the Markdown editor, including Markdown syntax basics and editor workflow.',
  twitterTitle: 'shbd Guide',
  twitterDescription: 'User guide for the Markdown editor, including Markdown syntax basics and editor workflow.'
})
</script>

<template>
  <section class="mx-auto w-full max-w-4xl rounded-lg border border-neutral-300 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
    <article class="prose prose-neutral max-w-none dark:prose-invert">
      <p>
        <NuxtLink
          to="/"
          class="not-prose inline-flex rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-700 no-underline dark:border-neutral-700 dark:text-neutral-200"
        >
          Back to Editor
        </NuxtLink>
      </p>

      <h1>User Guide</h1>
      <p>
        This editor is a Markdown-first workspace. You write Markdown on the left and see rendered output on the right.
        The saved source of truth is Markdown text.
      </p>

      <h2>Core Workflow</h2>
      <ul>
        <li>Use <strong>New</strong> to create a Markdown document, or <strong>New Typst</strong> to create a Typst document.</li>
        <li>Write content in the editor pane.</li>
        <li>Use <strong>PDF</strong> to export your rendered document.</li>
        <li>Use <strong>Upload .md</strong> and <strong>Download .md</strong> for Markdown files (<strong>Download .typ</strong> for Typst documents).</li>
      </ul>

      <h2>Typst Documents</h2>
      <p>
        Typst documents are written directly in the
        <a href="https://typst.app/docs" target="_blank" rel="noopener">Typst markup language</a>
        and compiled to print-quality PDF when you press <strong>PDF</strong>.
        The format is chosen when the document is created and cannot be changed later.
      </p>
      <pre><code>= Hello Typst

This is a #strong[print-quality] document.

- Real pagination and page numbers
- Excellent math: $integral_0^1 x^2 dif x = 1/3$
- Syntax-highlighted code blocks

```rust
fn main() {
    println!("Hello from Typst!");
}
```
      </code></pre>
      <p>
        Notes: Typst export requires signing in (the document is compiled on our
        server), compilation errors are shown under the toolbar, and Mermaid diagrams
        are not available in Typst mode.
      </p>

      <h2>Markdown Basics</h2>
      <p>Common syntax examples:</p>
      <pre><code># Heading 1
## Heading 2
### Heading 3

**bold** and *italic*

- bullet item
- another item

1. first
2. second

[link text](https://example.com)

![alt text](https://example.com/image.png)

&gt; blockquote
      </code></pre>

      <h2>Code Blocks</h2>
      <p>Use fenced blocks with a language label:</p>
      <pre><code>```javascript
const message = 'hello'
console.log(message)
```
      </code></pre>

      <h2>Mermaid Diagrams</h2>
      <p>Use Mermaid fences to define diagrams:</p>
      <pre><code>```mermaid
graph TD
  A[Start] --&gt; B[End]
```
      </code></pre>
      <p>For more information, see the <a href="https://mermaid.js.org/intro/" target="_blank" rel="noopener">Mermaid documentation</a>.</p>

      <h2>Tables</h2>
      <p>Table syntax:</p>
      <pre><code>| Column 1 | Column 2 |
| --- | --- |
| A | B |
| C | D |
      </code></pre>

      <h2>Emoji Shortcodes</h2>
      <p>Use shortcode syntax to insert emojis in normal Markdown text:</p>
      <pre><code>:smile: :rocket: :tada: :heart: :white_check_mark: :+1: :-1:
      </code></pre>
      <p>These shortcodes render in preview and PDF output.</p>

      <h2>Detailed documentation</h2>
      <p>For more detailed documentation on Markdown syntax, see the <a href="https://www.markdownguide.org/basic-syntax" target="_blank" rel="noopener">Basic Syntax Guide</a>
      and <a href="https://www.markdownguide.org/extended-syntax" target="_blank" rel="noopener">Extended Syntax Guide</a>.</p>

      <h2>Modes</h2>
      <ul>
        <li><strong>Public:</strong> editable but not saved.</li>
        <li><strong>Free:</strong> saved to your account with a document limit.</li>
        <li><strong>Paid:</strong> saved to your account with no document limit.</li>
      </ul>
    </article>
  </section>
</template>
