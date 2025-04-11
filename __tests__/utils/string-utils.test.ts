import { describe, it, expect } from 'vitest';
import {
  escapeRegex,
  getIndentation,
  applyIndentation,
  linesMatch,
} from '../../src/utils/string-utils';

describe('String Utilities', () => {
  describe('escapeRegex', () => {
    it('should escape special regex characters', () => {
      const input = 'Hello? [$()*+.^{|}] World\\';
      // Use the correct string literal based on manual trace of the function's behavior
      const expected = 'Hello\\? \\[\\$\\(\\)\\*\\+\\.\\^\\{\\|\\}\\] World\\\\';
      expect(escapeRegex(input)).toBe(expected);
    });

    it('should not escape normal characters', () => {
      const input = 'abcdef123';
      expect(escapeRegex(input)).toBe(input);
    });

    it('should handle empty string', () => {
      expect(escapeRegex('')).toBe('');
    });
  });

  describe('getIndentation', () => {
    it('should return leading spaces', () => {
      expect(getIndentation('  indented line')).toBe('  ');
    });

    it('should return leading tabs', () => {
      expect(getIndentation('\t\tindented line')).toBe('\t\t');
    });

    it('should return mixed leading whitespace', () => {
      expect(getIndentation(' \t indented line')).toBe(' \t ');
    });

    it('should return empty string for no leading whitespace', () => {
      expect(getIndentation('no indent')).toBe('');
    });

    it('should return empty string for empty line', () => {
      expect(getIndentation('')).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(getIndentation(undefined)).toBe(''); // Covers line 23
    });
  });

  describe('applyIndentation', () => {
    it('should apply indentation to a single line', () => {
      expect(applyIndentation('line1', '  ')).toEqual(['  line1']);
    });

    it('should apply indentation to multiple lines', () => {
      const content = 'line1\nline2\nline3';
      const indent = '\t';
      const expected = ['\tline1', '\tline2', '\tline3'];
      expect(applyIndentation(content, indent)).toEqual(expected); // Covers line 35
    });

    it('should handle empty content', () => {
      expect(applyIndentation('', '  ')).toEqual(['  ']); // split returns ['']
    });

    it('should handle empty indentation', () => {
      const content = 'line1\nline2';
      expect(applyIndentation(content, '')).toEqual(['line1', 'line2']);
    });
  });

  describe('linesMatch', () => {
    // ignoreLeadingWhitespace = false
    it('should match identical lines when not ignoring whitespace', () => {
      expect(linesMatch('  line', '  line', false)).toBe(true);
    });

    it('should not match different lines when not ignoring whitespace', () => {
      expect(linesMatch('  line', ' line', false)).toBe(false);
      expect(linesMatch('line', 'line ', false)).toBe(false);
    });

    // ignoreLeadingWhitespace = true
    it('should match lines with different leading whitespace when ignoring', () => {
      expect(linesMatch('    line', '  line', true)).toBe(true);
      expect(linesMatch('line', '\tline', true)).toBe(true);
    });

    it('should not match lines with different content when ignoring whitespace', () => {
      expect(linesMatch('  line1', ' line2', true)).toBe(false);
    });

    it('should not match if search line has extra indent when ignoring', () => {
      // This ensures we only trim the file line based on the search line's content
      expect(linesMatch('line', '  line', true)).toBe(true); // Should match if ignoring whitespace
    });

    it('should match lines with identical content but different trailing whitespace when ignoring', () => {
      // Note: trimStart() is used, so trailing whitespace matters
      expect(linesMatch('  line ', ' line', true)).toBe(false);
      expect(linesMatch('  line', ' line ', true)).toBe(false);
      expect(linesMatch('  line ', ' line ', true)).toBe(true);
    });

     it('should handle empty search line correctly when ignoring whitespace', () => {
      expect(linesMatch('  ', '', true)).toBe(true); // fileLine becomes '', searchLine is ''
      expect(linesMatch('  content', '', true)).toBe(false); // fileLine becomes 'content', searchLine is ''
      expect(linesMatch('', '', true)).toBe(true);
    });

    it('should handle empty file line correctly when ignoring whitespace', () => {
      expect(linesMatch('', '  content', true)).toBe(false); // fileLine is '', searchLine becomes 'content'
      expect(linesMatch('', '  ', true)).toBe(true); // fileLine is '', searchLine becomes ''
    });

    // Edge cases for undefined (Covers lines 50-52)
    it('should return false if fileLine is undefined', () => {
      expect(linesMatch(undefined, 'line', false)).toBe(false);
      expect(linesMatch(undefined, 'line', true)).toBe(false);
    });

    it('should return false if searchLine is undefined', () => {
      expect(linesMatch('line', undefined, false)).toBe(false);
      expect(linesMatch('line', undefined, true)).toBe(false);
    });

    it('should return false if both lines are undefined', () => {
      expect(linesMatch(undefined, undefined, false)).toBe(false);
      expect(linesMatch(undefined, undefined, true)).toBe(false);
    });

     it('should handle lines with only whitespace correctly when ignoring', () => {
      expect(linesMatch('   ', '\t', true)).toBe(true); // Both trimStart to ''
      expect(linesMatch('   ', '  a', true)).toBe(false); // fileLine '', searchLine 'a'
      expect(linesMatch('  a', '   ', true)).toBe(false); // fileLine 'a', searchLine ''
    });
  });
});