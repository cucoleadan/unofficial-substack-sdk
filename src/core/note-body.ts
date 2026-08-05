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

    return {
      id: positiveInteger(tag.id, 'Note person tag ID'),
      label,
      token: `@${label}`,
      url: tag.url ?? null
    }
  })

  const labels = new Set<string>()
  for (const tag of tags) {
    if (labels.has(tag.label)) {
      throw new SubstackConfigurationError(
        `Note person tag label "${tag.label}" must be unique.`
      )
    }
    labels.add(tag.label)
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
  matchedLabels: Set<string>
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
    matchedLabels.add(nextTag.label)
    cursor = nextIndex + nextTag.token.length
  }

  return content
}

/**
 * Builds Substack's ProseMirror-style Note document and converts explicitly
 * supplied `@Display Name` occurrences into person-tag nodes.
 */
export function createNoteBodyJson(
  body: string,
  personTags: readonly NotePersonTag[] = []
): NoteBodyJson {
  const validatedBody = boundedString(body, 'Note body', 1, MAX_NOTE_LENGTH)
  const tags = normalizePersonTags(personTags)
  const matchedLabels = new Set<string>()
  const paragraphs = validatedBody.split(/\r?\n/).map((paragraph) => ({
    type: 'paragraph' as const,
    content: parseInlineContent(paragraph, tags, matchedLabels)
  }))

  for (const tag of tags) {
    if (!matchedLabels.has(tag.label)) {
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
