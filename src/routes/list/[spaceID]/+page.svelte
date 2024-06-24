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
		console.warn("undoRedo sub fired", {...newStatus});
		canUndoRedo = newStatus;
	});	


	onMount(() => {
		replicacheInstance = initReplicache(spaceID);
		replicacheInstance.subscribe(listTodos, (data) => {
			_list = data;
			_list.sort((a: Todo, b: Todo) => a.sort - b.sort);
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
			// it is important to do it here and not in the replicache subscription (the subscription fires on changes we make)
			undoRedoManager.updateCanUndoRedoStatus();
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
			description: `create todo: '${text}''`,
			operation: () => {
				replicacheInstance?.mutate.createTodo(todoToCreate);
			},
			reverseOperation: () => {
				replicacheInstance?.mutate.deleteTodo(id);
			},
			hasUndoConflict: async () => {
				const currentTodo = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (currentTodo === undefined || currentTodo.text !== todoToCreate.text || currentTodo.completed !== todoToCreate.completed);
			}
		});
	}

	function deleteTodo(id: string) {
		const currentTodo = _list.find(todo => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);
		undoRedoManager.do({
			scopeName: `delete_todo:${id}`,
			description: `delete todo: '${currentTodo.text}'`,
			operation: () => replicacheInstance.mutate.deleteTodo(id),
			reverseOperation: () => replicacheInstance.mutate.unDeleteTodo(currentTodo),
			// no conflicts because we use nanoId, so another user can't create that same todo
		});
	}

	function updateTodoText(id: string, newText: string) {
		const currentTodo = _list.find(todo => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);

		if (newText === currentTodo.text) return;

		const updated = {id, text: newText};
		undoRedoManager.do({
			scopeName: `update_todo_text:${id}`,
			description: `update todo text: '${currentTodo.text}' -> '${newText}'`,
			operation: () => replicacheInstance.mutate.updateTodo(updated),
			reverseOperation: () => replicacheInstance.mutate.updateTodo(currentTodo),
			hasUndoConflict: async () => {
				// TODO - why does (tx) needs the async keyword?
				const todoNow = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (!todoNow || todoNow.text !== newText);
			},
			hasRedoConflict: async () => {
				const todoNow = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (!todoNow || todoNow.text !== currentTodo.text);
			}
		});
	}
	// TODO - can/ should I extract all of these functions to another file?
	function updateTodoCompleted(id: string, isCompleted: boolean) {
		const currentTodo = _list.find(todo => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);
		if (isCompleted === currentTodo.completed) return;

		const updated = {id, completed: isCompleted};
		undoRedoManager.do({
			scopeName: `update_todo_completion:${id}`,
			description: `mark todo ${currentTodo.text} ${isCompleted ? 'complete' : 'incomplete'}`,
			operation: () => replicacheInstance.mutate.updateTodo(updated),
			reverseOperation: () => replicacheInstance.mutate.updateTodo(currentTodo),
			hasUndoConflict: async () => {
				const todoNow = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (!todoNow || todoNow.completed !== isCompleted);
			},
			hasRedoConflict: async () => {
				const todoNow = await replicacheInstance.query(async (tx) => getTodoById(tx, id));
				return (!todoNow || todoNow.completed === isCompleted);
			}
		});

	}
	function setAllCompletion(isCompleted: boolean) {
		const initialAllIdsList = _list.map(item => item.id);
		const allIds = new Set(initialAllIdsList);
		// It we keep toggling any remaining items that weren't changed individually (by another user), if no items remain the operation will be removed
		// TODO - refactor to eliminate code duplication
		undoRedoManager.do({
			scopeName: `setAllCompleted:${initialAllIdsList.join(',')}`,
			description: `set all todos ${isCompleted? 'completed' : 'inccompleted'}`,
			operation: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				const remainingItems = currentList.filter(item => allIds.has(item.id)).filter(item => item.completed === !isCompleted);
				allIds.forEach(id => allIds.delete(id));
				remainingItems.forEach(item => allIds.add(item.id));
				remainingItems.forEach(item => {
					replicacheInstance.mutate.updateTodo({...item, completed: isCompleted});
				});
			},
			reverseOperation: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				const remainingItems = currentList.filter(item => allIds.has(item.id)).filter(item => item.completed === isCompleted);
				allIds.forEach(id => allIds.delete(id));
				remainingItems.forEach(item => allIds.add(item.id));
				remainingItems.forEach(item => {
					replicacheInstance.mutate.updateTodo({...item, completed: !isCompleted});
				});
			},
			hasUndoConflict: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				return (currentList.filter(item => allIds.has(item.id)).filter(item => item.completed === isCompleted).length === 0);
			},
			hasRedoConflict: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				return (currentList.filter(item => allIds.has(item.id)).filter(item => item.completed === !isCompleted).length === 0);
			}
		});

	}
	function deleteAllCompletedTodos() {
		const originalList = [..._list];
		const InitialAllIdsList =_list.filter(item => item.completed).map(item => item.id);
		const allIds =  new Set(InitialAllIdsList);
		undoRedoManager.do({
			scopeName: `deleteAllCompleted:${InitialAllIdsList.join(',')}`,
			description: "deleted all completed todos",
			operation: async () => {
				// We could have also remove any items that have different text (changed by another user) if we wanted different UX, I think it is fine as is
				const currentList = await replicacheInstance.query(listTodos);
				const remainingItems = currentList.filter(item => item.completed).filter(item => allIds.has(item.id));
				allIds.forEach(id => allIds.delete(id));
				remainingItems.forEach(item => allIds.add(item.id));
				remainingItems.forEach(item => replicacheInstance.mutate.deleteTodo(item.id));
			},
			reverseOperation: () => {
				originalList.filter(item => allIds.has(item.id)).forEach(item => replicacheInstance.mutate.unDeleteTodo(item));
			},
			hasRedoConflict: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				return (currentList.filter(item => allIds.has(item.id)).length === 0);
			}
		});

	} 
	function registerNavigation(from: string, to: string) {
		if (from === to) return;
		undoRedoManager.do({
			scopeName: "filterChange",
			description: `filter change ${from} -> ${to}`,
			operation: () => window.location.hash = to,
			reverseOperation: () => window.location.hash = from
		});
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
</style>
<p>{areAllChangesSaved ? 'All Data Saved' : 'Sync Pending'}</p>
<section class="undo-redo-bar">
	<button on:click={() => undoRedoManager.undo()} title={canUndoRedo.canUndo ? "Undo " + canUndoRedo.canUndo : ''} disabled={!canUndoRedo.canUndo}>
		<img src="/undo.svg" alt="Undo Icon" />
	</button>
	<button on:click={() => undoRedoManager.redo()} title={canUndoRedo.canRedo ? "Redo " + canUndoRedo.canRedo : ''} disabled={!canUndoRedo.canRedo}>
		<img src="/redo.svg" alt="Redo Icon" />
	</button>
</section>

<TestSync undoRedoManager={undoRedoManager} />
<section class="todoapp">
	<TodoMVC
		items={_list}
		onCreateItem={createTodo}
		onDeleteItem={deleteTodo}
		onUpdateItemText={updateTodoText}
		onUpdateItemCompleted={updateTodoCompleted}
		onSetAllCompletion={setAllCompletion}
		onDeleteAllCompletedTodos={deleteAllCompletedTodos}
		onNavigation={registerNavigation}
	/>
</section>
