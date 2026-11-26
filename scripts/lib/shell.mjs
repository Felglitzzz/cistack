// Reading a shell command line the way a hook needs to: which programs it runs, with
// what arguments, and from which directory. A best-effort reading, not a shell: what it
// can't see through (a variable, a command substitution, a script file) it doesn't see.

import { resolve } from "node:path";

const WRAPPERS = new Set(["sudo", "time", "nohup", "command", "exec", "env", "nice", "builtin"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);

// Splits into words and separators. Quotes group, a backslash escapes, and the
// operators ; | & ( ) { } and a newline, outside quotes, end a command.
function segments(command) {
  const out = [[]];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) out.at(-1).push(word);
    word = null;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      word ??= "";
    } else if (ch === "\\" && i + 1 < command.length) {
      word = (word ?? "") + command[++i];
    } else if (/\s/.test(ch) && ch !== "\n") {
      endWord();
    } else if (";|&(){}\n`".includes(ch)) {
      endWord();
      if (out.at(-1).length) out.push([]);
    } else {
      word = (word ?? "") + ch;
    }
  }
  endWord();
  return out.filter((words) => words.length);
}

// Drops what runs a program without being it: VAR=value, sudo, env, time and the like,
// with the flags that follow them.
function program(words) {
  let i = 0;
  while (i < words.length) {
    if (/^[A-Za-z_]\w*=/.test(words[i])) {
      i++;
    } else if (WRAPPERS.has(words[i])) {
      i++;
      while (words[i]?.startsWith("-")) i++;
    } else {
      break;
    }
  }
  return words.slice(i);
}

// The simple commands in a command line, each as {argv, cwd}. `cwd` follows `cd` and
// `pushd` earlier in the line. A shell's -c script and `eval` are read too.
export function simpleCommands(command, cwd) {
  const found = [];
  let here = cwd;
  for (const words of segments(command)) {
    const argv = program(words);
    if (!argv.length) continue;
    const name = argv[0].split("/").pop();
    if (name === "cd" || name === "pushd") {
      if (argv[1]) here = resolve(here, argv[1]);
      continue;
    }
    found.push({ argv: [name, ...argv.slice(1)], cwd: here });
    if (SHELLS.has(name)) {
      const flag = argv.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));
      if (flag !== -1 && argv[flag + 1]) found.push(...simpleCommands(argv[flag + 1], here));
    } else if (name === "eval") {
      found.push(...simpleCommands(argv.slice(1).join(" "), here));
    }
  }
  return found;
}
