import { describe, it, expect } from 'vitest';
import { stripDuplicateTitleHeading } from './changelog';

const TITLES = ['What’s new in 0.6.9-beta.3'];

describe('stripDuplicateTitleHeading (261020, T158)', () => {
  it('drops a first heading that repeats the modal title', () => {
    const md = "## What's new in 0.6.9-beta.3\n\n- Own voices on Sei Cloud\n- Fixes";
    expect(stripDuplicateTitleHeading(md, TITLES)).toBe('- Own voices on Sei Cloud\n- Fixes');
  });

  it('matches across apostrophe style, case, a "v" prefix and trailing colon', () => {
    for (const h of [
      '## What’s new in 0.6.9-beta.3',
      "## WHAT'S NEW IN v0.6.9-beta.3:",
      "#  What's  new in 0.6.9-beta.3",
    ]) {
      expect(stripDuplicateTitleHeading(`${h}\n- A`, TITLES)).toBe('- A');
    }
  });

  it('drops it when it matches the English title on a localized UI', () => {
    const md = "## What's new in 0.6.9-beta.3\n- A";
    expect(stripDuplicateTitleHeading(md, ['0.6.9-beta.3 版本更新内容', "What's new in 0.6.9-beta.3"])).toBe('- A');
  });

  it('keeps a heading for a different version or with other text', () => {
    const other = "## What's new in 0.6.8\n- A";
    expect(stripDuplicateTitleHeading(other, TITLES)).toBe(other);
    const fixes = '## Fixes\n- A';
    expect(stripDuplicateTitleHeading(fixes, TITLES)).toBe(fixes);
  });

  it('only looks at the first non-blank line', () => {
    const md = "Intro line\n## What's new in 0.6.9-beta.3\n- A";
    expect(stripDuplicateTitleHeading(md, TITLES)).toBe(md);
    expect(stripDuplicateTitleHeading("\n\n## What's new in 0.6.9-beta.3\n- A", TITLES)).toBe('- A');
  });

  it('leaves an empty changelog alone', () => {
    expect(stripDuplicateTitleHeading('', TITLES)).toBe('');
  });
});
