<script lang="ts">
	import { onMount } from 'svelte';
	import { Replicache } from 'replicache';
	import { nanoid } from 'nanoid';
	import { source } from 'sveltekit-sse';
	import { mutators, type M } from '$lib/replicache/mutators';
	import { page } from '$app/stores';
	import { listTodos } from '$lib/replicache/todo';
	import type { Todo } from '$lib/replicache/todo';
	import { getTodoById } from '$lib/replicache/todo';

	import TodoMVC from '$lib/components/TodoMVC.svelte';
	import TestSync from '$lib/components/TestSync.svelte';

	import { UndoManager } from '$lib/undo/UndoManager';
	import UndoRedoBar from '$lib/components/UndoRedoBar.svelte';

	const { spaceID } = $page.params;
	let replicacheInstance: Replicache<M>;
	let _list: Todo[] = [];
	let areAllChangesSaved = true;
	let mySessionId = '';
	const undoRedoManager = new UndoManager();
	let canUndoRedo = undoRedoManager.getUndoRedoStatus();
	undoRedoManager.subscribeToCanUndoRedoChange((newStatus) => {
		console.log('undoRedo sub fired', { ...newStatus });
		canUndoRedo = newStatus;
	});

	/* Doing this because replicache doesn't expose info about whether incoming changes are self-inflicted or external */
	$: knownItemIds = _list.map((item) => item.id);
	function updateTodoUndoStatusOnExternalChanges(data: Todo[]) {
		// Without this filtering, it would call it twice on every change, including changes in the current session, which can mess the change reason field
		const listBefore = [..._list];
		const updatedByAnotherBefore = _list.filter((item) => item.updatedBy !== mySessionId);
		const updatedByAnotherNow = data.filter((item) => item.updatedBy !== mySessionId);

		if (
			knownItemIds.find((id) => !data.find((item) => item.id === id)) || // an item was deleted by another session
			updatedByAnotherNow.filter((item) => {
				const prevMe = listBefore.find((prevItem) => prevItem.id === item.id);
				if (!prevMe) return false; // new item
				const prevOther = updatedByAnotherBefore.find((prevItem) => prevItem.id === item.id);
				if (prevMe && !prevOther) return true; // an existing item that was updated by someone else now
				/* this is not perfect - will be called if the other session creates and items and change it, 
				without this session ever touching it - okay for now but not perfect */
				return prevOther?.text !== item.text || prevOther?.completed !== item.completed;
			}).length > 0
		) {
			undoRedoManager.updateCanUndoRedoStatus();
			return true;
		}
		return false;
	}
	// I also couldn't find a way to learn whether our changes were overriden by the server (see the magic words in mutators.js)
	function updateCanUndoRedoStatusOnServerOverridingOurChanges(data: Todo[]) {
		/* I haven't implemented this, but keeping it here as a placeholder, 
		it needs to figure out if what we got back is the actual change we tried to make.
		if not, the undo stack might require an update, 
		noticably the "description" (tooltip) the user sees would be wrong without this.
		*/
	}

	/*************************************/

	onMount(() => {
		replicacheInstance = initReplicache(spaceID);
		mySessionId = replicacheInstance.clientID;
		replicacheInstance.subscribe(listTodos, (data) => {
			if (!updateTodoUndoStatusOnExternalChanges(data)) {
				updateCanUndoRedoStatusOnServerOverridingOurChanges(data);
			}
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
		// The line below is kinda dumb, it prevents Svelte from removing this store at compile time (since it has not subscribers)
		const unsubscribe = sseStore.subscribe(() => {});

		// This allows us to show the user whether all their local data is saved on the server
		replicacheInstance.onSync = async (isSyncing) => {
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
		let isRedo = false;
		const todoToCreate = {
			id,
			text,
			completed: false,
			updatedBy: mySessionId
		};
		let sort = -1;
		undoRedoManager.do({
			scopeName: `create_todo:${id}`,
			description: `create todo: '${text}'`,
			reverseDescription: `uncreate todo: '${text}'`,
			operation: async () => {
				if (isRedo) {
					replicacheInstance.mutate.unDeleteTodo({ ...todoToCreate, sort });
				} else {
					isRedo = true;
					await replicacheInstance.mutate.createTodo(todoToCreate);
					const createdTodo = await replicacheInstance.query((tx) => getTodoById(tx, id));
					if (createdTodo) {
						sort = createdTodo.sort;
					}
				}
			},
			reverseOperation: () => {
				replicacheInstance.mutate.deleteTodo(id);
			},
			hasUndoConflict: async () => {
				const currentTodo = await replicacheInstance.query((tx) => getTodoById(tx, id));
				if (!currentTodo) return true;
				return currentTodo.updatedBy !== mySessionId;
			}
		});
	}

	function deleteTodo(id: string) {
		const currentTodo = _list.find((todo) => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);
		undoRedoManager.do({
			scopeName: `delete_todo:${id}`,
			description: `delete todo: '${currentTodo.text}'`,
			reverseDescription: `undelete_todo:${id}`,
			operation: () => replicacheInstance.mutate.deleteTodo(id),
			reverseOperation: () => replicacheInstance.mutate.unDeleteTodo(currentTodo)
			// no conflicts because we use nanoId, so another user can't create that same todo
		});
	}

	function updateTodoText(id: string, newText: string) {
		const currentTodo = _list.find((todo) => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);

		if (newText === currentTodo.text) return;

		const updated = { id, text: newText, updatedBy: mySessionId };
		undoRedoManager.do({
			scopeName: `update_todo_text:${id}`,
			description: `update todo text: '${currentTodo.text}' -> '${newText}'`,
			reverseDescription: `update todo text: '${newText}' -> '${currentTodo.text}'`,
			operation: () => replicacheInstance.mutate.updateTodo(updated),
			reverseOperation: () => replicacheInstance.mutate.updateTodo(currentTodo),
			hasUndoConflict: async () => {
				const todoNow = await replicacheInstance.query((tx) => getTodoById(tx, id));
				if (!todoNow) return true;
				return todoNow.updatedBy !== mySessionId && todoNow.text !== newText;
			},
			hasRedoConflict: async () => {
				const todoNow = await replicacheInstance.query((tx) => getTodoById(tx, id));
				if (!todoNow) return true;
				return todoNow.updatedBy !== mySessionId && todoNow.text !== currentTodo.text;
			}
		});
	}

	function updateTodoCompleted(id: string, isCompleted: boolean) {
		const currentTodo = _list.find((todo) => todo.id === id);
		if (!currentTodo) throw new Error(`Bug! update todo couldn't find todo ${id}`);
		if (isCompleted === currentTodo.completed) return;

		const updated = { id, completed: isCompleted, updatedBy: mySessionId };
		undoRedoManager.do({
			scopeName: `update_todo_completion:${id}`,
			description: `mark todo ${currentTodo.text} ${isCompleted ? 'complete' : 'incomplete'}`,
			reverseDescription: `mark todo ${currentTodo.text} ${isCompleted ? 'incomplete' : 'complete'}`,
			operation: () => replicacheInstance.mutate.updateTodo(updated),
			reverseOperation: () => replicacheInstance.mutate.updateTodo(currentTodo),
			hasUndoConflict: async () => {
				const todoNow = await replicacheInstance.query((tx) => getTodoById(tx, id));
				if (!todoNow) return true;
				return todoNow.updatedBy !== mySessionId && todoNow.completed !== isCompleted;
			},
			hasRedoConflict: async () => {
				const todoNow = await replicacheInstance.query((tx) => getTodoById(tx, id));
				if (!todoNow) return true;
				return todoNow.updatedBy !== mySessionId && todoNow.completed === isCompleted;
			}
		});
	}

	function setAllCompletion(isCompleted: boolean) {
		const initialAllIdsList = _list.map((item) => item.id);
		const allIds = new Set(initialAllIdsList);
		// It we keep toggling any remaining items that weren't completed/uncompleted individually (by another user), if no items remain the operation will be removed
		undoRedoManager.do({
			scopeName: `setAllCompleted:${initialAllIdsList.join(',')}`,
			description: `set all todos ${isCompleted ? 'completed' : 'inccompleted'}`,
			reverseDescription: `set all todos ${isCompleted ? 'incompleted' : 'ccompleted'}`,
			operation: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				const remainingItems = currentList
					.filter((item) => allIds.has(item.id))
					.filter((item) => item.completed === !isCompleted);
				allIds.forEach((id) => allIds.delete(id));
				remainingItems.forEach((item) => allIds.add(item.id));
				remainingItems.forEach((item) => {
					replicacheInstance.mutate.updateTodo({
						...item,
						updatedBy: mySessionId,
						completed: isCompleted
					});
				});
			},
			reverseOperation: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				const remainingItems = currentList
					.filter((item) => allIds.has(item.id))
					.filter((item) => item.completed === isCompleted);
				allIds.forEach((id) => allIds.delete(id));
				remainingItems.forEach((item) => allIds.add(item.id));
				remainingItems.forEach((item) => {
					replicacheInstance.mutate.updateTodo({ ...item, completed: !isCompleted });
				});
			},
			hasUndoConflict: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				return (
					currentList
						.filter((item) => allIds.has(item.id))
						.filter((item) => item.completed === isCompleted).length === 0
				);
			},
			hasRedoConflict: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				return (
					currentList
						.filter((item) => allIds.has(item.id))
						.filter((item) => item.completed === !isCompleted).length === 0
				);
			}
		});
	}
	function deleteAllCompletedTodos() {
		const originalList = [..._list];
		const InitialAllIdsList = _list.filter((item) => item.completed).map((item) => item.id);
		const allIds = new Set(InitialAllIdsList);
		undoRedoManager.do({
			scopeName: `deleteAllCompleted:${InitialAllIdsList.join(',')}`,
			description: 'delete completed todos',
			reverseDescription: 'undelete completed todos',
			operation: async () => {
				let currentList = await replicacheInstance.query(listTodos);
				// if the another session adds or deletes items that's fine, even if they are completed they won't be deleted by a redo
				currentList = currentList.filter((item) => allIds.has(item.id));
				currentList.forEach((item) => replicacheInstance.mutate.deleteTodo(item.id));
			},
			reverseOperation: () => {
				originalList
					.filter((item) => allIds.has(item.id))
					.forEach((item) => replicacheInstance.mutate.unDeleteTodo(item));
			},
			hasRedoConflict: async () => {
				const currentList = await replicacheInstance.query(listTodos);
				return !!currentList
					.filter((item) => allIds.has(item.id))
					.find((item) => item.updatedBy !== mySessionId);
			}
		});
	}
	function registerNavigation(from: string, to: string) {
		if (from === to) return;
		undoRedoManager.do({
			scopeName: 'filterChange',
			description: `filter change ${from} -> ${to}`,
			reverseDescription: `filter change ${to} -> ${from}`,
			operation: () => (window.location.hash = to),
			reverseOperation: () => (window.location.hash = from)
		});
	}
</script>

<p>{areAllChangesSaved ? 'All Data Saved' : 'Sync Pending'}</p>

<UndoRedoBar {canUndoRedo} onUndo={undoRedoManager.undo} onRedo={undoRedoManager.redo} />

<TestSync
	doOp={undoRedoManager.do}
	updateCanUndoRedoStatus={undoRedoManager.updateCanUndoRedoStatus}
/>
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
