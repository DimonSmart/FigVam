import { Button } from './Button';

export function Pagination({label, prefix, previousLabel, nextLabel, offset, total, pageSize, previous, next}: {
  label: string; prefix: string; previousLabel: string; nextLabel: string;
  offset: number; total: number; pageSize: number; previous(): void; next(): void;
}) {
  return <nav className="pagination" aria-label={label}>
    <Button id={prefix+'-previous'} disabled={offset === 0} onClick={previous}>{previousLabel}</Button>
    <span id={prefix+'-number'}>{total ? (offset+1)+'–'+Math.min(offset+pageSize,total)+' из '+total : ''}</span>
    <Button id={prefix+'-next'} disabled={offset+pageSize >= total} onClick={next}>{nextLabel}</Button>
  </nav>;
}
