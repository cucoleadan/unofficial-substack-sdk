import { SubstackConfigurationError } from './errors.js'
import type {
  NoteBodyInlineNode,
  NoteBodyJson,
  NoteBodyParagraphNode,
  NoteBodyText,
  NotePersonTag,
  NotePersonTagNode
} from './types.js'
import { boundedString, positiveInteger } from './validation.js'

const MAX_NOTE_LENGTH = 5_000
const MAX_PERSON_TAG_LABEL_LENGTH = 500

export type NormalizedPersonTag = {
  handle: string
  id: number
  label: string
  mentionType: string
  token: string
  url: string | null
}

/**
 * Validates person tags and derives each `@handle` token. Only callers that
 * support publication mentions set `allowPublications`.
 */
export function normalizePersonTags(
  personTags: readonly NotePersonTag[],
  { allowPublications = false }: { allowPublications?: boolean } = {}
): NormalizedPersonTag[] {
  const tags = personTags.map((tag) => {
    const mentionType = tag.mentionType ?? 'user'
    if (mentionType !== 'user' && !(allowPublications && mentionType === 'pub')) {
      throw new SubstackConfigurationError(
        allowPublications
          ? `Note person tag mentionType must be "user" or "pub".`
          : `createNoteBodyJson supports user mentions only; use markdownToNoteBodyJson for "${mentionType}" mentions.`
      )
    }

    const label = boundedString(
      tag.label,
      'Note person tag label',
      1,
      MAX_PERSON_TAG_LABEL_LENGTH
    )

    const handle = boundedString(
      tag.handle?.replace(/^@/, '') ?? label,
      'Note person tag handle',
      1,
      MAX_PERSON_TAG_LABEL_LENGTH
    )

    return {
      handle,
      id: positiveInteger(tag.id, 'Note person tag ID'),
      label,
      mentionType,
      token: `@${handle}`,
      url: tag.url ?? null
    }
  })

  const handles = new Set<string>()
  for (const tag of tags) {
    if (handles.has(tag.handle)) {
      throw new SubstackConfigurationError(
        `Note person tag handle "@${tag.handle}" must be unique.`
      )
    }
    handles.add(tag.handle)
  }

  return tags
}

function personTagNode(tag: NormalizedPersonTag): NotePersonTagNode {
  return {
    type: 'substack_mention',
    attrs: {
      id: tag.id,
      label: tag.label,
      mentionType: 'user',
      url: tag.url
    }
  }
}

function parseInlineContent(
  body: string,
  personTags: readonly NormalizedPersonTag[],
  matchedHandles: Set<string>
): NoteBodyInlineNode[] {
  const content: NoteBodyInlineNode[] = []
  let cursor = 0

  while (cursor < body.length) {
    let nextTag: NormalizedPersonTag | undefined
    let nextIndex = -1

    for (const tag of personTags) {
      const index = body.indexOf(tag.token, cursor)
      if (
        index !== -1 &&
        (nextIndex === -1 ||
          index < nextIndex ||
          (index === nextIndex && tag.token.length > (nextTag?.token.length ?? 0)))
      ) {
        nextTag = tag
        nextIndex = index
      }
    }

    if (!nextTag) {
      content.push({ type: 'text', text: body.slice(cursor) })
      break
    }

    if (nextIndex > cursor) {
      content.push({ type: 'text', text: body.slice(cursor, nextIndex) })
    }

    content.push(personTagNode(nextTag))
    matchedHandles.add(nextTag.handle)
    cursor = nextIndex + nextTag.token.length
  }

  return content
}

function buildNoteBodyJson(body: string, personTags: readonly NotePersonTag[]): NoteBodyJson {
  const tags = normalizePersonTags(personTags)
  const matchedHandles = new Set<string>()
  const paragraphs = body
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((paragraph) => ({
      type: 'paragraph' as const,
      content: parseInlineContent(paragraph, tags, matchedHandles)
    }))

  if (paragraphs.length === 0) {
    throw new SubstackConfigurationError('Note body must contain at least one non-empty line.')
  }

  for (const tag of tags) {
    if (!matchedHandles.has(tag.handle)) {
      throw new SubstackConfigurationError(
        `Note body must contain the person tag "${tag.token}".`
      )
    }
  }

  return {
    type: 'doc',
    attrs: { schemaVersion: 'v1', title: null },
    content: paragraphs
  }
}

/**
 * Builds Substack's ProseMirror-style Note document and converts explicitly
 * supplied `@handle` occurrences into person-tag nodes.
 *
 * Each non-empty line becomes one paragraph. Blank lines are omitted because
 * Substack discards empty paragraphs when it stores a Note; paragraphs are
 * already rendered with spacing between them.
 */
export function createNoteBodyJson(
  body: string,
  personTags: readonly NotePersonTag[] = []
): NoteBodyJson {
  return buildNoteBodyJson(boundedString(body, 'Note body', 1, MAX_NOTE_LENGTH), personTags)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isEmptyAttrs(value: unknown): boolean {
  return value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0)
}

/** Normalizes a plain-text-compatible inline node, or returns null. */
function plainInlineNode(node: unknown): NoteBodyInlineNode | null {
  if (!isRecord(node)) return null

  if (node.type === 'text') {
    if (!hasOnlyKeys(node, ['type', 'text', 'marks'])) return null
    if (typeof node.text !== 'string') return null
    if (node.marks !== undefined && !(Array.isArray(node.marks) && node.marks.length === 0)) return null
    return { type: 'text', text: node.text }
  }

  if (node.type === 'substack_mention') {
    if (!hasOnlyKeys(node, ['type', 'attrs']) || !isRecord(node.attrs)) return null
    const { id, label, mentionType, url } = node.attrs
    if (!hasOnlyKeys(node.attrs, ['id', 'label', 'mentionType', 'url'])) return null
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null
    if (typeof label !== 'string' || label.length === 0) return null
    if (mentionType !== 'user') return null
    if (url !== undefined && url !== null && typeof url !== 'string') return null
    return { type: 'substack_mention', attrs: { id, label, mentionType: 'user', url: url ?? null } }
  }

  return null
}

/** Drops empty text nodes and merges adjacent text nodes. */
function mergeTextNodes(nodes: NoteBodyInlineNode[]): NoteBodyInlineNode[] {
  const merged: NoteBodyInlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.text) continue
      const previous = merged[merged.length - 1]
      if (previous?.type === 'text') {
        merged[merged.length - 1] = { type: 'text', text: previous.text + node.text }
        continue
      }
    }
    merged.push(node)
  }
  return merged
}

/**
 * Converts a Note document back into the plain text and person tags accepted
 * by `createNoteBodyJson`. It is the inverse of `createNoteBodyJson`.
 *
 * Returns null unless the document contains only paragraphs of unmarked text
 * and user mentions that convert back to the same document. Links, marks,
 * lists, hard breaks, and other nodes return null, so callers know the Note
 * cannot be edited as plain text without losing content.
 *
 * Paragraphs are separated by one newline and mentions are written as
 * `@Label`; each returned person tag uses its label as its handle. Empty
 * paragraphs are skipped. The 5,000-character limit is not applied here, so
 * an over-long Note returns its text and fails later in `createNoteBodyJson`.
 */
export function noteBodyJsonToText(bodyJson: unknown): NoteBodyText | null {
  if (!isRecord(bodyJson) || bodyJson.type !== 'doc') return null
  const blocks = bodyJson.content ?? []
  if (!Array.isArray(blocks)) return null

  const paragraphs: NoteBodyParagraphNode[] = []
  for (const block of blocks) {
    if (!isRecord(block) || block.type !== 'paragraph') return null
    if (!hasOnlyKeys(block, ['type', 'content', 'attrs']) || !isEmptyAttrs(block.attrs)) return null
    const inline = block.content ?? []
    if (!Array.isArray(inline)) return null

    const nodes: NoteBodyInlineNode[] = []
    for (const node of inline) {
      const plain = plainInlineNode(node)
      if (!plain) return null
      nodes.push(plain)
    }
    const content = mergeTextNodes(nodes)
    if (content.length > 0) paragraphs.push({ type: 'paragraph', content })
  }

  const personTags: NotePersonTag[] = []
  const taggedIds = new Set<number>()
  const text = paragraphs
    .map((paragraph) =>
      paragraph.content
        .map((node) => {
          if (node.type === 'text') return node.text
          if (!taggedIds.has(node.attrs.id)) {
            taggedIds.add(node.attrs.id)
            personTags.push({ id: node.attrs.id, label: node.attrs.label, url: node.attrs.url })
          }
          return `@${node.attrs.label}`
        })
        .join('')
    )
    .join('\n')
  if (paragraphs.length === 0) return { text, personTags }

  // Rebuilding rejects every ambiguous case: newlines inside text, literal
  // `@Label` text, one person with two labels, or two people with one label.
  let rebuilt: NoteBodyJson
  try {
    rebuilt = buildNoteBodyJson(text, personTags)
  } catch {
    return null
  }
  return JSON.stringify(rebuilt.content) === JSON.stringify(paragraphs) ? { text, personTags } : null
}
