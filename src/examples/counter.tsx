import { map, scan, shareReplay, startWith, Subject } from 'rxjs';


export const Counter = () => {
  const increment$ = new Subject<MouseEvent>();

  const count$ = increment$.pipe(
    map((): number => 1),
    scan((count: number, increment: number) => count + increment, 0),
    startWith(0),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  return (
    <button type="button" on={{ click: increment$ }}>
      Count: {count$}
    </button>
  );
};
