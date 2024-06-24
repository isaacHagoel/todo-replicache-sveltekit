import { createStore } from "./simplePubSub";
import { serialAsyncExecutor } from "./serialAsyncExecutor";

// TODO - add event listeners on ctrl+z etc (optional?)
// TODO - what about disabling the undo/redo as the user types in an input to avoid conflict with the browser undo redo? or do we prevent default?
// TODO - test this with sync operations
// type NotConflictSensitiveUndoEntry = {
//     operation: () => void,
//     reverseOperation: () => void,
//     description?: string
// }
// type ConflictSensitiveUndoEntryBase = {
//     operation: () => void;
//     reverseOperation: () => void;
//     description: string;
// };

// type WithUndoConflict = {
//     hasUndoConflict: () => boolean | Promise<boolean>;
//     hasRedoConflict?: () => boolean | Promise<boolean>;
// };

// type WithRedoConflict = {
//     hasUndoConflict?: () => boolean | Promise<boolean>;
//     hasRedoConflict: () => boolean | Promise<boolean>;
// };

// type ConflictSensitiveUndoEntry = ConflictSensitiveUndoEntryBase & (WithUndoConflict | WithRedoConflict);

// export type UndoEntry = NotConflictSensitiveUndoEntry | ConflictSensitiveUndoEntry;
export type UndoEntry = {
    // TODO - what if the operation is async - should i wait on a promise to resolve?
    operation: () => void,
    reverseOperation: () => void,
    hasUndoConflict?: () => boolean | Promise<boolean>,
    hasRedoConflict?: () => boolean | Promise<boolean>,
    // TODO - if we use conflict resolusion then description is mandatory
    scopeName: string,
    description?: string, // will be returned from subscribeToCanUndoRedoChange so you can display it in a tooltip next to the buttons (e.g "undo add item")
    // conflictResolutionStrategy?: ConflictResolutionStrategy, // TODO - needed or can they simply omit hasUndoConflict?
    // onConflict?: (undoEntry: UndoEntry, isRedo: boolean) => void,   // TODO - is this needed or can we just use the other subssciption and reason?
    preExec?: PreExecEntry // TODO - implement    
}

// export enum ConflictResolutionStrategy{
//     REVOKE_CONFLICTING = "REVOKE_CONFLICTING",
//     REVOKE_ALL = "REVOKE_ALL"
// }

export enum PreExecOption {
    RESTORE_FOCUS = "RESTORE_FOCUS",
    CUSTOM = "COSTUM"
}


export type PreExecEntry = {
    action: PreExecOption.RESTORE_FOCUS,
    querySelector: string
} | {
    action: PreExecOption.CUSTOM,
    callback: (undoEntry: UndoEntry, isRedo: boolean) => void
}

type DontCare = any; 

export type UndoRedoStatus = {
    canUndo: boolean | string, 
    canRedo: boolean | string,
    // TODO - add everywhere
    changeReason?: string
} 

type CallbackFunction =  (newStatus: UndoRedoStatus) => DontCare;


export type UndoManagerOptions = {
    maxEntries?: number
};

const DEFAULT_MAX_ENTRIES = 500;

export class UndoManager {
    private _maxEntries: number; 
    private _past: UndoEntry[] = [];
    private _future: UndoEntry[] = [];
    private _pubsub = createStore<UndoRedoStatus>(
        {canUndo: false, canRedo: false}, 
        (a, b) => (a.canUndo === b.canUndo && a.canRedo === b.canRedo)
    );
    private _serialAsyncExecutor = serialAsyncExecutor();
    constructor({maxEntries}: UndoManagerOptions = {}) {
        this._maxEntries = maxEntries ?? DEFAULT_MAX_ENTRIES;
        if (this._maxEntries <= 0) {
            throw new Error(`maxEntries has to be a positive number, got ${maxEntries}`);
        }
    }

    private isLastIfConflicting(stack: UndoEntry[], getCheck: ((entry: UndoEntry) => (() => (boolean | Promise<boolean>)) | undefined)) {
        const lastIndex = stack.length -1;
        if (lastIndex < 0) return false;
        const check = getCheck(stack[lastIndex]);
        if (check === undefined) return false;
        return this._serialAsyncExecutor.execute(check);
    }
    private async removeConflictingEntries() {
        if (await this.isLastIfConflicting(this._past, entry => entry.hasUndoConflict)) {
            const conflictingEntry = this._past.pop();
            this._past = this._past.filter(entry => entry.scopeName !== conflictingEntry?.scopeName);
        }
        if (await this.isLastIfConflicting(this._future, entry => entry.hasRedoConflict)) {
            const conflictingEntry = this._future.pop();
            this._future = this._future.filter(entry => entry.scopeName !== conflictingEntry?.scopeName);
        }
    }

    async updateCanUndoRedoStatus() {
        console.log("updating ur stat", {past: this._past});
        await this.removeConflictingEntries();
        console.log("AFTER: updating ur stat", {past: this._past});
        this._pubsub.set({
            canUndo: this._past.length > 0 ? this._past[this._past.length - 1]?.description || true : false,
            canRedo: this._future.length > 0 ? this._future[this._future.length - 1]?.description || true : false
        });
    }
    // TODO - do i need to bind all methods to the instance?

    async do(undoEntry: UndoEntry) {
        this._future = [];
        // TODO - should i await here? if yes it add a bunch of complexity, like what to do if the user spam clicks while it waits
        // TODO - add try/catch around all operations (?)
        await this._serialAsyncExecutor.execute(undoEntry.operation);
        this._past.push(undoEntry);
        this.updateCanUndoRedoStatus();
    }
    async undo() {
        // TODO - check for conflict,
        const entry = this._past.pop();
        if (entry === undefined) return;
        await this._serialAsyncExecutor.execute(entry.reverseOperation);
        this._future.push(entry);
        this.updateCanUndoRedoStatus();
    
    }
    async redo() {
        // TODO - check for conflict
        const entry = this._future.pop();
        if (entry === undefined) return;
        await this._serialAsyncExecutor.execute(entry.operation);
        this._past.push(entry);
        this.updateCanUndoRedoStatus();
    }

    subscribeToCanUndoRedoChange(callback: CallbackFunction) {
        return this._pubsub.subscribe(callback);
    }

    getUndoRedoStatus(): UndoRedoStatus {
        return {...this._pubsub.get()};
    }

}