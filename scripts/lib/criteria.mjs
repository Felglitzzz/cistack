// A ticket's acceptance criteria, as written in its issue.

// The bullets under the issue's "Acceptance criteria" heading, in order.
export function acceptanceCriteria(body) {
  const [, level, rest = ""] = body.replace(/\r\n/g, "\n").split(/^(#{2,})[ \t]*Acceptance criteria[ \t]*$/im);
  // The section runs to the next heading that isn't one of its own subheadings.
  const within = level ? rest.split(new RegExp(`^#{1,${level.length}}[ \\t]`, "m"))[0] : "";
  const found = [];
  let open = false;
  for (const line of within.split("\n")) {
    const bullet = line.match(/^(?:[-*]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?(.+)$/);
    if (bullet) found.push(bullet[1].trim());
    else if (open && /^[ \t]+\S/.test(line)) found[found.length - 1] += ` ${line.trim()}`;
    open = Boolean(bullet) || (open && /^[ \t]+\S/.test(line));
  }
  return found;
}
