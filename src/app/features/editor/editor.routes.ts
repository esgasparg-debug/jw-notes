import { Routes } from '@angular/router';
import { EditorShell } from './editor-shell';

export const EDITOR_ROUTES: Routes = [
  {
    path: '',
    component: EditorShell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'notes' },
      { path: 'notes', title: 'Notas', loadComponent: () => import('./notes/notes-page').then((m) => m.NotesPage) },
      { path: 'highlights', title: 'Marcações', loadComponent: () => import('./highlights/highlights-page').then((m) => m.HighlightsPage) },
      { path: 'bookmarks', title: 'Marcadores', loadComponent: () => import('./bookmarks/bookmarks-page').then((m) => m.BookmarksPage) },
      { path: 'comments', title: 'Comentários', loadComponent: () => import('./comments/comments-page').then((m) => m.CommentsPage) },
      { path: 'tags', title: 'Etiquetas', loadComponent: () => import('./tags/tags-page').then((m) => m.TagsPage) },
    ],
  },
];
