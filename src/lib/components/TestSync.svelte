<script lang="ts">
	import type { UndoEntry, UndoManager } from "$lib/undo/UndoManager";

    export let undoRedoManager: UndoManager;
   
    let count = 0;
    const  getCurrentCount = () => count; 
    function handleClick() {
        const frozenCount = count;
        undoRedoManager.do({
            scopeName: "increaseCount",
            operation: () => count++,
            reverseOperation: () => count--,
            // hasUndoConflict: () => ((frozenCount + 1) !== getCurrentCount()),
            hasUndoConflict: () => {
                console.log("comparing", {frozenCount, current: getCurrentCount()});
                return ((frozenCount + 1) !== getCurrentCount())
            },
            // hasRedoConflict: () => ((frozenCount - 1) !== getCurrentCount())
            hasRedoConflict: () => {
                // console.log("comparing", {frozenCount, current: getCurrentCount()});
                return (frozenCount !== getCurrentCount())}
        });
    }
</script>
<button on:click={handleClick}>click me</button>
<button on:click={() => {count = count + 1, undoRedoManager.updateCanUndoRedoStatus()} }>cause conflict</button>
<p>{count}</p>