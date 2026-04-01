import { Editor, EditorChange, EditorRangeOrCaret, EditorTransaction } from 'obsidian';
import EditorSelectionManipulator from './editor-selection-manipulator';
import { escapeRegExp } from './editor-utils';

interface ExtendedEditorChange {
	finalSelection?: EditorSelectionManipulator;
	replaceSelection?: EditorSelectionManipulator;
	replaceText?: string;
}

export default abstract class SelectionsProcessing {
	/**
	 * Processes all selections as a single transaction (one undo step).
	 * Handles offset shifts when multiple selections change text lengths.
	 */
	static selectionsProcessorTransaction(
		editor: Editor,
		fct: (sel: EditorSelectionManipulator, index: number) => ExtendedEditorChange,
		arrayCallback?: (arr: EditorSelectionManipulator[]) => EditorSelectionManipulator[],
		transactionForEachExecution = true,
	): void {
		let selections = EditorSelectionManipulator.listSelections(editor);
		if (arrayCallback) selections = arrayCallback(selections);

		const changes = selections.map((selection, index) => fct(selection, index));
		const transactionObject: EditorTransaction = {};

		const editorChanges: EditorChange[] = changes
			.filter((change) => change.replaceSelection && change.replaceText !== undefined)
			.map((v) => {
				const [from, to] = v.replaceSelection!.asFromToPoints();
				return { from, to, text: v.replaceText! };
			});

		if (editorChanges.length > 0) transactionObject.changes = editorChanges;

		let linesShift = 0;
		let characterShift = 0;
		let lastFinalSelection: EditorSelectionManipulator | undefined;

		const ranges: EditorRangeOrCaret[] = changes
			.filter((change) => change.finalSelection)
			.map((change) => {
				const finalSelection = change.finalSelection!;

				if (!change.replaceSelection || change.replaceText === undefined) {
					return finalSelection.toEditorRangeOrCaret();
				}

				const textLengthBefore = change.replaceSelection.getText().length;
				const textLengthAfter = change.replaceText.length;

				finalSelection.moveLines(linesShift);

				if (lastFinalSelection && lastFinalSelection.isOnSameLine(finalSelection) && finalSelection.isOneLine()) {
					characterShift += textLengthAfter - textLengthBefore;
					finalSelection.setChars(
						finalSelection.anchor.ch + characterShift,
						finalSelection.head.ch + characterShift,
					);
				} else if (lastFinalSelection && lastFinalSelection.isOnSameLine(finalSelection)) {
					characterShift += textLengthAfter - textLengthBefore;
					finalSelection.moveCharsWithoutOffset(characterShift, 0);
					characterShift = 0;
				} else {
					const linesCountBefore = change.replaceSelection.getText().split('\n').length;
					const linesCountAfter = change.replaceText.split('\n').length;
					linesShift += linesCountAfter - linesCountBefore;
				}

				lastFinalSelection = finalSelection;
				return finalSelection.toEditorRangeOrCaret();
			});

		if (ranges.length > 0) transactionObject.selections = ranges;

		const origin = transactionForEachExecution ? `coderidian-action-${Date.now()}` : undefined;
		editor.transaction(transactionObject, origin);
	}

	/** Replace text in all non-caret selections using a transform function. */
	static selectionsReplacer(editor: Editor, fct: (val: string) => string): void {
		this.selectionsProcessorTransaction(
			editor,
			(sel) => ({ replaceSelection: sel, replaceText: fct(sel.getText()) }),
			(array) => array.filter((sel) => !sel.isCaret()),
		);
	}

	static lowestSelection(selections: EditorSelectionManipulator[]): EditorSelectionManipulator {
		return selections
			.slice()
			.sort((a, b) => a.asNormalized().head.toOffset() - b.asNormalized().head.toOffset())
			.reverse()[0];
	}

	static selectionValuesEqual(selections: EditorSelectionManipulator[], caseSensitive: boolean): boolean {
		return selections.every((val, _i, arr) => {
			const [one, two] = [arr[0], val].map((s) => s.asNormalized().getText());
			return caseSensitive ? one === two : one.toLowerCase() === two.toLowerCase();
		});
	}

	/** Toggle between two separator characters in selections (e.g. '-' ↔ ' '). Fixes keyshots bug. */
	static convertOneToOtherChars(editor: Editor, first: string, second: string): void {
		this.selectionsReplacer(editor, (tx) => {
			const hasFirst = tx.includes(first);
			const hasSecond = tx.includes(second);
			if (hasFirst === hasSecond) return tx; // both or neither: no-op
			if (hasFirst) return tx.replace(new RegExp(escapeRegExp(first), 'gm'), second);
			return tx.replace(new RegExp(escapeRegExp(second), 'gm'), first);
		});
	}
}
