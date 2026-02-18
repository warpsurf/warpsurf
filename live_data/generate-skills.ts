/**
 * Generate bundled skills from markdown source files.
 *
 * Run: pnpm generate-skills
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SkillFrontmatter {
  domain: string;
  aliases?: string[];
  title: string;
}

interface SiteSkill {
  domain: string;
  aliases?: string[];
  title: string;
  content: string;
}

const SKILLS_DIR = path.join(__dirname, 'skills');
const OUTPUT_FILE = path.join(__dirname, '../apps/background/src/skills/data/bundled-skills.ts');

/** Parse YAML-like frontmatter from markdown. */
function parseFrontmatter(content: string): { data: SkillFrontmatter; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const data: Record<string, any> = {};

  let currentKey = '';
  let inArray = false;
  const arrayValues: string[] = [];

  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('- ') && inArray) {
      arrayValues.push(trimmed.slice(2).trim());
    } else if (trimmed.endsWith(':') && !trimmed.includes(': ')) {
      // Start of array
      if (inArray && currentKey) {
        data[currentKey] = [...arrayValues];
        arrayValues.length = 0;
      }
      currentKey = trimmed.slice(0, -1);
      inArray = true;
    } else {
      // Key-value pair
      if (inArray && currentKey) {
        data[currentKey] = arrayValues.length ? [...arrayValues] : [];
        arrayValues.length = 0;
        inArray = false;
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        // Handle empty array notation
        data[key] = value === '[]' ? [] : value;
        currentKey = key;
      }
    }
  }

  // Handle trailing array
  if (inArray && currentKey) {
    data[currentKey] = arrayValues.length ? [...arrayValues] : [];
  }

  return {
    data: data as SkillFrontmatter,
    body: body.trim(),
  };
}

async function main() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`Skills directory not found: ${SKILLS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
  const skills: SiteSkill[] = [];

  for (const file of files) {
    const filePath = path.join(SKILLS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(content);

    if (!parsed) {
      console.warn(`Skipping ${file}: invalid frontmatter`);
      continue;
    }

    const { data, body } = parsed;
    if (!data.domain || !data.title) {
      console.warn(`Skipping ${file}: missing domain or title`);
      continue;
    }

    skills.push({
      domain: data.domain,
      aliases: data.aliases?.length ? data.aliases : undefined,
      title: data.title,
      content: body,
    });

    console.log(`Loaded: ${data.domain} (${data.title})`);
  }

  // Sort by domain for consistent output
  skills.sort((a, b) => a.domain.localeCompare(b.domain));

  const output = `/**
 * Bundled site skills - Auto-generated
 *
 * Run: pnpm generate-skills
 * Generated: ${new Date().toISOString()}
 * Total skills: ${skills.length}
 */

import type { SiteSkill } from '../types';

export const BUNDLED_SKILLS: SiteSkill[] = ${JSON.stringify(skills, null, 2)};
`;

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, output);
  console.log(`\nGenerated ${OUTPUT_FILE}`);
  console.log(`Total skills: ${skills.length}`);
}

main().catch(console.error);
