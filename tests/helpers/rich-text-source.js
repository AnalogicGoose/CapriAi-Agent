'use strict';
const fs = require('node:fs'), path = require('node:path');
const uri = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
// Renderer modules loaded from data: URIs cannot resolve './rich-text.js'; inline it.
const richTextUri = () => uri(fs.readFileSync(path.join(__dirname, '../../src/renderer/js/rich-text.js'), 'utf8'));
const withRichText = source => source.replaceAll("'./rich-text.js'", `'${richTextUri()}'`);
module.exports = { withRichText };
