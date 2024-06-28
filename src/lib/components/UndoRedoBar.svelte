<script lang="ts">
	import { CHANGE_REASON, type UndoRedoStatus } from "$lib/undo/UndoManager";

    export let canUndoRedo: UndoRedoStatus;
    export let onUndo: () => void;
    export let onRedo: () => void;
    let undoButtonRef: HTMLElement, redoButtonRef: HTMLElement;
	$: if (
		canUndoRedo.canUndo &&
		canUndoRedo.canUndoChangeReason !== CHANGE_REASON.Undo &&
		canUndoRedo.canUndoChangeReason !== CHANGE_REASON.NoChange
	) {
		undoButtonRef.classList.remove('shrink');
		window.requestAnimationFrame(() => undoButtonRef?.classList.add('shrink'));
	}
	$: if (
		canUndoRedo.canRedo &&
		canUndoRedo.canRedoChangeReason !== CHANGE_REASON.Redo &&
		canUndoRedo.canRedoChangeReason !== CHANGE_REASON.NoChange
	) {
		redoButtonRef.classList.remove('shrink');
		window.requestAnimationFrame(() => redoButtonRef?.classList.add('shrink'));
	}
</script>
<style>
	.undo-redo-bar {
		display: flex;
		justify-content: center;
	}
	.undo-redo-bar button {
		opacity: 1;
		transition: opacity 150ms ease-in-out;
		border-radius: 15%;
		border: 1px solid rgba(0, 0, 0, 0.4);
		padding: 0.4em;
		margin: 0 0.2em;
	}
	.undo-redo-bar button:disabled {
		opacity: 0.3;
	}
	:global(.shrink) {
		animation: shrink 0.5s ease-out forwards;
	}

	@keyframes shrink {
		0% {
			transform: scale(1);
		}
		50% {
			transform: scale(0.9);
		}
		100% {
			transform: scale(1);
		}
	}
</style>


<section class="undo-redo-bar">
	<button
		bind:this={undoButtonRef}
		on:click={onUndo}
		title={canUndoRedo.canUndo ? canUndoRedo.canUndo : ''}
		disabled={!canUndoRedo.canUndo}
	>
		<img src="/undo.svg" alt="Undo Icon" />
	</button>
	<button
		bind:this={redoButtonRef}
		on:click={onRedo}
		title={canUndoRedo.canRedo ? canUndoRedo.canRedo : ''}
		disabled={!canUndoRedo.canRedo}
	>
		<img src="/redo.svg" alt="Redo Icon" />
	</button>
</section>