<script lang="ts">
	import { onMount } from 'svelte';
	import { Replicache } from 'replicache';
	import { nanoid } from 'nanoid';
	import { source } from 'sveltekit-sse';
	import { mutators, type M } from '$lib/replicache/mutators';
	import { page } from '$app/stores';
	import { listTodos } from '$lib/replicache/todo';
	import type { Todo, TodoUpdate } from '$lib/replicache/todo';
	import { getTodoById } from '$lib/replicache/todo';

	import TodoMVC from '$lib/components/TodoMVC.svelte';
	import TestSync from '$lib/components/TestSync.svelte'; 

	import {UndoManager} from "$lib/undo/UndoManager";

	const { spaceID } = $page.params;
	let replicacheInstance: Replicache<M>;
	let _list: Todo[] = [];
	let areAllChangesSaved = true;
	const undoRedoManager = new UndoManager();
	let canUndoRedo = undoRedoManager.getUndoRedoStatus();
	undoRedoManager.subscribeToCanUndoRedoChange(newStatus => {
		console.warn("undoRedo sub fired", newStatus);
		canUndoRedo = newStatus;
	});	


	onMount(() => {
		replicacheInstance = initReplicache(spaceID);
		replicacheInstance.subscribe(listTodos, (data) => {
			_list = data;
			_list.sort((a: Todo, b: Todo) => a.sort - b.sort);
			undoRedoManager.updateCanUndoRedoStatus();
		});
		// Implements a Replicache poke using Server-Sent Events.
		// If a "poke" message is received, it will pull from the server.
		const connection = source(`/api/replicache/${spaceID}/poke`);
		const sseStore = connection.select('poke').transform(() => {
			console.log('poked! pulling fresh data for spaceID', spaceID);
			replicacheInstance.pull();
		});
		// The line below are kinda dumb, it prevents Svelte from removing this store at compile time (since it has not subscribers)
		const unsubscribe = sseStore.subscribe(() => {});

		// This allows us to show the user whether all their local data is saved on the server
		replicacheInstance.onSync = async () => {
			areAllChangesSaved = (await replicacheInstance.experimentalPendingMutations()).length === 0;
		};

		// cleanup
		return () => {
			replicacheInstance.close();
			unsubscribe();
			connection.close();
		};
	});

	function initReplicache(spaceID: string) {
		const licenseKey = import.meta.env.VITE_REPLICACHE_LICENSE_KEY;
		if (!licenseKey) {
			throw new Error('Missing VITE_REPLICACHE_LICENSE_KEY');
		}
		return new Replicache({
			licenseKey,
			pushURL: `/api/replicache/${spaceID}/push`,
			pullURL: `/api/replicache/${spaceID}/pull`,
			name: spaceID,
			mutators
		});
	}

	async function createTodo(text: string) {
		const id = nanoid();
		const todoToCreate = {
					id,
					text,
					completed: false
				}
		undoRedoManager.do({
			scopeName: `create_todo:${id}`,
			operation: () => {
				replicacheInstance?.mutate.createTodo(todoToCreate);
			},
			reverseOperation: () => {
				replicacheInstance?.mutate.deleteTodo(id);
			},
			hasUndoConflict: async () => {
				const currentTodo = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return currentTodo === undefined || hasTodoChanged(currentTodo, todoToCreate);
			}
		});
	}

	function deleteTodo(id: string) {
		const currentTodo = _list.find(todo => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);
		undoRedoManager.do({
			scopeName: `delete_todo:${id}`,
			operation: () => replicacheInstance.mutate.deleteTodo(id),
			reverseOperation: () => replicacheInstance.mutate.unDeleteTodo(currentTodo),
			// no conflicts because we use nanoId, so another user can't create that same todo
		});
	}

	
	////////////////////////////////////
	type CompareTodo = Partial<Pick<Todo, 'text' | 'completed'>>;
	function hasTodoChanged(old: CompareTodo, current: CompareTodo) {
		return old.text !== current.text || old.completed !== current.completed;
	}

	// TODO - DELTE ALL AND COMPLETE ALL HAVE TO BE GROUPED (ADD GROUPING FEATURE?)
	function updateTodo(updatedTodo: TodoUpdate) {
		const currentTodo = _list.find(todo => todo.id === updatedTodo.id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${updatedTodo.id}`);

		undoRedoManager.do({
			scopeName: `update_todo_${updatedTodo.id}`,
			operation: () => replicacheInstance.mutate.updateTodo(updatedTodo),
			reverseOperation: () => replicacheInstance.mutate.updateTodo(currentTodo),
			hasUndoConflict: async () => {
				const currentTodo = await replicacheInstance.query(async (tx) => getTodoById(tx, updatedTodo.id));
				return currentTodo === undefined || hasTodoChanged(currentTodo, updatedTodo);
			}
		});
	}
	/////////////////////////

	function updateTodoText(id: string, newText: string) {
		const currentTodo = _list.find(todo => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);

		if (newText === currentTodo.text) return;

		const updated = {id, text: newText};
		undoRedoManager.do({
			scopeName: `update_todo_text:${id}`,
			operation: () => replicacheInstance.mutate.updateTodo(updated),
			reverseOperation: () => replicacheInstance.mutate.updateTodo(currentTodo),
			hasUndoConflict: async () => {
				const todoNow = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (!todoNow || todoNow.text !== newText);
			},
			hasRedoConflict: async () => {
				const todoNow = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (!todoNow || todoNow.text !== currentTodo.text);
			}
		});
	}
	function updateTodoCompleted(id: string, isCompleted: boolean) {
		const currentTodo = _list.find(todo => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);

		if (isCompleted === currentTodo.completed) return;

		const updated = {id, completed: isCompleted};
		undoRedoManager.do({
			scopeName: `update_todo_completion:${id}`,
			operation: () => replicacheInstance.mutate.updateTodo(updated),
			reverseOperation: () => replicacheInstance.mutate.updateTodo(currentTodo),
			hasUndoConflict: async () => {
				const todoNow = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (!todoNow || todoNow.completed !== isCompleted);
			},
			hasRedoConflict: async () => {
				const todoNow = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (!todoNow || todoNow.completed !== currentTodo.completed);
			}
		});

	}
	function markAllCompleted() {

	}
	function deleteAllCompletedTodos() {

	} 
	function registerNavigation(from: string, to: string) {
		if (from === to) return;
		console.log({from, to});
		// TODO we need an option to not do the operation the first time (but only when we redo)?
		undoRedoManager.do({
			scopeName: "filterChange",
			operation: () => window.location.hash = to,
			reverseOperation: () => window.location.hash = from
		});
	}
</script>

<p>{areAllChangesSaved ? 'All Data Saved' : 'Sync Pending'}</p>
<button on:click={() => undoRedoManager.undo()} disabled={!canUndoRedo.canUndo}>Undo</button>
<button on:click={() => undoRedoManager.redo()} disabled={!canUndoRedo.canRedo}>Redo</button>
<TestSync undoRedoManager={undoRedoManager} />
<section class="todoapp">
	<TodoMVC
		items={_list}
		onCreateItem={createTodo}
		onDeleteItem={deleteTodo}
		onUpdateItem={updateTodo}
		onUpdateItemText={updateTodoText}
		onUpdateItemCompleted={updateTodoCompleted}
		onNavigation={registerNavigation}
	/>
</section>
