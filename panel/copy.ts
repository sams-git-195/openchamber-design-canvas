// Design Canvas UI copy, in one place.
//
// TOAST WORDING GUIDE (P5). Every `host.toast` in the panel follows it:
//   1. Sentence case, ONE line. Outcome first, then the next step:
//        "Design started. Controls are in Work Status."
//        "Could not open the canvas: <reason>. Try again."
//   2. No adverb narrating the success (a toast that fires IS the success), no
//      "Oops", no exclamation mark, no stack trace.
//   3. Errors say WHAT failed and WHAT TO DO. A raw service message rides after
//      the colon; it never stands alone.
//   4. `copy: true` on errors that carry a path or an id, so the user can paste
//      them into a bug report. When a long path had to be shortened for the
//      toast, Copy carries the FULL text.
//   5. `persistent: true` only for BLOCKING states — the user cannot continue
//      until they act. Progress, confirmations and recoverable errors time out.
//   6. GUEST_TOAST_MAX (500) bounds every toast: paths are middle-truncated,
//      then the whole message is clipped (`fitToast`).
//
// This module is pure (no host, no DOM) so the wording is testable alone.

/** The host's hard cap on a toast message (`GUEST_TOAST_MAX`). */
export const TOAST_MAX = 500;
/** What we send — leaves room for the host to never clip mid-character. */
const TOAST_FIT = 480;
/** A path longer than this is middle-truncated inside a toast. */
const TOAST_PATH_MAX = 56;
/** `copy.text` is bounded by the SDK at 32,000 characters. */
const TOAST_COPY_MAX = 32_000;

export type PanelToast = {
  kind: 'info' | 'success' | 'error';
  message: string;
  copy?: boolean | { text: string };
  persistent?: boolean;
};

/** A path shortened in the middle: both the drive/root and the folder name stay readable. */
export function shortPath(path: string, max = TOAST_PATH_MAX): string {
  if (path.length <= max) return path;
  const head = Math.max(1, Math.floor((max - 1) * 0.4));
  const tail = Math.max(1, max - 1 - head);
  return `${path.slice(0, head)}…${path.slice(path.length - tail)}`;
}

const LONG_PATH = /(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'`)\]]{40,}/g;
const CARRIES_PATH_OR_ID = /(?:[A-Za-z]:[\\/]|\\\\|\/[\w.~-]+\/|\bses_\w+|\bjob[-_]\w+|\bnew-design:|\bworkspace:)/;

/** Middle-truncate every long path in `text`. */
export function shortenPaths(text: string): string {
  return text.replace(LONG_PATH, (match) => shortPath(match));
}

/** Shorten paths, then clip the whole message under the host cap. */
export function fitToast(text: string): string {
  const shortened = shortenPaths(text.replace(/\s*\n\s*/g, ' · ').trim());
  return shortened.length > TOAST_FIT ? `${shortened.slice(0, TOAST_FIT - 1)}…` : shortened;
}

function toastOf(kind: PanelToast['kind'], text: string, options: { copy?: boolean; persistent?: boolean }): PanelToast {
  const message = fitToast(text);
  const toast: PanelToast = { kind, message };
  const wantCopy = options.copy ?? (kind === 'error' && CARRIES_PATH_OR_ID.test(text));
  if (wantCopy) toast.copy = message === text ? true : { text: text.slice(0, TOAST_COPY_MAX) };
  if (options.persistent) toast.persistent = true;
  return toast;
}

export const infoToast = (text: string): PanelToast => toastOf('info', text, {});
export const successToast = (text: string, options: { copy?: boolean } = {}): PanelToast => toastOf('success', text, options);
/** An error toast; Copy is added automatically when the text carries a path or id. */
export const errorToast = (text: string, options: { persistent?: boolean } = {}): PanelToast => toastOf('error', text, options);

/** The reason text of any thrown value. */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Make `text` end in a full stop (leaves `.`, `!`, `?` alone). */
export function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Outcome first, then the next step: "Export failed: x. Try /canvas export again." */
export function withNext(outcome: string, next: string): string {
  return `${sentence(outcome)} ${next}`;
}

// ---- toast wording (one constant or builder per message) ----

export const PERMISSION_HEADS_UP =
  "The agent edits files outside this chat's folder. Approve its file-edit permission prompts so it can write the design.";
export const DESIGN_MODE_OFF = 'Design Mode is off. Run /canvas to turn it back on.';
export const DESIGN_STARTED = 'Design started. Controls are in Work Status.';
export const NO_CANVAS_FOR_EXPORT = 'No canvas workspace yet. Run /canvas <brief> to create one, then export again.';
export const NO_CANVAS_FOR_CRITIQUE = 'No canvas workspace yet. Run /canvas <brief> to create one, then critique again.';
export const CANVAS_CREATE_FAILED = 'Could not create the canvas workspace. See the message above, then press Start to retry.';
export const WORKSPACE_REFERENCE_ADDED = 'Workspace reference added to the composer.';
export const FILE_REFERENCE_ADDED = 'File reference added to the composer.';
export const FOLDER_PATH_COPIED = 'Folder path copied.';
export const DROP_PATH_MESSAGE = 'Dropped files cannot be attached by name. Paste a file path using + → File path.';
export const EXPORT_STARTED = 'Export started — the result is toasted when it finishes.';
export const CRITIQUE_STARTED = 'Critique started — the review chip follows when it finishes.';
/** #6: the hidden resolve pane dies with its answer, so it cannot carry a job. */
export const CANVAS_JOBS_NEED_RAIL = 'Open the Design Canvas rail tab to run exports and critiques.';
export const EXPORT_STILL_RUNNING = 'Export is still running. Files land in the workspace exports folder as each screen finishes.';
export const DIAGNOSTICS_COPIED = 'Diagnostics copied. Paste them into your bug report.';

export const listWorkspacesFailed = (error: string): string =>
  withNext(`Could not list canvas workspaces: ${error}`, 'Check that the Design Canvas service is running, then try again.');
export const scaffoldFailed = (error: string): string =>
  withNext(`Could not create the canvas workspace: ${error}`, 'Try again.');
export const setupStatusUnreadable = (error: string): string =>
  withNext(`Canvas setup status could not be read (${error})`, 'The workspace files exist; press Start to try opening it.');
export const setupStatusUnavailable = (why: string): string =>
  withNext(`Canvas setup status is unavailable${why ? ` (${why})` : ''}`, 'The workspace files exist; press Start to try opening it.');
export const setupFailed = (progressText: string): string => withNext(progressText, 'Press Start to retry.');
export const SETUP_TOO_LONG = 'Canvas setup is taking unusually long. The workspace files exist; press Start to try opening it.';
export const exportFailedToStart = (error: string): string => withNext(`Export failed: ${error}`, 'Try /canvas export again.');
export const exportStatusUnreadable = (error: string): string =>
  withNext(`Could not read the export status: ${error}`, 'The export may still be running; check the workspace exports folder.');
export const exportFailedSummary = (summary: string): string => withNext(summary, 'Try /canvas export again.');
export const critiqueFailed = (error: string): string => withNext(`Critique failed: ${error}`, 'Try /canvas critique again.');
export const startSessionFailed = (error: string): string =>
  withNext(`Could not start the design: ${error}`, 'Your draft is unchanged; try again.');
export const openCanvasFailed = (error: string): string => withNext(`Could not open the canvas: ${error}`, 'Try again.');
export const openedWorkspace = (name: string): string => `Opened ${name}. Its canvas window is live.`;
export const openingWorkspace = (name: string): string =>
  `Opening ${name}. Its dev server is still starting; the screens load when it answers.`;
export const missingWorkspace = (message: string): string => withNext(message, 'Start creates a new canvas.');
export const attachFailed = (what: 'workspace' | 'file', error: string): string =>
  withNext(`Could not add the ${what} reference: ${error}`, 'Try again.');
export const openChatFailed = (error: string): string => withNext(`Could not open the canvas chat: ${error}`, 'Try again from Your design work.');
export const startChatFailed = (error: string): string => withNext(`Could not start the canvas chat: ${error}`, 'Try again.');
export const chatNotSent = (sent: string, failure?: string): string =>
  withNext(`Could not start the canvas chat (${sent}${failure ? `: ${failure}` : ''})`, 'Try again.');
export const chatStartedNotOpened = (error: string): string =>
  withNext(`The canvas chat started but could not open: ${error}`, 'Open it from Your design work.');
export const copyFolderFailed = (error: string): string => withNext(`Could not copy the folder path: ${error}`, 'Try again.');
export const focusFailed = (error: string): string => withNext(`Could not raise the canvas window: ${error}`, 'Try Open canvas.');
export const switchModeFailed = (error: string): string => withNext(`Could not switch the canvas mode: ${error}`, 'Try again.');
export const switchScreenFailed = (error: string): string => withNext(`Could not switch screens: ${error}`, 'Try again.');
export const attachPickFailed = (error: string): string => withNext(`Could not attach a canvas pick: ${error}`, 'It will be retried automatically.');
export const stopPreviewFailed = (error: string): string => withNext(`Could not stop the preview: ${error}`, 'Try the Stop button again.');
export const serviceNotReady = (error: string): string => withNext(`Local service not ready: ${error}`, 'It starts with the extension; reload if this persists.');
export const configError = (error: string): string => withNext(`Config error: ${error}`, 'Check .design-studio.json in the workspace.');
export const liveCanvasError = (error: string): string => withNext(`Live canvas error: ${error}`, 'Reopen the canvas if it does not recover.');

// ---- /canvas help ----

/** One verb per line, in the order users reach for them. */
export const CANVAS_VERBS: ReadonlyArray<{ verb: string; does: string }> = [
  { verb: 'on', does: 'Turn Design Mode on for this chat and open the canvas.' },
  { verb: 'off', does: 'Turn Design Mode off and close the canvas window.' },
  { verb: 'play', does: 'Switch the canvas to play: click through the screens like a user.' },
  { verb: 'edit', does: 'Switch the canvas to edit: click any element to select it.' },
  { verb: 'wireframe | hi-fi | prototype | deck | custom', does: 'Start with that kind of design, e.g. "/canvas wireframe pricing page".' },
  { verb: 'export', does: 'Export every screen to PNG and PDF in the workspace exports folder.' },
  { verb: 'critique', does: 'Send the agent the quality-gate digest for a review.' },
  { verb: 'help', does: 'Show this list.' },
];
export const CANVAS_HELP_TAIL = 'Type a brief after /canvas to start a design in this chat.';
export const CANVAS_HELP_TITLE = 'Design Canvas — /canvas commands';

/** The chip text `/canvas help` hands the composer: one verb per line, then the tail. */
export function canvasHelpText(): string {
  return [
    'Design Canvas commands',
    '',
    ...CANVAS_VERBS.map((entry) => `/canvas ${entry.verb} — ${entry.does}`),
    '',
    CANVAS_HELP_TAIL,
  ].join('\n');
}

/** Whether the whole `/canvas` argument string is the help verb (`/canvas help me design…` is a brief). */
export function isHelpVerb(args: string): boolean {
  return /^(?:help|\?)$/i.test(args.trim());
}

// ---- first-run strip ----

export const FIRST_RUN_STEPS: ReadonlyArray<string> = [
  'Describe it',
  'Answer a few questions (or say go)',
  'Click any element, then Reference in chat',
];
export const FIRST_RUN_TEXT = FIRST_RUN_STEPS.map((step, index) => `${index + 1} ${step}`).join(' · ');
export const FIRST_RUN_DISMISS = 'Dismiss';

// ---- diagnostics ----

export const DIAGNOSTICS_LABEL = 'Diagnostics';
export const DIAGNOSTICS_COPY = 'Copy diagnostics';
export const DIAGNOSTICS_EMPTY_ERRORS = 'No errors recorded.';
export const DIAGNOSTICS_CLOSE = 'Close';
export const diagnosticsCopyFailed = (error: string): string =>
  withNext(`Could not copy diagnostics: ${error}`, 'Select the text and copy it by hand.');

// ---- message and session actions ----

export const ACTION_OTHER_CHAT = 'That message belongs to another chat. Open that chat, then run the action again.';
export const ACTION_ALREADY_ON = 'Design Mode is already on for this chat. Open canvas in the rail raises the window.';
