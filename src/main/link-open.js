'use strict';

// Chat links open only as public https pages in the user's preferred browser.
function createLinkOpener({ publicUrl, openUrl }) {
  return async url => {
    try {
      if (typeof url !== 'string' || url.length > 2048) throw Error('Invalid link.');
      await openUrl(publicUrl(url), 'default');
      return { ok: true };
    } catch {
      return { ok: false, error: 'Couldn’t open that link.' };
    }
  };
}
module.exports = { createLinkOpener };
