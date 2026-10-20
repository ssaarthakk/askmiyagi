export async function readInput() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

export function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
