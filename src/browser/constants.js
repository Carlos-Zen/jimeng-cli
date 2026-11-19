// Shared constants between the CLI, the daemon and (by convention) the extension.
import os from 'node:os';
import path from 'node:path';

export const DAEMON_HOST = '127.0.0.1';
export const DAEMON_PORT = Number(process.env.JIMENG_DAEMON_PORT || 19835);
/** Fixed ID of the jimeng-cli browser extension (derived from the "key" in extension/manifest.json). */
export const EXTENSION_ID = 'ohddnjibfpolbmekcfleaemkepiigjgc';
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
/** Header every CLI → daemon request must carry (browsers cannot send it cross-origin without a preflight we deny). */
export const CLI_HEADER = 'x-jimeng-cli';
export const HOME_DIR = process.env.JIMENG_CLI_HOME || path.join(os.homedir(), '.jimeng-cli');
export const PROTOCOL_VERSION = 1;
