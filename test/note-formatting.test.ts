import { describe, expect, test } from 'bun:test'

import {
  createNoteBodyJson,
  markdownToNoteBodyJson,
  normalizeNoteBodyJson,
  noteBodyJsonToMarkdown,
  type NoteRichDocument,
  SubstackConfigurationError
} from '../src/core/index.js'
import fixtureCases from './fixtures/note-formatting/cases.json'
import normalizedFixtureCases from './fixtures/note-formatting/normalized-cases.json'

type Case = { sent: any; stored?: any; storedBody?: string; error?: { status: number; body: string } }
const cases = fixtureCases as Record<string, Case>
const storedCases = Object.entries(cases).filter(([, value]) => value.stored)

const LINK = { target: '_blank', rel: 'nofollow ugc noopener', class: 'note-link' }
const MARKS = ['bold', 'italic', 'strike', 'code', 'link']

/**
 * What Substack did to each document in the live run: it deleted
 * whitespace-only text between two formatted text nodes, replaced link text
 * with the URL, and removed empty paragraphs.
 */
function substackStores(document: any): any {
  const inline = (nodes: any[] = []) => {
    const kept = nodes.filter((node, index) => {
      const marked = (other: any) => other?.type === 'text' && other.marks?.length
      const blank = node.type === 'text' && !node.marks && node.text.trim() === ''
      return !(blank && marked(nodes[index - 1]) && marked(nodes[index + 1]))
    })
    return kept.map((node) => {
      const link = node.marks?.find((mark: any) => mark.type === 'link')
      return link ? { ...node, text: link.attrs.href } : node
    })
  }
  const block = (node: any): any =>
    node.type === 'paragraph'
      ? { ...node, content: inline(node.content) }
      : node.content && node.type !== 'codeBlock'
        ? { ...node, content: node.content.map(block) }
        : node
  return {
    ...document,
    content: document.content.map(block).filter((node: any) => node.type !== 'paragraph' || node.content.length > 0)
  }
}

/** Ignores mark order and Substack's default link, list, and code-block attributes. */
function canonical(node: any): any {
  const marks = (list?: any[]) =>
    (list ?? [])
      .map((mark) => (mark.type === 'link' ? { type: 'link', attrs: { ...LINK, ...mark.attrs } } : mark))
      .sort((a, b) => MARKS.indexOf(a.type) - MARKS.indexOf(b.type))
  switch (node.type) {
    case 'text':
      return { type: 'text', text: node.text, marks: marks(node.marks) }
    case 'substack_mention':
      return { ...node, marks: marks(node.marks) }
    case 'orderedList':
      return { type: 'orderedList', start: node.attrs?.start ?? 1, content: node.content.map(canonical) }
    case 'codeBlock':
      return { type: 'codeBlock', language: node.attrs?.language ?? null, text: node.content?.[0]?.text ?? '' }
    default:
      return { type: node.type, content: (node.content ?? []).map(canonical) }
  }
}

const plainText = (node: any): string =>
  node.type === 'text'
    ? node.text
    : (node.content ?? []).map(plainText).join(node.type === 'paragraph' ? '' : '\n')

describe('live formatting fixtures', () => {
  test.each(storedCases)('the model of Substack’s storage reproduces the live result: %s', (_name, value) => {
    expect(substackStores(value.sent)).toEqual(value.stored)
  })

  test('the live run covered every supported node and mark', () => {
    const types = new Set<string>()
    const walk = (node: any) => {
      types.add(node.type)
      node.marks?.forEach((mark: any) => types.add(`mark:${mark.type}`))
      node.content?.forEach(walk)
    }
    storedCases.forEach(([, value]) => walk(value.stored))
    expect([...types].sort()).toEqual(
      [
        'blockquote', 'bulletList', 'codeBlock', 'doc', 'listItem', 'orderedList', 'paragraph',
        'substack_mention', 'text', 'mark:bold', 'mark:code', 'mark:italic', 'mark:link', 'mark:strike'
      ].sort()
    )
  })
})

describe('live run of SDK-prepared documents', () => {
  const prepared = Object.entries(normalizedFixtureCases as Record<string, { sent: any; stored: any }>)

  test.each(prepared)('Substack stored the document unchanged: %s', (_name, value) => {
    expect(value.stored).toEqual(value.sent)
  })

  test.each(prepared)('the SDK reproduces and round-trips it: %s', (name, value) => {
    expect(normalizeNoteBodyJson(value.sent)).toEqual(value.sent)
    const converted = noteBodyJsonToMarkdown(value.stored)
    // The same person is mentioned with and without a URL, which one tag cannot express.
    if (name === 'mentions-normalized') {
      expect(converted).toBeNull()
      return
    }
    expect(converted).not.toBeNull()
    const rebuilt = markdownToNoteBodyJson(converted!.markdown, converted!.personTags)
    expect(canonical(rebuilt)).toEqual(canonical(value.stored))
    // Documents built from Markdown use the editor's defaults and round-trip byte for byte.
    if (name === 'markdown') expect(rebuilt).toEqual(value.stored)
  })
})

describe('normalizeNoteBodyJson', () => {
  test.each(storedCases)('leaves a document Substack stored unchanged: %s', (_name, value) => {
    expect(normalizeNoteBodyJson(value.stored)).toEqual(value.stored)
  })

  test.each(storedCases)('produces a document Substack stores unchanged: %s', (_name, value) => {
    const normalized = normalizeNoteBodyJson(value.sent)
    expect(substackStores(normalized)).toEqual(normalized)
    expect(normalizeNoteBodyJson(normalized)).toEqual(normalized)
  })

  test('keeps the spaces that Substack deleted between formatted words', () => {
    const { sent, stored } = cases.marks!
    const normalized = normalizeNoteBodyJson(sent)

    expect(plainText(stored)).not.toBe(plainText(sent))
    expect(plainText(normalized)).toBe(plainText(sent))
    expect(normalized.content[1]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'plain ' },
        { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'italic ', marks: [{ type: 'italic' }] },
        { type: 'text', text: 'strike ', marks: [{ type: 'strike' }] },
        { type: 'text', text: 'code', marks: [{ type: 'code' }] }
      ]
    })
  })

  test('prefers a plain neighbour, then bold or italic, and never code or a link', () => {
    const t = (text: string, ...types: string[]) =>
      types.length ? { type: 'text', text, marks: types.map((type) => (type === 'link' ? { type, attrs: { href: text } } : { type })) } : { type: 'text', text }
    const paragraph = (...content: unknown[]) =>
      normalizeNoteBodyJson({ type: 'doc', content: [{ type: 'paragraph', content }] }).content[0]

    expect(paragraph(t('a', 'code'), t(' '), t('b', 'italic')) as unknown).toEqual({
      type: 'paragraph',
      content: [t('a', 'code'), t(' b', 'italic')]
    })
    expect(paragraph(t('a', 'strike'), t(' '), t('b', 'bold')) as unknown).toEqual({
      type: 'paragraph',
      content: [t('a', 'strike'), t(' b', 'bold')]
    })
    expect(paragraph(t('https://x.com', 'link'), t(' '), t('b', 'code')) as unknown).toEqual({
      type: 'paragraph',
      content: [t('https://x.com', 'link'), t(' '), t('b', 'code')]
    })
  })

  test('keeps a space between two mentions, which Substack preserves', () => {
    const mention = (id: number) => ({ type: 'substack_mention', attrs: { id, label: `P${id}`, mentionType: 'user', url: null } })
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [mention(1), { type: 'text', text: ' ' }, mention(2)] }] }

    expect(normalizeNoteBodyJson(document).content[0] as unknown).toEqual(document.content[0])
  })

  test('replaces link text with the URL and keeps the link attributes as sent', () => {
    const normalized = normalizeNoteBodyJson(cases.links!.sent)

    expect(normalized.content).toEqual(cases.links!.stored.content)
  })

  test('splits paragraphs at hard breaks and drops empty paragraphs and text', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] }
      ]
    }

    expect(normalizeNoteBodyJson(document).content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'two' }] }
    ])
  })

  test('rejects formatting that made Substack return HTTP 500', () => {
    const { sent, error } = cases.unsupported!
    expect(error).toEqual({ status: 500, body: '{"error":""}' })

    expect(() => normalizeNoteBodyJson(sent)).toThrow(SubstackConfigurationError)
    expect(() => normalizeNoteBodyJson(sent)).toThrow(
      /heading at \$\.content\[1\]; underline mark at \$\.content\[2\]\.content\[0\]; horizontalRule at \$\.content\[3\]/
    )
    expect(() => normalizeNoteBodyJson({ type: 'paragraph' })).toThrow(SubstackConfigurationError)
  })
})

describe('Note Markdown', () => {
  const ann = { id: 1, label: 'Ann Lee' }
  const pub = { id: 2, label: 'Daily Pub', mentionType: 'pub', url: 'https://daily.substack.com' }
  const link = (href: string) => ({ type: 'link', attrs: { href, ...LINK } })

  test('builds every supported mark, links, and user and publication mentions', () => {
    const document = markdownToNoteBodyJson(
      'Hi @Ann Lee and @Daily Pub! **bold** *italic* _also_ ~~gone~~ `x*y` ***both***, see https://ex.com/a_b?q=1.',
      [ann, pub]
    )

    expect(document as unknown).toEqual({
      type: 'doc',
      attrs: { schemaVersion: 'v1', title: null },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'substack_mention', attrs: { id: 1, label: 'Ann Lee', mentionType: 'user', url: null } },
            { type: 'text', text: ' and ' },
            { type: 'substack_mention', attrs: { id: 2, label: 'Daily Pub', mentionType: 'pub', url: 'https://daily.substack.com' } },
            { type: 'text', text: '! ' },
            // Spaces between formatted words move into a neighbour so Substack keeps them.
            { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'italic also ', marks: [{ type: 'italic' }] },
            { type: 'text', text: 'gone ', marks: [{ type: 'strike' }] },
            { type: 'text', text: 'x*y', marks: [{ type: 'code' }] },
            { type: 'text', text: ' both', marks: [{ type: 'bold' }, { type: 'italic' }] },
            { type: 'text', text: ', see ' },
            { type: 'text', text: 'https://ex.com/a_b?q=1', marks: [link('https://ex.com/a_b?q=1')] },
            { type: 'text', text: '.' }
          ]
        }
      ]
    })
  })

  test('builds formatted mentions and links', () => {
    expect(markdownToNoteBodyJson('**@Ann Lee** and **https://ex.com**', [ann]).content[0] as unknown).toEqual({
      type: 'paragraph',
      content: [
        { type: 'substack_mention', attrs: { id: 1, label: 'Ann Lee', mentionType: 'user', url: null }, marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'https://ex.com', marks: [{ type: 'bold' }, link('https://ex.com')] }
      ]
    })
  })

  test('builds lists, nested lists, quotes, and code blocks', () => {
    const document = markdownToNoteBodyJson(
      ['- one', '  - nested', '* two', '3. three', '4. four', '> quoted', '> *again*', '```ts', 'const a = 1', '', 'b()', '```'].join('\n')
    )
    const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })

    expect(document.content as unknown).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p('one'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('nested')] }] }] },
          { type: 'listItem', content: [p('two')] }
        ]
      },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p('three')] }, { type: 'listItem', content: [p('four')] }] },
      { type: 'blockquote', content: [p('quoted'), p('again', [{ type: 'italic' }])] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1\n\nb()' }] }
    ])
  })

  test('treats escaped and unpaired characters as text', () => {
    const document = markdownToNoteBodyJson(
      String.raw`\- not a list, 1\. not ordered, \> not a quote, 5 * 3, snake_case_name, \*\*not bold\*\*, \@Ann Lee, https\://not.a.link`,
      []
    )

    expect(document.content).toEqual([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '- not a list, 1. not ordered, > not a quote, 5 * 3, snake_case_name, **not bold**, @Ann Lee, https://not.a.link'
          }
        ]
      }
    ])
  })

  test('excludes trailing punctuation and unbalanced parentheses from URLs', () => {
    const urls = (markdown: string) =>
      markdownToNoteBodyJson(markdown)
        .content.flatMap((block: any) => block.content)
        .filter((node: any) => node.marks?.some((mark: any) => mark.type === 'link'))
        .map((node: any) => node.text)

    expect(urls('(see https://ex.com/a). Or https://ex.com/b_(c)! Or https://ex.com/d?')).toEqual([
      'https://ex.com/a',
      'https://ex.com/b_(c)',
      'https://ex.com/d'
    ])
  })

  test.each(storedCases.filter(([name]) => name !== 'mentions'))(
    'round-trips the document Substack stored: %s',
    (_name, value) => {
      const converted = noteBodyJsonToMarkdown(value.stored)

      expect(converted).not.toBeNull()
      expect(canonical(markdownToNoteBodyJson(converted!.markdown, converted!.personTags))).toEqual(canonical(value.stored))
    }
  )

  test('round-trips the stored mentions, the same person with two different URLs aside', () => {
    const stored = cases.mentions!.stored as NoteRichDocument
    const withoutSecondUrl = { ...stored, content: stored.content.filter((_block, index) => index !== 3) }

    expect(noteBodyJsonToMarkdown(stored)).toBeNull()
    const converted = noteBodyJsonToMarkdown(withoutSecondUrl)
    expect(converted?.markdown).toBe(
      [
        'Automated SDK formatting test (sdk-format-test mentions). This Note will be deleted.',
        'Hello @Example Author, and again @Example Author!',
        '@Example Author at the start, then a https://example.com/m next to @Example Author',
        'Bold around **@Example Author** mention.'
      ].join('\n')
    )
    expect(converted?.personTags).toEqual([{ id: 1001, label: 'Example Author', url: null }])
    expect(markdownToNoteBodyJson(converted!.markdown, converted!.personTags)).toEqual(withoutSecondUrl)
  })

  test.each([
    ['marks', 'plain **bold *both*** ~~strike~~ `code` and *it*', []],
    ['adjacent marks', '**a**~~b~~*c*`d`', []],
    ['mentions and links', '@Ann Lee, **@Daily Pub** and https://ex.com/x_y?z=1#f', [ann, pub]],
    ['nested lists', '- a\n  - b\n    - c\n- d\n1. one\n  - mixed', []],
    ['separate lists', '1. a\n\n3. b\n- c\n\n- d', []],
    ['quotes and code', '> one\n> **two**\n\n> three\n```\nraw *text* @Ann Lee\n```', []],
    ['escapes', String.raw`\- a \> b 1\. c \*d\* e\_f\_ \@Ann Lee https\://x.y \\ \~\~`, []],
    ['unicode', 'Ünïcødé ✓ — 日本語 — 👩🏽‍💻 **🚀**', []]
  ])('Markdown → document → Markdown → document is stable: %s', (_name, markdown, tags) => {
    const document = markdownToNoteBodyJson(markdown, tags)
    const converted = noteBodyJsonToMarkdown(document)

    expect(converted).not.toBeNull()
    expect(markdownToNoteBodyJson(converted!.markdown, converted!.personTags)).toEqual(document)
    expect(noteBodyJsonToMarkdown(markdownToNoteBodyJson(converted!.markdown, converted!.personTags))).toEqual(converted)
  })

  test('agrees with createNoteBodyJson on plain text with mentions', () => {
    const tags = [{ id: 1, handle: 'ann', label: 'Ann Lee' }]

    expect(markdownToNoteBodyJson('Thanks @ann!\nSecond line', tags)).toEqual(createNoteBodyJson('Thanks @ann!\nSecond line', tags))
  })

  test.each([
    ['a list item with two paragraphs', { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] }],
    ['inline code containing a backtick', { type: 'paragraph', content: [{ type: 'text', text: 'a`b', marks: [{ type: 'code' }] }] }],
    ['a code block containing a fence', { type: 'codeBlock', content: [{ type: 'text', text: 'a\n```\nb' }] }],
    ['a newline in text', { type: 'paragraph', content: [{ type: 'text', text: 'a\nb' }] }],
    ['one person with two labels', { type: 'paragraph', content: [{ type: 'substack_mention', attrs: { id: 1, label: 'A', mentionType: 'user', url: null } }, { type: 'substack_mention', attrs: { id: 1, label: 'B', mentionType: 'user', url: null } }] }],
    ['two people with one label', { type: 'paragraph', content: [{ type: 'substack_mention', attrs: { id: 1, label: 'A', mentionType: 'user', url: null } }, { type: 'substack_mention', attrs: { id: 2, label: 'A', mentionType: 'user', url: null } }] }],
    ['an unsupported node', { type: 'heading', content: [{ type: 'text', text: 'h' }] }]
  ])('noteBodyJsonToMarkdown returns null for %s', (_name, block) => {
    expect(noteBodyJsonToMarkdown({ type: 'doc', content: [block] })).toBeNull()
  })

  test('validates input, tags, and the 5,000-character limit', () => {
    expect(() => markdownToNoteBodyJson('')).toThrow(SubstackConfigurationError)
    expect(() => markdownToNoteBodyJson('\n\n')).toThrow(SubstackConfigurationError)
    expect(() => markdownToNoteBodyJson('no tag here', [ann])).toThrow('@Ann Lee')
    expect(() => markdownToNoteBodyJson('@x', [{ id: 1, label: 'x', mentionType: 'team' }])).toThrow(SubstackConfigurationError)
    expect(() => createNoteBodyJson('@Daily Pub', [pub])).toThrow(SubstackConfigurationError)

    // Formatting characters do not count toward the limit.
    expect(() => markdownToNoteBodyJson(`**${'a'.repeat(5_000)}**`)).not.toThrow()
    expect(() => markdownToNoteBodyJson('a'.repeat(5_001))).toThrow(SubstackConfigurationError)
    const long = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b'.repeat(6_000) }] }] }
    expect(noteBodyJsonToMarkdown(long)?.markdown).toHaveLength(6_000)
  })
})
