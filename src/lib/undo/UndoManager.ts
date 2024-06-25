import { createStore } from "./simplePubSub";
import { serialAsyncExecutor } from "./serialAsyncExecutor";

// TODO - add event listeners on ctrl+z etc (optional?)
// TODO - what about disabling the undo/redo as the user types in an input to avoid conflict with the browser undo redo? or do we prevent default?
// TODO - test this with sync operations

export type UndoEntry = {
    // TODO - what if the operation is async - should i wait on a promise to resolve?
    operation: () => void,
    reverseOperation: () => void,
    hasUndoConflict?: () => boolean | Promise<boolean>,
    hasRedoConflict?: () => boolean | Promise<boolean>,
    scopeName: string,
    description?: string, // will be returned from subscribeToCanUndoRedoChange so you can display it in a tooltip next to the buttons (e.g "undo add item")
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
    canUndoChangeReason: CHANGE_REASON,
    canRedoChangeReason: CHANGE_REASON
} 

type CallbackFunction =  (newStatus: UndoRedoStatus) => DontCare;


export type UndoManagerOptions = {
    // TODO - implement
    maxEntries?: number
};

const DEFAULT_MAX_ENTRIES = 500;
// Todo all enums make this naming convention?
export enum CHANGE_REASON {
    Do = "Do",
    Undo = "Undo",
    Redo = "Redo",
    Conflict = "Conflict",
    NoChange = "NoChange"
}

export class UndoManager {
    private _maxEntries: number; 
    private _past: UndoEntry[] = [];
    private _future: UndoEntry[] = [];
    private _pubsub = createStore<UndoRedoStatus>(
        {canUndo: false, canRedo: false, canUndoChangeReason: CHANGE_REASON.NoChange, canRedoChangeReason: CHANGE_REASON.NoChange}, 
        (a, b) => (a.canUndo === b.canUndo && a.canRedo === b.canRedo && a.canUndoChangeReason === b.canUndoChangeReason && a.canRedoChangeReason === b.canRedoChangeReason)
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
        let isUndoConflict = false, isRedoConflict = false;
        while (await this.isLastIfConflicting(this._past, entry => entry.hasUndoConflict)) {
            const conflictingEntry = this._past.pop();
            isUndoConflict = true;
            this._past = this._past.filter(entry => entry.scopeName !== conflictingEntry?.scopeName);
        }
        while (await this.isLastIfConflicting(this._future, entry => entry.hasRedoConflict)) {
            const conflictingEntry = this._future.pop();
            isRedoConflict = true;
            this._future = this._future.filter(entry => entry.scopeName !== conflictingEntry?.scopeName);
        }
        return {isUndoConflict, isRedoConflict};
    }

    private getLastEntryDescOrBoolean(stack: UndoEntry[]) {
        return stack.length > 0 ? stack[stack.length - 1]?.description || true : false
    }
    private async _updateCanUndoRedoStatus(changeReason = CHANGE_REASON.NoChange) {
        const {isUndoConflict, isRedoConflict} = await this.removeConflictingEntries();
        this._pubsub.set({
            canUndo: this.getLastEntryDescOrBoolean(this._past),
            canRedo: this.getLastEntryDescOrBoolean(this._future),
            canUndoChangeReason: isUndoConflict ? CHANGE_REASON.Conflict : changeReason,
            canRedoChangeReason: isRedoConflict ? CHANGE_REASON.Conflict : changeReason
        });
    }
    async updateCanUndoRedoStatus() {
       this._updateCanUndoRedoStatus();
    }
    // TODO - do i need to bind all methods to the instance?

    async do(undoEntry: UndoEntry) {
        this._future = [];
        // TODO - should i await here? if yes it add a bunch of complexity, like what to do if the user spam clicks while it waits
        // TODO - add try/catch around all operations (?)
        await this._serialAsyncExecutor.execute(undoEntry.operation);
        this._past.push(undoEntry);
        this._updateCanUndoRedoStatus(CHANGE_REASON.Do);
    }
    async undo() {
        const entry = this._past.pop();
        if (entry === undefined) return;
        await this._serialAsyncExecutor.execute(entry.reverseOperation);
        this._future.push(entry);
        this._updateCanUndoRedoStatus(CHANGE_REASON.Undo);
    
    }
    async redo() {
        const entry = this._future.pop();
        if (entry === undefined) return;
        await this._serialAsyncExecutor.execute(entry.operation);
        this._past.push(entry);
        this._updateCanUndoRedoStatus(CHANGE_REASON.Redo);
    }

    subscribeToCanUndoRedoChange(callback: CallbackFunction) {
        return this._pubsub.subscribe(callback);
    }

    getUndoRedoStatus(): UndoRedoStatus {
        return {...this._pubsub.get()};
    }

}