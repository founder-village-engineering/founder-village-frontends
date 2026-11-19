export function parseJsonc(source: string): unknown {
  let uncommented = "";
  let index = 0;
  let inString = false;
  let escaped = false;
  while (index < source.length) {
    const character = source.charAt(index);
    const following = source.charAt(index + 1);
    if (inString) {
      uncommented += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      uncommented += character;
      index += 1;
    } else if (character === "/" && following === "/") {
      index += 2;
      while (index < source.length && !"\r\n".includes(source.charAt(index)))
        index += 1;
    } else if (character === "/" && following === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) throw new Error("unterminated JSONC comment");
      index = end + 2;
    } else {
      uncommented += character;
      index += 1;
    }
  }

  let cleaned = "";
  index = 0;
  inString = false;
  escaped = false;
  while (index < uncommented.length) {
    const character = uncommented.charAt(index);
    if (inString) {
      cleaned += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') inString = true;
    if (character === ",") {
      let lookahead = index + 1;
      while (
        lookahead < uncommented.length &&
        /\s/.test(uncommented.charAt(lookahead))
      )
        lookahead += 1;
      if ("}]".includes(uncommented.charAt(lookahead))) {
        index += 1;
        continue;
      }
    }
    cleaned += character;
    index += 1;
  }
  return JSON.parse(cleaned) as unknown;
}
