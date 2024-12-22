import fs from 'fs/promises';
import path from 'path';

/**
 * Ensures .codexkeeper is added to user's .gitignore
 * @param projectPath Path to the project root
 */
export async function ensureGitIgnore(projectPath: string): Promise<void> {
  const gitignorePath = path.join(projectPath, '.gitignore');

  try {
    // Check if .gitignore exists
    let content = '';
    try {
      content = await fs.readFile(gitignorePath, 'utf-8');
    } catch (error) {
      // File doesn't exist, will create new one
    }

    // Check if .codexkeeper is already in .gitignore
    const lines = content.split('\n');
    const hasCodexkeeper = lines.some(
      line => line.trim() === '.codexkeeper' || line.trim() === '.codexkeeper/'
    );

    if (!hasCodexkeeper) {
      // Add .codexkeeper to .gitignore
      const newContent =
        content.trim() + '\n\n# Local system directories\n.codexkeeper/\n.codexkeeper\n';
      await fs.writeFile(gitignorePath, newContent, 'utf-8');
      console.error('Added .codexkeeper to .gitignore');
    }
  } catch (error) {
    console.error('Failed to update .gitignore:', error);
    // Don't throw error as this is not critical
  }
}
