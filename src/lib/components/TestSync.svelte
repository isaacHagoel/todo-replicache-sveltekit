<script lang="ts">
	import type { UndoEntry, UndoManager } from "$lib/undo/UndoManager";

    export let undoRedoManager: UndoManager;
   
    let count = 0;
    const  getCurrentCount = () => count; 
    function handleClick() {
        const frozenCount = count;
        undoRedoManager.do({
            scopeName: "increaseCount",
            description: "increase counter",
            reverseDescription: "decrease counter",
            operation: () => count++,
            reverseOperation: () => count--,
            hasUndoConflict: () => {
                return ((frozenCount + 1) !== getCurrentCount())
            },
           
            hasRedoConflict: () => {
                return (frozenCount !== getCurrentCount())}
        });
    }
</script>
<style>
    section {
        display: flex;
        justify-content: center;
    }
    button {
        border: 1px solid rgba(0, 0, 0, 0.7);
        padding: 0.3em;
        margin: 0 1em;
        border-radius: 10%;
        width: 10em;
    }
    p {
       font-size: large;
       color: black;
    }
    h4 {
        text-align: center;
    }
</style>
<hr/>
<h4>Local (unsynced) synchronous counter demo</h4>
<section>
    <button on:click={handleClick}>Increase with undo</button>
    <p>{count}</p>
    <button on:click={() => {count = count + 1, undoRedoManager.updateCanUndoRedoStatus()} }>Simulate external increase (conflict)</button>
</section>
<hr/>