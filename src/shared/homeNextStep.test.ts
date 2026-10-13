import { describe, expect, it } from 'vitest';
import { nameInSentence } from './homeNextStep';

describe('nameInSentence (261014)', () => {
  it('raises the first letter of an all-lowercase name', () => {
    expect(nameInSentence('red')).toBe('Red');
    expect(nameInSentence('sui-chan')).toBe('Sui-chan');
    expect(nameInSentence('_marv')).toBe('_Marv');
  });

  it('leaves names with a capital, no cased letters, or nothing alone', () => {
    expect(nameInSentence('Sui')).toBe('Sui');
    expect(nameInSentence('xXSuiXx')).toBe('xXSuiXx');
    expect(nameInSentence('DeepSeek')).toBe('DeepSeek');
    expect(nameInSentence('水星')).toBe('水星');
    expect(nameInSentence('42')).toBe('42');
    expect(nameInSentence('')).toBe('');
  });
});
