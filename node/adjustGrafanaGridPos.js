#!/usr/bin / env node
/**
 * Script to adjust Grafana panel coordinates in a template file.
 * Assumes a Ansible jinja template, but should work for any Grafana template file.
 * 
 * 1️⃣ Read a text file (any language) supplied on the command line.  
 * 2️⃣ Find every occurrence of a Grafana `gridPos` object – e.g.
 *        {"x":0,"y":4,"w":24,"h":8}
 *    (whitespace, newlines and property order are tolerated).  
 * 3️⃣ Collect those objects into an array, recalculate each object's `y`
 *    so that it equals the sum of the `h` values of all preceding objects.  
 * 4️⃣ Replace the original objects in the source text with the updated ones.  
 * 5️⃣ Write the result to a new file whose name is the original name plus
 *    `_modified` before the extension.
 */

const fs = require('fs');
const path = require('path');
// Updated helper – matches a JSON‑style object that:
//   • contains exactly four key/value pairs,
//   • includes an “x” property (with a numeric value) that can appear in any position.
// The RegExp works across line breaks thanks to the `s` flag.
function buildGridPosRegex() {
  // Numeric literal (integer or float, optional leading minus)
  const num = '-?\\d+(?:\\.\\d+)?';

  // Generic key/value pair (quoted or bare key, any primitive value)
  const anyProp = '(?:"?[a-zA-Z0-9_-]+"?\\s*:\\s*[^,}\\n]+)';

  // Look‑ahead to guarantee the presence of an “x” property with a number,
  // regardless of where it appears inside the braces.
  const xLookAhead = '(?=[^}]*"?x"?\\s*:\\s*' + num + ')';

  // Exactly four properties, separated by commas (allowing whitespace/newlines).
  const fourProps = '(' + anyProp + '\\s*,\\s*){3}' + anyProp;

  // Assemble the full pattern:
  //   { optional ws  look‑ahead  fourProps  optional ws }
  const pattern =
    '\\{' +                 // opening brace
    '\\s*' +                // optional leading whitespace / newlines
    xLookAhead +            // ensure an “x” property exists
    fourProps +             // match the four key/value pairs
    '\\s*' +                // optional trailing whitespace / newlines
    '\\}';                  // closing brace

  // `g` – global (find all matches)
  // `s` – dot matches newline, allowing multi‑line objects
  return new RegExp(pattern, 'gs');
}

// ---------- Main processing ----------
(async () => {
  // ----- 1️⃣ Parse CLI arguments -----
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    console.error('Usage: node adjust-gridpos.js <path-to-input-file>');
    process.exit(1);
  }

  // Resolve absolute path for safety
  const absInputPath = path.resolve(process.cwd(), inputPath);

  // ----- 2️⃣ Read the file -----
  let rawText;
  try {
    rawText = await fs.promises.readFile(absInputPath, 'utf8');
  } catch (err) {
    console.error(`❌ Could not read file "${absInputPath}": ${err.message}`);
    process.exit(1);
  }

  // ----- 3️⃣ Extract gridPos objects -----
  const regex = buildGridPosRegex();
  const matches = [...rawText.matchAll(regex)];

  if (matches.length === 0) {
    console.warn('⚠️ No gridPos objects found in the input file.');
    process.exit(0);
  }

  // Parse each matched JSON snippet into a plain object
  const gridPosArray = matches.map(m => {
    try {
      // JSON.parse requires double‑quoted property names; our regex already captures that.
      return JSON.parse(m[0]);
    } catch (_) {
      // Fallback: replace single quotes with double quotes and try again
      const sanitized = m[0].replace(/'/g, '"');
      return JSON.parse(sanitized);
    }
  });


  // ----- 4️⃣ Recalculate y values -----
  let cumulativeHeight = 0;
  const adjustedArray = gridPosArray.map(obj => {
    // const newObj = { ...obj, y: cumulativeHeight };
    const newObj = {
      x: obj.x,
      y: cumulativeHeight,
      h: obj.h,
      w: obj.w
    };

    cumulativeHeight += Number(obj.h) || 0;
    return newObj;
  });

  // ----- 5️⃣ Replace original snippets with adjusted ones -----
  // We'll walk the matches in order and rebuild the output string.
  let output = '';
  let lastIndex = 0;

  matches.forEach((match, idx) => {
    const start = match.index;
    const end = start + match[0].length;

    // Append text before this match unchanged
    output += rawText.slice(lastIndex, start);

    // Insert the adjusted JSON (pretty‑printed without extra spaces)
    const replacement = JSON.stringify(adjustedArray[idx]);

    output += replacement;
    lastIndex = end;
  });

  // Append any remaining tail of the file
  output += rawText.slice(lastIndex);

  // ----- 6️⃣ Write to the new file -----
  const ext = path.extname(absInputPath);               // e.g. ".json"
  const base = path.basename(absInputPath, ext);       // e.g. "dashboard"
  const dir = path.dirname(absInputPath);
  const outName = `${base}_modified${ext}`;
  const outPath = path.join(dir, outName);

  try {
    await fs.promises.writeFile(outPath, output, 'utf8');
    console.log(`✅ Modified file written to: ${outPath}`);
  } catch (err) {
    console.error(`❌ Failed to write output file: ${err.message}`);
    process.exit(1);
  }
})();           
