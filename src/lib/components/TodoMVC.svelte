<script lang="ts">
	/**
	 * This is copied directly from https://github.com/sveltejs/svelte-todomvc and modified to integrate it with Replicache and typescript (plus some minor bug fixes)
	 */
	import 'todomvc-app-css/index.css';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/stores';
	import { get } from "svelte/store";
	import type { Todo, TodoUpdate } from '$lib/replicache/todo';

	const active = (item: Todo) => !item.completed;
	const completed = (item: Todo) => item.completed;

	export let items: Todo[] = [];
	export let onCreateItem: (newTodoText: string) => void;
	export let onUpdateItemText: (id: string, newText: string) => unknown;
	export let onUpdateItemCompleted: (id: string, isCompleted: boolean) => unknown;
	export let onSetAllCompletion: (isCompleted: boolean) => void;
	export let onDeleteItem: (itemId: string) => void;
	export let onDeleteAllCompletedTodos: () => void;
	export let onNavigation: (from: string, to: string) => void;

	let currentFilter = 'all';
	let editedItemId: string | null = null;

	$: filtered =
		currentFilter === 'all'
			? items
			: items.filter(currentFilter === 'completed' ? completed : active);

	$: numActive = items.filter(active).length;

	$: numCompleted = items.filter(completed).length;

	const updateView = () => {
		currentFilter = 'all';
		if (location.hash === '#/active') {
			currentFilter = 'active';
		} else if (location.hash === '#/completed') {
			currentFilter = 'completed';
		}
	};

	let prevHash = get(page).url.hash;
	async function handleFilterClicked(to: string) {
		await tick();
		onNavigation(prevHash, to);
		prevHash = to;
	}

	function toggleAll(event: Event) {
		const isChecked = (event.target as HTMLInputElement).checked;
		onSetAllCompletion(isChecked);
	}

	function createNew(event: KeyboardEvent) {
		const target = event.target as HTMLInputElement;
		if (!target) throw new Error('Bug in create new item. No target found');
		if (target.value && event.key === 'Enter') {
			onCreateItem(target.value);
			target.value = '';
		}
	}

	function handleEdit(event: KeyboardEvent) {
		const target = event.target as HTMLInputElement;
		if (event.key === 'Enter') target.blur();
		else if (event.key === 'Escape') editedItemId = null;
	}

	function submit(event: FocusEvent) {
		if (editedItemId === null) return;
		const target = event.target as HTMLInputElement;
		if (target.value) {
			onUpdateItemText(editedItemId, target.value);
		} else {
			onDeleteItem(editedItemId);
		}
		editedItemId = null;
	}

	onMount(updateView);
</script>

<svelte:window on:hashchange={updateView} />

<header class="header">
	<h1>todos</h1>
	<!-- svelte-ignore a11y-autofocus -->
	<input class="new-todo" on:keydown={createNew} placeholder="What needs to be done?" autofocus />
</header>

{#if items.length > 0}
	<section class="main">
		<input
			id="toggle-all"
			class="toggle-all"
			type="checkbox"
			on:change={toggleAll}
			checked={numCompleted === items.length}
		/>
		<label for="toggle-all">Mark all as complete</label>

		<ul class="todo-list">
			{#each filtered as item (item.id)}
				<li class:completed={item.completed} class:editing={editedItemId === item.id}>
					<div class="view">
						<input
							class="toggle"
							type="checkbox"
							checked={item.completed}
							on:change={() => onUpdateItemCompleted(item.id, !item.completed)}
						/>
						<!-- svelte-ignore a11y-label-has-associated-control -->
						<label on:dblclick={() => (editedItemId = item.id)}>{item.text}</label>
						<button on:click={() => onDeleteItem(item.id)} class="destroy" />
					</div>

					{#if editedItemId === item.id}
						<!-- svelte-ignore a11y-autofocus -->
						<input
							value={item.text}
							id="edit"
							class="edit"
							on:keydown={handleEdit}
							on:blur={submit}
							autofocus
						/>
					{/if}
				</li>
			{/each}
		</ul>

		<footer class="footer">
			<span class="todo-count">
				<strong>{numActive}</strong>
				{numActive === 1 ? 'item' : 'items'} left
			</span>

			<ul class="filters">
				<!-- TODO - refactor this to be a each loop or somehow nicer -->
				<li>
					<a on:click={() => handleFilterClicked("#/")} class:selected={currentFilter === 'all'} href="#/">All</a>
				</li>
				<li>
					<a on:click={() => handleFilterClicked("#/active")} class:selected={currentFilter === 'active'} href="#/active">Active</a>
				</li>
				<li>
					<a on:click={() => handleFilterClicked("#/completed")} class:selected={currentFilter === 'completed'} href="#/completed">Completed</a>
				</li>
			</ul>

			{#if numCompleted}
				<button class="clear-completed" on:click={onDeleteAllCompletedTodos}>Clear completed</button>
			{/if}
		</footer>
	</section>
{/if}
