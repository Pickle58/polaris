import { StateEffect, StateField } from "@codemirror/state";
import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
    keymap,
} from "@codemirror/view";

import { fetcher } from "./fetcher";

// StateEffect: a way to send "messages" to the editor to update our state
// We define one effect type for setting the current suggestion text
const setSuggestionEffect = StateEffect.define<string | null>();

// StateField: a way to store custom state in the editor
// - create(); Returns the initial value when the editor loads
// - update(); Called on every transaction (keystroke, etc) to potentially update the value
const suggestionState = StateField.define<string | null>({
    create() {
        return null;
    },
    update(value, transaction) {
        // Check if the transaction has our setSuggestionEffect, and if so, update the value
        // Otherwise, keep the existing value
        for (const effect of transaction.effects) {
            if (effect.is(setSuggestionEffect)) {
                return effect.value;
            }
        }
        return value;
    },
});


// WidgetType: a way to render custom DOM elements in the editor that can be positioned relative to the text
class SuggestionWidget extends WidgetType {
    constructor(readonly text: string) {
        super();
    }

    // toDOM() is called by CodeMirror to render the widget in the editor. We create a simple <span> element with our suggestion text and some styling to make it look like "ghost text"
    toDOM() {
        const span = document.createElement("span");
        span.textContent = this.text;
        span.style.opacity = "0.4";//ghost text style
        span.style.pointerEvents = "none"; // Allow clicks to pass through to the editor
        return span;
    }
}

let debounceTimer: number | null = null;
let isWaitingForSuggestion = false;
const DEBOUNCE_DELAY = 300; // milliseconds

let currentAbortController: AbortController | null = null;


const generatePayload = (view: EditorView, fileName: string) => {
    const code = view.state.doc.toString();
    if (!code || code.trim().length === 0) return null;

    const cursorPosition = view.state.selection.main.head;
    const currentLine = view.state.doc.lineAt(cursorPosition);
    const cursorInline = cursorPosition - currentLine.from;

    const previousLines: string[] = [];
    const previousLinesToFetch = Math.min(5, currentLine.number - 1);
    for (let i = previousLinesToFetch; i >= 1; i--) {
        previousLines.push(view.state.doc.line(currentLine.number - i).text);
    }

    const nextLines: string[] = [];
    const totalLines = view.state.doc.lines;
    const linesToFetch = Math.min(5, totalLines - currentLine.number);
    for (let i = 1; i <= linesToFetch; i++) {
        nextLines.push(view.state.doc.line(currentLine.number + i).text);
    }
    return {
        fileName,
        code,
        currentLine: currentLine.text,
        previousLines: previousLines.join("\n"),
        textBeforeCursor: currentLine.text.slice(0, cursorInline),
        textAfterCursor: currentLine.text.slice(cursorInline),
        nextLines: nextLines.join("\n"),
        lineNumber: currentLine.number,
    }
}

const createDebouncePlugin = (fileName: string) => {
    return ViewPlugin.fromClass(
        class {
            constructor(view: EditorView) {
                this.triggerSuggestion(view);
            }
            update(update: ViewUpdate) {
                if (update.docChanged || update.selectionSet) {
                    this.triggerSuggestion(update.view);
                }
            }

            triggerSuggestion(view: EditorView) {
                if (debounceTimer !== null) {
                    clearTimeout(debounceTimer);
                }

                if (currentAbortController !== null) {
                    currentAbortController.abort();
                }
                
                isWaitingForSuggestion = true;

                debounceTimer = window.setTimeout(async () => {
                    const payload = generatePayload(view, fileName);
                    if (!payload) {
                      isWaitingForSuggestion = false;  
                        view.dispatch({
                            effects: setSuggestionEffect.of(null), // Clear suggestion if we can't generate a payload
                        });
                        return;
                    }
                    currentAbortController = new AbortController();
                    const suggestion = await fetcher(
                        payload, 
                        currentAbortController.signal
                    );
                    
                    isWaitingForSuggestion = false;
                    view.dispatch({
                        effects: setSuggestionEffect.of(suggestion), // Update our suggestionState with the new suggestion text
                    });
                }, DEBOUNCE_DELAY);
            }

            destroy() {
                if (debounceTimer !== null) {
                    clearTimeout(debounceTimer);
                }

                if (currentAbortController !== null) {
                    currentAbortController.abort();
                }
            }
        }
    );
};
const renderPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.build(view);
        }

        update(update: ViewUpdate) {
            // Rebuild decorations on every update (for simplicity) 
            const suggestionChanged = update.transactions.some((transaction) => {
                return transaction.effects.some((effect) => {
                    return effect.is(setSuggestionEffect);
                });
            });

            // Rebuild decorations if doc changed, cursor moved, or suggestion text changed
            const shouldRebuild = update.docChanged || update.selectionSet || suggestionChanged;

            if (shouldRebuild) {
                this.decorations = this.build(update.view);
            }

        }

        build(view: EditorView) {
            if (isWaitingForSuggestion) {
                return Decoration.none; 
            }


          // Get the current suggestion text from our state field
          const suggestion = view.state.field(suggestionState);

          if (!suggestion) {
              return Decoration.none;
          }  

            // Create a widget decoration that will render the suggestion text at the end of the document
            const cursor = view.state.selection.main.head;
            return Decoration.set([
                Decoration.widget({
                    widget: new SuggestionWidget(suggestion),
                    side: 1, // Render after the cursor
                }).range(cursor),
            ]);
        }
    },
    { decorations: (plugin) => plugin.decorations } // Tell CodeMirror that this plugin provides decorations
);

// A simple keymap to accept the suggestion when the user presses Tab. It replaces the current document text with the suggestion text and moves the cursor to the end.
const acceptSuggestionKeymap = keymap.of([
    {
        key: "Tab",
        run(view) {
            const suggestion = view.state.field(suggestionState);
            if (!suggestion) {
                return false;
            }// No suggestion to accept

            // Insert the suggestion text at the current cursor position
            const cursor = view.state.selection.main.head;
            view.dispatch({
                changes: { from: cursor, to: cursor, insert: suggestion },// Insert the suggestion at the cursor
                selection: { anchor: cursor + suggestion.length }, // Move the cursor to the end of the inserted suggestion
                effects: setSuggestionEffect.of(null), // Clear the suggestion after accepting
            });
            return true; // Indicate that we handled the key press
        }
    }
]);

export const suggestion = (fileName: string) => [
    suggestionState, // our state storage
    createDebouncePlugin(fileName), // the plugin that triggers suggestion generation with debouncing
    renderPlugin, // the plugin that renders the suggestion in the editor
    acceptSuggestionKeymap, // a keymap to accept the suggestion when the user presses Tab
];