import { createStore } from "./simplePubSub";

// TODO - add event listeners on ctrl+z etc (optional?)
// TODO - what about disabling the undo/redo as the user types in an input to avoid conflict with the browser undo redo? or do we prevent default?

export type UndoEntry = {
    // TODO - what if the operation is async - should i wait on a promise to resolve?
    operation: () => void,
    reverseOperation: () => void,
    hasConflict?: () => boolean,
    name?: string, // will be returned from subscribeToCanUndoRedoChange so you can display it in a tooltip next to the buttons (e.g "undo add item")
    conflictResolutionStrategy?: ConflictResolutionStrategy, // TODO - needed or can they simply omit hasConflict?
    onConflict?: (undoEntry: UndoEntry, isRedo: boolean) => void,   // TODO - is this needed or can we just use the other subssciption and reason?
    preExec?: PreExecEntry // TODO - implement    
}

export enum ConflictResolutionStrategy{
    REVOKE_CONFLICTING = "REVOKE_CONFLICTING",
    REVOKE_ALL = "REVOKE_ALL"
}

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
    private _pubsub;
    constructor({maxEntries}: UndoManagerOptions = {}) {
        this._maxEntries = maxEntries ?? DEFAULT_MAX_ENTRIES;
        if (this._maxEntries <= 0) {
            throw new Error(`maxEntries has to be a positive number, got ${maxEntries}`);
        }
        this._pubsub = createStore<UndoRedoStatus>(
            {canUndo: false, canRedo: false}, 
            (a, b) => (a.canUndo === b.canUndo && a.canRedo === b.canRedo)
        );
    }
    private removeConflictingEntries() {
        // TODO - THIS DOESN'T WORK BECAUSE THE REPLICACHE OPS ARE ASYNC SO WE HAVE TO WAIT IN 'DO' ETC BEFORE PUSHING SOMETHING TO THE QUEUE
        this._past = this._past.filter(entry => entry.hasConflict ? !entry.hasConflict() : true);
        this._future = this._future.filter(entry => entry.hasConflict ? !entry.hasConflict() : true);
        // TODO - when implementing changeReason return something from here
    }

    updateCanUndoRedoStatus() {
        this.removeConflictingEntries();
        this._pubsub.set({
            canUndo: this._past.length > 0 ? this._past[this._past.length - 1]?.name || true : false,
            canRedo: this._future.length > 0 ? this._future[this._future.length - 1]?.name || true : false
        });
    }
    // TODO - do i need to bind all methods to the instance?

    do(undoEntry: UndoEntry) {
        this._future = [];
        // TODO - should i await here? if yes it add a bunch of complexity, like what to do if the user spam clicks while it waits
        undoEntry.operation();
        this._past.push(undoEntry);
        this.updateCanUndoRedoStatus();
    }
    undo() {
        // TODO - check for conflict,
        const entry = this._past.pop();
        if (entry === undefined) return;
        entry.reverseOperation();
        this._future.push(entry);
        this.updateCanUndoRedoStatus();
    
    }
    redo() {
        // TODO - check for conflict
        const entry = this._future.pop();
        if (entry === undefined) return;
        entry.operation();
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