import { SubstackConfigurationError } from './errors.js'
import type {
  NoteBodyInlineNode,
  NoteBodyJson,
  NotePersonTag,
  NotePersonTagNode
} from './types.js'
import { boundedString, positiveInteger } from './validation.js'

const MAX_NOTE_LENGTH = 5_000
const MAX_PERSON_TAG_LABEL_LENGTH = 500

type NormalizedPersonTag = {
  handle: string
  id: number
  label: string
  token: string
  url: string | null
}

function normalizePersonTags(personTags: readonly NotePersonTag[]): NormalizedPersonTag[] {
  const tags = personTags.map((tag) => {
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

/**
 * Builds Substack's ProseMirror-style Note document and converts explicitly
 * supplied `@handle` occurrences into person-tag nodes.
 */
export function createNoteBodyJson(
  body: string,
  personTags: readonly NotePersonTag[] = []
): NoteBodyJson {
  const validatedBody = boundedString(body, 'Note body', 1, MAX_NOTE_LENGTH)
  const tags = normalizePersonTags(personTags)
  const matchedHandles = new Set<string>()
  const paragraphs = validatedBody.split(/\r?\n/).map((paragraph) => ({
    type: 'paragraph' as const,
    content: parseInlineContent(paragraph, tags, matchedHandles)
  }))

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
