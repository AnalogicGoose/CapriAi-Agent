'use strict';

// Chat links open only as public https pages in the user's preferred browser.
function createLinkOpener({ publicUrl, openUrl }) {
  return async url => {
    try {
      if (typeof url !== 'string' || url.length > 2048) throw Error('Invalid link.');
      await openUrl(publicUrl(url), 'default');
      return { ok: true };
    } catch (error) {
      const missing = /verified browser executable for “([^”]{1,40})”/.exec(String(error?.message));
      return { ok: false, error: missing ? `${missing[1]} isn’t installed. Pick another browser in her control room (App).` : 'Couldn’t open that link.' };
    }
  };
}
module.exports = { createLinkOpener };
