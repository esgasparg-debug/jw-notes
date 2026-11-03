import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { DocumentStore } from './document.store';

/** Editor routes need an open backup; otherwise send the user to the start page. */
export const requireDocument: CanActivateFn = () => {
  const store = inject(DocumentStore);
  return store.hasDocument() || inject(Router).createUrlTree(['/']);
};
