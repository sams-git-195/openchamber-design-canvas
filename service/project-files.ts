// Pasted-reference validation for `POST /reference`.
//
// The panel iframe cannot touch the filesystem, so when the user pastes a file
// path to attach as a reference it asks the service to confirm the path names a
// readable regular file, confined to the project when relative.
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';

/**
 * Resolve only an explicitly pasted path, never a dropped File.name. Relative
 * paths are confined to the captured real source root; an absolute external
 * path is an explicit user selection. Inspect metadata/access, not file bytes.
 */
export async function resolveReferencePath(dir: string, input: string): Promise<{ path: string; sourceDirectory: string }> {
  const controls = /[\u0000-\u001f\u007f-\u009f]/;
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || controls.test(dir)) {
    throw new Error('Source directory must be a valid absolute project path. Select a project and try again.');
  }
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('Paste a non-empty accessible file path.');
  }
  if (controls.test(input)) {
    throw new Error('File paths cannot contain control characters. Paste a valid file path.');
  }
  let sourceDirectory: string;
  try {
    sourceDirectory = await fs.realpath(dir);
    if (!(await fs.stat(sourceDirectory)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('Source project directory is not accessible. Select an accessible project and try again.');
  }
  const absolute = path.isAbsolute(input);
  const inside = (target: string): boolean => {
    const relative = path.relative(sourceDirectory, target);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  const candidate = path.resolve(sourceDirectory, input);
  if (!absolute && !inside(candidate)) {
    throw new Error('Relative file path is outside the source project. Paste its absolute path to select an external file.');
  }
  let canonical: string;
  try {
    canonical = await fs.realpath(candidate);
  } catch {
    throw new Error('File not found or not accessible. Check the pasted path and its permissions.');
  }
  if (!absolute && !inside(canonical)) {
    throw new Error('Relative file path resolves outside the source project through a symlink. Paste its absolute path to select an external file.');
  }
  try {
    const stat = await fs.stat(canonical);
    if (!stat.isFile()) throw new Error('not a regular file');
  } catch (error) {
    if (error instanceof Error && error.message === 'not a regular file') {
      throw new Error('Reference must be a regular file, not a directory or special file. Paste a file path.');
    }
    throw new Error('File is not accessible. Check the pasted path and its permissions.');
  }
  try {
    await fs.access(canonical, constants.R_OK);
  } catch {
    throw new Error('File is not readable. Check its permissions or paste another file path.');
  }
  return { path: canonical, sourceDirectory };
}

