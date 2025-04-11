import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid'; // Use uuid for unique temp dir names

/**
 * Recursively creates a directory structure based on the provided object.
 * @param structure Object defining the structure. Keys are filenames/dirnames.
 *                  String values are file contents. Object values are subdirectories.
 * @param currentPath The path where the structure should be created.
 */
async function createStructureRecursively(
  structure: FileSystemStructure,
  currentPath: string,
): Promise<void> {
  for (const name in structure) {
    if (!Object.prototype.hasOwnProperty.call(structure, name)) {
      continue;
    }
    const itemPath = path.join(currentPath, name);
    const content = structure[name];

    if (typeof content === 'string' || Buffer.isBuffer(content)) {
      // It's a file - ensure parent directory exists first
      try {
        await fsPromises.mkdir(path.dirname(itemPath), { recursive: true });
        await fsPromises.writeFile(itemPath, content);
      } catch (error) {
        console.error(`Failed to create file ${itemPath}:`, error);
        throw error;
      }
    } else if (typeof content === 'object' && content !== null) {
      // It's a directory (plain object)
      await fsPromises.mkdir(itemPath, { recursive: true });
      // Recurse into the subdirectory
      await createStructureRecursively(content, itemPath);
    } else {
      // Handle other potential types or throw an error
      console.warn(`Unsupported type for item '${name}' in test structure.`);
    }
  }
}

/**
 * Removes the temporary directory and its contents.
 * @param dirPath The absolute path to the temporary directory to remove.
 */
export async function cleanupTemporaryFilesystem(dirPath: string): Promise<void> {
  if (!dirPath) {
    console.warn('Attempted to cleanup an undefined or empty directory path.');
    return;
  }
  try {
    // Basic check to prevent accidental deletion outside expected temp pattern
    if (!path.basename(dirPath).startsWith('jest-temp-')) {
      console.error(`Refusing to delete directory not matching 'jest-temp-*' pattern: ${dirPath}`);
      return; // Or throw an error
    }
    await fsPromises.rm(dirPath, { recursive: true, force: true });
  } catch (error: unknown) {
    // Log error but don't necessarily fail the test run because of cleanup issues
    if (error instanceof Error) {
      console.error(`Failed to cleanup temporary directory ${dirPath}:`, error.message);
    } else {
      console.error(`Failed to cleanup temporary directory ${dirPath}:`, String(error));
    }
  }
}

/**
 * Creates a temporary directory with a unique name and populates it based on the structure.
 * @param structure Object defining the desired filesystem structure within the temp dir.
 * @param baseTempDir Optional base directory for temporary folders (defaults to project root).
 * @returns The absolute path to the created temporary root directory.
 */
interface FileSystemStructure {
  [key: string]: string | Buffer | FileSystemStructure;
}

export async function createTemporaryFilesystem(
  structure: FileSystemStructure,
  baseTempDir = process.cwd(),
): Promise<string> {
  // Verify base directory exists
  try {
    await fsPromises.access(baseTempDir);
  } catch {
    throw new Error(`Base temp directory does not exist: ${baseTempDir}`);
  }

  // Create a unique directory name within the base temp directory
  const tempDirName = `jest-temp-${uuidv4()}`;
  const tempDirPath = path.join(baseTempDir, tempDirName);

  try {
    console.log(`Creating temp directory: ${tempDirPath}`);
    await fsPromises.mkdir(tempDirPath, { recursive: true }); // Ensure base temp dir exists
    console.log(`Temp directory created successfully`);

    console.log(`Creating structure in temp directory`);
    await createStructureRecursively(structure, tempDirPath);
    console.log(`Structure created successfully`);

    return tempDirPath;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Failed to create temporary filesystem at ${tempDirPath}:`, error.message);
    } else {
      console.error(`Failed to create temporary filesystem at ${tempDirPath}:`, String(error));
    }
    // Attempt cleanup even if creation failed partially
    try {
      await cleanupTemporaryFilesystem(tempDirPath); // Now defined before use
    } catch (cleanupError) {
      console.error(
        `Failed to cleanup partially created temp directory ${tempDirPath}:`,
        cleanupError,
      );
    }
    throw error; // Re-throw the original error
  }
}
