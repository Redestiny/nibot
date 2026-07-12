import { Annotation } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// Transactions carrying this annotation are programmatic (content loads and
// streamed AI text) and must not mark the document dirty.
export const programmaticChange = Annotation.define<boolean>();

let activeView: EditorView | null = null;

export function registerEditorView(view: EditorView | null): void {
  activeView = view;
}

export function setEditorContent(text: string): void {
  if (!activeView) {
    return;
  }
  activeView.dispatch({
    changes: { from: 0, to: activeView.state.doc.length, insert: text },
    annotations: programmaticChange.of(true),
  });
}

export function appendEditorText(chunk: string): void {
  if (!activeView) {
    return;
  }
  activeView.dispatch({
    changes: { from: activeView.state.doc.length, insert: chunk },
    annotations: programmaticChange.of(true),
  });
  activeView.dispatch({
    effects: EditorView.scrollIntoView(activeView.state.doc.length),
  });
}

export function getEditorContent(): string {
  return activeView?.state.doc.toString() ?? '';
}
