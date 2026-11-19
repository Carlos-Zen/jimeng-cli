// Minimal command registry. Command modules call cli({...}) at import time.
//
// Spec fields: name, aliases?, description, example?, browser (bool), defaultWindowMode?,
// args: [{ name, type: 'string'|'int'|'boolean', positional?, required?, default?, help }],
// columns: default table columns, func: browser ? (page, kwargs) : (kwargs).

export const Strategy = Object.freeze({ UI: 'ui', PUBLIC: 'public' });

const commands = new Map();

export function cli(spec) {
  if (!spec?.name || typeof spec.func !== 'function') throw new Error('cli(): name and func are required');
  commands.set(spec.name, spec);
  return spec;
}

export function getCommand(name) {
  if (commands.has(name)) return commands.get(name);
  for (const c of commands.values()) if (c.aliases?.includes(name)) return c;
  return undefined;
}

export function listCommands() {
  return [...commands.values()];
}
