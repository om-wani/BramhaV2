import { Extension } from '@tiptap/core'

// Wikilink extension — registers the [[wikilink]] concept in the TipTap extension list.
// Actual [[detection and autocomplete is handled via onUpdate in NoteEditor.
export const WikilinkExtension = Extension.create({
  name: 'wikilink',

  addInputRules() {
    // Detection is handled via onUpdate regex; InputRules left empty intentionally.
    return []
  },
})
