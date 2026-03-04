export type EditorSelectionContext = {
	isEmpty: boolean;
};

export function shouldAttachEditorContext(selection: EditorSelectionContext): boolean {
	return !selection.isEmpty;
}
