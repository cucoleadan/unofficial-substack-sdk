import { SubstackConfigurationError } from './errors.js'
import { type NormalizedPersonTag, normalizePersonTags } from './note-body.js'
import type {
  NoteBodyMarkdown,
  NotePersonTag,
  NoteRichBlockNode,
  NoteRichBlockquoteNode,
  NoteRichDocument,
  NoteRichInlineNode,
  NoteRichListItemNode,
  NoteRichMentionNode,
  NoteRichParagraphNode,
  NoteRichTextNode,
  NoteTextMark
} from './types.js'

const MAX_NOTE_LENGTH = 5_000
/** Attributes Substack's Notes editor gives every link. */
const LINK_ATTRS = { target: '_blank', rel: 'nofollow ugc noopener', class: 'note-link' } as const
const MARK_ORDER = ['bold', 'italic', 'strike', 'code', 'link'] as const
const SIMPLE_MARKS = new Set(['bold', 'italic', 'strike', 'code'])
const LIST_TYPES = new Set(['bulletList', 'orderedList'])

type Path = string
type InlineMarkName = 'bold' | 'italic' | 'strike'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Normalization: the form Substack stores without changing it.
// ---------------------------------------------------------------------------

class UnsupportedFormatting {
  readonly problems: string[] = []
  add(problem: string) {
    this.problems.push(problem)
  }
}

function normalizeMarks(value: unknown, path: Path, issues: UnsupportedFormatting): NoteTextMark[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    issues.add(`${path}.marks is not an array`)
    return undefined
  }
  const marks: NoteTextMark[] = []
  value.forEach((mark, index) => {
    if (!isRecord(mark) || typeof mark.type !== 'string') {
      issues.add(`${path}.marks[${index}] is not a mark`)
    } else if (SIMPLE_MARKS.has(mark.type)) {
      marks.push({ type: mark.type as 'bold' | 'italic' | 'strike' | 'code' })
    } else if (mark.type === 'link' && isRecord(mark.attrs) && typeof mark.attrs.href === 'string') {
      marks.push({ type: 'link', attrs: { ...(mark.attrs as { href: string }) } })
    } else {
      issues.add(`${mark.type} mark at ${path}`)
    }
  })
  return marks.length > 0 ? marks : undefined
}

function linkOf(node: NoteRichInlineNode) {
  return node.marks?.find((mark) => mark.type === 'link')
}

function normalizeInline(
  value: unknown,
  path: Path,
  issues: UnsupportedFormatting
): Array<NoteRichInlineNode | 'break'> {
  if (!isRecord(value) || typeof value.type !== 'string') {
    issues.add(`${path} is not a node`)
    return []
  }
  if (value.type === 'hardBreak') return ['break']
  const marks = normalizeMarks(value.marks, path, issues)
  if (value.type === 'text') {
    if (typeof value.text !== 'string') {
      issues.add(`${path}.text is not a string`)
      return []
    }
    const node: NoteRichTextNode = { type: 'text', text: value.text, ...(marks ? { marks } : {}) }
    // Notes always display a link's URL as its text.
    const link = linkOf(node)
    if (link && link.type === 'link') node.text = link.attrs.href
    return [node]
  }
  if (value.type === 'substack_mention') {
    const attrs = isRecord(value.attrs) ? value.attrs : {}
    if (typeof attrs.id !== 'number' || typeof attrs.label !== 'string') {
      issues.add(`${path} is a mention without a numeric id and a label`)
      return []
    }
    return [
      {
        type: 'substack_mention',
        attrs: {
          id: attrs.id,
          label: attrs.label,
          mentionType: typeof attrs.mentionType === 'string' ? attrs.mentionType : 'user',
          url: typeof attrs.url === 'string' ? attrs.url : null
        },
        ...(marks ? { marks } : {})
      }
    ]
  }
  issues.add(`${value.type} at ${path}`)
  return []
}

function sameMarks(a?: NoteTextMark[], b?: NoteTextMark[]) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

/** How invisible a space is when it takes on a neighbour's marks; lower is better. */
function spaceHost(node: NoteRichInlineNode | undefined): number {
  if (node?.type !== 'text') return Infinity
  const types = (node.marks ?? []).map((mark) => mark.type)
  if (types.includes('code') || types.includes('link')) return Infinity
  if (types.length === 0) return 0
  if (types.every((type) => type === 'bold' || type === 'italic')) return 1
  return 2
}

/**
 * Substack deletes a whitespace-only text node between formatted text, which
 * joins the neighbouring words. Moving the whitespace into a neighbour keeps
 * it. A space between two mentions has no host and is kept as is, which
 * Substack preserves.
 */
function foldWhitespace(nodes: NoteRichInlineNode[]): NoteRichInlineNode[] {
  const result = [...nodes]
  for (let index = 0; index < result.length; index++) {
    const node = result[index]!
    if (node.type !== 'text' || node.text.trim() !== '' || node.marks) continue
    const previous = result[index - 1]
    const next = result[index + 1]
    const previousScore = spaceHost(previous)
    const nextScore = spaceHost(next)
    if (previousScore === Infinity && nextScore === Infinity) continue
    if (previousScore <= nextScore) {
      result[index - 1] = { ...(previous as NoteRichTextNode), text: (previous as NoteRichTextNode).text + node.text }
    } else {
      result[index + 1] = { ...(next as NoteRichTextNode), text: node.text + (next as NoteRichTextNode).text }
    }
    result.splice(index, 1)
    index--
  }
  return result
}

function cleanInline(nodes: NoteRichInlineNode[]): NoteRichInlineNode[] {
  // Moving whitespace can leave two neighbours with identical marks; merge them too.
  return mergeText(foldWhitespace(mergeText(nodes)))
}

function mergeText(nodes: NoteRichInlineNode[]): NoteRichInlineNode[] {
  const merged: NoteRichInlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.text) continue
      const previous = merged[merged.length - 1]
      if (previous?.type === 'text' && sameMarks(previous.marks, node.marks) && !linkOf(node)) {
        merged[merged.length - 1] = { ...previous, text: previous.text + node.text }
        continue
      }
    }
    merged.push(node)
  }
  return merged
}

/** Splits a paragraph at hard breaks, as Substack does when storing it. */
function normalizeParagraph(value: Record<string, unknown>, path: Path, issues: UnsupportedFormatting): NoteRichParagraphNode[] {
  const content = value.content ?? []
  if (!Array.isArray(content)) {
    issues.add(`${path}.content is not an array`)
    return []
  }
  const paragraphs: NoteRichInlineNode[][] = [[]]
  content.forEach((child, index) => {
    for (const node of normalizeInline(child, `${path}.content[${index}]`, issues)) {
      if (node === 'break') paragraphs.push([])
      else paragraphs[paragraphs.length - 1]!.push(node)
    }
  })
  return paragraphs.map((nodes) => {
    const cleaned = cleanInline(nodes)
    return cleaned.length > 0 ? { type: 'paragraph', content: cleaned } : { type: 'paragraph' }
  })
}

const isEmptyParagraph = (block: NoteRichBlockNode) => block.type === 'paragraph' && !block.content?.length

function normalizeBlocks(
  values: unknown,
  path: Path,
  issues: UnsupportedFormatting,
  { dropEmptyParagraphs }: { dropEmptyParagraphs: boolean }
): NoteRichBlockNode[] {
  if (!Array.isArray(values)) {
    issues.add(`${path} is not an array`)
    return []
  }
  const blocks: NoteRichBlockNode[] = []
  values.forEach((value, index) => {
    const at = `${path}[${index}]`
    if (!isRecord(value) || typeof value.type !== 'string') {
      issues.add(`${at} is not a node`)
      return
    }
    switch (value.type) {
      case 'paragraph':
        blocks.push(...normalizeParagraph(value, at, issues))
        return
      case 'bulletList':
      case 'orderedList': {
        const items = Array.isArray(value.content) ? value.content : []
        const listItems: NoteRichListItemNode[] = items.map((item, itemIndex) => {
          const itemPath = `${at}.content[${itemIndex}]`
          if (!isRecord(item) || item.type !== 'listItem') {
            issues.add(`${itemPath} is not a listItem`)
            return { type: 'listItem', content: [{ type: 'paragraph' }] }
          }
          const content = normalizeBlocks(item.content, `${itemPath}.content`, issues, { dropEmptyParagraphs: false })
          return { type: 'listItem', content: content as NoteRichListItemNode['content'] }
        })
        if (value.type === 'bulletList') {
          blocks.push({ type: 'bulletList', content: listItems })
        } else {
          const start = isRecord(value.attrs) && typeof value.attrs.start === 'number' ? value.attrs.start : undefined
          blocks.push({ type: 'orderedList', ...(start === undefined ? {} : { attrs: { start } }), content: listItems })
        }
        return
      }
      case 'blockquote': {
        const content = normalizeBlocks(value.content, `${at}.content`, issues, { dropEmptyParagraphs: true })
        if (content.length > 0) blocks.push({ type: 'blockquote', content: content as NoteRichBlockquoteNode['content'] })
        return
      }
      case 'codeBlock': {
        const children = Array.isArray(value.content) ? value.content : []
        let text = ''
        children.forEach((child, childIndex) => {
          if (isRecord(child) && child.type === 'text' && typeof child.text === 'string') text += child.text
          else issues.add(`${at}.content[${childIndex}] is not plain text`)
        })
        const language = isRecord(value.attrs) ? value.attrs.language : undefined
        blocks.push({
          type: 'codeBlock',
          ...(isRecord(value.attrs) ? { attrs: { language: typeof language === 'string' ? language : null } } : {}),
          ...(text ? { content: [{ type: 'text', text }] } : {})
        })
        return
      }
      default:
        issues.add(`${value.type} at ${at}`)
    }
  })
  return dropEmptyParagraphs ? blocks.filter((block) => !isEmptyParagraph(block)) : blocks
}

/**
 * Rewrites a Note document into the form Substack stores without changing it,
 * so a Note read back after publishing equals the document you sent.
 *
 * - Whitespace between two formatted words moves into a neighbouring plain,
 *   bold, or italic text node. Substack deletes it otherwise.
 * - Link text becomes the link's URL, as Notes always display it.
 * - Hard breaks split paragraphs, and empty paragraphs are removed.
 * - Adjacent text nodes with identical marks are merged.
 *
 * Throws `SubstackConfigurationError` for formatting Substack Notes do not
 * support, such as headings, underline, horizontal rules, or images; Substack
 * rejects those with HTTP 500.
 */
export function normalizeNoteBodyJson(bodyJson: unknown): NoteRichDocument {
  if (!isRecord(bodyJson) || bodyJson.type !== 'doc') {
    throw new SubstackConfigurationError('A Note body must be a document with type "doc".')
  }
  const issues = new UnsupportedFormatting()
  const content = normalizeBlocks(bodyJson.content ?? [], '$.content', issues, { dropEmptyParagraphs: true })
  if (issues.problems.length > 0) {
    throw new SubstackConfigurationError(
      `Note formatting is not supported by Substack Notes: ${issues.problems.join('; ')}.`
    )
  }
  return { type: 'doc', attrs: { schemaVersion: 'v1', title: null }, content }
}

// ---------------------------------------------------------------------------
// Note Markdown → document
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'char'; ch: string }
  | { kind: 'delim'; raw: '**' | '~~' | '*' | '_' }
  | { kind: 'code'; text: string }
  | { kind: 'url'; href: string }
  | { kind: 'mention'; tag: NormalizedPersonTag }

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch)
const count = (text: string, ch: string) => text.split(ch).length - 1

/** Reads a bare http(s) URL, excluding trailing punctuation as GitHub does. */
function readUrl(line: string, index: number): string | undefined {
  if (!line.startsWith('http://', index) && !line.startsWith('https://', index)) return undefined
  if (isWordChar(line[index - 1])) return undefined
  let end = index
  while (end < line.length && !/\s/.test(line[end]!)) end++
  let url = line.slice(index, end)
  while (url) {
    if (/[?!.,:;*_~'"]$/.test(url)) url = url.slice(0, -1)
    else if (url.endsWith(')') && count(url, '(') < count(url, ')')) url = url.slice(0, -1)
    else break
  }
  return /^https?:\/\/[^/\s]/.test(url) ? url : undefined
}

function tokenize(line: string, tags: readonly NormalizedPersonTag[]): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < line.length) {
    const ch = line[index]!
    if (ch === '\\' && index + 1 < line.length) {
      tokens.push({ kind: 'char', ch: line[index + 1]! })
      index += 2
      continue
    }
    if (ch === '`') {
      const close = line.indexOf('`', index + 1)
      if (close > index + 1) {
        tokens.push({ kind: 'code', text: line.slice(index + 1, close) })
        index = close + 1
        continue
      }
    }
    const url = readUrl(line, index)
    if (url) {
      tokens.push({ kind: 'url', href: url })
      index += url.length
      continue
    }
    if (ch === '@') {
      let match: NormalizedPersonTag | undefined
      for (const tag of tags) {
        if (line.startsWith(tag.token, index) && tag.token.length > (match?.token.length ?? 0)) match = tag
      }
      if (match) {
        tokens.push({ kind: 'mention', tag: match })
        index += match.token.length
        continue
      }
    }
    if (line.startsWith('**', index) || line.startsWith('~~', index)) {
      tokens.push({ kind: 'delim', raw: line.slice(index, index + 2) as '**' | '~~' })
      index += 2
      continue
    }
    if (ch === '*' || (ch === '_' && !(isWordChar(line[index - 1]) && isWordChar(line[index + 1])))) {
      tokens.push({ kind: 'delim', raw: ch })
      index += 1
      continue
    }
    tokens.push({ kind: 'char', ch })
    index += 1
  }

  // An unpaired delimiter is literal text.
  for (const raw of ['**', '~~', '*', '_'] as const) {
    const positions = tokens.flatMap((token, position) =>
      token.kind === 'delim' && token.raw === raw ? [position] : []
    )
    if (positions.length % 2 === 1) tokens[positions[positions.length - 1]!] = { kind: 'char', ch: raw }
  }
  return tokens.flatMap((token) =>
    token.kind === 'char' && token.ch.length > 1 ? [...token.ch].map((ch) => ({ kind: 'char' as const, ch })) : [token]
  )
}

function orderedMarks(active: ReadonlySet<InlineMarkName>, extra: NoteTextMark[] = []): NoteTextMark[] | undefined {
  const marks: NoteTextMark[] = [...[...active].map((type) => ({ type })), ...extra]
  marks.sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type))
  return marks.length > 0 ? marks : undefined
}

function mentionNode(tag: NormalizedPersonTag, marks?: NoteTextMark[]): NoteRichMentionNode {
  return {
    type: 'substack_mention',
    attrs: { id: tag.id, label: tag.label, mentionType: tag.mentionType, url: tag.url },
    ...(marks ? { marks } : {})
  }
}

function parseInline(line: string, tags: readonly NormalizedPersonTag[], matched: Set<string>): NoteRichInlineNode[] {
  const nodes: NoteRichInlineNode[] = []
  const toggles = { '**': false, '~~': false, '*': false, _: false }
  let buffer = ''
  const active = () => {
    const set = new Set<InlineMarkName>()
    if (toggles['**']) set.add('bold')
    if (toggles['*'] || toggles._) set.add('italic')
    if (toggles['~~']) set.add('strike')
    return set
  }
  const flush = () => {
    if (!buffer) return
    const marks = orderedMarks(active())
    nodes.push({ type: 'text', text: buffer, ...(marks ? { marks } : {}) })
    buffer = ''
  }

  for (const token of tokenize(line, tags)) {
    if (token.kind === 'char') {
      buffer += token.ch
      continue
    }
    flush()
    if (token.kind === 'delim') {
      toggles[token.raw] = !toggles[token.raw]
    } else if (token.kind === 'code') {
      nodes.push({ type: 'text', text: token.text, marks: orderedMarks(active(), [{ type: 'code' }]) })
    } else if (token.kind === 'url') {
      nodes.push({
        type: 'text',
        text: token.href,
        marks: orderedMarks(active(), [{ type: 'link', attrs: { href: token.href, ...LINK_ATTRS } }])
      })
    } else {
      matched.add(token.tag.handle)
      nodes.push(mentionNode(token.tag, orderedMarks(active())))
    }
  }
  flush()
  return cleanInline(nodes)
}

const LIST_LINE = /^( *)(?:([-*])|(\d+)\.) (.*)$/

function paragraph(content: NoteRichInlineNode[]): NoteRichParagraphNode {
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function parseList(
  lines: string[],
  start: number,
  indent: number,
  tags: readonly NormalizedPersonTag[],
  matched: Set<string>
): { node: NoteRichBlockNode; next: number } {
  const first = LIST_LINE.exec(lines[start]!)!
  const ordered = first[3] !== undefined
  const items: NoteRichListItemNode[] = []
  let index = start
  while (index < lines.length) {
    const match = LIST_LINE.exec(lines[index]!)
    if (!match || match[1]!.length !== indent || (match[3] !== undefined) !== ordered) break
    const content: NoteRichListItemNode['content'] = [paragraph(parseInline(match[4]!, tags, matched))]
    index++
    while (index < lines.length) {
      const child = LIST_LINE.exec(lines[index]!)
      if (!child || child[1]!.length !== indent + 2) break
      const nested = parseList(lines, index, indent + 2, tags, matched)
      content.push(nested.node as NoteRichListItemNode['content'][number])
      index = nested.next
    }
    items.push({ type: 'listItem', content })
  }
  const node: NoteRichBlockNode = ordered
    ? { type: 'orderedList', attrs: { start: Number(first[3]) }, content: items }
    : { type: 'bulletList', content: items }
  return { node, next: index }
}

function parseMarkdown(markdown: string, tags: readonly NormalizedPersonTag[], matched: Set<string>): NoteRichBlockNode[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: NoteRichBlockNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line === '') {
      index++
      continue
    }
    const fence = /^```(.*)$/.exec(line)
    if (fence) {
      const code: string[] = []
      index++
      while (index < lines.length && lines[index] !== '```') code.push(lines[index++]!)
      index++
      const text = code.join('\n')
      blocks.push({
        type: 'codeBlock',
        attrs: { language: fence[1]!.trim() || null },
        ...(text ? { content: [{ type: 'text', text }] } : {})
      })
      continue
    }
    if (line === '>' || line.startsWith('> ')) {
      const quoted: NoteRichParagraphNode[] = []
      while (index < lines.length && (lines[index] === '>' || lines[index]!.startsWith('> '))) {
        const content = parseInline(lines[index]!.slice(2), tags, matched)
        if (content.length > 0) quoted.push({ type: 'paragraph', content })
        index++
      }
      if (quoted.length > 0) blocks.push({ type: 'blockquote', content: quoted })
      continue
    }
    const list = LIST_LINE.exec(line)
    if (list && list[1] === '') {
      const parsed = parseList(lines, index, 0, tags, matched)
      blocks.push(parsed.node)
      index = parsed.next
      continue
    }
    const content = parseInline(line, tags, matched)
    if (content.length > 0) blocks.push({ type: 'paragraph', content })
    index++
  }
  return blocks
}

function visibleLength(blocks: readonly NoteRichBlockNode[]): number {
  let length = 0
  const walk = (node: any) => {
    if (node.type === 'text') length += node.text.length
    else if (node.type === 'substack_mention') length += node.attrs.label.length + 1
    for (const child of node.content ?? []) walk(child)
  }
  blocks.forEach(walk)
  return length
}

function buildFromMarkdown(markdown: string, personTags: readonly NotePersonTag[]): NoteRichDocument {
  const tags = normalizePersonTags(personTags, { allowPublications: true })
  const matched = new Set<string>()
  const content = parseMarkdown(markdown, tags, matched)
  if (content.length === 0) {
    throw new SubstackConfigurationError('Note Markdown must contain at least one non-empty line.')
  }
  for (const tag of tags) {
    if (!matched.has(tag.handle)) {
      throw new SubstackConfigurationError(`Note Markdown must contain the person tag "${tag.token}".`)
    }
  }
  return normalizeNoteBodyJson({ type: 'doc', content })
}

/**
 * Builds a formatted Note document from Note Markdown, a small Markdown
 * dialect limited to what Substack Notes support:
 *
 * - `**bold**`, `*italic*` or `_italic_`, `~~strikethrough~~`, and `` `code` ``
 * - Bare `http://` and `https://` URLs become links. Notes show the URL as the
 *   link text, so `[text](url)` is not supported.
 * - `@handle` becomes a mention for each supplied person tag, as in
 *   `createNoteBodyJson`. Tags may mention a user or, with
 *   `mentionType: "pub"`, a publication.
 * - Each line is a paragraph; blank lines are ignored.
 * - `- item` or `* item` bulleted lists and `1. item` numbered lists, nested
 *   by indenting two spaces; `> quote` lines; and ```` ``` ```` fenced code
 *   blocks with an optional language.
 * - A backslash makes the next character literal, such as `\*` or `\@`.
 *
 * The result is already normalized with `normalizeNoteBodyJson`, so Substack
 * stores it unchanged. The visible text is limited to 5,000 characters.
 */
export function markdownToNoteBodyJson(
  markdown: string,
  personTags: readonly NotePersonTag[] = []
): NoteRichDocument {
  if (typeof markdown !== 'string' || markdown.length === 0) {
    throw new SubstackConfigurationError('Note Markdown must be a non-empty string.')
  }
  const document = buildFromMarkdown(markdown, personTags)
  if (visibleLength(document.content) > MAX_NOTE_LENGTH) {
    throw new SubstackConfigurationError(
      `Note text must contain at most ${MAX_NOTE_LENGTH.toLocaleString('en-US')} characters.`
    )
  }
  return document
}

// ---------------------------------------------------------------------------
// Document → Note Markdown
// ---------------------------------------------------------------------------

function escapeText(text: string, tags: readonly NormalizedPersonTag[]): string {
  let out = ''
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]!
    if (ch === '\\' || ch === '*' || ch === '~' || ch === '`') out += `\\${ch}`
    else if (ch === '_' && !(isWordChar(text[index - 1]) && isWordChar(text[index + 1]))) out += '\\_'
    else if (ch === '@' && tags.some((tag) => text.startsWith(tag.token, index))) out += '\\@'
    // Plain text that would read as a bare URL, such as `https://`, is not a link.
    else if (ch === ':' && text.startsWith('://', index) && /https?$/.test(text.slice(0, index))) out += '\\:'
    else out += ch
  }
  return out
}

function serializeInline(nodes: readonly NoteRichInlineNode[], tags: readonly NormalizedPersonTag[]): string | null {
  let out = ''
  const open = new Set<InlineMarkName>()
  const delimiter: Record<InlineMarkName, string> = { bold: '**', italic: '*', strike: '~~' }
  const transition = (wanted: ReadonlySet<InlineMarkName>) => {
    for (const mark of ['bold', 'italic', 'strike'] as const) {
      if (open.has(mark) !== wanted.has(mark)) {
        out += delimiter[mark]
        if (open.has(mark)) open.delete(mark)
        else open.add(mark)
      }
    }
  }

  for (const node of nodes) {
    const types = (node.marks ?? []).map((mark) => mark.type)
    transition(new Set(types.filter((type): type is InlineMarkName => type === 'bold' || type === 'italic' || type === 'strike')))
    const link = linkOf(node)
    const isCode = types.includes('code')
    if (node.type === 'substack_mention') {
      if (isCode || link) return null
      out += `@${node.attrs.label}`
    } else if (link && link.type === 'link') {
      if (isCode || node.text !== link.attrs.href) return null
      out += link.attrs.href
    } else if (isCode) {
      if (!node.text || node.text.includes('`')) return null
      out += `\`${node.text}\``
    } else {
      out += escapeText(node.text, tags)
    }
  }
  transition(new Set())
  return out
}

/** Escapes a paragraph line that would otherwise read as a list, quote, or fence. */
function escapeLineStart(line: string): string {
  const match = /^( *)(-|\d+\.|>)( |$)/.exec(line)
  if (!match) return line
  const [, indent, marker] = match
  const escaped = marker === '-' ? '\\-' : marker === '>' ? '\\>' : marker!.replace('.', '\\.')
  return indent + escaped + line.slice(indent!.length + marker!.length)
}

function serializeList(
  node: NoteRichBlockNode,
  indent: string,
  tags: readonly NormalizedPersonTag[],
  lines: string[]
): boolean {
  if (node.type !== 'bulletList' && node.type !== 'orderedList') return false
  let number = node.type === 'orderedList' ? (node.attrs?.start ?? 1) : 0
  for (const item of node.content) {
    const [first, ...rest] = item.content
    if (first?.type !== 'paragraph') return false
    const text = serializeInline(first.content ?? [], tags)
    if (text === null) return false
    lines.push(`${indent}${node.type === 'orderedList' ? `${number++}.` : '-'} ${text}`)
    for (const child of rest) {
      if (!LIST_TYPES.has(child.type) || !serializeList(child, `${indent}  `, tags, lines)) return false
    }
  }
  return true
}

function serializeBlocks(blocks: readonly NoteRichBlockNode[], tags: readonly NormalizedPersonTag[]): string | null {
  const lines: string[] = []
  let previous: NoteRichBlockNode['type'] | undefined
  for (const block of blocks) {
    // A blank line keeps two adjacent lists or quotes of the same kind apart.
    if (block.type === previous && block.type !== 'paragraph' && block.type !== 'codeBlock') lines.push('')
    previous = block.type
    if (block.type === 'paragraph') {
      const text = serializeInline(block.content ?? [], tags)
      if (text === null) return null
      lines.push(escapeLineStart(text))
    } else if (block.type === 'blockquote') {
      for (const child of block.content) {
        if (child.type !== 'paragraph') return null
        const text = serializeInline(child.content ?? [], tags)
        if (text === null) return null
        lines.push(`> ${text}`)
      }
    } else if (block.type === 'codeBlock') {
      const text = block.content?.map((node) => node.text).join('') ?? ''
      if (text.split('\n').includes('```')) return null
      lines.push(`\`\`\`${block.attrs?.language ?? ''}`, ...(text ? text.split('\n') : []), '```')
    } else if (!serializeList(block, '', tags, lines)) {
      return null
    }
  }
  return lines.join('\n')
}

function canonicalMarks(marks?: NoteTextMark[]) {
  return [...(marks ?? [])]
    .map((mark) =>
      mark.type === 'link'
        ? {
            type: 'link',
            attrs: {
              href: mark.attrs.href,
              target: mark.attrs.target ?? LINK_ATTRS.target,
              rel: mark.attrs.rel ?? LINK_ATTRS.rel,
              class: mark.attrs.class ?? LINK_ATTRS.class
            }
          }
        : { type: mark.type }
    )
    .sort((a, b) => MARK_ORDER.indexOf(a.type as never) - MARK_ORDER.indexOf(b.type as never))
}

/** Compares two documents, ignoring mark order and default attributes. */
function canonical(node: any): unknown {
  switch (node.type) {
    case 'doc':
      return { type: 'doc', content: node.content.map(canonical) }
    case 'text':
      return { type: 'text', text: node.text, marks: canonicalMarks(node.marks) }
    case 'substack_mention':
      return { type: 'substack_mention', attrs: node.attrs, marks: canonicalMarks(node.marks) }
    case 'orderedList':
      return { type: 'orderedList', start: node.attrs?.start ?? 1, content: node.content.map(canonical) }
    case 'codeBlock':
      return { type: 'codeBlock', language: node.attrs?.language ?? null, text: (node.content ?? []).map((t: any) => t.text).join('') }
    default:
      return { type: node.type, content: (node.content ?? []).map(canonical) }
  }
}

function collectMentions(node: any, found: NotePersonTag[], seen: Map<string, NotePersonTag>): boolean {
  if (node.type === 'substack_mention') {
    const { id, label, mentionType, url } = node.attrs
    const key = `${mentionType}:${id}`
    const existing = seen.get(key)
    if (existing) return existing.label === label && (existing.url ?? null) === url
    const tag: NotePersonTag = { id, label, url, ...(mentionType === 'user' ? {} : { mentionType }) }
    seen.set(key, tag)
    found.push(tag)
  }
  return (node.content ?? []).every((child: any) => collectMentions(child, found, seen))
}

/**
 * Converts a formatted Note document into Note Markdown and person tags that
 * `markdownToNoteBodyJson` turns back into the same document. Use it to edit
 * a published Note or draft in your application without losing formatting,
 * mentions, or links.
 *
 * The document is first normalized with `normalizeNoteBodyJson`. Returns null
 * when it contains formatting Substack Notes do not support, or anything Note
 * Markdown cannot reproduce exactly, such as a list item with two paragraphs,
 * two adjacent quotes, or plain text that looks like a URL. Mark order and
 * Substack's default link, list, and code-block attributes are not
 * significant. The 5,000-character limit is not applied here.
 */
export function noteBodyJsonToMarkdown(bodyJson: unknown): NoteBodyMarkdown | null {
  let document: NoteRichDocument
  try {
    document = normalizeNoteBodyJson(bodyJson)
  } catch {
    return null
  }

  const personTags: NotePersonTag[] = []
  const seen = new Map<string, NotePersonTag>()
  if (!document.content.every((block) => collectMentions(block, personTags, seen))) return null

  let tags: NormalizedPersonTag[]
  try {
    tags = normalizePersonTags(personTags, { allowPublications: true })
  } catch {
    return null
  }
  const markdown = serializeBlocks(document.content, tags)
  if (markdown === null) return null
  if (document.content.length === 0) return { markdown, personTags }

  try {
    const rebuilt = buildFromMarkdown(markdown, personTags)
    return JSON.stringify(canonical(rebuilt)) === JSON.stringify(canonical(document)) ? { markdown, personTags } : null
  } catch {
    return null
  }
}
