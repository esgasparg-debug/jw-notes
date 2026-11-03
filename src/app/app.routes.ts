import { Routes } from '@angular/router';
import { requireDocument } from './core/state/document-guard';

export const routes: Routes = [
  { path: '', title: 'Editor de Notas', loadComponent: () => import('./features/home/sync-home').then((m) => m.SyncHome) },
  { path: 'mais', title: 'Mais opções', loadComponent: () => import('./features/more/more-page').then((m) => m.MorePage) },
  {
    path: 'editor',
    title: 'Editor',
    canActivate: [requireDocument],
    loadChildren: () => import('./features/editor/editor.routes').then((m) => m.EDITOR_ROUTES),
  },
  { path: 'merge', title: 'Mesclar backups', loadComponent: () => import('./features/merge/merge-page').then((m) => m.MergePage) },
  {
    path: 'settings',
    title: 'Configurações',
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
