import { createStore } from "./simplePubSub";
import { serialAsyncExecutor } from "./serialAsyncExecutor";

export type UndoEntry = {
    operation: () => void,
    reverseOperation: () => void,
    hasUndoConflict?: () => boolean | Promise<boolean>,
    hasRedoConflict?: () => boolean | Promise<boolean>,
    // determines what gets removed when there are conflict
    scopeName: string,
    // will be returned from subscribeToCanUndoRedoChange so you can display it in a tooltip next to the buttons (e.g "undo add item")    
    description?: string,
}

export type UndoRedoStatus = {
    canUndo: boolean | string, 
    canRedo: boolean | string,
    canUndoChangeReason: CHANGE_REASON,
    canRedoChangeReason: CHANGE_REASON
} 

type CallbackFunction =  (newStatus: UndoRedoStatus) => unknown;

export enum CHANGE_REASON {
    Do = "Do",
    Undo = "Undo",
    Redo = "Redo",
    Conflict = "Conflict",
    NoChange = "NoChange"
}

/****
 * This a POC implementation of an undo-redo manager that can deal with async or sync operations. 
 * It makes sure async operations are executed serially to avoid race conditions (later operation finishing before a previous one)
 * It supports conflicts checks and in case of a conflicting entry at the head of the undo or redo queue it removes
 * all the entries with the same scopeName from the stack.
 * It exposes the next action to unde/redo and the change reason when it changes.
 * ****
 * The consumer is expected to call `updateCanUndoRedoStatus` when external changes that can create conflicts are executed  
 ******/
export class UndoManager {
    private _past: UndoEntry[] = [];
    private _future: UndoEntry[] = [];
    private _pubsub = createStore<UndoRedoStatus>(
        {canUndo: false, canRedo: false, canUndoChangeReason: CHANGE_REASON.NoChange, canRedoChangeReason: CHANGE_REASON.NoChange}, 
        (a, b) => (a.canUndo === b.canUndo && a.canRedo === b.canRedo && a.canUndoChangeReason === b.canUndoChangeReason && a.canRedoChangeReason === b.canRedoChangeReason)
    );
    private _serialAsyncExecutor = serialAsyncExecutor();
   

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

    async do(undoEntry: UndoEntry) {
        this._future = [];
        try {
            await this._serialAsyncExecutor.execute(undoEntry.operation);
            this._past.push(undoEntry);
        } catch(e) {
            console.error(`Faulty do operation: ${undoEntry.scopeName}`);
        }
        this._updateCanUndoRedoStatus(CHANGE_REASON.Do);
    }
    async undo() {
        const entry = this._past.pop();
        if (entry === undefined) return;
        try {
            await this._serialAsyncExecutor.execute(entry.reverseOperation);
            this._future.push(entry);
        } catch (e) {
            console.error(`Faulty reverse operation: ${entry.scopeName}`);
        }
        this._updateCanUndoRedoStatus(CHANGE_REASON.Undo);
    
    }
    async redo() {
        const entry = this._future.pop();
        if (entry === undefined) return;
        try {
            await this._serialAsyncExecutor.execute(entry.operation);
            this._past.push(entry);
        } catch (e) {
            console.error(`Faulty redo operation: ${entry.scopeName}`);
        }
        this._updateCanUndoRedoStatus(CHANGE_REASON.Redo);
    }

    subscribeToCanUndoRedoChange(callback: CallbackFunction) {
        return this._pubsub.subscribe(callback);
    }

    getUndoRedoStatus(): UndoRedoStatus {
        return {...this._pubsub.get()};
    }

}