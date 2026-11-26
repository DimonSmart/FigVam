import { describe, expect, it } from 'vitest';
import { parseDocumentList } from '../src/api/document-list';

describe('document catalog contract', () => {
  it('preserves nullable metadata and unknown compatibility codes', () => {
    const value = parseDocumentList({ items: [{ documentId: '1', name: 'Design', role: 'Viewer',
      revision: 3, compatibilityIssue: 'NEW_CODE' }], nextCursor: null });
    expect(value.items[0]).toMatchObject({ documentId: '1', profileVersion: null, revision: 3, compatibilityIssue: 'NEW_CODE' });
  });
  it('rejects malformed metadata instead of coercing values', () => {
    expect(() => parseDocumentList({ items: [{ documentId: '1', name: 'Design', role: 'Owner', revision: '3' }] })).toThrow(TypeError);
  });
});
