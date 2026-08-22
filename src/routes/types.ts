import type { Observable } from 'rxjs';

import type { ViewChild } from '../jsx/runtime';

export interface PageData {
  readonly title: string;
  readonly view: ViewChild;
  readonly stream$?: Observable<ViewChild>;
}
