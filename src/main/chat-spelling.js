'use strict';

// Use Electron's local spellchecker; only an explicit menu choice edits a draft.
function installChatSpelling(window, Menu) {
  const contents = window.webContents;
  contents.on('context-menu', (_event, params) => {
    if (!params.isEditable || params.formControlType !== 'text-area') return;
    const items = [];
    // Windows can report spellcheckEnabled=false even while supplying a
    // misspelled word and native suggestions. Trust the actual spelling result.
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: 'No spelling suggestions', enabled: false });
      items.push({ label: 'Add to dictionary', click: () => {
        contents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
      } });
      items.push({ type: 'separator' });
    }
    const flags = params.editFlags;
    items.push(
      { role: 'undo', enabled: flags.canUndo },
      { role: 'redo', enabled: flags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: flags.canCut },
      { role: 'copy', enabled: flags.canCopy },
      { role: 'paste', enabled: flags.canPaste },
      { role: 'selectAll', enabled: flags.canSelectAll },
    );
    Menu.buildFromTemplate(items).popup({ window });
  });
}

module.exports = { installChatSpelling };
